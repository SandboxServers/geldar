package dev.geldar.core.kino;

/** Where feed messages go. {@code json} is one kino-feed message; the sink must not block the server thread. */
public interface KinoSink {
    void publish(String agentId, String json);
}