package dev.geldar.neoforge;

import dev.geldar.core.EventEnvelope;
import java.time.Instant;
import java.util.function.Supplier;

/**
 * The export's handler bodies, free of NeoForge types. Each one builds one envelope and hands it to the lifecycle,
 * which only enqueues. Nothing here throws into the server thread: a failure is logged once per event and dropped.
 */
public final class ExportHandlers {
    /** server_tps is written every 400 ticks: 20 s at 20 TPS, the interval Paper's tpsIntervalSeconds defaults to. */
    public static final int TPS_EVERY_TICKS = 400;

    private final ExportLifecycle lifecycle;
    private final String shard;
    private final Supplier<Instant> clock;
    private final OperatorSink sink;
    private final TickWindow window = new TickWindow();
    private long tickStartNanos;
    private long worldTick;
    private int ticksSinceTps;

    public ExportHandlers(ExportLifecycle lifecycle, String shard, Supplier<Instant> clock, OperatorSink sink) {
        this.lifecycle = lifecycle;
        this.shard = shard;
        this.clock = clock;
        this.sink = sink;
    }

    /** A living player took damage; {@code amount} is the damage applied after reductions. */
    public void damage(String player, String cause, double amount) {
        send("damage", () -> EventMapping.damage(shard, clock.get(), worldTick, player, cause, amount));
    }

    /** A player died at {@code where} in {@code dimensionId}. */
    public void death(String player, String cause, EventMapping.Pos where, String dimensionId) {
        send("death", () -> EventMapping.death(shard, clock.get(), worldTick, player, cause, where, dimensionId));
    }

    /** A player got into a bed and is sleeping. */
    public void sleep(String player) {
        send("sleep", () -> EventMapping.sleep(shard, clock.get(), worldTick, player));
    }

    /** The start of a server tick; {@code nanoTime} is {@code System.nanoTime()} at that point. */
    public void tickStart(long nanoTime) {
        tickStartNanos = nanoTime;
    }

    /**
     * The end of a server tick. Records its duration and, every {@link #TPS_EVERY_TICKS} ticks, writes server_tps.
     * {@code serverTick} is the server's tick count; {@code players} the online player count.
     */
    public void tickEnd(long nanoTime, long serverTick, int players) {
        worldTick = serverTick;
        window.record(nanoTime - tickStartNanos);
        ticksSinceTps++;
        if (ticksSinceTps >= TPS_EVERY_TICKS) {
            ticksSinceTps = 0;
            send("server_tps", () -> EventMapping.serverTps(
                    shard,
                    clock.get(),
                    worldTick,
                    window.tps(),
                    players,
                    lifecycle.dropped(),
                    lifecycle.connected()));
        }
    }

    /** Builds with {@code build} and publishes; a failure in either step is logged and the event is skipped. */
    private void send(String type, Supplier<EventEnvelope> build) {
        try {
            lifecycle.publish(build.get());
        } catch (RuntimeException e) {
            sink.warn("geldar_neoforge could not export " + type + " (" + e.getClass().getSimpleName() + ")");
        }
    }
}
