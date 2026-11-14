package dev.geldar.core.blockowner;

import java.util.ArrayList;
import java.util.List;

/** A scripted CoreProtect: returns the rows it is given, or throws, and counts the lookups it served. */
final class FakeCoreProtectPort implements CoreProtectPort {
    private final List<LogRow> rows = new ArrayList<>();
    private RuntimeException failure;
    private long delayMs;
    private int lookups;
    private String lastThread;
    private final List<String> logged = new ArrayList<>();
    private boolean refuseLogging;

    /** Adds one row; rows must be added newest first. */
    FakeCoreProtectPort row(String world, int x, int y, int z, boolean place, String user) {
        rows.add(new LogRow(world, x, y, z, place, user, false));
        return this;
    }

    FakeCoreProtectPort rolledBack(String world, int x, int y, int z, boolean place, String user) {
        rows.add(new LogRow(world, x, y, z, place, user, true));
        return this;
    }

    /** The placements logged, in call order, each as "user world x,y,z material". */
    List<String> logged() {
        return List.copyOf(logged);
    }

    /** Makes the next {@link #logPlacement} calls throw. */
    FakeCoreProtectPort refuseLogging() {
        this.refuseLogging = true;
        return this;
    }

    @Override
    public synchronized void logPlacement(String user, String world, int x, int y, int z, String material) {
        if (refuseLogging) {
            throw new IllegalStateException("scripted refusal");
        }
        logged.add(user + " " + world + " " + x + "," + y + "," + z + " " + material);
    }

    FakeCoreProtectPort failWith(RuntimeException e) {
        this.failure = e;
        return this;
    }

    FakeCoreProtectPort sleepFor(long ms) {
        this.delayMs = ms;
        return this;
    }

    int lookups() {
        return lookups;
    }

    String lastThread() {
        return lastThread;
    }

    @Override
    public synchronized List<LogRow> rows(String world, int chunkX, int chunkZ) {
        lookups++;
        lastThread = Thread.currentThread().getName();
        if (delayMs > 0) {
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        if (failure != null) {
            throw failure;
        }
        return List.copyOf(rows);
    }
}
