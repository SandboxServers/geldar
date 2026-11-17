package dev.geldar.ledger.core;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

/**
 * One daemon thread that drains the rings into a {@link Sink}: batches of up to 256 records per ring
 * every 50 ms. Every Throwable from the sink is caught and counted in {@link #sinkErrors()}; the thread
 * never dies from it. A blocking sink only delays draining: producers keep dropping into full rings.
 */
public final class Emitter implements AutoCloseable {
  static final int BATCH = 256;
  static final long PERIOD_MS = 50L;
  static final long CLOSE_WAIT_MS = 1000L;

  private final List<EventRing> rings;
  private final Sink sink;
  private final AtomicLong sinkErrors = new AtomicLong();
  private final Thread thread;
  private volatile boolean running = true;

  public Emitter(String threadName, List<EventRing> rings, Sink sink) {
    this.rings = List.copyOf(rings);
    this.sink = sink;
    this.thread = new Thread(this::run, threadName);
    this.thread.setDaemon(true);
  }

  public Emitter start() {
    thread.start();
    return this;
  }

  public long sinkErrors() {
    return sinkErrors.get();
  }

  private void run() {
    EventRing.ErrorCounter errors = sinkErrors::incrementAndGet;
    while (running) {
      try {
        boolean more;
        do {
          more = false;
          for (EventRing r : rings) {
            if (r.drain(BATCH, sink, errors) == BATCH) {
              more = true;
            }
          }
        } while (more && running);
      } catch (Throwable e) {
        sinkErrors.incrementAndGet();
      }
      try {
        Thread.sleep(PERIOD_MS);
      } catch (InterruptedException e) {
        return;
      }
    }
  }

  /** Stops the thread; waits at most one second (a sink blocked longer is abandoned, the thread is a daemon). */
  @Override
  public void close() {
    running = false;
    thread.interrupt();
    try {
      thread.join(CLOSE_WAIT_MS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}