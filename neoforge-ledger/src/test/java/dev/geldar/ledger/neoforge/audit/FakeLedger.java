package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.ContentLog;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** A recording ledger for the PT-N8 tests: registered names, recorded events and content, and guard traffic. */
final class FakeLedger {
    final List<String> registered = new ArrayList<>();
    final List<List<String>> registeredFields = new ArrayList<>();
    final List<Object[]> events = new ArrayList<>();
    final List<String[]> content = new ArrayList<>();
    final AtomicInteger guardBegins = new AtomicInteger();
    final AtomicInteger guardEnds = new AtomicInteger();
    final AtomicBoolean guardAllowed = new AtomicBoolean(true);
    final AtomicBoolean main = new AtomicBoolean(true);
    final AtomicBoolean recordThrows = new AtomicBoolean();
    /** Event name to the rate it was registered with (content registrations have none). */
    final java.util.Map<String, Integer> registeredRates = new java.util.HashMap<>();
    /** The ledger config, read on every event: audit and chat are on by default here; tests swap it. */
    volatile LedgerConfig config = config("collector.audit.enabled=true", "collector.chat.enabled=true");

    /** A chat family with an explicit, empty online-name source (the production default fails closed). */
    TextContentFamily text(java.util.function.LongSupplier clock) {
        TextContentFamily t = new TextContentFamily(ledger, clock);
        t.onlineNames(java.util.List::of);
        return t;
    }

    static LedgerConfig config(String... lines) {
        java.util.Properties p = new java.util.Properties();
        for (String l : lines) {
            int i = l.indexOf('=');
            p.setProperty(l.substring(0, i), l.substring(i + 1));
        }
        return ConfigParser.parse(p).config();
    }

    final HostInfo host = new HostInfo() {
        @Override
        public long serverTick() {
            return 0;
        }

        @Override
        public String loaderName() {
            return "fake";
        }

        @Override
        public boolean isMainThread() {
            return main.get();
        }
    };

    final Ledger ledger = (Ledger) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {Ledger.class}, (p, m, a) -> switch (m.getName()) {
                case "events" -> eventLog();
                case "content" -> contentLog();
                case "guard" -> guard();
                case "config" -> config;
                default -> throw new UnsupportedOperationException(m.getName());
            });

    private EventLog eventLog() {
        return (EventLog) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "register" -> {
                    registered.add((String) a[0]);
                    registeredRates.put((String) a[0], (Integer) a[2]);
                    registeredFields.add(Arrays.asList((String[]) a[3]));
                    return registered.size() - 1;
                }
                case "record" -> {
                    if (recordThrows.get()) {
                        throw new IllegalStateException("boom");
                    }
                    events.add(a);
                    return null;
                }
                default -> throw new UnsupportedOperationException(m.getName());
            }
        });
    }

    private ContentLog contentLog() {
        return (ContentLog) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {ContentLog.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "register" -> {
                    registered.add((String) a[0]);
                    registeredFields.add(Arrays.asList((String[]) a[1]));
                    return registered.size() - 1;
                }
                case "record" -> {
                    if (recordThrows.get()) {
                        throw new IllegalStateException("boom");
                    }
                    content.add(new String[] {(String) a[1], (String) a[2], (String) a[3], (String) a[4]});
                    return null;
                }
                default -> throw new UnsupportedOperationException(m.getName());
            }
        });
    }

    private CollectorGuard guard() {
        return new CollectorGuard() {
            @Override
            public boolean allowed() {
                return guardAllowed.get();
            }

            @Override
            public long begin() {
                guardBegins.incrementAndGet();
                return 5;
            }

            @Override
            public void end(long token) {
                guardEnds.incrementAndGet();
            }
        };
    }
}
