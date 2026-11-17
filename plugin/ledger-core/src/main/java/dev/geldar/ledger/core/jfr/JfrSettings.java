package dev.geldar.ledger.core.jfr;

import java.time.Duration;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Which JFR events the runner may enable, and with what explicit period or threshold. An event is enabled only when a
 * handler requests it, it is on the allow-list and it is not on the permanent deny-list. Events with no entry here have
 * no explicit setting and are never enabled.
 */
public final class JfrSettings {
    /** How an event is throttled: a period (periodic events) or a threshold (duration events). */
    public record Setting(Kind kind, Duration value) {
        public enum Kind {
            PERIOD,
            THRESHOLD
        }

        public static Setting period(Duration d) {
            return new Setting(Kind.PERIOD, d);
        }

        public static Setting threshold(Duration d) {
            return new Setting(Kind.THRESHOLD, d);
        }
    }

    /**
     * Never enabled, whatever the allow-list says: CPU sampling and method timing need the owner's explicit yes (0351,
     * after PT-15), {@code jdk.JavaExceptionThrow} has a very high rate, and the socket, process, environment, system property, JVM\n     * argument and native library events carry addresses, command lines, arguments or paths from outside the JVM.
     */
    public static final Set<String> DENIED = Set.of(
            "jdk.ExecutionSample",
            "jdk.NativeMethodSample",
            "jdk.CPUTimeSample",
            "jdk.MethodTiming",
            "jdk.MethodTrace",
            "jdk.JavaExceptionThrow",
            "jdk.JavaErrorThrow",
            "jdk.SocketRead",
            "jdk.SocketWrite",
            "jdk.ProcessStart",
            "jdk.InitialEnvironmentVariable",
            "jdk.InitialSystemProperty",
            "jdk.JVMInformation",
            "jdk.SystemProcess",
            "jdk.NativeLibrary");

    private final Map<String, Setting> byEvent;

    /** An allow-list with its values; denied names are dropped at construction. */
    public JfrSettings(Map<String, Setting> allowed) {
        Map<String, Setting> m = new LinkedHashMap<>();
        allowed.forEach((k, v) -> {
            if (!DENIED.contains(k)) {
                m.put(k, v);
            }
        });
        this.byEvent = Map.copyOf(m);
    }

    /** The card's defaults for the PT-09b events. */
    public static JfrSettings defaults() {
        Map<String, Setting> m = new LinkedHashMap<>();
        m.put("jdk.ThreadCPULoad", Setting.period(Duration.ofSeconds(10)));
        m.put("jdk.SafepointBegin", Setting.threshold(Duration.ofMillis(10)));
        m.put("jdk.SafepointEnd", Setting.threshold(Duration.ofMillis(10)));
        m.put("jdk.JavaMonitorEnter", Setting.threshold(Duration.ofMillis(20)));
        m.put("jdk.FileRead", Setting.threshold(Duration.ofMillis(10)));
        m.put("jdk.FileWrite", Setting.threshold(Duration.ofMillis(10)));
        m.put("jdk.ExceptionStatistics", Setting.period(Duration.ofSeconds(60)));
        return new JfrSettings(m);
    }

    /** A copy restricted to the named events (the configurable allow-list); unknown names are ignored. */
    public JfrSettings allowOnly(Collection<String> names) {
        Map<String, Setting> m = new LinkedHashMap<>();
        byEvent.forEach((k, v) -> {
            if (names.contains(k)) {
                m.put(k, v);
            }
        });
        return new JfrSettings(m);
    }

    /** A copy with one event's setting replaced or added (denied names stay out). */
    public JfrSettings with(String event, Setting setting) {
        Map<String, Setting> m = new LinkedHashMap<>(byEvent);
        m.put(event, setting);
        return new JfrSettings(m);
    }

    public Set<String> allowed() {
        return byEvent.keySet();
    }

    /** The settings to apply: only the requested events that are allowed. Iteration order follows the request. */
    public Map<String, Setting> resolve(Collection<String> requested) {
        Map<String, Setting> out = new LinkedHashMap<>();
        for (String name : requested) {
            Setting s = byEvent.get(name);
            if (s != null) {
                out.put(name, s);
            }
        }
        return out;
    }
}
