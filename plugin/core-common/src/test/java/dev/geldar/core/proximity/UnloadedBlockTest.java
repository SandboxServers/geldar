package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** The unloaded-chunk signal: a cheap unchecked exception with no stack trace (decision 0199, step 5). */
class UnloadedBlockTest {
    @Test
    void isAnUncheckedExceptionWithAFixedMessage() {
        UnloadedBlock e = new UnloadedBlock();
        assertTrue(e instanceof RuntimeException);
        assertEquals("chunk not loaded", e.getMessage());
    }

    @Test
    void carriesNoStackTrace() {
        assertEquals(0, new UnloadedBlock().getStackTrace().length);
    }
}
