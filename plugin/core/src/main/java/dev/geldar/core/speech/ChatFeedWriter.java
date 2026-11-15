package dev.geldar.core.speech;

import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.World;

/**
 * The BlueMap side of the live chat panel (decision 0310). Keeps a {@link ChatRing} and writes it as {@link #FILE}
 * into the BlueMap web root. Loaded only when BlueMap is enabled. The ring keeps its lines whether or not BlueMap is
 * attached; nothing is written before {@link #attach} or after {@link #detach}. Writes happen on an async task, at
 * most once a second (the task runs every 20 ticks and writes only when the ring changed), through a temporary file
 * that is moved into place. After {@link #SLOW_AFTER_FAILURES} failures in a row, retries come only every
 * {@link #SLOW_RETRY_SECONDS} seconds. Never throws: the first failure is logged once, at warning level.
 */
public final class ChatFeedWriter {
    /** The file the panel page reads, in the BlueMap web root. */
    public static final String FILE = "geldar-chat.json";
    /** The marker set the speech bubbles used (decision 0197); deleted from every map on attach. */
    static final String OLD_MARKER_SET = "geldar-speech";
    /** Consecutive write failures after which retries slow down. */
    static final int SLOW_AFTER_FAILURES = 5;
    /** The retry interval once retries are slowed. */
    static final long SLOW_RETRY_SECONDS = 30;

    private final ChatRing ring = new ChatRing();
    private final Logger log;
    private final LongSupplier nanos;
    private final AtomicBoolean dirty = new AtomicBoolean();
    private final AtomicBoolean warned = new AtomicBoolean();
    private volatile Path root;
    private int failures;
    private long nextAttemptNanos;
    private long writes;

    public ChatFeedWriter(Logger log) {
        this(log, System::nanoTime);
    }

    /** The nanosecond clock is a seam for tests; production uses {@link System#nanoTime}. */
    ChatFeedWriter(Logger log, LongSupplier nanos) {
        this.log = log;
        this.nanos = nanos;
    }

    /** Records an agent's chat line. Safe on any thread; the file is written by the next flush. */
    public void say(UUID agent, String text, long nowMillis) {
        try {
            ring.add(agent, text, nowMillis);
            dirty.set(true);
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    /** BlueMap has enabled: take its web root, delete the old bubble marker set, and write the ring soon. */
    public void attach(BlueMapAPI api) {
        try {
            attach(api.getWebApp().getWebRoot());
            removeOldMarkerSets(api);
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    /** Uses {@code webRoot} as the directory the feed is written to, and writes the ring soon. */
    synchronized void attach(Path webRoot) {
        root = webRoot;
        failures = 0;
        nextAttemptNanos = 0;
        dirty.set(true);
        log.info("chat feed attached");
    }

    /** BlueMap has disabled: nothing is written until the next attach. */
    public void detach() {
        root = null;
    }

    /** Writes the ring if it changed since the last write. Runs on an async task; never throws. */
    public synchronized void flushIfDirty() {
        Path dir = root;
        if (dir == null || !dirty.get()) {
            return;
        }
        long now = nanos.getAsLong();
        if (failures >= SLOW_AFTER_FAILURES && now - nextAttemptNanos < 0) {
            return;
        }
        dirty.set(false);
        try {
            Path tmp = dir.resolve(FILE + ".tmp");
            Files.writeString(tmp, ring.toJson(), StandardCharsets.UTF_8);
            Files.move(tmp, dir.resolve(FILE), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            failures = 0;
            writes++;
        } catch (IOException | RuntimeException e) {
            dirty.set(true);
            failures++;
            if (failures >= SLOW_AFTER_FAILURES) {
                nextAttemptNanos = now + TimeUnit.SECONDS.toNanos(SLOW_RETRY_SECONDS);
            }
            fail(e);
        }
    }

    /** How many times the feed file has been written; for tests. */
    synchronized long writeCount() {
        return writes;
    }

    private static void removeOldMarkerSets(BlueMapAPI api) {
        for (World world : Bukkit.getWorlds()) {
            api.getWorld(world).ifPresent(blueWorld -> {
                for (BlueMapMap map : blueWorld.getMaps()) {
                    map.getMarkerSets().remove(OLD_MARKER_SET);
                }
            });
        }
    }

    private void fail(Exception e) {
        if (warned.compareAndSet(false, true)) {
            log.log(Level.WARNING, "chat feed was not written (" + e.getClass().getName()
                    + "); later failures are not logged", e);
        }
    }
}
