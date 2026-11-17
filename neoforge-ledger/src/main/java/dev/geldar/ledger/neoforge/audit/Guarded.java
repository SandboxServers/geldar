package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.CollectorGuard;
import dev.geldar.ledger.core.HostInfo;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.BooleanSupplier;

/**
 * Runs one handler body fail-safe: every throwable is swallowed and counted (a VM error is rethrown). On the server
 * thread the body runs inside the collector's guard; on any other thread (async chat, console, RCON) the guard is never
 * touched, because it is main-thread state.
 */
final class Guarded {
    private final CollectorGuard guard;
    private final HostInfo host;
    private final BooleanSupplier gate;
    private final LongAdder errors = new LongAdder();

    /** {@code gate} is the opt-in: checked first on every thread, so off means nothing is recorded (names may still be read by the wiring). */
    Guarded(CollectorGuard guard, HostInfo host, BooleanSupplier gate) {
        this.guard = guard;
        this.host = host;
        this.gate = gate;
    }

    long errors() {
        return errors.sum();
    }

    /** Runs {@code body} under the guard when on the server thread, plain otherwise. */
    void run(Runnable body) {
        long token = 0;
        boolean begun = false;
        try {
            if (!gate.getAsBoolean()) {
                return;
            }
            if (host.isMainThread()) {
                if (!guard.allowed()) {
                    return;
                }
                token = guard.begin();
                begun = true;
            }
            body.run();
        } catch (Throwable t) {
            swallow(t);
        } finally {
            if (begun) {
                try {
                    guard.end(token);
                } catch (Throwable t) {
                    swallow(t);
                }
            }
        }
    }

    /** Runs {@code body} only on the server thread (combat events); anything else is ignored. */
    void runMain(Runnable body) {
        try {
            if (host.isMainThread()) {
                run(body);
            }
        } catch (Throwable t) {
            swallow(t);
        }
    }

    private void swallow(Throwable t) {
        if (t instanceof VirtualMachineError vme) {
            throw vme;
        }
        errors.increment();
    }
}
