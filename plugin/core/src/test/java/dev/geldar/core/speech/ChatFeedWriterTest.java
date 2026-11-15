package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ChatFeedWriterTest {
    private static final UUID AGENT = UUID.fromString("0f8fad5b-d9cb-469f-a165-8c967dc8d2a7");
    private static final long SECOND = 1_000_000_000L;
    private static final String ONE_LINE = "{\"v\":1,\"lines\":[{\"t\":1234,\"id\":\""
            + "0f8fad5b-d9cb-469f-a165-8c967dc8d2a7\",\"text\":\"hello\"}]}";

    @TempDir
    Path dir;
    private final List<LogRecord> records = new ArrayList<>();
    private final AtomicLong now = new AtomicLong();
    private Logger log;

    @BeforeEach
    void captureLogs() {
        log = Logger.getLogger("ChatFeedWriterTest." + System.nanoTime());
        log.setUseParentHandlers(false);
        log.setLevel(Level.ALL);
        log.addHandler(new Handler() {
            @Override
            public void publish(LogRecord record) {
                records.add(record);
            }

            @Override
            public void flush() {
            }

            @Override
            public void close() {
            }
        });
    }

    private ChatFeedWriter writer() {
        return new ChatFeedWriter(log, now::get);
    }

    private long warnings() {
        return records.stream().filter(r -> r.getLevel() == Level.WARNING).count();
    }

    @Test
    void flushWritesTheFeedAndLeavesNoTempFile() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(ONE_LINE, Files.readString(dir.resolve(ChatFeedWriter.FILE)));
        assertFalse(Files.exists(dir.resolve(ChatFeedWriter.FILE + ".tmp")));
    }

    @Test
    void secondFlushWithNothingNewDoesNotRewrite() {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
    }

    @Test
    void nothingIsWrittenAfterDetach() {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.detach();
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(0, writer.writeCount());
        assertFalse(Files.exists(dir.resolve(ChatFeedWriter.FILE)));
    }

    @Test
    void failedWriteKeepsTheDirtyFlagSoALaterFlushWrites() throws IOException {
        Path missing = dir.resolve("missing");
        ChatFeedWriter writer = writer();
        writer.attach(missing);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(0, writer.writeCount());
        Files.createDirectory(missing);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        assertEquals(ONE_LINE, Files.readString(missing.resolve(ChatFeedWriter.FILE)));
    }

    @Test
    void firstWriteFailureIsLoggedOnceAtWarningWithTheExceptionClass() {
        ChatFeedWriter writer = writer();
        writer.attach(dir.resolve("missing"));
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        writer.flushIfDirty();
        assertEquals(1, warnings());
        LogRecord warning = records.stream().filter(r -> r.getLevel() == Level.WARNING).findFirst().orElseThrow();
        assertTrue(warning.getMessage().contains("NoSuchFileException"));
        assertTrue(warning.getThrown() instanceof IOException);
    }

    @Test
    void attachLogsTheFeedAtInfo() {
        writer().attach(dir);
        assertTrue(records.stream().anyMatch(
                r -> r.getLevel() == Level.INFO && "chat feed attached".equals(r.getMessage())));
    }

    @Test
    void retriesStayImmediateUntilTheFifthFailure() throws IOException {
        Path missing = dir.resolve("missing");
        ChatFeedWriter writer = writer();
        writer.attach(missing);
        writer.say(AGENT, "hello", 1234L);
        for (int i = 0; i < 4; i++) {
            writer.flushIfDirty();
        }
        Files.createDirectory(missing);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
    }

    @Test
    void afterFiveFailuresRetryOnlyEvery30Seconds() throws IOException {
        Path missing = dir.resolve("missing");
        ChatFeedWriter writer = writer();
        writer.attach(missing);
        writer.say(AGENT, "hello", 1234L);
        for (int i = 0; i < 5; i++) {
            writer.flushIfDirty();
        }
        Files.createDirectory(missing);
        now.addAndGet(SECOND);
        writer.flushIfDirty();
        assertEquals(0, writer.writeCount());
        now.addAndGet(29 * SECOND);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        assertEquals(1, warnings());
    }
}
