package dev.geldar.core.speech;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
    /** The epoch milliseconds at nanosecond zero; the test clock advances both together. */
    private static final long WALL = 1_700_000_000_000L;
    private static final String ONE_LINE = "{\"v\":1,\"clock\":{\"time\":1000,\"at\":1700000000000},"
            + "\"lines\":[{\"t\":1234,\"id\":\"0f8fad5b-d9cb-469f-a165-8c967dc8d2a7\",\"text\":\"hello\"}]}";

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

    /** Samples the overworld at {@code ticks}, read at the current test instant. */
    private void sample(ChatFeedWriter writer, long ticks) {
        writer.sampleClock(ticks, WALL + now.get() / 1_000_000L);
    }

    private static JsonObject parse(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    private long warnings() {
        return records.stream().filter(r -> r.getLevel() == Level.WARNING).count();
    }

    @Test
    void flushWritesTheFeedAndLeavesNoTempFile() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        sample(writer, 1000);
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
        sample(writer, 1000);
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

    @Test
    void everyWriteCarriesTheWorldTimeAndTheSampleTimeBeforeTheLines() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        now.set(2 * SECOND);
        sample(writer, 6000);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        String text = Files.readString(dir.resolve(ChatFeedWriter.FILE));
        JsonObject feed = parse(text);
        assertEquals(1, feed.get("v").getAsInt());
        assertEquals(6000, feed.getAsJsonObject("clock").get("time").getAsInt());
        assertEquals(WALL + 2000, feed.getAsJsonObject("clock").get("at").getAsLong());
        assertEquals(1, feed.getAsJsonArray("lines").size());
        assertTrue(text.indexOf("\"clock\"") < text.indexOf("\"lines\""));
    }

    @Test
    void worldTimeIsWrappedModuloOneDay() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        long[][] cases = {{24_000, 0}, {-1, 23_999}, {48_005, 5}, {-24_000, 0}, {0, 0}, {23_999, 23_999}};
        for (long[] c : cases) {
            sample(writer, c[0]);
            writer.say(AGENT, "hello", 1234L);
            writer.flushIfDirty();
            int shown = parse(Files.readString(dir.resolve(ChatFeedWriter.FILE)))
                    .getAsJsonObject("clock").get("time").getAsInt();
            assertEquals(c[1], shown, "world time " + c[0]);
        }
    }

    @Test
    void clockKeyIsOmittedBeforeAnySampleIsTaken() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        String text = Files.readString(dir.resolve(ChatFeedWriter.FILE));
        JsonObject feed = parse(text);
        assertFalse(feed.has("clock"));
        assertFalse(text.contains("null"));
        assertEquals("hello", feed.getAsJsonArray("lines").get(0).getAsJsonObject().get("text").getAsString());
    }

    @Test
    void clockAtIsTheSampleInstantNotTheWriteInstant() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.sampleClock(6000, WALL);
        now.set(5 * SECOND);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        JsonObject clock = parse(Files.readString(dir.resolve(ChatFeedWriter.FILE))).getAsJsonObject("clock");
        assertEquals(WALL, clock.get("at").getAsLong());
        assertEquals(6000, clock.get("time").getAsInt());
    }

    @Test
    void feedIsRewrittenAfterTenSecondsEvenWithNoNewChat() throws IOException {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        sample(writer, 1000);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        now.set(9 * SECOND);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        now.set(10 * SECOND);
        sample(writer, 1000);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        JsonObject feed = parse(Files.readString(dir.resolve(ChatFeedWriter.FILE)));
        assertEquals(WALL + 10_000, feed.getAsJsonObject("clock").get("at").getAsLong());
        assertEquals(1, feed.getAsJsonArray("lines").size());
        assertFalse(Files.exists(dir.resolve(ChatFeedWriter.FILE + ".tmp")));
    }

    @Test
    void refreshIsTenSecondsAfterTheLastWriteAndRepeatsEveryTen() {
        ChatFeedWriter writer = writer();
        writer.attach(dir);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        now.set(10 * SECOND);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        now.set(11 * SECOND);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        now.set(19 * SECOND);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        now.set(20 * SECOND);
        writer.flushIfDirty();
        assertEquals(3, writer.writeCount());
    }

    @Test
    void aFailedRefreshWithNoChatIsRetriedOnTheNextFlush() throws IOException {
        Path sub = dir.resolve("sub");
        Files.createDirectory(sub);
        ChatFeedWriter writer = writer();
        writer.attach(sub);
        sample(writer, 1000);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        Files.delete(sub.resolve(ChatFeedWriter.FILE));
        Files.delete(sub);
        now.set(10 * SECOND);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        Files.createDirectory(sub);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        assertEquals(1, warnings());
    }

    @Test
    void aFailedRefreshWithNoChatCountsTowardTheFiveFailureCap() throws IOException {
        Path sub = dir.resolve("sub");
        Files.createDirectory(sub);
        ChatFeedWriter writer = writer();
        writer.attach(sub);
        sample(writer, 1000);
        writer.say(AGENT, "hello", 1234L);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        Files.delete(sub.resolve(ChatFeedWriter.FILE));
        Files.delete(sub);
        now.set(10 * SECOND);
        for (int i = 0; i < 5; i++) {
            writer.flushIfDirty();
        }
        assertEquals(1, writer.writeCount());
        Files.createDirectory(sub);
        now.set(11 * SECOND);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        now.set(39 * SECOND);
        writer.flushIfDirty();
        assertEquals(1, writer.writeCount());
        now.set(40 * SECOND);
        writer.flushIfDirty();
        assertEquals(2, writer.writeCount());
        assertEquals(1, warnings());
    }
}
