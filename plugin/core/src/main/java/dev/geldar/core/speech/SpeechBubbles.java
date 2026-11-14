package dev.geldar.core.speech;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * Places each agent's latest chat line above the agent and removes it when it expires. {@link #say} and
 * {@link #expire} run on the server thread only. Neither throws: a failure is logged once, at fine level.
 * The map side is a {@link Renderer}, so BlueMap classes stay in {@link SpeechMarkers}.
 */
public final class SpeechBubbles {
    /** Height above the agent's feet where a bubble sits, in blocks. */
    static final double LIFT = 2.6;

    /** Draws the bubbles on the maps. Called on the server thread with every bubble that is still live. */
    public interface Renderer {
        void render(List<Placed> bubbles);
    }

    /** One bubble to draw: the agent, its world, the point to hang it from, and its HTML. */
    public record Placed(UUID agent, World world, double x, double y, double z, String html) {}

    private record Anchor(World world, double x, double y, double z) {}

    private final BubbleBook book;
    private final Renderer renderer;
    private final Logger log;
    private final Map<UUID, Anchor> anchors = new HashMap<>();
    private final AtomicBoolean warned = new AtomicBoolean();

    public SpeechBubbles(BubbleBook book, Renderer renderer, Logger log) {
        this.book = book;
        this.renderer = renderer;
        this.log = log;
    }

    /** Shows an agent's chat line above the agent's current position. Server thread. */
    public void say(Player player, String raw, long nowMillis) {
        try {
            Optional<String> text = SpeechText.clean(raw);
            Location at = player.getLocation();
            if (text.isEmpty() || !player.isOnline() || at.getWorld() == null) {
                return;
            }
            UUID agent = player.getUniqueId();
            anchors.put(agent, new Anchor(at.getWorld(), at.getX(), at.getY(), at.getZ()));
            book.put(agent, text.get(), nowMillis);
            sweep(nowMillis);
            draw();
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    /** Removes the bubbles that have expired and redraws the maps when any did. Server thread. */
    public void expire(long nowMillis) {
        try {
            if (sweep(nowMillis)) {
                draw();
            }
        } catch (RuntimeException e) {
            fail(e);
        }
    }

    private boolean sweep(long nowMillis) {
        boolean removed = false;
        for (UUID agent : book.expired(nowMillis)) {
            book.remove(agent);
            anchors.remove(agent);
            removed = true;
        }
        return removed;
    }

    private void draw() {
        List<Placed> placed = new ArrayList<>();
        for (Map.Entry<UUID, String> entry : book.snapshot().entrySet()) {
            Anchor at = anchors.get(entry.getKey());
            if (at != null) {
                placed.add(new Placed(entry.getKey(), at.world(), at.x(), at.y() + LIFT, at.z(),
                        SpeechText.html(entry.getValue())));
            }
        }
        renderer.render(placed);
    }

    private void fail(RuntimeException e) {
        if (warned.compareAndSet(false, true)) {
            log.log(Level.FINE, "speech bubble failed; later failures are not logged", e);
        }
    }
}
