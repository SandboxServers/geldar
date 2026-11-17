package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.HostInfo;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;

/** {@link HostInfo} over two suppliers, so the class holds no game type and is testable without a server. */
final class NeoForgeHostInfo implements HostInfo {
    private final LongSupplier tick;
    private final BooleanSupplier mainThread;

    NeoForgeHostInfo(LongSupplier tick, BooleanSupplier mainThread) {
        this.tick = tick;
        this.mainThread = mainThread;
    }

    @Override
    public long serverTick() {
        return tick.getAsLong();
    }

    @Override
    public boolean isMainThread() {
        return mainThread.getAsBoolean();
    }

    @Override
    public String loaderName() {
        return "neoforge";
    }
}