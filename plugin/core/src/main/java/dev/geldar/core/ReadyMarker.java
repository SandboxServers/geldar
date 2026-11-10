package dev.geldar.core;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Supplier;

/**
 * The readiness marker the Paper healthcheck reads (compose/phase0.yml). Written when Geldar-Core enables and
 * removed when it disables. The file holds this JVM's pid and its start time (field 22 of /proc/self/stat), so a
 * marker that an earlier server left in /tmp, which a container restart keeps, never matches the running server:
 * the healthcheck compares both values with /proc/&lt;pid&gt;/stat. The rolling server log is not consulted.
 */
final class ReadyMarker {
    /** Index of field 22 (starttime) among the fields after the comm field, which begin at field 3. */
    private static final int START_TIME_INDEX = 19;

    private final Path file;
    private final Supplier<String> identity;

    /** Takes the identity source, so a test can write a known identity without a /proc file. */
    ReadyMarker(Path file, Supplier<String> identity) {
        this.file = file;
        this.identity = identity;
    }

    /** The marker for this JVM: its pid and start time, read from /proc/self/stat. */
    static ReadyMarker forThisProcess(Path file) {
        return new ReadyMarker(file, () -> identityFrom(readSelfStat(), ProcessHandle.current().pid()));
    }

    /** The "pid starttime" pair for {@code pid}, from the text of its /proc stat file. */
    static String identityFrom(String stat, long pid) {
        // comm sits in parentheses and may hold spaces, so the fields are counted from its closing parenthesis.
        String[] fields = stat.substring(stat.lastIndexOf(')') + 2).split(" ");
        return pid + " " + fields[START_TIME_INDEX];
    }

    void write() throws IOException {
        Files.writeString(file, identity.get() + "\n", StandardCharsets.US_ASCII);
    }

    void remove() throws IOException {
        Files.deleteIfExists(file);
    }

    private static String readSelfStat() {
        try {
            return Files.readString(Path.of("/proc/self/stat"), StandardCharsets.US_ASCII);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read /proc/self/stat; the readiness marker needs Linux", e);
        }
    }
}
