package dev.geldar.ledger.core.disk;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitor;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.EnumSet;
import java.util.function.LongSupplier;

/**
 * Bounded, symlink-safe directory size. Never follows a symlink (a link is neither counted nor entered), never reads
 * file contents, never throws: a per-file error is skipped and the walk goes on. The walk stops when it has visited
 * {@code maxEntries} entries or run for {@code maxNanos}; the result then carries {@code partial = true}.
 */
public final class DirSize {
    public static final long DEFAULT_MAX_ENTRIES = 2_000_000L;
    public static final long DEFAULT_MAX_NANOS = 20_000_000_000L;

    /**
     * @param available false when the root is missing, is not a directory, or is a symlink
     * @param bytes sum of regular file sizes seen
     * @param entries files and directories visited
     * @param partial true when the entry or time budget stopped the walk, so {@code bytes} is a lower bound
     */
    public record Result(boolean available, long bytes, long entries, boolean partial) {
        static final Result UNAVAILABLE = new Result(false, 0, 0, false);
    }

    private DirSize() {}

    public static Result of(Path root, long maxEntries) {
        return of(root, maxEntries, DEFAULT_MAX_NANOS, System::nanoTime);
    }

    public static Result of(Path root, long maxEntries, long maxNanos, LongSupplier nanoClock) {
        try {
            if (root == null
                    || Files.isSymbolicLink(root)
                    || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
                return Result.UNAVAILABLE;
            }
            Walker w = new Walker(maxEntries, maxNanos, nanoClock);
            try {
                Files.walkFileTree(root, EnumSet.noneOf(java.nio.file.FileVisitOption.class), Integer.MAX_VALUE, w);
            } catch (IOException | RuntimeException e) {
                // A walk-level failure keeps what was counted so far, flagged as partial.
                return new Result(true, w.bytes, w.entries, true);
            }
            return new Result(true, w.bytes, w.entries, w.partial);
        } catch (RuntimeException e) {
            return Result.UNAVAILABLE;
        }
    }

    private static final class Walker implements FileVisitor<Path> {
        private final long maxEntries;
        private final long deadline;
        private final LongSupplier clock;
        long bytes;
        long entries;
        boolean partial;

        Walker(long maxEntries, long maxNanos, LongSupplier clock) {
            this.maxEntries = maxEntries;
            this.clock = clock;
            this.deadline = clock.getAsLong() + maxNanos;
        }

        private boolean overBudget() {
            if (entries >= maxEntries || clock.getAsLong() - deadline >= 0) {
                partial = true;
                return true;
            }
            return false;
        }

        @Override
        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
            if (overBudget()) {
                return FileVisitResult.TERMINATE;
            }
            entries++;
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
            if (overBudget()) {
                return FileVisitResult.TERMINATE;
            }
            entries++;
            if (attrs.isRegularFile()) {
                bytes += attrs.size();
            }
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult visitFileFailed(Path file, IOException exc) {
            // Vanished mid-walk or permission denied: skip it.
            return FileVisitResult.CONTINUE;
        }

        @Override
        public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
            return FileVisitResult.CONTINUE;
        }
    }
}
