package dev.geldar.core;

import dev.geldar.core.blockowner.CoreProtectPort;
import java.util.ArrayList;
import java.util.List;

/** A CoreProtect that has no rows and logs each placement as "user world x,y,z material", in call order. */
final class LoggingCoreProtect implements CoreProtectPort {
    private final List<String> logged = new ArrayList<>();

    @Override
    public List<LogRow> rows(String world, int chunkX, int chunkZ) {
        return List.of();
    }

    @Override
    public void logPlacement(String user, String world, int x, int y, int z, String material) {
        logged.add(user + " " + world + " " + x + "," + y + "," + z + " " + material);
    }

    List<String> logged() {
        return List.copyOf(logged);
    }
}
