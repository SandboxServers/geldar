package dev.geldar.core.speech;

import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.World;

/**
 * The BlueMap side of the live chat panel (decision 0310). Keeps a {@link ChatRing} and writes it as {@link #FILE}
 * into the BlueMap web root. Loaded only when BlueMap is enabled. The ring keeps its lines whether or not BlueMap is
 * attached; nothing is written before {@link #attach} or after {@link #detach}. Writes happen on an async task, at
 * most once a second (the task runs every 20 ticks and writes only when the ring changed), through a temporary file
 * that is moved into place. Never throws: a failure is logged once, at fine level.
 */
public final class ChatFeedWriter {
    /** The file the panel page reads, in the BlueMap web root. */
    public static final String FILE = "geldar-chat.json";
    /** The marker set the speech bubbles used (decision 0197); deleted from every map on attach. */
    static final String OLD_MARKER_SET = "geldar-speech";

    private final ChatRing ring = new ChatRing();
    private final Logger log;
    private final AtomicBoolean dirty = new AtomicBoolean();
    private final AtomicBoolean warned = new AtomicBoolean();
    private volatile Path root;

    public ChatFeedWriter(Logger log) {
        this.log = log;
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
            root = api.getWebApp().getWebRoot();
            dirty.set(true);
            removeOldMarkerSets(api);
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    /** BlueMap has disabled: nothing is written until the next attach. */
    public void detach() {
        root = null;
    }

    /** Writes the ring if it changed since the last write. Runs on an async task; never throws. */
    public synchronized void flushIfDirty() {
        Path dir = root;
        if (dir == null || !dirty.getAndSet(false)) {
            return;
        }
        try {
            Path tmp = dir.resolve(FILE + ".tmp");
            Files.writeString(tmp, ring.toJson(), StandardCharsets.UTF_8);
            Files.move(tmp, dir.resolve(FILE), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException | RuntimeException e) {
            dirty.set(true);
            fail(e);
        }
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
            log.log(Level.FINE, "chat feed was not written; later failures are not logged", e);
        }
    }
}
