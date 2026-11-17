package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.CollectorGuard;
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
                default -> throw new UnsupportedOperationException(m.getName());
            });

    private EventLog eventLog() {
        return (EventLog) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {EventLog.class}, (p, m, a) -> {
            switch (m.getName()) {
                case "register" -> {
                    registered.add((String) a[0]);
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
