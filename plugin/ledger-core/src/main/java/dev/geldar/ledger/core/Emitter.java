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
  /** How long the closing flush may keep delivering queued records. */
  static final long FLUSH_MS = 500L;

  private final List<EventRing> rings;
  private final Sink sink;
  private final AtomicLong sinkErrors = new AtomicLong();
  private final Thread thread;
  private volatile boolean running = true;
  /** Set when close() gives up on the thread: no sink call may start after it. */
  private volatile boolean abandoned;
  private volatile long flushDeadline;

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
      pass(errors, () -> !running || abandoned);
      try {
        Thread.sleep(PERIOD_MS);
      } catch (InterruptedException e) {
        break;
      }
    }
    // Final flush: deliver what is queued, bounded by a deadline, never after close() abandoned us.
    Thread.interrupted();
    pass(errors, () -> abandoned || System.nanoTime() - flushDeadline > 0);
  }

  /** Drains every ring in batches until all are quiet or {@code stop} is true. */
  private void pass(EventRing.ErrorCounter errors, java.util.function.BooleanSupplier stop) {
    try {
      boolean more;
      do {
        more = false;
        for (EventRing r : rings) {
          if (r.drain(BATCH, sink, errors, stop) == BATCH) {
            more = true;
          }
        }
      } while (more && !stop.getAsBoolean());
    } catch (Throwable e) {
      sinkErrors.incrementAndGet();
    }
  }

  /**
   * Stops the thread after a final flush of at most {@link #FLUSH_MS}. Waits at most one second on the
   * calling thread (onDisable blocks that long in the worst case). A sink blocked longer is abandoned:
   * the thread is a daemon and makes no further sink call once this method has returned.
   */
  @Override
  public void close() {
    flushDeadline = System.nanoTime() + FLUSH_MS * 1_000_000L;
    running = false;
    thread.interrupt();
    try {
      thread.join(CLOSE_WAIT_MS);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
    if (thread.isAlive()) {
      abandoned = true;
    }
  }
}