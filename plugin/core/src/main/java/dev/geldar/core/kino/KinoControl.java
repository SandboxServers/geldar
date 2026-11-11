package dev.geldar.core.kino;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.HashMap;
import java.util.Map;
import java.util.Queue;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.LongSupplier;
import java.util.regex.Pattern;

/**
 * The plugin side of kino-control.schema.json: Glass asks for targets to be started and stopped. {@link #receive}
 * may be called from any thread (the NATS thread) and only queues; {@link #drain} runs on the server thread and
 * calls the feed, which reads the world. With the kill switch off every message is ignored. Nothing here is
 * visible to an agent or a player: the feed only reads.
 */
public final class KinoControl {
    /** A target Glass has not mentioned for this long is stopped (a Glass that died or restarted). */
    public static final long TTL_MILLIS = 45_000;

    private static final Pattern AGENT = Pattern.compile("^[a-z][a-z0-9_]{0,63}$");
    private static final Set<String> TYPES = Set.of("start", "resync", "refresh", "stop");
    private static final Set<String> KEYS = Set.of("control_version", "type", "target_agent_id");

    private record Command(String type, String agent) {}

    private final KinoFeed feed;
    private final LongSupplier clock;
    private final Queue<Command> queue = new ConcurrentLinkedQueue<>();
    private final Map<String, Long> lastSeen = new HashMap<>();

    public KinoControl(KinoFeed feed, LongSupplier clockMillis) {
        this.feed = feed;
        this.clock = clockMillis;
    }

    /** Parses one control message; anything that does not match the schema, or any message while killed, is dropped. */
    public void receive(String json) {
        if (feed.isKilled()) {
            return;
        }
        try {
            JsonObject o = JsonParser.parseString(json).getAsJsonObject();
            if (!o.keySet().equals(KEYS) || o.get("control_version").getAsInt() != 1) {
                return;
            }
            String type = o.get("type").getAsString();
            String agent = o.get("target_agent_id").getAsString();
            if (TYPES.contains(type) && AGENT.matcher(agent).matches()) {
                queue.add(new Command(type, agent));
            }
        } catch (RuntimeException e) {
            // Not JSON, wrong shape or wrong types: ignored.
        }
    }

    /** Applies queued commands and expires silent targets. Server thread only. */
    public void drain() {
        if (feed.isKilled()) {
            queue.clear();
            lastSeen.clear();
            return;
        }
        long now = clock.getAsLong();
        for (Command c = queue.poll(); c != null; c = queue.poll()) {
            switch (c.type()) {
                case "start", "resync" -> started(c.agent(), feed.start(c.agent()), now);
                case "refresh" -> started(c.agent(), feed.isTarget(c.agent()) || feed.start(c.agent()), now);
                default -> {
                    lastSeen.remove(c.agent());
                    feed.stop(c.agent(), "unsubscribed");
                }
            }
        }
        lastSeen.entrySet().removeIf(e -> {
            boolean stale = now - e.getValue() > TTL_MILLIS;
            if (stale) {
                feed.stop(e.getKey(), "unsubscribed");
            }
            return stale || !feed.isTarget(e.getKey());
        });
    }

    private void started(String agent, boolean running, long now) {
        if (running) {
            lastSeen.put(agent, now);
        }
    }
}
