package dev.geldar.core.speech;

import java.util.Optional;

/**
 * Turns an agent's chat line into the plain text of the chat feed (decision 0310). Control, format and line or
 * paragraph separator characters become spaces, whitespace runs collapse to one space, and the text is capped at
 * {@link #MAX_CODE_POINTS} code points. No HTML escaping: the page renders the text with textContent. Pure: no Bukkit
 * or BlueMap types.
 */
public final class SpeechText {
    /** The longest text kept, counted in code points (the say schema cap). */
    public static final int MAX_CODE_POINTS = 256;

    private SpeechText() {
    }

    /** The feed text for a chat line; empty when nothing is left after cleaning. */
    public static Optional<String> clean(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String plain = collapse(raw);
        if (plain.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(cap(plain));
    }

    static String collapse(String raw) {
        StringBuilder spaced = new StringBuilder(raw.length());
        raw.codePoints().forEach(cp -> {
            int type = Character.getType(cp);
            boolean hidden = type == Character.CONTROL || type == Character.FORMAT
                    || type == Character.LINE_SEPARATOR || type == Character.PARAGRAPH_SEPARATOR;
            spaced.appendCodePoint(hidden ? ' ' : cp);
        });
        return spaced.toString().replaceAll("\\s+", " ").strip();
    }

    static String cap(String text) {
        if (text.codePointCount(0, text.length()) <= MAX_CODE_POINTS) {
            return text;
        }
        return text.substring(0, text.offsetByCodePoints(0, MAX_CODE_POINTS)).stripTrailing();
    }
}
