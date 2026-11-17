package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.UnsafeValues;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The shell against fake Server, scheduler and plugin manager (no running server). */
class LedgerPluginTest {
    static final List<String> LOG = new ArrayList<>();

    public static class GoodA implements Collector {
        public String id() { return "good_a"; }
        public void start(CollectorContext ctx) { LOG.add("start a"); }
        public void stop() { LOG.add("stop a"); }
    }

    public static class GoodB implements Collector {
        public String id() { return "good_b"; }
        public void start(CollectorContext ctx) { LOG.add("start b"); }
        public void stop() { LOG.add("stop b"); }
    }

    public static class Bad implements Collector {
        public String id() { return "bad"; }
        public void start(CollectorContext ctx) { throw new IllegalStateException("boom"); }
        public void stop() { LOG.add("stop bad"); }
    }

    static LedgerPluginTest current;
    static final Server SERVER = (Server) Proxy.newProxyInstance(
            LedgerPluginTest.class.getClassLoader(), new Class<?>[] {Server.class}, (p, m, a) -> switch (m.getName()) {
                case "getScheduler" -> current.scheduler;
                case "getPluginManager" -> current.manager;
                case "getLogger" -> Logger.getLogger("ledger-test");
                case "getCurrentTick" -> 7;
                case "isPrimaryThread" -> true;
                case "getUnsafe" -> Proxy.newProxyInstance(
                        LedgerPluginTest.class.getClassLoader(),
                        new Class<?>[] {UnsafeValues.class},
                        (p2, m2, a2) -> defaultFor(m2.getReturnType()));
                case "shutdown" -> {
                    current.shutdowns++;
                    yield null;
                }
                default -> defaultFor(m.getReturnType());
            });

    static {
        // Bukkit.setServer needs Paper's build-info provider, which a bare classpath does not have: set the field.
        try {
            java.lang.reflect.Field f = Bukkit.class.getDeclaredField("server");
            f.setAccessible(true);
            if (f.get(null) == null) {
                f.set(null, SERVER);
            }
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    BukkitScheduler scheduler;
    PluginManager manager;
    @TempDir Path tmp;    final List<Runnable> asyncTimers = new ArrayList<>();
    final List<String> schedulerCalls = new ArrayList<>();
    final List<Plugin> disabled = new ArrayList<>();
    int shutdowns;
    boolean throwOnDisable;

    @BeforeEach
    void clearLog() {
        current = this;
        LOG.clear();
    }

    static Object defaultFor(Class<?> t) {
        if (t == boolean.class) return false;
        if (t == int.class) return 0;
        if (t == long.class) return 0L;
        return null;
    }

    private BukkitTask task() {
        return (BukkitTask) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {BukkitTask.class}, (p, m, a) -> defaultFor(m.getReturnType()));
    }

    private LedgerPlugin plugin(Path dataFolder, Class<?>... collectors) {
        BukkitScheduler schedulerProxy = (BukkitScheduler) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {BukkitScheduler.class}, (p, m, a) -> {
                    schedulerCalls.add(m.getName());
                    switch (m.getName()) {
                        case "runTask" -> ((Runnable) a[1]).run(); // the main thread hop, run inline
                        case "runTaskTimerAsynchronously" -> asyncTimers.add((Runnable) a[1]);
                        default -> {}
                    }
                    return m.getReturnType() == BukkitTask.class ? task() : defaultFor(m.getReturnType());
                });
        PluginManager managerProxy = (PluginManager) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {PluginManager.class}, (p, m, a) -> {
                    if (m.getName().equals("disablePlugin")) {
                        disabled.add((Plugin) a[0]);
                        if (throwOnDisable) throw new IllegalStateException("boom");
                    }
                    return defaultFor(m.getReturnType());
                });
        scheduler = schedulerProxy;
        manager = managerProxy;

        LedgerPlugin plugin = newPlugin(dataFolder);
        for (Class<?> c : collectors) plugin.collectorNames.add(c.getName());
        return plugin;
    }

    /**
     * JavaPlugin's constructors need a PluginLoader service that only a Paper server provides, so the instance is
     * allocated without running them and the three fields the shell reads are set.
     */
    private LedgerPlugin newPlugin(Path dataFolder) {
        try {
            java.lang.reflect.Field u = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
            u.setAccessible(true);
            LedgerPlugin plugin = (LedgerPlugin) ((sun.misc.Unsafe) u.get(null)).allocateInstance(LedgerPlugin.class);
            plugin.collectorNames = new ArrayList<>();
            set(plugin, "server", SERVER);
            set(plugin, "dataFolder", dataFolder.toFile());
            set(plugin, "logger", Logger.getLogger("ledger-test"));
            return plugin;
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void set(Object o, String field, Object value) throws ReflectiveOperationException {
        java.lang.reflect.Field f = org.bukkit.plugin.java.JavaPlugin.class.getDeclaredField(field);
        f.setAccessible(true);
        f.set(o, value);
    }

    private void poll() {
        assertEquals(1, asyncTimers.size());
        asyncTimers.get(0).run();
    }

    private void writeConfig(Path dir, String text) throws IOException {
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("ledger.properties"), text);
    }

    @Test
    void aCollectorWhoseStartThrowsIsDisabledAndTheOthersStillStart() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"), GoodA.class, Bad.class, GoodB.class);
        plugin.onEnable();
        poll();
        assertEquals(List.of("good_a", "good_b"), plugin.collectors().runningIds());
        assertTrue(disabled.isEmpty());
        // a later poll must not retry the failed collector
        plugin.applyConfig(dev.geldar.ledger.core.LedgerConfig.defaults());
        assertEquals(List.of("good_a", "good_b"), plugin.collectors().runningIds());
        assertEquals(1, LOG.stream().filter("stop bad"::equals).count());
    }

    @Test
    void aThrowingCoreFactoryDisablesThePluginAndNeverShutsTheServerDown() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"), GoodA.class);
        plugin.coreFactory = cfg -> {
            throw new IllegalStateException("no core");
        };
        assertDoesNotThrow(plugin::onEnable);
        assertEquals(List.of(plugin), disabled);
        assertEquals(0, shutdowns);
        assertTrue(asyncTimers.isEmpty());
        assertDoesNotThrow(plugin::onDisable);
    }

    @Test
    void aFailingDisablePluginCallDoesNotEscapeEither() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"));
        plugin.coreFactory = cfg -> {
            throw new IllegalStateException("no core");
        };
        throwOnDisable = true;
        assertDoesNotThrow(plugin::onEnable);
        assertEquals(0, shutdowns);
    }

    @Test
    void flippingTheMasterSwitchOffThroughTheWatcherStopsEveryCollectorAndListener() throws IOException {
        Path data = tmp.resolve("data");
        writeConfig(data, "enabled=true");
        LedgerPlugin plugin = plugin(data, GoodA.class, GoodB.class);
        plugin.onEnable();
        poll();
        assertEquals(List.of("good_a", "good_b"), plugin.collectors().runningIds());
        plugin.listeners().register(new ListenerRegistryTest.JoinQuitListener());
        assertEquals(1, plugin.listeners().count());

        writeConfig(data, "enabled=false");
        poll();

        assertEquals(List.of(), plugin.collectors().runningIds());
        assertEquals(0, plugin.listeners().count());
        assertEquals(List.of("start a", "start b", "stop b", "stop a"), LOG); // reverse order

        writeConfig(data, "enabled=true"); // and back on
        poll();
        assertEquals(List.of("good_a", "good_b"), plugin.collectors().runningIds());
    }

    @Test
    void aPerCollectorFlagStopsOnlyThatCollector() throws IOException {
        Path data = tmp.resolve("data");
        writeConfig(data, "enabled=true");
        LedgerPlugin plugin = plugin(data, GoodA.class, GoodB.class);
        plugin.onEnable();
        poll();
        writeConfig(data, "collector.good_a.enabled=false");
        poll();
        assertEquals(List.of("good_b"), plugin.collectors().runningIds());
    }

    @Test
    void aMissingCollectorClassIsSkippedSilently() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"), GoodA.class);
        plugin.collectorNames.add(0, "dev.geldar.ledger.paper.nope.MissingCollector");
        plugin.onEnable();
        poll();
        assertEquals(1, plugin.collectors().loadedCount());
        assertEquals(List.of("good_a"), plugin.collectors().runningIds());
    }

    @Test
    void theRealCollectorListSkipsEverythingNotYetBuiltWithoutFailing() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"));
        plugin.collectorNames = PaperCollectors.NAMES;
        plugin.onEnable();
        poll();
        assertTrue(disabled.isEmpty());
    }

    @Test
    void aMissingConfigMeansDefaultsAndNothingIsCreatedOnDisk() {
        Path data = tmp.resolve("data");
        LedgerPlugin plugin = plugin(data, GoodA.class);
        plugin.onEnable();
        poll();
        assertEquals(List.of("good_a"), plugin.collectors().runningIds());
        assertFalse(Files.exists(data));
    }

    @Test
    void theConfigIsPolledOnTheAsyncSchedulerOnlyAndNeverReadAtEnable() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"), GoodA.class);
        plugin.onEnable();
        assertEquals(List.of("runTaskTimerAsynchronously"), schedulerCalls);
        assertTrue(plugin.collectors().runningIds().isEmpty()); // nothing is read or started before the first poll
    }

    @Test
    void onDisableStopsCollectorsInReverseOrderAndUnregistersListeners() {
        LedgerPlugin plugin = plugin(tmp.resolve("data"), GoodA.class, GoodB.class);
        plugin.onEnable();
        poll();
        plugin.listeners().register(new ListenerRegistryTest.JoinQuitListener());
        plugin.onDisable();
        assertEquals(List.of("start a", "start b", "stop b", "stop a"), LOG);
        assertEquals(0, plugin.listeners().count());
        assertDoesNotThrow(plugin::onDisable);
    }

    @Test
    void hostSchedulerPeriodsRoundUpToWholeTicksWithAMinimumOfOne() {
        assertEquals(100, PaperHostScheduler.periodTicks(5000));
        assertEquals(1, PaperHostScheduler.periodTicks(1));
        assertEquals(1, PaperHostScheduler.periodTicks(0));
        assertEquals(2, PaperHostScheduler.periodTicks(51));
    }

    @Test
    void aThrowingScheduledTaskDoesNotEscape() {
        List<Runnable> captured = new ArrayList<>();
        List<Long> periods = new ArrayList<>();
        BukkitScheduler schedulerProxy = (BukkitScheduler) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {BukkitScheduler.class}, (p, m, a) -> {
                    captured.add((Runnable) a[1]);
                    periods.add((Long) a[3]);
                    return task();
                });
        Plugin plugin = (Plugin) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Plugin.class}, (p, m, a) -> defaultFor(m.getReturnType()));
        PaperHostScheduler host = new PaperHostScheduler(plugin, schedulerProxy, Logger.getAnonymousLogger());
        host.everyTicks(0, () -> {
            throw new IllegalStateException("boom");
        });
        assertEquals(List.of(1L), periods); // a zero period becomes one tick
        assertDoesNotThrow(() -> captured.get(0).run());
        assertDoesNotThrow(() -> captured.get(0).run());
    }
}
