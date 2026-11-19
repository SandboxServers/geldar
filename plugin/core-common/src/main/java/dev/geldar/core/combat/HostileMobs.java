package dev.geldar.core.combat;

import java.util.List;
import java.util.Set;

/**
 * Mobs the game always classes as hostile (decision 0154). The list mirrors ALWAYS_HOSTILE in
 * golem/src/perception/hostile-types.ts, in the same order; HostileMobsTest keeps them equal. Neutral and conditional
 * mobs (wolf, enderman, piglin, zombified_piglin, bee, iron_golem, spider, cave_spider) are not listed.
 */
public final class HostileMobs {
    static final List<String> NAMES = List.of(
            "blaze",
            "creeper",
            "drowned",
            "elder_guardian",
            "endermite",
            "evoker",
            "ghast",
            "guardian",
            "hoglin",
            "husk",
            "magma_cube",
            "phantom",
            "pillager",
            "ravager",
            "shulker",
            "silverfish",
            "skeleton",
            "slime",
            "stray",
            "vex",
            "vindicator",
            "warden",
            "witch",
            "wither",
            "wither_skeleton",
            "zoglin",
            "zombie",
            "zombie_villager");

    private static final Set<String> SET = Set.copyOf(NAMES);

    private HostileMobs() {}

    /** True for an always-hostile mob type, given without its namespace (for example "zombie"). */
    public static boolean isHostile(String mobType) {
        return mobType != null && SET.contains(mobType);
    }
}
