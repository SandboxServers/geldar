package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class LookupDebugLogTest {
    private final List<String> lines = new ArrayList<>();
    private long now;

    private LookupDebugLog log() {
        Logger logger = Logger.getAnonymousLogger();
        logger.setUseParentHandlers(false);
        logger.addHandler(new Handler() {
            @Override
            public void publish(LogRecord record) {
                if (record.getLevel() == Level.INFO) {
                    lines.add(record.getMessage());
                }
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        });
        return new LookupDebugLog(logger, () -> now);
    }

    @Test
    void nothingIsLoggedWhenDebugIsOff() {
        LookupDebugLog log = log();
        log.info("raw row 0: action=1");
        assertEquals(0, lines.size());
    }

    @Test
    void aMinuteKeepsTwentyLinesAndDropsTheRest() {
        LookupDebugLog log = log();
        log.setEnabled(true);
        for (int i = 0; i < 25; i++) {
            log.info("line " + i);
        }
        assertEquals(LookupDebugLog.MAX_LINES_PER_MINUTE, lines.size());
        assertEquals("blockowner.debug: line 0", lines.get(0));
        assertEquals("blockowner.debug: line 19", lines.get(19));
    }

    @Test
    void theNextMinuteHasANewBudget() {
        LookupDebugLog log = log();
        log.setEnabled(true);
        for (int i = 0; i < 20; i++) {
            log.info("first " + i);
        }
        log.info("dropped in the first minute");
        now = LookupDebugLog.MINUTE_MS;
        log.info("second minute");
        assertEquals(21, lines.size());
        assertEquals("blockowner.debug: second minute", lines.get(20));
    }

    @Test
    void turningDebugOffStopsTheLines() {
        LookupDebugLog log = log();
        log.setEnabled(true);
        log.info("on");
        log.setEnabled(false);
        log.info("off");
        assertEquals(1, lines.size());
    }
}
