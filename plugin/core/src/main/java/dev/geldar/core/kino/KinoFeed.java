package dev.geldar.core.kino;

import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The feed of decision 0075: for each target agent it reads the loaded chunks around the agent and publishes
 * the kino-feed messages. It never loads a chunk, shows nothing in the game and takes no input. The kill
 * switch ({@link #kill}) says bye to every target and silences the feed for good.
 */
public final class KinoFeed {
    /** Sections read above and below the target's own section. */
    public static final int SECTIONS_BELOW = 2;

    public static final int SECTIONS_ABOVE = 2;
    private static final String AIR = "minecraft:air";

    private final KinoWorld world;
    private final KinoSink sink;
    private final int radius;
    private final Map<String, Target> targets = new ConcurrentHashMap<>();
    private volatile boolean killed;

    private static final class Target {
        int chunkX;
        int chunkZ;
        final Set<Long> sent = new HashSet<>();
    }

    public KinoFeed(KinoWorld world, KinoSink sink, int radiusChunks) {
        this.world = world;
        this.sink = sink;
        this.radius = Math.max(1, Math.min(8, radiusChunks));
    }

    /** Starts a feed for an online agent; false when killed or the agent is offline. */
    public boolean start(String agentId) {
        Optional<KinoWorld.Position> at = killed ? Optional.empty() : world.agentPosition(agentId);
        if (at.isEmpty()) {
            return false;
        }
        Target t = new Target();
        targets.put(agentId, t);
        sink.publish(agentId, KinoMessages.hello(world.name(), agentId, radius));
        t.chunkX = chunk(at.get().x());
        t.chunkZ = chunk(at.get().z());
        sendWindow(agentId, t, at.get());
        return true;
    }

    public void stop(String agentId, String reason) {
        if (!killed && targets.remove(agentId) != null) {
            sink.publish(agentId, KinoMessages.bye(reason));
        }
    }

    /** The kill switch: bye to every target, then nothing more is ever published. */
    public void kill() {
        if (killed) {
            return;
        }
        killed = true;
        targets.keySet().forEach(id -> sink.publish(id, KinoMessages.bye("kill_switch")));
        targets.clear();
    }

    /** Config reload: false is the kill switch (bye to every target, publishing stops); true allows starts again. */
    public void setEnabled(boolean enabled) {
        if (!enabled) {
            kill();
        } else {
            killed = false;
        }
    }

    /** Whether the agent is a current target; only targets are named in entity positions. */
    public boolean isTarget(String agentId) {
        return targets.containsKey(agentId);
    }

    public boolean isKilled() {
        return killed;
    }

    /** One tick of the feed: follows each target and publishes entity positions. */
    public void tick() {
        for (Map.Entry<String, Target> e : targets.entrySet()) {
            if (killed) {
                return;
            }
            String id = e.getKey();
            Optional<KinoWorld.Position> at = world.agentPosition(id);
            if (at.isEmpty()) {
                stop(id, "session_ended");
                continue;
            }
            Target t = e.getValue();
            int cx = chunk(at.get().x());
            int cz = chunk(at.get().z());
            if (cx != t.chunkX || cz != t.chunkZ) {
                t.chunkX = cx;
                t.chunkZ = cz;
                sink.publish(id, KinoMessages.targetMoved(id, at.get().x(), at.get().y(), at.get().z()));
                sendWindow(id, t, at.get());
            }
            sink.publish(id, KinoMessages.entityPositions(world.entitiesNear(at.get().x(), at.get().z(), radius)));
        }
    }

    /** A block change; sent to every target whose window holds the block. */
    public void blockChanged(String worldName, int x, int y, int z, String state) {
        if (killed || !world.name().equals(worldName)) {
            return;
        }
        for (Map.Entry<String, Target> e : targets.entrySet()) {
            Target t = e.getValue();
            if (Math.abs(Math.floorDiv(x, 16) - t.chunkX) <= radius
                    && Math.abs(Math.floorDiv(z, 16) - t.chunkZ) <= radius) {
                sink.publish(e.getKey(), KinoMessages.blockUpdate(x, y, z, state));
            }
        }
    }

    private static int chunk(double blockCoord) {
        return Math.floorDiv((int) Math.floor(blockCoord), 16);
    }

    /** Sends each loaded, not yet sent chunk of the window; a section that is all air is not sent. */
    private void sendWindow(String agentId, Target t, KinoWorld.Position at) {
        int sy = Math.floorDiv((int) Math.floor(at.y()), 16);
        int lo = Math.max(world.minSectionY(), sy - SECTIONS_BELOW);
        int hi = Math.min(world.maxSectionY(), sy + SECTIONS_ABOVE);
        t.sent.removeIf(k -> Math.abs((int) (k >> 32) - t.chunkX) > radius
                || Math.abs((int) (long) k - t.chunkZ) > radius);
        for (int x = t.chunkX - radius; x <= t.chunkX + radius; x++) {
            for (int z = t.chunkZ - radius; z <= t.chunkZ + radius; z++) {
                long key = ((long) x << 32) ^ (z & 0xffffffffL);
                if (t.sent.contains(key) || !world.isChunkLoaded(x, z)) {
                    continue;
                }
                t.sent.add(key);
                for (int y = lo; y <= hi; y++) {
                    sendSection(agentId, x, y, z);
                }
            }
        }
    }

    private void sendSection(String agentId, int sx, int sy, int sz) {
        String[] cells = new String[PaletteEncoder.CELLS];
        boolean allAir = true;
        int i = 0;
        for (int y = 0; y < 16; y++) {
            for (int z = 0; z < 16; z++) {
                for (int x = 0; x < 16; x++) {
                    String s = PaletteEncoder.normalize(world.blockState(sx * 16 + x, sy * 16 + y, sz * 16 + z));
                    allAir &= AIR.equals(s);
                    cells[i++] = s;
                }
            }
        }
        if (!allAir) {
            sink.publish(agentId, KinoMessages.chunkSection(sx, sz, sy, PaletteEncoder.encode(cells)));
        }
    }
}