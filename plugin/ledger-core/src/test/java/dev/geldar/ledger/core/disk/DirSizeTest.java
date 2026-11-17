package dev.geldar.ledger.core.disk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DirSizeTest {
  @TempDir Path tmp;

  private static void write(Path p, int n) throws IOException {
    Files.createDirectories(p.getParent());
    Files.write(p, new byte[n]);
  }

  @Test
  void sumsExactly() throws IOException {
    write(tmp.resolve("a.bin"), 10);
    write(tmp.resolve("d/b.bin"), 200);
    write(tmp.resolve("d/e/c.bin"), 3000);
    DirSize.Result r = DirSize.of(tmp, 1000);
    assertTrue(r.available());
    assertEquals(3210, r.bytes());
    assertFalse(r.partial());
  }

  @Test
  void symlinkIsNotFollowedAndLoopIsSafe() throws IOException {
    Path outside = Files.createTempDirectory("outside");
    try {
      write(outside.resolve("big.bin"), 5000);
      write(tmp.resolve("root/in.bin"), 7);
      try {
        Files.createSymbolicLink(tmp.resolve("root/escape"), outside);
        Files.createSymbolicLink(tmp.resolve("root/loop"), tmp.resolve("root"));
      } catch (IOException | UnsupportedOperationException e) {
        assumeTrue(false, "symlinks unavailable: " + e);
      }
      DirSize.Result r = DirSize.of(tmp.resolve("root"), 1000);
      assertEquals(7, r.bytes());
      assertFalse(r.partial());
    } finally {
      Files.deleteIfExists(outside.resolve("big.bin"));
      Files.deleteIfExists(outside);
    }
  }

  @Test
  void symlinkedRootIsUnavailable() throws IOException {
    write(tmp.resolve("real/x.bin"), 50);
    try {
      Files.createSymbolicLink(tmp.resolve("link"), tmp.resolve("real"));
    } catch (IOException | UnsupportedOperationException e) {
      assumeTrue(false, "symlinks unavailable: " + e);
    }
    assertFalse(DirSize.of(tmp.resolve("link"), 1000).available());
  }

  @Test
  void entryBudgetStopsTheWalkAndSetsPartial() throws IOException {
    for (int i = 0; i < 50; i++) {
      write(tmp.resolve("f" + i), 1);
    }
    DirSize.Result r = DirSize.of(tmp, 10);
    assertTrue(r.partial());
    assertTrue(r.entries() <= 10);
    assertTrue(r.bytes() < 50);
    assertFalse(DirSize.of(tmp, 1000).partial());
  }

  @Test
  void timeBudgetStopsTheWalkAndSetsPartial() throws IOException {
    for (int i = 0; i < 20; i++) {
      write(tmp.resolve("f" + i), 1);
    }
    AtomicInteger calls = new AtomicInteger();
    // Each clock read advances 1 s; the budget is 3 s.
    DirSize.Result r = DirSize.of(tmp, 1000, 3_000_000_000L, () -> calls.incrementAndGet() * 1_000_000_000L);
    assertTrue(r.partial());
    assertTrue(r.entries() < 20);
  }

  @Test
  void missingOrNonDirectoryRootIsUnavailableWithoutThrowing() throws IOException {
    DirSize.Result missing = DirSize.of(tmp.resolve("nope"), 1000);
    assertFalse(missing.available());
    assertEquals(0, missing.bytes());
    write(tmp.resolve("file"), 5);
    assertFalse(DirSize.of(tmp.resolve("file"), 1000).available());
    assertFalse(DirSize.of(null, 1000).available());
  }

  @Test
  void directoryVanishingMidWalkIsSkipped() throws IOException {
    for (int i = 0; i < 5; i++) {
      write(tmp.resolve("f" + i), 20);
    }
    write(tmp.resolve("0a/keep"), 10);
    write(tmp.resolve("0b/x"), 400);
    write(tmp.resolve("0c/y"), 800);
    AtomicInteger calls = new AtomicInteger();
    // From the third clock read on (the first child directory is open, its siblings not yet opened), the subtree is deleted under the walk.
    DirSize.Result r =
        DirSize.of(
            tmp,
            1000,
            Long.MAX_VALUE / 2,
            () -> {
              if (calls.incrementAndGet() >= 3) {
                try {
                  Files.deleteIfExists(tmp.resolve("0b/x"));
                  Files.deleteIfExists(tmp.resolve("0c/y"));
                  Files.deleteIfExists(tmp.resolve("0c"));
                  Files.deleteIfExists(tmp.resolve("0b"));
                } catch (IOException ex) {
                  throw new RuntimeException(ex);
                }
              }
              return 0L;
            });
    assertTrue(r.available());
    assertFalse(r.partial());
    assertEquals(110, r.bytes());
  }
  @Test
  void unreadableSubdirectoryDoesNotAbort() throws IOException {
    assumeTrue(Files.getFileStore(tmp).supportsFileAttributeView("posix"));
    write(tmp.resolve("ok.bin"), 11);
    write(tmp.resolve("locked/x.bin"), 999);
    write(tmp.resolve("z/after.bin"), 22);
    Path locked = tmp.resolve("locked");
    Files.setPosixFilePermissions(locked, PosixFilePermissions.fromString("---------"));
    try {
      assumeTrue(!Files.isReadable(locked), "running as a user who ignores permissions");
      DirSize.Result r = DirSize.of(tmp, 1000);
      assertEquals(33, r.bytes());
      assertFalse(r.partial());
    } finally {
      Files.setPosixFilePermissions(locked, PosixFilePermissions.fromString("rwx------"));
    }
  }
}
