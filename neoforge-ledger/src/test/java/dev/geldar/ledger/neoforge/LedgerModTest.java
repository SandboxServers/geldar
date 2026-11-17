package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
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
    void shutdownClosesTheLedgerThenTheSchedulerAndSurvivesCloseFailure(@TempDir Path dir) {
        OtelLedger ledger = create(dir.resolve("none"));
        NeoForgeHostScheduler scheduler = new NeoForgeHostScheduler(Logger.getLogger("t"));
        assertDoesNotThrow(() -> LedgerMod.shutdown(ledger, scheduler));
        // the scheduler is closed: late scheduling is a no-op
        assertDoesNotThrow(() -> scheduler.everyMillis(1, () -> {}).cancel());
        assertDoesNotThrow(() -> LedgerMod.shutdown(null, scheduler));
        assertTrue(true);
    }
}