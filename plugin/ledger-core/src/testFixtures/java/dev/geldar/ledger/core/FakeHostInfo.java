package dev.geldar.ledger.core;

/** A {@link HostInfo} whose tick, loader name and main-thread answer are settable. */
public final class FakeHostInfo implements HostInfo {
    private volatile long serverTick;
    private volatile boolean mainThread;
    private volatile String loaderName = "fake";

    @Override
    public long serverTick() {
        return serverTick;
    }

    @Override
    public boolean isMainThread() {
        return mainThread;
    }

    @Override
    public String loaderName() {
        return loaderName;
    }

    public FakeHostInfo serverTick(long tick) {
        this.serverTick = tick;
        return this;
    }

    /** Tests set this to true to simulate the caller being the server thread. */
    public FakeHostInfo mainThread(boolean value) {
        this.mainThread = value;
        return this;
    }

    public FakeHostInfo loaderName(String name) {
        this.loaderName = name;
        return this;
    }
}