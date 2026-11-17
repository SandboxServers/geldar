package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.Collector;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.Names;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.function.LongSupplier;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Collector construction: the factory seam, configured paths, and the skip and failure logging. */
class PaperCollectorsTest {
    @TempDir Path tmp;

    private final List<LogRecord> logs = new ArrayList<>();
    private final Map<String, LongSupplier> gauges = new HashMap<>();
    private final List<Runnable> timers = new ArrayList<>();

    private Logger logger() {
        Logger l = Logger.getAnonymousLogger();
        l.setUseParentHandlers(false);
        l.addHandler(new Handler() {
            @Override
            public void publish(LogRecord r) {
                logs.add(r);
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        return l;
    }

    private CollectorContext ctx() {
        Ledger ledger = (Ledger) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> {
                    if (m.getName().equals("gaugeLong")) {
                        gauges.put((String) a[0], (LongSupplier) a[3]);
                    }
                    return null;
                });
        HostScheduler sched = new HostScheduler() {
            @Override
            public Cancellable everyTicks(int ticks, Runnable r) {
                throw new AssertionError("main thread scheduling");
            }

            @Override
            public Cancellable everyMillis(long ms, Runnable r) {
                timers.add(r);
                return () -> {};
            }
        };
        HostInfo host = new HostInfo() {
            public long serverTick() {
                return 0;
            }

            public boolean isMainThread() {
                return false;
            }

            public String loaderName() {
                return "test";
            }
        };
        return new CollectorContext() {
            public Ledger ledger() {
                return ledger;
            }

            public HostScheduler scheduler() {
                return sched;
            }

            public HostInfo host() {
                return host;
            }
        };
    }

    private static LedgerConfig config(String... kv) {
        Properties p = new Properties();
        for (int i = 0; i < kv.length; i += 2) {
            p.setProperty(kv[i], kv[i + 1]);
        }
        var r = ConfigParser.parse(p);
        assertTrue(r.ok(), r.errors().toString());
        return r.config();
    }

    private long count(Level level, String text) {
        return logs.stream().filter(r -> r.getLevel() == level && r.getMessage().contains(text)).count();
    }

    @Test
    void cgroupCollectorReadsTheConfiguredRoot() throws IOException {
        Path root = tmp.resolve("cg");
        Files.createDirectories(root);
        Files.writeString(root.resolve("cpu.stat"), "nr_periods 200\nnr_throttled 50\nthrottled_usec 2500000\n");
        Files.writeString(root.resolve("memory.current"), "123456");
        Files.writeString(root.resolve("memory.max"), "2048");
        PaperCollectors c = new PaperCollectors(List.of(PaperCollectors.CGROUP), new PaperCollectors.DefaultFactory(getClass().getClassLoader()), ctx(), logger());
        c.apply(config("container.cgroup_root", root.toString()));
        assertEquals(List.of("container"), c.runningIds());
        timers.get(0).run();
        assertEquals(123456, gauges.get(Names.Container.MEMORY_BYTES).getAsLong(), "read from the configured root, not /sys/fs/cgroup");
    }

    @Test
    void diskCollectorMeasuresOnlyTheConfiguredAreas() throws IOException {
        Path world = tmp.resolve("world");
        Files.createDirectories(world);
        Files.write(world.resolve("r.mca"), new byte[1000]);
        PaperCollectors c = new PaperCollectors(List.of(PaperCollectors.DISK), new PaperCollectors.DefaultFactory(getClass().getClassLoader()), ctx(), logger());
        c.apply(config("disk.area.world.path", world.toString()));
        assertEquals(List.of("disk"), c.runningIds());
        assertEquals(1, timers.size());
        timers.get(0).run();
        assertTrue(gauges.get(Names.Disk.BYTES).getAsLong() >= 1000);
    }

    @Test
    void diskCollectorWithNoConfiguredAreaIsNotStartedAndSaysSoOnce() {
        PaperCollectors c = new PaperCollectors(List.of(PaperCollectors.DISK), new PaperCollectors.DefaultFactory(getClass().getClassLoader()), ctx(), logger());
        c.apply(config());
        c.apply(config());
        assertTrue(c.runningIds().isEmpty());
        assertEquals(List.of(PaperCollectors.DISK), c.skippedNames());
        assertEquals(1, count(Level.INFO, "no disk.area"));
        assertEquals(0, logs.stream().filter(r -> r.getLevel().intValue() >= Level.WARNING.intValue()).count());
        assertTrue(timers.isEmpty());
    }

    @Test
    void aMissingClassIsInfoOnlyAndAThrowingFactoryIsOneWarningAndNeverThrows() {
        PaperCollectors.CollectorFactory factory = (name, cfg) -> {
            if (name.equals("missing")) {
                throw new ClassNotFoundException(name);
            }
            if (name.equals("broken")) {
                throw new IllegalStateException("x");
            }
            if (name.equals("linkage")) {
                throw new NoClassDefFoundError(name);
            }
            return new Collector() {
                public String id() {
                    return "fine";
                }

                public void start(CollectorContext c) {}

                public void stop() {}
            };
        };
        PaperCollectors c = new PaperCollectors(List.of("missing", "broken", "linkage", "ok"), factory, ctx(), logger());
        c.apply(config());
        c.apply(config());
        assertEquals(List.of("fine"), c.runningIds());
        assertEquals(List.of("broken", "missing", "linkage"), c.skippedNames());
        assertEquals(1, logs.stream().filter(r -> r.getLevel() == Level.WARNING).count(), "only the broken one warns");
        assertEquals(1, count(Level.WARNING, "broken"));
        assertEquals(1, logs.stream().filter(r -> r.getLevel() == Level.INFO).count(), "one INFO line for the absent classes");
        assertFalse(logs.stream().anyMatch(r -> r.getThrown() != null), "no stack traces");
    }
}