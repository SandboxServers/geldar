package dev.geldar.core.proximity;

import java.util.Set;

/**
 * The absorption table of decision 0199, step 4: the value one block adds to effective distance. Rows are the table
 * in the record. Every value is a proposal, not measured; MH-8a sets the final values. Pure: it reads a
 * {@link BlockProbe} and nothing else.
 *
 * <p>Ids are matched without the {@code minecraft:} prefix. Families are matched by suffix (fences, walls, logs,
 * ores, wool, stained glass). Doors and trapdoors count only for the wood types listed here; any other door is
 * unknown.
 */
public final class AbsorptionTable {
    /** Absorption of a block the table does not list (also any solid block not listed). Proposal, not measured. */
    public static final double DEFAULT_ABSORPTION = 2.0;

    private static final String NAMESPACE = "minecraft:";
    private static final Set<String> WOOD_TYPES = Set.of(
            "oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "bamboo", "crimson", "warped");

    private AbsorptionTable() {
    }

    /**
     * The absorption of {@code block}, in blocks of effective distance. An open gate, door or trapdoor absorbs 0; a
     * closed one follows its row. A null id is unknown and takes the default.
     */
    public static double of(BlockProbe block) {
        String name = name(block.id());
        if (name == null) {
            return DEFAULT_ABSORPTION;
        }
        if (name.equals("air") || name.equals("cave_air") || name.equals("void_air")) {
            return 0.0;
        }
        if (name.equals("glass") || name.equals("glass_pane") || name.equals("iron_bars")
                || name.endsWith("_stained_glass") || name.endsWith("_stained_glass_pane")) {
            return 0.5;
        }
        if (name.equals("water")) {
            return 1.0;
        }
        if (name.endsWith("_fence_gate")) {
            return block.open() ? 0.0 : 1.0;
        }
        if (name.endsWith("_fence") || name.endsWith("_wall")) {
            return 1.0;
        }
        if (name.endsWith("_planks") || name.endsWith("_log") || name.endsWith("_leaves")) {
            return 1.0;
        }
        if (isWoodenOpening(name, "_door") || isWoodenOpening(name, "_trapdoor")) {
            return block.open() ? 0.0 : 2.0;
        }
        if (name.endsWith("_wool")) {
            return 3.0;
        }
        if (name.equals("stone") || name.equals("dirt") || name.equals("gravel") || name.equals("bricks")
                || name.endsWith("_ore")) {
            return 2.0;
        }
        return DEFAULT_ABSORPTION;
    }

    private static String name(String id) {
        if (id == null) {
            return null;
        }
        return id.startsWith(NAMESPACE) ? id.substring(NAMESPACE.length()) : id;
    }

    private static boolean isWoodenOpening(String name, String suffix) {
        if (!name.endsWith(suffix)) {
            return false;
        }
        return WOOD_TYPES.contains(name.substring(0, name.length() - suffix.length()));
    }
}
