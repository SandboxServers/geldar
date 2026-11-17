package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ProgressWiringTest {
    @Test
    void onlyAGrantIsExportedAndARevokeNever() {
        assertEquals(true, ProgressWiring.exported("GRANT"));
        assertEquals(false, ProgressWiring.exported("REVOKE"));
        assertEquals(false, ProgressWiring.exported(null));
    }

    @Test
    void aListenerBodyThatThrowsNeverReachesTheEventBusButAVmErrorDoes() {
        ProgressWiring.guarded(() -> {
            throw new NullPointerException("advancement id");
        });
        assertThrows(OutOfMemoryError.class, () -> ProgressWiring.guarded(() -> {
            throw new OutOfMemoryError();
        }));
    }
}
