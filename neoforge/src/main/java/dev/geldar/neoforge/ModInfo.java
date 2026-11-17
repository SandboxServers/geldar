package dev.geldar.neoforge;

/** Identity of this mod. The id must equal modId in META-INF/neoforge.mods.toml; ModInfoTest checks that. */
public final class ModInfo {
    private ModInfo() {
    }

    public static String modId() {
        return "geldar_neoforge";
    }
}
