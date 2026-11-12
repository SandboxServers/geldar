package dev.geldar.core.kino;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
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
    /** Sections read below the target's own section: little, since the ground below the agent is mostly hidden. */
    public static final int SECTIONS_BELOW = 1;

    /** Sections read above the target's own section: the sky and the surface above the agent are what it sees. */
    public static final int SECTIONS_ABOVE = 6;
    private static final String AIR = "minecraft:air";

    /** Blocks one {@link #pump} may read on the server thread (one section is 4096). */
    public static final int BLOCK_BUDGET_PER_TICK = 16_384;

    /** Blocks that are full opaque cubes; any other state counts as see-through, so a section is only skipped when sure. */
    private static final Set<String> OPAQUE = Set.of(
            "minecraft:stone", "minecraft:deepslate", "minecraft:granite", "minecraft:diorite", "minecraft:andesite",
            "minecraft:tuff", "minecraft:calcite", "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:grass_block",
            "minecraft:podzol", "minecraft:mycelium", "minecraft:gravel", "minecraft:clay", "minecraft:sand",
            "minecraft:red_sand", "minecraft:sandstone", "minecraft:netherrack", "minecraft:bedrock",
            "minecraft:obsidian", "minecraft:bricks", "minecraft:terracotta", "minecraft:rooted_dirt", "minecraft:mud",
            "minecraft:packed_mud", "minecraft:cobbled_deepslate", "minecraft:polished_deepslate",
            "minecraft:chiseled_deepslate", "minecraft:deepslate_tiles", "minecraft:reinforced_deepslate");

    /** Suffixes of whole opaque cube families: logs, wood, planks, bricks, concrete, wool, terracotta. */
    private static final List<String> OPAQUE_SUFFIXES =
            List.of("_log", "_wood", "_planks", "_bricks", "_concrete", "_wool", "_terracotta");

    /** Entities one {@link #tick} may examine per target (the entity_positions message itself is capped at 256). */
    public static final int ENTITY_EXAMINE_PER_TICK = 512;

    private static final int SECTION_BLOCKS = PaletteEncoder.CELLS;
    /** The six face layers (16 x 16 cells each) read only for a section whose own cells are all opaque. */
    private static final int FACE_BLOCKS = 6 * 256;
    /** The most one section can cost; a section is read only when this much of the budget is left. */
    private static final int WORST_SECTION = SECTION_BLOCKS + FACE_BLOCKS;

    private final KinoWorld world;
    private final int budget;
    private final KinoSink sink;
    private final int radius;
    private final Map<String, Target> targets = new ConcurrentHashMap<>();
    private volatile boolean killed;

    /** A section by chunk x, section y and chunk z. */
    private record Section(int x, int y, int z) {}

    private static final class Target {
        int chunkX;
        int chunkZ;
        /** The sections queued or sent and still inside the window; a section leaving the window is evicted. */
        final Set<Section> sent = new HashSet<>();
        /** The target's own section Y, as of the last window queue. */
        int sectionY;
        /** Sections still to read, as {x, y, z}; filled by a window request, drained by {@link #pump}. */
        final Deque<int[]> pending = new ArrayDeque<>();
        /** A resync arrived while a window was still queued: one more pass follows, not one per request. */
        boolean again;
        int lo;
        int hi;
        /** Where the next entity scan resumes: a window cell index and an entity index inside that chunk. */
        int scanChunk;
        int scanEntity;
    }

    public KinoFeed(KinoWorld world, KinoSink sink, int radiusChunks) {
        this(world, sink, radiusChunks, BLOCK_BUDGET_PER_TICK);
    }

    public KinoFeed(KinoWorld world, KinoSink sink, int radiusChunks, int blockBudgetPerTick) {
        this.budget = Math.max(WORST_SECTION, blockBudgetPerTick);
        this.world = world;
        this.sink = sink;
        this.radius = Math.max(1, Math.min(8, radiusChunks));
    }

    /**
     * Starts a feed for an online agent; false when killed or the agent is offline. For a target that already runs
     * this is a resync: it reads nothing here, it only asks for the window to be sent again (at most one pass is
     * queued behind the one in progress). The block reads happen in {@link #pump}, within the per-tick budget.
     */
    public boolean start(String agentId) {
        Optional<KinoWorld.Position> at = killed ? Optional.empty() : world.agentPosition(agentId);
        if (at.isEmpty()) {
            return false;
        }
        Target running = targets.get(agentId);
        if (running != null) {
            if (running.pending.isEmpty()) {
                running.sent.clear();
                queueWindow(running, at.get());
            } else {
                running.again = true;
            }
            return true;
        }
        Target t = new Target();
        targets.put(agentId, t);
        sink.publish(agentId, KinoMessages.hello(world.name(), agentId, radius));
        t.chunkX = chunk(at.get().x());
        t.chunkZ = chunk(at.get().z());
        sink.publish(agentId, KinoMessages.targetMoved(agentId, at.get().x(), at.get().y(), at.get().z()));
        queueWindow(t, at.get());
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
            boolean moved = cx != t.chunkX || cz != t.chunkZ;
            boolean sectionChanged = sectionOf(at.get().y()) != t.sectionY;
            if (moved) {
                t.chunkX = cx;
                t.chunkZ = cz;
                t.scanChunk = 0;
                t.scanEntity = 0;
                sink.publish(id, KinoMessages.targetMoved(id, at.get().x(), at.get().y(), at.get().z()));
            }
            if (moved || sectionChanged) {
                queueWindow(t, at.get());
            }
            sink.publish(id, KinoMessages.entityPositions(scanEntities(id, t)));
        }
    }

    /**
     * Looks at no more than {@link #ENTITY_EXAMINE_PER_TICK} entities per target per call, walking the window's
     * chunks from where the last call stopped, so a crowded world is covered over several ticks. An entity that
     * is an agent keeps its id only when it is this feed's own target (a viewer is not told who else is watched).
     */
    private List<KinoWorld.EntityView> scanEntities(String targetId, Target t) {
        int side = 2 * radius + 1;
        int cells = side * side;
        int left = ENTITY_EXAMINE_PER_TICK;
        int ci = t.scanChunk % cells;
        int from = t.scanEntity;
        List<KinoWorld.EntityView> out = new ArrayList<>();
        for (int visited = 0; visited < cells && left > 0; visited++) {
            int cx = t.chunkX - radius + ci / side;
            int cz = t.chunkZ - radius + ci % side;
            KinoWorld.ChunkEntities part = world.entitiesInChunk(cx, cz, from, left);
            for (KinoWorld.EntityView v : part.views()) {
                boolean hide = v.agentId() != null && !v.agentId().equals(targetId);
                out.add(hide ? new KinoWorld.EntityView(v.uid(), v.type(), null, v.x(), v.y(), v.z(), v.yaw(), v.pitch()) : v);
            }
            left -= part.views().size();
            if (from + part.views().size() < part.total()) {
                t.scanChunk = ci;
                t.scanEntity = from + part.views().size();
                return out;
            }
            from = 0;
            ci = (ci + 1) % cells;
        }
        t.scanChunk = ci;
        t.scanEntity = 0;
        return out;
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

    private static int sectionOf(double blockY) {
        return Math.floorDiv((int) Math.floor(blockY), 16);
    }

    /**
     * Reads queued sections for all targets, at most the block budget per call (call it every game tick). It
     * never reads more than the budget, whatever Glass asks for.
     */
    public void pump() {
        if (killed) {
            return;
        }
        int left = budget;
        for (Map.Entry<String, Target> e : targets.entrySet()) {
            Target t = e.getValue();
            while (left >= WORST_SECTION && !t.pending.isEmpty() && !killed) {
                int[] s = t.pending.poll();
                if (world.isChunkLoaded(s[0], s[2])) {
                    left -= sendSection(e.getKey(), s[0], s[1], s[2]);
                }
            }
            if (t.pending.isEmpty() && t.again) {
                t.again = false;
                Optional<KinoWorld.Position> at = world.agentPosition(e.getKey());
                if (at.isPresent()) {
                    t.sent.clear();
                    queueWindow(t, at.get());
                }
            }
        }
    }

    /**
     * Queues each loaded section of the window that is not already sent or queued; no block is read here. Sections
     * that left the window (by chunk or by section Y) are evicted, so coming back to them queues them again.
     */
    private void queueWindow(Target t, KinoWorld.Position at) {
        t.sectionY = sectionOf(at.y());
        t.lo = Math.max(world.minSectionY(), t.sectionY - SECTIONS_BELOW);
        t.hi = Math.min(world.maxSectionY(), t.sectionY + SECTIONS_ABOVE);
        t.sent.removeIf(s -> Math.abs(s.x() - t.chunkX) > radius || Math.abs(s.z() - t.chunkZ) > radius
                || s.y() < t.lo || s.y() > t.hi);
        t.pending.removeIf(s -> !t.sent.contains(new Section(s[0], s[1], s[2])));
        for (int x = t.chunkX - radius; x <= t.chunkX + radius; x++) {
            for (int z = t.chunkZ - radius; z <= t.chunkZ + radius; z++) {
                if (!world.isChunkLoaded(x, z)) {
                    continue;
                }
                for (int y = t.lo; y <= t.hi; y++) {
                    if (t.sent.add(new Section(x, y, z))) {
                        t.pending.add(new int[] {x, y, z});
                    }
                }
            }
        }
    }

    /**
     * Publishes one section unless it is empty or buried. Returns the blocks it may have read, which the caller
     * takes from the budget: a fully opaque section is charged for its face layers too, read or not.
     */
    private int sendSection(String agentId, int sx, int sy, int sz) {
        String[] cells = new String[PaletteEncoder.CELLS];
        boolean allAir = true;
        boolean allOpaque = true;
        int i = 0;
        for (int y = 0; y < 16; y++) {
            for (int z = 0; z < 16; z++) {
                for (int x = 0; x < 16; x++) {
                    String s = PaletteEncoder.normalize(world.blockState(sx * 16 + x, sy * 16 + y, sz * 16 + z));
                    allAir &= AIR.equals(s);
                    allOpaque &= opaque(s);
                    cells[i++] = s;
                }
            }
        }
        if (!allAir && !(allOpaque && sealed(sx, sy, sz))) {
            sink.publish(agentId, KinoMessages.chunkSection(sx, sz, sy, PaletteEncoder.encode(cells)));
        }
        return allOpaque ? WORST_SECTION : SECTION_BLOCKS;
    }

    /**
     * True when no camera can see into a section: its six face layers, one block outside it, are all opaque (the
     * caller has checked that the section itself is). Conservative: a section at the top or bottom of the world, or
     * a face in a chunk that is not loaded, is not sealed, so it is sent.
     */
    private boolean sealed(int sx, int sy, int sz) {
        if (sy <= world.minSectionY() || sy >= world.maxSectionY()) {
            return false;
        }
        int[] base = {sx * 16, sy * 16, sz * 16};
        for (int axis = 0; axis < 3; axis++) {
            int u = (axis + 1) % 3;
            int v = (axis + 2) % 3;
            for (int offset : new int[] {-1, 16}) {
                for (int a = 0; a < 16; a++) {
                    for (int b = 0; b < 16; b++) {
                        int[] c = {base[0], base[1], base[2]};
                        c[axis] = base[axis] + offset;
                        c[u] = base[u] + a;
                        c[v] = base[v] + b;
                        if (!world.isChunkLoaded(Math.floorDiv(c[0], 16), Math.floorDiv(c[2], 16))
                                || !opaque(PaletteEncoder.normalize(world.blockState(c[0], c[1], c[2])))) {
                            return false;
                        }
                    }
                }
            }
        }
        return true;
    }

    /** Whether a block state is a full opaque cube; unknown states are not. */
    private static boolean opaque(String state) {
        int bracket = state.indexOf('[');
        String id = bracket < 0 ? state : state.substring(0, bracket);
        if (OPAQUE.contains(id) || id.endsWith("_ore")) {
            return true;
        }
        for (String suffix : OPAQUE_SUFFIXES) {
            if (id.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }
}