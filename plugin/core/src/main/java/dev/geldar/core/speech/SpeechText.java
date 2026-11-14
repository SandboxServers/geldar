package dev.geldar.core.speech;

import java.util.Optional;

/**
 * Turns an agent's chat line into the text of a speech bubble. BlueMap shows the bubble as HTML, so the text is
 * escaped: no raw {@code <}, {@code >}, {@code &}, double or single quote survives {@link #clean}. Control,
 * format and line or paragraph separator characters become spaces, whitespace runs collapse to one space, and the
 * text is capped at {@link #MAX_CODE_POINTS} code points before it is escaped. Pure: no Bukkit or BlueMap types.
 */
public final class SpeechText {
    /** The longest text shown, counted in code points before escaping (the ellipsis is included). */
    public static final int MAX_CODE_POINTS = 140;
    static final String ELLIPSIS = "...";
    static final String STYLE = "background:rgba(255,255,255,0.85);color:#222222;font-size:12px;"
            + "border-radius:8px;padding:3px 7px;max-width:220px;pointer-events:none;";

    private SpeechText() {
    }

    /** The bubble text for a chat line, HTML-escaped; empty when nothing is left after cleaning. */
    public static Optional<String> clean(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        String plain = collapse(raw);
        if (plain.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(escape(cap(plain)));
    }

    /** One div with inline styles only, around text that {@link #clean} has already escaped. */
    public static String html(String escaped) {
        return "<div style=\"" + STYLE + "\">" + escaped + "</div>";
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
        int keep = MAX_CODE_POINTS - ELLIPSIS.length();
        return text.substring(0, text.offsetByCodePoints(0, keep)).stripTrailing() + ELLIPSIS;
    }

    static String escape(String text) {
        StringBuilder out = new StringBuilder(text.length() + 16);
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
