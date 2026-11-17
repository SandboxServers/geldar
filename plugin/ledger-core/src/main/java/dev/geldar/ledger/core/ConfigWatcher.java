package dev.geldar.ledger.core;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.HashSet;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.logging.Logger;

/**
 * Re-reads the config file every 5 s on an async thread ({@link HostScheduler#everyMillis}; never
 * {@code everyTicks}, S6). The file is read only when its mtime or size changed. A bad file keeps the previous
 * snapshot and logs once per distinct error; a missing file means defaults. The consumer is called on the scheduler
 * thread whenever the snapshot is swapped, and once on the first poll.
 */
public final class ConfigWatcher {
    public static final long PERIOD_MS = 5000;

    private record Stamp(long mtime, long size) {}

    private static final Stamp UNREAD = new Stamp(Long.MIN_VALUE, -2);
    private static final Stamp MISSING = new Stamp(-1, -1);

    private final Path path;
    private final HostScheduler scheduler;
    private final Consumer<LedgerConfig> onChange;
    private final Logger log;
    private final AtomicReference<LedgerConfig> current = new AtomicReference<>(LedgerConfig.defaults());
    private final Set<String> loggedErrors = new HashSet<>();
    private Stamp last = UNREAD;
    private Cancellable task;
    private volatile int reads;

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
        if (task == null) {
            task = scheduler.everyMillis(PERIOD_MS, this::poll);
        }
    }

    public synchronized void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    /** The current snapshot (defaults until the first poll). */
    public LedgerConfig current() {
        return current.get();
    }

    /** Number of times the file content was actually read (for tests). */
    int reads() {
        return reads;
    }

    /** One poll; runs on the scheduler's async thread. Never throws. */
    void poll() {
        try {
            Stamp now = stamp();
            if (now.equals(last)) {
                return;
            }
            if (now.equals(MISSING)) {
                last = now;
                swap(LedgerConfig.defaults());
                return;
            }
            Properties props = new Properties();
            reads++;
            try (InputStream in = Files.newInputStream(path)) {
                props.load(in);
            }
            ConfigParser.ParseResult result = ConfigParser.parse(props);
            last = now;
            if (result.ok()) {
                loggedErrors.clear();
                swap(result.config());
            } else {
                String msg = String.join("; ", result.errors());
                if (loggedErrors.add(msg)) {
                    log.warning("Ledger config rejected, keeping the previous one: " + msg);
                }
            }
        } catch (NoSuchFileException e) {
            last = UNREAD; // raced with a delete: look again next poll
        } catch (IOException | RuntimeException e) {
            String msg = "cannot read config: " + e.getClass().getSimpleName();
            if (loggedErrors.add(msg)) {
                log.warning("Ledger config " + msg + ", keeping the previous one");
            }
        }
    }

    private Stamp stamp() throws IOException {
        try {
            BasicFileAttributes a = Files.readAttributes(path, BasicFileAttributes.class);
            return new Stamp(a.lastModifiedTime().toMillis(), a.size());
        } catch (NoSuchFileException e) {
            return MISSING;
        }
    }

    private void swap(LedgerConfig next) {
        current.set(next);
        onChange.accept(next);
    }
}
