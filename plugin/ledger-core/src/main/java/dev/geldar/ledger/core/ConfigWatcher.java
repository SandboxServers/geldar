package dev.geldar.ledger.core;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.logging.Logger;

/**
 * Re-reads the config file every 5 s on an async thread ({@link HostScheduler#everyMillis}; never
 * {@code everyTicks}, S6).
 *
 * <p>Rules:
 *
 * <ul>
 *   <li>At most {@link #MAX_BYTES} are read; a larger file is rejected with one log line and the previous snapshot is
 *       kept. Every log line and every remembered error is at most {@link #MAX_LOG} chars.
 *   <li>The file is stat-ed, read, stat-ed again; if size, mtime or file key changed meanwhile the poll is skipped
 *       (torn write). A change is detected by (size, mtime, file key, SHA-256 of the bytes), so a same-size
 *       same-mtime rewrite is seen. An empty file counts as a torn write until it has been seen empty on two
 *       consecutive polls.
 *   <li>A bad file keeps the previous snapshot and logs once per distinct error, except the kill switch: when the
 *       bad file says {@code enabled=false} the previous snapshot is applied with {@code enabled=false}.
 *   <li>Before the first load {@link #current()} is {@link LedgerConfig#disabled()} (the agent ships disabled; the
 *       file default {@code enabled=true} applies only once a file was read or found missing) and {@link #loaded()}
 *       is false. The first completed poll always calls the consumer once, with defaults when the first file is bad.
 *   <li>{@link #poll} is single-flight; {@link #stop} waits for a running poll and no consumer call happens after it
 *       returns. A consumer exception is logged as "config consumer failed" and never escapes.
 * </ul>
 */
public final class ConfigWatcher {
    public static final long PERIOD_MS = 5000;
    public static final int MAX_BYTES = 65_536;
    public static final int MAX_LOG = 512;
    static final int MAX_REMEMBERED = 64;
    private static final int MAX_LISTED_ERRORS = 5;

    private record Stamp(long mtime, long size, Object fileKey) {}

    private record Seen(Stamp stamp, String hash) {}

    private static final Stamp MISSING = new Stamp(-1, -1, null);

    private final Path path;
    private final HostScheduler scheduler;
    private final Consumer<LedgerConfig> onChange;
    private final Logger log;
    private final AtomicReference<LedgerConfig> current = new AtomicReference<>(LedgerConfig.disabled());
    private final Set<String> loggedErrors = new HashSet<>();
    private Seen last;
    private Stamp emptyStamp;
    private Cancellable task;
    private volatile boolean stopped;
    private volatile boolean loaded;
    private volatile int reads;
    /** Test seam: runs between the read and the second stat. */
    Runnable afterReadHook = () -> {};

    public ConfigWatcher(Path path, HostScheduler scheduler, Consumer<LedgerConfig> onChange) {
        this(path, scheduler, onChange, Logger.getLogger(ConfigWatcher.class.getName()));
    }

    public ConfigWatcher(Path path, HostScheduler scheduler, Consumer<LedgerConfig> onChange, Logger log) {
        this.path = path;
        this.scheduler = scheduler;
        this.onChange = onChange;
        this.log = log;
    }

    /** Schedules the poll every 5 s. No file I/O happens on the caller's thread. Idempotent. */
    public synchronized void start() {
        stopped = false;
        if (task == null) {
            task = scheduler.everyMillis(PERIOD_MS, this::poll);
        }
    }

    /** Cancels the task and waits for a poll in flight; no consumer call happens after this returns. */
    public synchronized void stop() {
        stopped = true;
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    /** The current snapshot ({@link LedgerConfig#disabled()} until the first poll completed). */
    public LedgerConfig current() {
        return current.get();
    }

    /** True once the first poll completed and the consumer was called. */
    public boolean loaded() {
        return loaded;
    }

    /** Number of times the file content was parsed (for tests; an unchanged file is read but not parsed). */
    int reads() {
        return reads;
    }

    /** One poll; runs on the scheduler's async thread. Single-flight. Never throws. */
    synchronized void poll() {
        if (stopped) {
            return;
        }
        try {
            pollOnce();
        } catch (Throwable e) { // an Error must never escape into the host scheduler
            logOnce("cannot read config: " + e.getClass().getSimpleName(), "Ledger config cannot be read: "
                    + e.getClass().getSimpleName() + ", keeping the previous one");
        }
    }

    private void pollOnce() throws IOException {
        Stamp before = stamp();
        if (before.equals(MISSING)) {
            emptyStamp = null;
            if (last == null || !last.stamp().equals(MISSING)) {
                last = new Seen(MISSING, "");
                deliver(LedgerConfig.defaults());
            }
            return;
        }
        if (before.size() > MAX_BYTES) {
            rejectOversized(before);
            return;
        }
        byte[] bytes;
        try (InputStream in = Files.newInputStream(path)) {
            bytes = in.readNBytes(MAX_BYTES + 1);
        } catch (NoSuchFileException e) {
            return; // raced with a delete: look again next poll
        }
        afterReadHook.run();
        if (!before.equals(stamp())) {
            return; // torn: changed while reading, try again next poll
        }
        if (bytes.length > MAX_BYTES) {
            rejectOversized(before);
            return;
        }
        if (bytes.length == 0) {
            if (!before.equals(emptyStamp)) {
                emptyStamp = before;
                logOnce("empty config", "Ledger config is empty, treating it as a torn write and keeping the previous one");
                return;
            }
        } else {
            emptyStamp = null;
        }
        Seen seen = new Seen(before, sha256(bytes));
        if (seen.equals(last)) {
            return;
        }
        last = seen;
        parseAndApply(bytes);
    }

    private void parseAndApply(byte[] bytes) {
        int from = bytes.length >= 3 && (bytes[0] & 0xFF) == 0xEF && (bytes[1] & 0xFF) == 0xBB && (bytes[2] & 0xFF) == 0xBF ? 3 : 0;
        Properties props = new Properties();
        reads++;
        try {
            props.load(new ByteArrayInputStream(bytes, from, bytes.length - from));
        } catch (IOException | RuntimeException e) {
            reject("cannot parse config: " + e.getClass().getSimpleName(), null);
            return;
        }
        ConfigParser.ParseResult result = ConfigParser.parse(props);
        if (result.ok()) {
            loggedErrors.clear();
            deliver(result.config());
        } else {
            reject(summarise(result.errors()), props);
        }
    }

    private void rejectOversized(Stamp s) {
        last = new Seen(s, "oversized");
        reject("config larger than " + MAX_BYTES + " bytes, ignored", null);
    }

    /** Logs once; applies the kill switch when the bad file says {@code enabled=false}; first load gets defaults. */
    private void reject(String msg, Properties props) {
        String enabled = props == null ? null : props.getProperty("enabled");
        boolean off = enabled != null && enabled.trim().equals("false");
        logOnce(msg, "Ledger config rejected, keeping the previous one" + (off ? " (enabled=false applied)" : "") + ": " + msg);
        LedgerConfig base = loaded ? current.get() : LedgerConfig.defaults();
        if (off) {
            if (!loaded || base.enabled()) {
                deliver(base.withEnabled(false));
            }
        } else if (!loaded) {
            deliver(base);
        }
    }

    private static String summarise(List<String> errors) {
        StringBuilder sb = new StringBuilder();
        int shown = Math.min(errors.size(), MAX_LISTED_ERRORS);
        for (int i = 0; i < shown; i++) {
            sb.append(i == 0 ? "" : "; ").append(errors.get(i));
        }
        if (errors.size() > shown) {
            sb.append("; and ").append(errors.size() - shown).append(" more");
        }
        return bound(sb.toString());
    }

    static String bound(String s) {
        String clean = s.replaceAll("\\p{Cc}", "?");
        return clean.length() <= MAX_LOG ? clean : clean.substring(0, MAX_LOG - 3) + "...";
    }

    private void logOnce(String key, String message) {
        String k = bound(key);
        if (loggedErrors.size() >= MAX_REMEMBERED) {
            loggedErrors.clear();
        }
        if (loggedErrors.add(k)) {
            log.warning(bound(message));
        }
    }

    private Stamp stamp() throws IOException {
        try {
            BasicFileAttributes a = Files.readAttributes(path, BasicFileAttributes.class);
            return new Stamp(a.lastModifiedTime().toMillis(), a.size(), a.fileKey());
        } catch (NoSuchFileException e) {
            return MISSING;
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private void deliver(LedgerConfig next) {
        current.set(next);
        loaded = true;
        if (stopped) {
            return;
        }
        try {
            onChange.accept(next);
        } catch (Throwable e) {
            logOnce("config consumer failed: " + e.getClass().getSimpleName(),
                    "Ledger config consumer failed: " + e.getClass().getSimpleName());
        }
    }
}
