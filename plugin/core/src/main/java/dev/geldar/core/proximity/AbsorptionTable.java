package dev.geldar.core.proximity;

/**
 * The absorption table of decision 0199, step 4: the value one block adds to effective distance. Rows are the table
 * in the record. Every value is a proposal, not measured; MH-8a sets the final values. Pure: it reads a
 * {@link BlockProbe} and nothing else.
 *
 * <p>Ids are matched without the {@code minecraft:} prefix. Families are matched by suffix (fences, walls, logs,
 * wood and stems, ores, wool, stained glass). Doors and trapdoors of any type absorb 2 when closed and 0 when open. An
 * unlisted non-solid block (grass, torches, vines) absorbs 0; an unlisted solid block takes the default. Slabs, stairs,
 * carpets and tinted glass are unlisted, so they take the default 2 (to be settled by MH-8a).
 */
public final class AbsorptionTable {
    /** Absorption of a solid block the table does not list. Proposal, not measured. */
    public static final double DEFAULT_ABSORPTION = 2.0;

    private static final String NAMESPACE = "minecraft:";

    private AbsorptionTable() {
    }

    /**
     * The absorption of {@code block}, in blocks of effective distance. An open gate, door or trapdoor absorbs 0; a
     * closed door or trapdoor absorbs 2 whatever its material. An unlisted non-solid block absorbs 0. A null id is
     * unknown and takes the default.
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
        if (name.endsWith("_planks") || name.endsWith("_log") || name.endsWith("_wood") || name.endsWith("_stem")
                || name.endsWith("_leaves")) {
            return 1.0;
        }
        if (name.endsWith("_door") || name.endsWith("_trapdoor")) {
            return block.open() ? 0.0 : 2.0;
        }
        if (name.endsWith("_wool")) {
            return 3.0;
        }
        if (name.equals("stone") || name.equals("dirt") || name.equals("gravel") || name.equals("bricks")
                || name.endsWith("_ore")) {
            return 2.0;
        }
        return block.solid() ? DEFAULT_ABSORPTION : 0.0;
    }

    private static String name(String id) {
        if (id == null) {
            return null;
        }
        return id.startsWith(NAMESPACE) ? id.substring(NAMESPACE.length()) : id;
    }
}
