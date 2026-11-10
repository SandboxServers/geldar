package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ReadyMarkerTest {
    /** A stat line whose field 22 (starttime) is 777; the comm field is "java", as the JVM's is. */
    private static final String STAT =
            "4242 (java) S 1 4242 4242 0 -1 4194560 1 0 0 0 5 3 0 0 20 0 1 0 777 0 0\n";

    @Test
    void writesTheIdentityAndRemovesIt(@TempDir Path dir) throws IOException {
        Path file = dir.resolve("geldar-identity.ready");
        ReadyMarker marker = new ReadyMarker(file, () -> "4242 777");

        marker.write();
        assertEquals("4242 777\n", Files.readString(file));

        marker.remove();
        assertFalse(Files.exists(file));
    }

    @Test
    void writeReplacesAnEarlierMarker(@TempDir Path dir) throws IOException {
        Path file = dir.resolve("geldar-identity.ready");
        Files.writeString(file, "99 1\n");
        new ReadyMarker(file, () -> "4242 777").write();
        assertEquals("4242 777\n", Files.readString(file));
    }

    @Test
    void removingAMissingMarkerIsNotAnError(@TempDir Path dir) throws IOException {
        new ReadyMarker(dir.resolve("absent.ready"), () -> "1 1").remove();
    }

    @Test
    void writeFailsWhenTheDirectoryIsMissing(@TempDir Path dir) {
        ReadyMarker marker = new ReadyMarker(dir.resolve("no-such-dir").resolve("geldar-identity.ready"), () -> "1 1");
        assertThrows(IOException.class, marker::write);
    }

    @Test
    void identityTakesTheStartTimeFromTheStatFields() {
        assertEquals("4242 777", ReadyMarker.identityFrom(STAT, 4242));
    }

    @Test
    void identityCountsFieldsPastACommNameWithSpaces() {
        String stat = STAT.replace("(java)", "(java server 1)");
        assertEquals("4242 777", ReadyMarker.identityFrom(stat, 4242));
    }

    @Test
    void aDifferentProcessStartGivesADifferentIdentity() {
        String restarted = STAT.replace(" 777 ", " 912 ");
        assertNotEquals(ReadyMarker.identityFrom(STAT, 4242), ReadyMarker.identityFrom(restarted, 4242));
    }
}
