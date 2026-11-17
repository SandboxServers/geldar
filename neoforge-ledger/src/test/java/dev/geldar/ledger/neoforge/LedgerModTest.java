package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.OtelLedger;
import io.opentelemetry.api.OpenTelemetry;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The fail-safe paths of {@link LedgerMod#create}: any problem leaves the ledger off and never throws. */
class LedgerModTest {
    private static final NeoForgeHostInfo HOST = new NeoForgeHostInfo(() -> 0L, () -> true);

    private static OtelLedger create(Path file) {
        return LedgerMod.create(file, HOST, OpenTelemetry::noop);
    }

    private static Path write(Path dir, String text) throws IOException {
        Path file = dir.resolve("ledger.properties");
        Files.writeString(file, text);
        return file;
    }

    @Test
    void missingFileMeansDefaults(@TempDir Path dir) {
        assertNotNull(create(dir.resolve("absent.properties")));
    }

    @Test
    void validFileGivesALedger(@TempDir Path dir) throws IOException {
        assertNotNull(create(write(dir, "collector.census.enabled=false\n")));
    }

    @Test
    void malformedFileGivesNoLedger(@TempDir Path dir) throws IOException {
        assertNull(create(write(dir, "a=\\u12\n")));
    }

    @Test
    void credentialKeyGivesNoLedger(@TempDir Path dir) throws IOException {
        assertNull(create(write(dir, "rcon_password=x\n")));
    }

    @Test
    void invalidValueGivesNoLedger(@TempDir Path dir) throws IOException {
        assertNull(create(write(dir, "collector.census.budget_avg_us=notanumber\n")));
    }

    @Test
    void bootstrapLinkageErrorGivesNoLedger(@TempDir Path dir) {
        assertNull(LedgerMod.create(dir.resolve("none"), HOST, () -> {
            throw new NoClassDefFoundError("io/opentelemetry/api/GlobalOpenTelemetry");
        }));
    }

    @Test
    void bootstrapRuntimeExceptionGivesNoLedger(@TempDir Path dir) {
        assertNull(LedgerMod.create(dir.resolve("none"), HOST, () -> {
            throw new IllegalStateException("boom");
        }));
    }

    @Test
    void shutdownFlushesTheLedgerBeforeTheSchedulerCloses() {
        java.util.List<String> order = new java.util.ArrayList<>();
        LedgerMod.shutdown(() -> order.add("ledger"), () -> order.add("scheduler"));
        assertEquals(java.util.List.of("ledger", "scheduler"), order);
    }

    @Test
    void shutdownStillClosesTheSchedulerWhenTheLedgerCloseThrowsOrIsAbsent() {
        java.util.List<String> order = new java.util.ArrayList<>();
        assertDoesNotThrow(() -> LedgerMod.shutdown(() -> {
            order.add("ledger");
            throw new IllegalStateException("boom");
        }, () -> order.add("scheduler")));
        assertEquals(java.util.List.of("ledger", "scheduler"), order);
        order.clear();
        LedgerMod.shutdown((Runnable) null, () -> order.add("scheduler"));
        assertEquals(java.util.List.of("scheduler"), order);
    }

    @Test
    void realShutdownClosesTheScheduler(@TempDir Path dir) {
        OtelLedger ledger = create(dir.resolve("none"));
        NeoForgeHostScheduler scheduler = new NeoForgeHostScheduler(Logger.getLogger("t"));
        assertDoesNotThrow(() -> LedgerMod.shutdown(ledger, scheduler));
        assertDoesNotThrow(() -> scheduler.everyMillis(1, () -> {}).cancel());
        assertDoesNotThrow(() -> LedgerMod.shutdown((OtelLedger) null, scheduler));
    }

    @Test
    void aThrowingInstallDoesNotSkipTheNextOnes() {
        java.util.List<String> ran = new java.util.ArrayList<>();
        LedgerMod.isolated("a", () -> ran.add("a"));
        LedgerMod.isolated("b", () -> {
            throw new NoClassDefFoundError("x");
        });
        LedgerMod.isolated("c", () -> ran.add("c"));
        assertEquals(java.util.List.of("a", "c"), ran);
        assertThrows(OutOfMemoryError.class, () -> LedgerMod.isolated("d", () -> {
            throw new OutOfMemoryError();
        }));
    }
}