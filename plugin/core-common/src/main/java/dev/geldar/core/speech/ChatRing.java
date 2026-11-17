package dev.geldar.core.speech;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Optional;
import java.util.UUID;

/**
 * The last {@link #CAPACITY} agent chat lines, oldest first, as the live chat feed (decision 0310). Pure: no Bukkit
 * or BlueMap types. Text is plain, not HTML: {@link SpeechText#clean} collapses whitespace and control characters
 * and caps the text at {@link SpeechText#MAX_CODE_POINTS} code points. Nothing is HTML-escaped; the page shows the
 * text as text only. Empty text is skipped. Synchronized, because chat arrives on async threads.
 */
public final class ChatRing {
    /** How many lines the feed keeps; the 101st line evicts the oldest. */
    public static final int CAPACITY = 100;
    /** The format version written as {@code "v"}. */
    static final int VERSION = 1;

    /** One chat line: epoch milliseconds, the agent's UUID, and the plain text. */
    public record Line(long t, UUID id, String text) {}

    private final Deque<Line> lines = new ArrayDeque<>();

    /** Adds an agent's chat line, evicting the oldest line when the ring is full. Empty text is skipped. */
    public synchronized void add(UUID id, String text, long nowMillis) {
        Optional<String> plain = SpeechText.clean(text);
        if (plain.isEmpty()) {
            return;
        }
        lines.addLast(new Line(nowMillis, id, plain.get()));
        while (lines.size() > CAPACITY) {
            lines.removeFirst();
        }
    }

    /** The world clock written with the feed: the time of day in ticks, and the sample time in epoch milliseconds. */
    public record Clock(int time, long at) {}

    /** The feed without a clock: {@code {"v":1,"lines":[...]}}. */
    public synchronized String toJson() {
        return toJson(null);
    }

    /**
     * The feed file's contents: {@code {"v":1,"clock":{"time":..,"at":..},"lines":[...]}}, with each line
     * {@code {"t":..,"id":"..","text":".."}}, oldest first. A null {@code clock} omits the {@code "clock"} key.
     */
    public synchronized String toJson(Clock clock) {
        StringBuilder out = new StringBuilder("{\"v\":").append(VERSION);
        if (clock != null) {
            out.append(",\"clock\":{\"time\":").append(clock.time()).append(",\"at\":").append(clock.at()).append('}');
        }
        out.append(",\"lines\":[");
        boolean first = true;
        for (Line line : lines) {
            if (!first) {
                out.append(',');
            }
            first = false;
            out.append("{\"t\":").append(line.t())
                    .append(",\"id\":\"").append(line.id())
                    .append("\",\"text\":").append(quote(line.text()))
                    .append('}');
        }
        return out.append("]}").toString();
    }

    /**
     * A JSON string literal for {@code text}: quote and backslash are escaped, and every other control character
     * below U+0020 becomes {@code \\uXXXX}. Nothing else is changed, so {@code <} and {@code /} stay as they are.
     */
    static String quote(String text) {
        StringBuilder out = new StringBuilder(text.length() + 2).append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                out.append("\\\"");
            } else if (c == '\\') {
                out.append("\\\\");
            } else if (c < 0x20) {
                out.append(String.format("\\u%04x", (int) c));
            } else {
                out.append(c);
            }
        }
        return out.append('"').toString();
    }
}
