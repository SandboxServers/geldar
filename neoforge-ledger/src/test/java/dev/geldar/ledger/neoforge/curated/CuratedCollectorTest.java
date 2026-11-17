package dev.geldar.ledger.neoforge.curated;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;
import net.neoforged.bus.api.Event;
import net.neoforged.neoforge.event.entity.player.PlayerContainerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.level.BlockEvent;
import net.neoforged.neoforge.event.level.block.BreakBlockEvent;
import org.junit.jupiter.api.Test;

/** No Minecraft objects: a fake ledger, a fake clock, a fake bus and fake readers. Every family lambda is invoked. */
class CuratedCollectorTest {
    static final String LIFE = "ag_ada_01";
    final AtomicLong clock = new AtomicLong(1_000_000_000L);
    final List<String> names = new ArrayList<>();
    final List<String[]> fields = new ArrayList<>();
    final List<Object[]> records = new ArrayList<>();
    final AtomicBoolean guardAllowed = new AtomicBoolean(true);
    final AtomicBoolean mainThread = new AtomicBoolean(true);
    final AtomicInteger guardCalls = new AtomicInteger();
    final AtomicBoolean recordThrows = new AtomicBoolean();
    final AtomicBoolean guardEndThrows = new AtomicBoolean();

    private Ledger ledger(boolean enabled) {
        Properties p = new Properties();
        if (enabled) {
            p.setProperty("collector.curated.enabled", "true");
        }
        LedgerConfig cfg = ConfigParser.parse(p).config();
        EventLog events = (EventLog) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (px, m, a) -> {
                    if (m.getName().equals("register")) {
                        names.add((String) a[0]);
                        fields.add((String[]) a[3]);
                        return names.size() - 1;
                    }
                    if (m.getName().equals("record")) {
                        if (recordThrows.get()) {
                            throw new IllegalStateException("boom");
                        }
                        records.add(a);
                    }
                    return null;
                });
        CollectorGuard guard = new CollectorGuard() {
            @Override
            public boolean allowed() {
                guardCalls.incrementAndGet();
                return guardAllowed.get();
            }

            @Override
            public long begin() {
                guardCalls.incrementAndGet();
                return 5;
            }

            @Override
            public void end(long token) {
                guardCalls.incrementAndGet();
                if (guardEndThrows.get()) {
                    throw new IllegalStateException("end");
                }
            }
        };
        return (Ledger) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (px, m, a) ->
                switch (m.getName()) {
                    case "events" -> events;
                    case "guard" -> guard;
                    case "config" -> cfg;
                    default -> null;
                });
    }

    private CuratedCollector started(boolean enabled) {
        CuratedCollector c = new CuratedCollector(clock::get);
        Ledger l = ledger(enabled);
        HostInfo host = new HostInfo() {
            @Override
            public long serverTick() {
                return 0;
            }

            @Override
            public boolean isMainThread() {
                return mainThread.get();
            }

            @Override
            public String loaderName() {
                return "test";
            }
        };
        c.start(new CollectorContext() {
            @Override
            public Ledger ledger() {
                return l;
            }

            @Override
            public HostScheduler scheduler() {
                return null;
            }

            @Override
            public HostInfo host() {
                return host;
            }
        });
        return c;
    }

    private static CuratedFields at(String player, boolean cancelled) {
        return new CuratedFields(1, -2, 3, player, "minecraft:stone", "minecraft:overworld", cancelled);
    }

    @Test
    void offUnlessEnabled() {
        CuratedCollector c = started(false);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        assertFalse(c.active());
        assertEquals(List.of(), names);
        assertEquals(0, records.size());
    }

    @Test
    void registersEightEventsWithParityNamesAndFields() {
        started(true);
        assertEquals(
                List.of(
                        "geldar.block.break", "geldar.block.break_cancelled", "geldar.block.place",
                        "geldar.block.place_cancelled", "geldar.item.craft", "geldar.item.smelt",
                        "geldar.container.open", "geldar.container.close"),
                names);
        assertEquals(List.of(AttrKeys.X, AttrKeys.Y, AttrKeys.Z, AttrKeys.LIFE_ID, AttrKeys.BLOCK, AttrKeys.WORLD), List.of(fields.get(0)));
        assertEquals(AttrKeys.ITEM, fields.get(4)[4]);
        assertEquals(AttrKeys.CONTAINER_TYPE, fields.get(6)[4]);
    }

    @Test
    void lifeIdKeptHumanDropped() {
        CuratedCollector c = started(true);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        c.handle(CuratedKind.BREAK, () -> at("Steve", false));
        c.handle(CuratedKind.BREAK, () -> at(null, false));
        assertEquals(LIFE, records.get(0)[4]);
        assertNull(records.get(1)[4]);
        assertNull(records.get(2)[4]);
        assertEquals(1L, records.get(0)[1]);
        assertEquals(-2L, records.get(0)[2]);
        assertEquals("minecraft:stone", records.get(0)[5]);
        assertEquals("minecraft:overworld", records.get(0)[6]);
    }

    @Test
    void cancelledBreakAndPlaceAreMarkedNotDropped() {
        CuratedCollector c = started(true);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, true));
        c.handle(CuratedKind.PLACE, () -> at(LIFE, true));
        c.handle(CuratedKind.CRAFT, () -> at(LIFE, true));
        assertEquals(1, records.get(0)[0]); // break_cancelled
        assertEquals(3, records.get(1)[0]); // place_cancelled
        assertEquals(4, records.get(2)[0]); // craft has no twin
    }

    @Test
    void bucketComesBeforeReading() {
        CuratedCollector c = started(true);
        AtomicInteger reads = new AtomicInteger();
        for (int i = 0; i < 100; i++) {
            c.handle(CuratedKind.SMELT, () -> {
                reads.incrementAndGet();
                return at(LIFE, false);
            });
        }
        assertEquals(CuratedCollector.RATE, reads.get());
        assertEquals(CuratedCollector.RATE, records.size());
        assertEquals(100 - CuratedCollector.RATE, c.rateDrops());
        clock.addAndGet(2_000_000_000L); // refill
        c.handle(CuratedKind.SMELT, () -> at(LIFE, false));
        assertEquals(CuratedCollector.RATE + 1, records.size());
    }

    @Test
    void bucketsAreIndependentPerKind() {
        CuratedCollector c = started(true);
        for (int i = 0; i < 100; i++) {
            c.handle(CuratedKind.SMELT, () -> at(LIFE, false));
        }
        int before = records.size();
        c.handle(CuratedKind.CRAFT, () -> at(LIFE, false));
        assertEquals(before + 1, records.size());
    }

    @Test
    void guardDeniedReadsNothing() {
        CuratedCollector c = started(true);
        guardAllowed.set(false);
        AtomicInteger reads = new AtomicInteger();
        c.handle(CuratedKind.BREAK, () -> {
            reads.incrementAndGet();
            return at(LIFE, false);
        });
        assertEquals(0, reads.get());
        assertEquals(0, records.size());
    }

    @Test
    void asyncThreadNeverTouchesTheGuard() {
        CuratedCollector c = started(true);
        mainThread.set(false);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        assertEquals(0, guardCalls.get());
        assertEquals(1, records.size());
    }

    @Test
    void mainThreadEndsTheGuardOnEveryPath() {
        CuratedCollector c = started(true);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false)); // allowed, begin, end
        assertEquals(3, guardCalls.get());
        guardCalls.set(0);
        c.handle(CuratedKind.BREAK, () -> {
            throw new IllegalStateException("reader");
        }); // allowed, begin, end despite the throw
        assertEquals(3, guardCalls.get());
        assertEquals(1, c.errorCount());
    }

    @Test
    void nothingEscapes() {
        CuratedCollector c = started(true);
        recordThrows.set(true);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        assertEquals(1, c.errorCount());
        recordThrows.set(false);
        guardEndThrows.set(true);
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        assertEquals(2, c.errorCount());
        guardEndThrows.set(false);
        c.handle(CuratedKind.BREAK, () -> null); // a reader that ignores the event
        assertEquals(2, c.errorCount());
    }

    @Test
    void stopSilencesAndRestartWorks() {
        CuratedCollector c = started(true);
        c.stop();
        c.handle(CuratedKind.BREAK, () -> at(LIFE, false));
        assertEquals(0, records.size());
        assertFalse(c.active());
        c.stop(); // twice is fine
    }

    @Test
    void identityNeverLeaksHumanNameIntoAnyField() {
        CuratedCollector c = started(true);
        c.handle(CuratedKind.CONTAINER_OPEN, () -> at("Steve", false));
        for (Object o : records.get(0)) {
            assertFalse(String.valueOf(o).contains("Steve"));
        }
    }

    /** Every family lambda: the right kind, the reader's fields, cancelled twins, and a null event is harmless. */
    @Test
    void everyLambdaRoutesToItsKind() {
        CuratedCollector c = started(true);
        List<String> seen = new ArrayList<>();
        Readers r = new Readers() {
            private CuratedFields f(String tag, boolean cancelled) {
                seen.add(tag);
                return at(LIFE, cancelled);
            }

            @Override
            public CuratedFields breakBlock(BreakBlockEvent e) {
                return f("break", true);
            }

            @Override
            public CuratedFields place(BlockEvent.EntityPlaceEvent e) {
                return f("place", false);
            }

            @Override
            public CuratedFields craft(PlayerEvent.ItemCraftedEvent e) {
                return f("craft", false);
            }

            @Override
            public CuratedFields smelt(PlayerEvent.ItemSmeltedEvent e) {
                return f("smelt", false);
            }

            @Override
            public CuratedFields open(PlayerContainerEvent.Open e) {
                return f("open", false);
            }

            @Override
            public CuratedFields close(PlayerContainerEvent.Close e) {
                return f("close", false);
            }
        };
        List<Class<?>> types = new ArrayList<>();
        List<Consumer<? extends Event>> handlers = new ArrayList<>();
        Bus bus = new Bus() {
            @Override
            public <E extends Event> void listen(Class<E> type, Consumer<E> handler) {
                types.add(type);
                handlers.add(handler);
            }
        };
        BlocksItemsFamily.register(bus, c, r);
        ContainersFamily.register(bus, c, r);
        assertEquals(
                List.of(
                        BreakBlockEvent.class, BlockEvent.EntityPlaceEvent.class, PlayerEvent.ItemCraftedEvent.class,
                        PlayerEvent.ItemSmeltedEvent.class, PlayerContainerEvent.Open.class,
                        PlayerContainerEvent.Close.class),
                types);
        for (Consumer<? extends Event> h : handlers) {
            @SuppressWarnings("unchecked")
            Consumer<Event> any = (Consumer<Event>) h;
            any.accept(null); // the readers ignore the event; the lambdas must not touch it themselves
        }
        assertEquals(List.of("break", "place", "craft", "smelt", "open", "close"), seen);
        // break (cancelled -> id 1), place 2, craft 4, smelt 5, open 6, close 7
        assertEquals(List.of(1, 2, 4, 5, 6, 7), records.stream().map(x -> x[0]).toList());
        assertTrue(c.errorCount() == 0);
    }
}
