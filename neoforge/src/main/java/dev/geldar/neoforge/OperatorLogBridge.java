package dev.geldar.neoforge;

import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

/**
 * Routes the publisher's java.util.logging records to the operator sink. A NATS outage warns once, not on every
 * retry: the first failed connect warns, and the next warning comes only after a successful connect. Queue-full
 * warnings are not suppressed; core-common already rate-limits them to once a minute.
 */
final class OperatorLogBridge extends Handler {
    private final OperatorSink sink;
    private boolean outage;

    private OperatorLogBridge(OperatorSink sink) {
        this.sink = sink;
    }

    /** An unnamed logger, so no global logger state is shared, that writes only to the sink. */
    static Logger loggerFor(OperatorSink sink) {
        Logger logger = Logger.getAnonymousLogger();
        logger.setUseParentHandlers(false);
        logger.setLevel(Level.INFO);
        logger.addHandler(new OperatorLogBridge(sink));
        return logger;
    }

    @Override
    public synchronized void publish(LogRecord record) {
        String message = record.getMessage();
        if (message == null) {
            return;
        }
        if (record.getLevel().intValue() >= Level.WARNING.intValue()) {
            if (isOutageMessage(message)) {
                if (outage) {
                    return;
                }
                outage = true;
            }
            sink.warn(message);
        } else {
            if (message.startsWith("Connected to NATS")) {
                outage = false;
            }
            sink.info(message);
        }
    }

    static boolean isOutageMessage(String message) {
        return message.startsWith("NATS unavailable") || message.startsWith("Publish of ");
    }

    @Override
    public void flush() {
        // Nothing buffered: every record is passed to the sink when it is published.
    }

    @Override
    public void close() {
        // Nothing to release.
    }
}
