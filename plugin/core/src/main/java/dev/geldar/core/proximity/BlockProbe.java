package dev.geldar.core.proximity;

/**
 * One block as the absorption model sees it: a namespaced id (for example {@code minecraft:oak_planks}), whether it
 * is solid, and whether a door, trapdoor or gate is open. Plain data, so the model needs no Bukkit or Paper types.
 */
public record BlockProbe(String id, boolean solid, boolean open) {
}
