package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.DropCounters;
import dev.geldar.ledger.core.LedgerConfig;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.LongAdder;
import java.util.logging.Level;
import java.util.logging.Logger;
import jdk.jfr.FlightRecorder;
import jdk.jfr.consumer.RecordedEvent;
import jdk.jfr.consumer.RecordingStream;

/**
 * An in-process JFR event stream on one daemon thread named {@code ledger-jfr}. Nothing goes to disk by this class: no
 * {@code dump}, no {@code setDestination}. Memory is bounded by {@code setMaxAge(30 s)} and {@code setMaxSize(8 MiB)}.
 * Only events that handlers request, that are allowed by {@link JfrSettings} and that are not on its deny-list are
 * enabled, each with an explicit period or threshold and no stack trace. Never throws into the caller: every failure
 * is logged once and leaves an inert runner. Handler exceptions are caught and counted in the {@code jfr} drop queue
 * ({@code geldar_ledger_dropped_total{queue=jfr}}).
 */
public final class JfrRunner {
    public static final String THREAD_NAME = "ledger-jfr";
    public static final String QUEUE = "jfr";
    static final Duration MAX_AGE = Duration.ofSeconds(30);
    static final long MAX_SIZE_BYTES = 8L * 1024 * 1024;
    private static final long JOIN_MS = 5000;

    private final Logger log;
    private final LongAdder dropped;
    private final Map<String, Object> enabled = new LinkedHashMap<>();
    private final AtomicBoolean stopped = new AtomicBoolean();
    private volatile RecordingStream stream;
    private volatile Thread thread;

    private JfrRunner(Logger log, LongAdder dropped) {
        this.log = log;
        this.dropped = dropped;
    }

    /** Starts with the default settings and a private drop counter set. Returns an inert runner when JFR is off. */
    public static JfrRunner start(List<JfrHandler> handlers, LedgerConfig config, Logger log) {
        return start(handlers, config, log, new DropCounters(), JfrSettings.defaults());
    }

    public static JfrRunner start(
            List<JfrHandler> handlers, LedgerConfig config, Logger log, DropCounters drops, JfrSettings settings) {
        JfrRunner runner = new JfrRunner(log, drops.counter(QUEUE));
        try {
            if (config == null || !config.enabled() || !config.jfrEnabled() || handlers.isEmpty()) {
                return runner;
            }
            if (!available()) {
                log.info("JFR is not available in this JVM; JFR metrics are off");
                return runner;
            }
            runner.open(handlers, settings);
        } catch (Throwable t) {
            log.log(Level.WARNING, "JFR runner failed to start; JFR metrics are off", t);
            runner.stop();
        }
        return runner;
    }

    /** True when the {@code jdk.jfr} module is present and the recorder is usable. */
    static boolean available() {
        try {
            return FlightRecorder.isAvailable();
        } catch (Throwable t) { // NoClassDefFoundError without the module, or a SecurityException
            return false;
        }
    }

    private void open(List<JfrHandler> handlers, JfrSettings settings) {
        List<String> requested = new ArrayList<>();
        for (JfrHandler h : handlers) {
            requested.addAll(h.eventNames());
        }
        Map<String, JfrSettings.Setting> resolved = settings.resolve(requested);
        for (String name : requested) {
            if (!resolved.containsKey(name)) {
                log.info("JFR event " + name + " is not allowed or has no setting; not enabled");
            }
        }
        if (resolved.isEmpty()) {
            return;
        }
        RecordingStream rs = new RecordingStream();
        this.stream = rs;
        rs.setMaxAge(MAX_AGE);
        rs.setMaxSize(MAX_SIZE_BYTES);
        resolved.forEach((name, setting) -> {
            var ev = rs.enable(name).withoutStackTrace();
            if (setting.kind() == JfrSettings.Setting.Kind.PERIOD) {
                ev.withPeriod(setting.value());
            } else {
                ev.withThreshold(setting.value());
            }
            enabled.put(name, setting);
            rs.onEvent(name, event -> dispatch(handlers, name, event));
        });
        Thread t = new Thread(() -> run(rs), THREAD_NAME);
        t.setDaemon(true);
        this.thread = t;
        t.start();
    }

    private void dispatch(List<JfrHandler> handlers, String name, RecordedEvent event) {
        for (JfrHandler h : handlers) {
            if (h.eventNames().contains(name)) {
                try {
                    h.handle(event);
                } catch (Throwable t) {
                    dropped.increment();
                }
            }
        }
    }

    private void run(RecordingStream rs) {
        try {
            rs.start();
        } catch (Throwable t) {
            if (!stopped.get()) {
                log.log(Level.WARNING, "JFR stream ended with an error", t);
            }
        } finally {
            try {
                rs.close();
            } catch (Throwable ignored) {
                // closing is best effort
            }
        }
    }

    /** The event names enabled, for tests and diagnostics. */
    public List<String> enabledEvents() {
        return List.copyOf(enabled.keySet());
    }

    /** Handler failures counted so far. */
    public long dropped() {
        return dropped.sum();
    }

    /** True while the stream thread is alive. */
    public boolean running() {
        Thread t = thread;
        return t != null && t.isAlive();
    }

    /** Closes the stream and waits briefly for the thread. Idempotent; never throws. */
    public void stop() {
        if (!stopped.compareAndSet(false, true)) {
            return;
        }
        try {
            RecordingStream rs = stream;
            if (rs != null) {
                rs.close();
            }
            Thread t = thread;
            if (t != null && t != Thread.currentThread()) {
                t.join(JOIN_MS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Throwable t) {
            log.log(Level.WARNING, "JFR runner stop failed", t);
        }
    }
}
