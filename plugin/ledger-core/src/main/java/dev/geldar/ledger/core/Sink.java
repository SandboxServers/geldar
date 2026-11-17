package dev.geldar.ledger.core;

/**
 * Receives records drained from the rings. Called on the emitter thread only, never on the main thread.
 * An implementation may throw: the {@link Emitter} catches every Throwable and counts it.
 */
public interface Sink {
  /**
   * One drained record.
   *
   * @param queue the ring the record came from
   * @param eventId the id the producer passed to {@link EventRing#offer}
   * @param timestampNanos epoch nanoseconds taken at offer time
   */
  void accept(
      String queue,
      int eventId,
      long timestampNanos,
      long a,
      long b,
      long c,
      String s1,
      String s2,
      String s3);
}