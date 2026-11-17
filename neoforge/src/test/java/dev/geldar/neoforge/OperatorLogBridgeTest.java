package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class OperatorLogBridgeTest {
    private final List<String> infos = new ArrayList<>();
    private final List<String> warnings = new ArrayList<>();
    private final OperatorSink sink = new OperatorSink() {
        @Override
        public void info(String message) {
            infos.add(message);
        }

        @Override
        public void warn(String message) {
            warnings.add(message);
        }
    };

    @Test
    void forwardsInfoAndWarningTextToTheSink() {
        Logger logger = OperatorLogBridge.loggerFor(sink);
        logger.info("Created JetStream stream GELDAR_EVENTS");
        logger.warning("Event queue full: 4 events dropped so far (4 since the last report)");
        assertEquals(List.of("Created JetStream stream GELDAR_EVENTS"), infos);
        assertEquals(List.of("Event queue full: 4 events dropped so far (4 since the last report)"), warnings);
    }

    /** A NATS outage warns once; the next warning comes only after a successful connect. */
    @Test
    void natsOutageWarnsOnceUntilTheConnectionReturns() {
        Logger logger = OperatorLogBridge.loggerFor(sink);
        logger.warning("NATS unavailable (IOException), retrying in 500 ms");
        logger.warning("NATS unavailable (IOException), retrying in 1000 ms");
        logger.warning("NATS unavailable (IOException), retrying in 2000 ms");
        assertEquals(1, warnings.size());

        logger.info("Connected to NATS, publishing into GELDAR_EVENTS");
        logger.warning("NATS unavailable (IOException), retrying in 500 ms");
        assertEquals(2, warnings.size());
    }

    /** Queue-full warnings are rate-limited by core-common, so the bridge must not swallow them during an outage. */
    @Test
    void queueFullWarningsPassDuringAnOutage() {
        Logger logger = OperatorLogBridge.loggerFor(sink);
        logger.warning("NATS unavailable (IOException), retrying in 500 ms");
        logger.warning("Event queue full: 10 events dropped so far (10 since the last report)");
        logger.warning("Event queue full: 20 events dropped so far (10 since the last report)");
        assertEquals(3, warnings.size());
        assertFalse(OperatorLogBridge.isOutageMessage("Event queue full"));
        assertTrue(OperatorLogBridge.isOutageMessage("Publish of ev_1 failed, will retry: x"));
    }

    @Test
    void loggersFromLoggerForDoNotShareHandlersOrParents() {
        Logger first = OperatorLogBridge.loggerFor(sink);
        Logger second = OperatorLogBridge.loggerFor(sink);
        assertFalse(first.getUseParentHandlers());
        assertEquals(1, first.getHandlers().length);
        assertEquals(1, second.getHandlers().length);
        assertTrue(first != second);
    }
}
