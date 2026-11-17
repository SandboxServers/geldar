package dev.geldar.core.proximity;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Judges one chat line for every listener (decision 0199, steps 1, 2, 3 and 5). Pure: blocks come through
 * {@link BlockReader}, so it runs on the server thread with a live or snapshot reader and in tests with a grid.
 * Listeners inside the raw gate are cast nearest first against one {@link LineBudget} per line, so a spent budget
 * silences the farthest. A completed cast is cached per (speaker, listener) for the tick. Not thread-safe.
 */
public final class ChatHearing {
    /** One listener: a key (the player name), whether it shares the speaker's world, and its feet position. */
    public record Candidate(String key, boolean sameWorld, double x, double y, double z) {
    }

    /** The tier of one listener; {@code notice} is set only for MUFFLED. */
    public record Verdict(String key, Tier tier, MuffledNotice notice) {
    }

    /** The outcome of one cast: the tier, whether it may be cached, and whether the budget caused the silence. */
    private record Cast(Tier tier, boolean cacheable, boolean budgetCaused) {
    }

    private final MuffleSettings settings;
    private final Consumer<String> log;
    private final Map<String, Cast> cache = new HashMap<>();
    private long cacheTick = Long.MIN_VALUE;

    public ChatHearing(MuffleSettings settings, Consumer<String> log) {
        this.settings = settings;
        this.log = log;
    }

    /**
     * The verdict of each listener inside the raw gate, nearest first. A listener outside the gate gets no verdict.
     * When the line budget silences any listener, one counter line is logged; the words are never logged.
     */
    public List<Verdict> judge(long tick, String speaker, double sx, double sy, double sz,
            List<Candidate> listeners, BlockReader reader) {
        if (tick != cacheTick) {
            cache.clear();
            cacheTick = tick;
        }
        List<Candidate> inGate = new ArrayList<>();
        for (Candidate c : listeners) {
            if (ProximityRule.heard(c.sameWorld(), c.x() - sx, c.y() - sy, c.z() - sz)) {
                inGate.add(c);
            }
        }
        inGate.sort(Comparator.comparingDouble((Candidate c) -> raw(c, sx, sy, sz)).thenComparing(Candidate::key));
        LineBudget budget = new LineBudget(settings.perLineCap());
        List<Verdict> verdicts = new ArrayList<>();
        int silencedByBudget = 0;
        long started = settings.benchLog() ? System.nanoTime() : 0L;
        for (Candidate c : inGate) {
            String cacheKey = speaker + "\u0000" + c.key();
            Cast cast = cache.get(cacheKey);
            if (cast == null) {
                cast = cast(sx, sy, sz, c, reader, budget);
                if (cast.cacheable()) {
                    cache.put(cacheKey, cast);
                }
                if (cast.budgetCaused()) {
                    silencedByBudget++;
                }
            }
            MuffledNotice notice = cast.tier() == Tier.MUFFLED
                    ? MuffledNotice.of(sx, sz, c.x(), c.z(), sy - c.y(), raw(c, sx, sy, sz))
                    : null;
            verdicts.add(new Verdict(c.key(), cast.tier(), notice));
        }
        if (silencedByBudget > 0) {
            log.accept("chat: " + silencedByBudget + " listener(s) silenced by the read budget");
        }
        if (settings.benchLog()) {
            long ns = System.nanoTime() - started;
            int reads = settings.perLineCap() - budget.remaining();
            boolean capHit = budget.remaining() == 0 || silencedByBudget > 0;
            log.accept("muffle-bench line speaker=" + speaker + " tick=" + tick + " listeners=" + verdicts.size()
                    + " reads=" + reads + " capHit=" + capHit + " ns=" + ns);
        }
        return verdicts;
    }

    private Cast cast(double sx, double sy, double sz, Candidate c, BlockReader reader, LineBudget budget) {
        Absorption.Effective ray;
        try {
            ray = Absorption.effectiveDistance(sx, sy, sz, c.x(), c.y(), c.z(), reader,
                    Math.min(settings.perRayCap(), budget.remaining()));
        } catch (UnloadedBlock unloaded) {
            // A chunk not loaded: silent for this listener, nothing forced to load, and no line for the block.
            budget.take(Math.min(1, budget.remaining()));
            return new Cast(Tier.SILENT, false, false);
        }
        budget.take(ray.reads());
        if (ray.cutShort()) {
            return new Cast(Tier.SILENT, false, budget.remaining() == 0);
        }
        // The sealed penalty only matters when it moves the listener to another tier. An open-air listener whose
        // penalised distance keeps the same tier skips the column scan, so it does not spend the line budget.
        Tier open = ProximityRule.tier(ray.distance(), false, settings.margin());
        Tier sealedTier = ProximityRule.tier(ray.distance() + settings.sealedPenalty(), false, settings.margin());
        if (open == sealedTier) {
            return new Cast(open, true, false);
        }
        int floorX = (int) Math.floor(c.x());
        int floorY = (int) Math.floor(c.y());
        int floorZ = (int) Math.floor(c.z());
        Absorption.Sealed sealed;
        try {
            sealed = Absorption.sealedPenalty(floorX, floorY, floorZ, reader, reader.buildLimit(),
                    Math.min(settings.perRayCap(), budget.remaining()));
        } catch (UnloadedBlock unloaded) {
            budget.take(Math.min(1, budget.remaining()));
            return new Cast(Tier.SILENT, false, false);
        }
        budget.take(sealed.reads());
        if (sealed.truncated() && budget.remaining() == 0) {
            return new Cast(Tier.SILENT, false, true);
        }
        double effective = ray.distance() + (sealed.penalty() != 0 ? settings.sealedPenalty() : 0.0);
        return new Cast(ProximityRule.tier(effective, false, settings.margin()), true, false);
    }

    private static double raw(Candidate c, double sx, double sy, double sz) {
        double dx = c.x() - sx;
        double dy = c.y() - sy;
        double dz = c.z() - sz;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
}
