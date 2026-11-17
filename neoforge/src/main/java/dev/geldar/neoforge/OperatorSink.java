package dev.geldar.neoforge;

/** Operator-facing log lines. Never agent-visible: they go to the server log only. */
public interface OperatorSink {
    void info(String message);

    void warn(String message);
}
