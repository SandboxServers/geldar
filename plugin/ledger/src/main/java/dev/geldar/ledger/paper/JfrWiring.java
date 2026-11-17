package dev.geldar.ledger.paper;

import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.jfr.ContentionHandler;
import dev.geldar.ledger.core.jfr.ExceptionHandler;
import dev.geldar.ledger.core.jfr.FileIoHandler;
import dev.geldar.ledger.core.jfr.JfrHandler;
import dev.geldar.ledger.core.jfr.JfrRunner;
import dev.geldar.ledger.core.jfr.SafepointHandler;
import dev.geldar.ledger.core.jfr.ThreadCpuHandler;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.function.BiFunction;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Starts and stops the JFR runner from the config key {@code jfr.enabled} (default false). The runner is bounded (30 s,
 * 8 MiB, the JfrSettings allow list) and fails safe: no JFR means one log line and nothing else. Called from the main
 * thread; the (joining) stop runs on another thread so the main thread is never held.
 */
final class JfrWiring {
    /** A started runner. {@link #running()} is false for an inert runner (JFR unavailable, start failed, stream died). */
    interface Handle {
        boolean running();

        void stop();
    }

    /** Starts a runner for the given ledger and config; replaced by tests. */
    interface Starter extends BiFunction<Ledger, LedgerConfig, Handle> {}

    private final Logger log;
    private final Starter starter;
    private final Executor stopper;
    private Handle runner;

    JfrWiring(Logger log) {
        this(log, (ledger, config) -> {
            JfrRunner r = JfrRunner.start(handlers(ledger), config, log);
            return new Handle() {
                public boolean running() {
                    return r.running();
                }

                public void stop() {
                    r.stop();
                }
            };
        }, JfrWiring::daemon);
    }

    JfrWiring(Logger log, Starter starter, Executor stopper) {
        this.log = log;
        this.starter = starter;
        this.stopper = stopper;
    }

    private static void daemon(Runnable r) {
        Thread t = new Thread(r, "ledger-jfr-stop");
        t.setDaemon(true);
        t.start();
    }

    static List<JfrHandler> handlers(Ledger ledger) {
        return List.of(
                new ThreadCpuHandler(ledger),
                new SafepointHandler(ledger),
                new ContentionHandler(ledger),
                new FileIoHandler(ledger),
                new ExceptionHandler(ledger));
    }

    /**
     * Applies a config snapshot: starts when jfr.enabled is on and no running runner exists (so an inert runner, one
     * whose start failed or whose stream died, is replaced on the NEXT config apply; never in a loop), stops when it
     * turns off. Never throws.
     */
    void sync(LedgerConfig config, Ledger ledger) {
        try {
            boolean want = config.enabled() && config.jfrEnabled();
            if (!want) {
                stop();
            } else if (!started()) {
                stop();
                runner = starter.apply(ledger, config);
            }
        } catch (Throwable t) {
            runner = null;
            log.log(Level.WARNING, "JFR wiring failed; JFR metrics are off", t);
        }
    }

    /** Idempotent; the runner's join happens off the calling thread. */
    void stop() {
        Handle r = runner;
        runner = null;
        if (r != null) {
            try {
                stopper.execute(() -> {
                    try {
                        r.stop();
                    } catch (Throwable t) {
                        log.log(Level.FINE, "JFR runner stop failed", t);
                    }
                });
            } catch (Throwable t) {
                log.log(Level.FINE, "JFR runner stop not scheduled", t);
            }
        }
    }

    /** True while a runner exists and is running. */
    boolean started() {
        Handle r = runner;
        return r != null && r.running();
    }
}
