package dev.geldar.ledger.neoforge.players;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class StatsFileReaderTest {
    static final UUID ID = new UUID(0x1234L, 0x5678L);

    @TempDir
    Path dir;

    final List<Long> sleeps = new ArrayList<>();

    static String sample() throws IOException {
        try (InputStream in = StatsFileReaderTest.class.getResourceAsStream("/stats/sample.json")) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    Path file() {
        return dir.resolve(ID + ".json");
    }

    StatsFileReader reader() {
        StatsFileReader r = StatsFileReader.open(dir, sleeps::add);
        assertNotNull(r);
        return r;
    }

    @Test
    void theSampleFileYieldsExactlyTheAllowListedValues() throws Exception {
        Files.writeString(file(), sample());
        Map<String, Long> got = reader().read(ID);
        assertEquals(
                Map.of("play_time", 72000L, "deaths", 3L, "mob_kills", 12L, "walk_one_cm", 55000L, "mined_total", 15L, "crafted_total", 10L),
                got);
        assertEquals(List.of(), sleeps);
    }

    @Test
    void aStatKeyOutsideTheAllowListIsNeverReturned() throws Exception {
        Files.writeString(file(), sample());
        Map<String, Long> got = reader().read(ID);
        for (String k : got.keySet()) {
            assertEquals(true, StatsFileReader.NAMES.contains(k), k);
        }
        assertEquals(6, got.size());
    }

    @Test
    void nonNumericAndNegativeValuesAreIgnored() throws Exception {
        Files.writeString(
                file(),
                "{\"stats\":{\"minecraft:custom\":{\"minecraft:deaths\":\"3\",\"minecraft:mob_kills\":-2,\"minecraft:play_time\":1.5,\"minecraft:walk_one_cm\":7},"
                        + "\"minecraft:mined\":{\"minecraft:stone\":\"x\"}}}");
        assertEquals(Map.of("walk_one_cm", 7L), reader().read(ID));
    }

    @Test
    void aTruncatedFileIsRetriedOnceAfterOneSecondThenSkippedWithoutThrowing() throws Exception {
        String s = sample();
        Files.writeString(file(), s.substring(0, s.length() / 2));
        assertNull(reader().read(ID));
        assertEquals(List.of(StatsFileReader.RETRY_MS), sleeps);
    }

    @Test
    void aFileThatIsCompleteOnTheRetryIsRead() throws Exception {
        String s = sample();
        Files.writeString(file(), s.substring(0, s.length() / 2));
        StatsFileReader r = StatsFileReader.open(dir, ms -> {
            sleeps.add(ms);
            try {
                Files.writeString(file(), s);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });
        assertEquals(72000L, r.read(ID).get("play_time"));
        assertEquals(1, sleeps.size());
    }

    @Test
    void anAbsentFileIsNullWithoutRetry() {
        assertNull(reader().read(ID));
        assertEquals(List.of(), sleeps);
    }

    @Test
    void aFileOverTheCapIsSkippedUnread() throws Exception {
        String pad = " ".repeat(StatsFileReader.MAX_BYTES);
        Files.writeString(file(), sample() + pad);
        assertNull(reader().read(ID));
        assertEquals(List.of(), sleeps);
    }

    @Test
    void aSymlinkIsNotFollowed() throws Exception {
        Path outside = Files.createTempFile("outside", ".json");
        try {
            Files.writeString(outside, sample());
            try {
                Files.createSymbolicLink(file(), outside);
            } catch (IOException | UnsupportedOperationException | SecurityException e) {
                assumeTrue(false, "no symlink support here");
            }
            assertNull(reader().read(ID));
        } finally {
            Files.deleteIfExists(file());
            Files.deleteIfExists(outside);
        }
    }

    @Test
    void aDirectoryWithTheFileNameIsNotRead() throws Exception {
        Files.createDirectory(file());
        assertNull(reader().read(ID));
        assertEquals(List.of(), sleeps);
    }

    @Test
    void theEligibilityGuardAcceptsOnlyARegularFileWithinTheCapInsideTheRoot() throws Exception {
        Path root = dir.toRealPath();
        assertEquals(false, StatsFileReader.eligible(file(), root), "missing");
        Files.createDirectory(file());
        assertEquals(false, StatsFileReader.eligible(file(), root), "directory");
        Files.delete(file());
        Files.writeString(file(), sample());
        assertEquals(true, StatsFileReader.eligible(file(), root), "regular file");
        Path other = Files.createTempDirectory("other");
        try {
            assertEquals(false, StatsFileReader.eligible(file(), other.toRealPath()), "small regular file outside the root");
        } finally {
            Files.delete(other);
        }
        Files.writeString(file(), "x".repeat(StatsFileReader.MAX_BYTES + 1));
        assertEquals(false, StatsFileReader.eligible(file(), root), "over the cap");
    }

    @Test
    void aSymlinkToAnotherFileInsideTheStatsDirIsNotFollowed() throws Exception {
        Path target = dir.resolve("other-player.json");
        Files.writeString(target, sample());
        try {
            Files.createSymbolicLink(file(), target);
        } catch (IOException | UnsupportedOperationException | SecurityException e) {
            assumeTrue(false, "no symlink support here (needs Linux or a privileged Windows run)");
        }
        assertNull(reader().read(ID), "only NOFOLLOW_LINKS rejects this: the target is inside the root");
    }

    @Test
    void onlyAnObjectLikePrefixIsRetried() throws Exception {
        for (String bad : new String[] {"", "   ", "\uFEFF{}", "[1]", "garbage"}) {
            Files.writeString(file(), bad);
            assertNull(reader().read(ID), bad);
        }
        assertEquals(List.of(), sleeps);
        assertEquals(true, StatsFileReader.midWrite(" \n{\"stats\":".getBytes(StandardCharsets.UTF_8)));
    }
    @Test
    void aMissingStatsDirectoryGivesNoReader() {
        assertNull(StatsFileReader.open(dir.resolve("nope"), sleeps::add));
        assertNull(StatsFileReader.open(null, sleeps::add));
    }
}
