package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.LedgerConfig;
import dev.geldar.ledger.core.jfr.JfrRunner;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class JfrWiringTest {
    private final Logger log = Logger.getAnonymousLogger();
    private int starts;
    private boolean boom;

    private JfrWiring wiring() {
        return new JfrWiring(log, (ledger, config) -> {
            starts++;
            if (boom) {
                throw new IllegalStateException("x");
            }
            // an inert runner (jfr off in this config): enough to track start and stop
            return JfrRunner.start(java.util.List.of(), LedgerConfig.disabled(), log);
        });
    }

    private static LedgerConfig on(boolean master, boolean jfr) {
        return LedgerConfig.defaults().withEnabled(master).withJfrEnabled(jfr);
    }

    @Test
    void defaultConfigNeverStartsJfr() {
        JfrWiring w = wiring();
        w.sync(LedgerConfig.defaults(), null);
        assertEquals(0, starts);
        assertFalse(w.started());
    }

    @Test
    void startsOnceWhileOnStopsWhenOffAndRestartsOnReenable() {
        JfrWiring w = wiring();
        w.sync(on(true, true), null);
        w.sync(on(true, true), null);
        assertEquals(1, starts);
        assertTrue(w.started());
        w.sync(on(true, false), null);
        assertFalse(w.started());
        w.sync(on(true, true), null);
        assertEquals(2, starts);
        w.sync(on(false, true), null); // master off wins
        assertFalse(w.started());
        w.stop(); // idempotent
    }

    @Test
    void aFailingStartLeavesJfrOffAndNeverThrows() {
        JfrWiring w = wiring();
        boom = true;
        w.sync(on(true, true), null);
        assertFalse(w.started());
        boom = false;
        w.sync(on(true, true), null); // retried on the next config
        assertTrue(w.started());
    }
}
