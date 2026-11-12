package dev.geldar.core;

import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Pure logic of the gravestone marker: where it goes and what the sign says. No server types, so it is
 * unit-tested with a fake grid. The marker holds no items; it is a base block with a standing sign on top.
 */
public final class Gravestone {
    /** Mirror of MARKER_WORD in contract/src/agent-text.ts: sign text is text an agent can read. */
    static final Pattern MARKER_WORD =
            Pattern.compile("observer|watch|human|maker|stream|credit|colo|shard|harness", Pattern.CASE_INSENSITIVE);
    static final int RADIUS = 3;
    /** A sign line shows about 15 characters. */
    static final int LINE_MAX = 15;
    static final long TICKS_PER_DAY = 24_000L;

    private Gravestone() {}

    /** Block queries the search needs; the Bukkit side answers them from the live world. */
    public interface Grid {
        boolean isAir(int x, int y, int z);

        boolean isSolid(int x, int y, int z);

        boolean isLiquid(int x, int y, int z);
    }

    /** The base block position; the sign stands one block above it. */
    public record Spot(int x, int y, int z) {}

    /**
     * The nearest safe spot within {@link #RADIUS}: base block air, sign cell air, a solid non-liquid block
     * below, no liquid beside it. Spots with open air on all four sides win over cramped ones (a doorway or
     * corridor), then the nearest wins. Empty when there is none.
     */
    public static Optional<Spot> findSpot(Grid grid, int cx, int cy, int cz) {
        Spot best = null;
        long bestKey = Long.MAX_VALUE;
        for (int dx = -RADIUS; dx <= RADIUS; dx++) {
            for (int dy = -RADIUS; dy <= RADIUS; dy++) {
                for (int dz = -RADIUS; dz <= RADIUS; dz++) {
                    int x = cx + dx;
                    int y = cy + dy;
                    int z = cz + dz;
                    if (!safe(grid, x, y, z)) {
                        continue;
                    }
                    long cramped = openSides(grid, x, y, z) == 4 ? 0 : 1;
                    long key = cramped * 10_000L + (long) dx * dx + (long) dy * dy + (long) dz * dz;
                    if (key < bestKey) {
                        bestKey = key;
                        best = new Spot(x, y, z);
                    }
                }
            }
        }
        return Optional.ofNullable(best);
    }

    private static boolean safe(Grid g, int x, int y, int z) {
        return g.isAir(x, y, z)
                && g.isAir(x, y + 1, z)
                && g.isSolid(x, y - 1, z)
                && !g.isLiquid(x, y - 1, z)
                && !g.isLiquid(x + 1, y, z)
                && !g.isLiquid(x - 1, y, z)
                && !g.isLiquid(x, y, z + 1)
                && !g.isLiquid(x, y, z - 1);
    }

    private static int openSides(Grid g, int x, int y, int z) {
        int open = 0;
        open += g.isAir(x + 1, y, z) ? 1 : 0;
        open += g.isAir(x - 1, y, z) ? 1 : 0;
        open += g.isAir(x, y, z + 1) ? 1 : 0;
        open += g.isAir(x, y, z - 1) ? 1 : 0;
        return open;
    }

    /** The one cause word for a Bukkit damage cause name; never a killer's name. */
    public static String causeWord(String damageCause) {
        if (damageCause == null) {
            return "other";
        }
        return switch (damageCause.toUpperCase(Locale.ROOT)) {
            case "ENTITY_ATTACK", "ENTITY_SWEEP_ATTACK", "THORNS", "SONIC_BOOM" -> "slain";
            case "PROJECTILE" -> "shot";
            case "DROWNING" -> "drowned";
            case "FALL" -> "fell";
            case "FIRE", "FIRE_TICK", "LAVA", "HOT_FLOOR", "MELTING" -> "burned";
            case "STARVATION" -> "starved";
            default -> "other";
        };
    }

    /**
     * The four sign lines. {@code day} below 1 means unknown and the line is left blank. A name that
     * contains a marker word is replaced, so the sign can never carry meta text.
     */
    public static String[] lines(String playerName, long day, String cause) {
        String name = playerName == null || playerName.isBlank() || MARKER_WORD.matcher(playerName).find()
                ? "a traveller"
                : playerName.strip();
        if (name.length() > LINE_MAX) {
            name = name.substring(0, LINE_MAX);
        }
        return new String[] {"Here lies", name, day >= 1 ? "Day " + day : "", cause};
    }

    /** The 1-based world day from the full time in ticks; 0 when the time is unknown. */
    public static long dayOf(long fullTimeTicks) {
        return fullTimeTicks < 0 ? 0 : fullTimeTicks / TICKS_PER_DAY + 1;
    }
}
