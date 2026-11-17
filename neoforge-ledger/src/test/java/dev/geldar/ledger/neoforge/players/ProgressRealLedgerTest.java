package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.OtelLedger;
import io.opentelemetry.api.OpenTelemetry;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

/** The real {@link OtelLedger} enforces the positional slot kinds (longs, then strings), which a fake cannot. */
class ProgressRealLedgerTest {
    private final HostInfo host = new HostInfo() {
        public long serverTick() {
            return 1;
        }

        public boolean isMainThread() {
            return false;
        }

        public String loaderName() {
            return "neoforge";
        }
    };

    @Test
    void earnAndGrantReachTheSinkWithLifeIdAndKeyAsStringsAndFlagAsANumber() throws Exception {
        List<Map<String, Object>> seen = new CopyOnWriteArrayList<>();
        Properties p = new Properties();
        p.setProperty("collector.progress.enabled", "true");
        OtelLedger ledger = new OtelLedger(
                ConfigParser.parse(p).config(),
                host,
                Logger.getLogger("test"),
                OpenTelemetry.noop().getMeter("t"),
                true,
                (n, s, b, a, t) -> {
                    if (n.equals(Names.Events.PLAYER_ADVANCEMENT)) {
                        seen.add(a);
                    }
                });
        try {
            ProgressCollector c = new ProgressCollector(() -> java.nio.file.Path.of("no-such-stats-dir"), ms -> {});
            c.start(new CollectorContext() {
                public Ledger ledger() {
                    return ledger;
                }

                public HostScheduler scheduler() {
                    return new HostScheduler() {
                        public Cancellable everyTicks(int t, Runnable r) {
                            return () -> {};
                        }

                        public Cancellable everyMillis(long ms, Runnable r) {
                            return () -> {};
                        }
                    };
                }

                public HostInfo host() {
                    return host;
                }
            });
            c.advancement("ag_ada_01", "minecraft:story/root", true);
            c.advancement("ag_ada_01", "minecraft:story/root", false);
            long end = System.nanoTime() + 5_000_000_000L;
            while (seen.size() < 2 && System.nanoTime() < end) {
                Thread.sleep(10);
            }
            assertEquals(2, seen.size());
            List<Long> flags = new java.util.ArrayList<>();
            for (Map<String, Object> a : seen) {
                assertEquals("ag_ada_01", a.get(AttrKeys.LIFE_ID));
                assertEquals("minecraft:story/root", a.get(AttrKeys.SUBTYPE));
                assertTrue(a.get(AttrKeys.FLAG) instanceof Number, String.valueOf(a));
                flags.add(((Number) a.get(AttrKeys.FLAG)).longValue());
            }
            assertTrue(flags.containsAll(List.of(0L, 1L)), flags.toString());
        } finally {
            ledger.close();
        }
    }
}
