package dev.geldar.ledger.core;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;

/**
 * Bounded ring of preallocated slots (3 longs, 3 strings, event id, timestamp). Many producers, one
 * consumer (the {@link Emitter}). Each slot has a sequence number (bounded MPMC queue after Vyukov), so a
 * producer claims a slot with one CAS and publishes with one ordered store. {@link #offer} never blocks,
 * never allocates and returns false when the ring is full (the drop is counted).
 */
public final class EventRing {
  private final String name;
  private final int mask;
  private final int capacity;
  private final LongSupplier epochNanos;
  private final LongAdder drops;

  private final AtomicLongArray seq;
  private final int[] ids;
  private final long[] ts;
  private final long[] as;
  private final long[] bs;
  private final long[] cs;
  private final String[] s1;
  private final String[] s2;
  private final String[] s3;

  private final AtomicLong tail = new AtomicLong();
  /** Consumer-only; volatile so a second reader (tests, gauges) sees it. */
  private volatile long head;

  public EventRing(String name, int capacity, DropCounters drops) {
    this(name, capacity, drops, () -> System.currentTimeMillis() * 1_000_000L);
  }

  public EventRing(String name, int capacity, DropCounters drops, LongSupplier epochNanos) {
    if (capacity < 2 || Integer.bitCount(capacity) != 1) {
      throw new IllegalArgumentException("capacity must be a power of two >= 2");
    }
    this.name = name;
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.epochNanos = epochNanos;
    this.drops = drops.counter(name);
    this.seq = new AtomicLongArray(capacity);
    for (int i = 0; i < capacity; i++) {
      seq.lazySet(i, i);
    }
    ids = new int[capacity];
    ts = new long[capacity];
    as = new long[capacity];
    bs = new long[capacity];
    cs = new long[capacity];
    s1 = new String[capacity];
    s2 = new String[capacity];
    s3 = new String[capacity];
  }

  public String name() {
    return name;
  }

  public int capacity() {
    return capacity;
  }

  /** Approximate number of queued records. */
  public int size() {
    long n = tail.get() - head;
    return (int) Math.max(0, Math.min(capacity, n));
  }

  /** Copies the arguments into a free slot. Returns false (and counts a drop) when the ring is full. */
  public boolean offer(int id, long a, long b, long c, String str1, String str2, String str3) {
    long pos = tail.get();
    while (true) {
      int i = (int) pos & mask;
      long s = seq.get(i);
      long diff = s - pos;
      if (diff == 0) {
        if (tail.compareAndSet(pos, pos + 1)) {
          ids[i] = id;
          ts[i] = epochNanos.getAsLong();
          as[i] = a;
          bs[i] = b;
          cs[i] = c;
          s1[i] = str1;
          s2[i] = str2;
          s3[i] = str3;
          seq.set(i, pos + 1);
          return true;
        }
        pos = tail.get();
      } else if (diff < 0) {
        drops.increment();
        return false;
      } else {
        pos = tail.get();
      }
    }
  }

  /**
   * Single consumer only. Delivers up to {@code max} records to the sink and returns how many were taken.
   * A slot is released before the sink is called, so a slow or throwing sink never pins a slot.
   * A Throwable from the sink is rethrown after the slot is released; the caller decides.
   */
  int drain(int max, Sink sink, ErrorCounter errors) {
    int n = 0;
    long h = head;
    while (n < max) {
      int i = (int) h & mask;
      if (seq.get(i) != h + 1) {
        break;
      }
      int id = ids[i];
      long t = ts[i];
      long a = as[i];
      long b = bs[i];
      long c = cs[i];
      String x = s1[i];
      String y = s2[i];
      String z = s3[i];
      s1[i] = null;
      s2[i] = null;
      s3[i] = null;
      seq.set(i, h + capacity);
      h++;
      head = h;
      n++;
      try {
        sink.accept(name, id, t, a, b, c, x, y, z);
      } catch (Throwable e) {
        errors.onError();
      }
    }
    return n;
  }

  /** Callback for sink failures, so the ring needs no knowledge of the emitter. */
  interface ErrorCounter {
    void onError();
  }
}