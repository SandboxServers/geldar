package dev.geldar.ledger.core;

/** Owner-approved full-text capture; delivered to the gateway only (S3). */
public interface ContentLog {
    /** Registers a content event. Startup only. */
    int register(String eventName, String... fieldNames);

    /** Any thread including the main thread. The text is capped to 32 KiB and redacted on the emitter thread. */
    void record(int id, String text, String s1, String s2, String s3);
}
