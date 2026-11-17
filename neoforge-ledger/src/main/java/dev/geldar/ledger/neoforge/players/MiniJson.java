package dev.geldar.ledger.neoforge.players;

import java.io.IOException;

/**
 * A small pull reader for one complete JSON document held in memory; just enough for {@link StatsFileReader}. It has
 * no dependency, so it works the same in the mod layer and in unit tests. Strict about truncation, trailing commas, bad
 * escapes and depth over {@value #MAX_DEPTH} (each is an {@link IOException}), but lenient on separators: a missing or a
 * leading comma between members is accepted and a lone sign reads as a number token. That cannot export a wrong value:
 * values still go through the allow-list and a checked {@code Long.parseLong}. Values are consumed or
 * skipped without being built into a tree; a number is handed back as its text.
 */
final class MiniJson {
    enum Token {
        BEGIN_OBJECT,
        END_OBJECT,
        BEGIN_ARRAY,
        END_ARRAY,
        NAME,
        STRING,
        NUMBER,
        LITERAL,
        END_DOCUMENT
    }

    static final int MAX_DEPTH = 32;

    private final String s;
    private int pos;

    MiniJson(String text) {
        this.s = text;
    }

    private void ws() {
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
                return;
            }
            pos++;
        }
    }

    /** The next token without consuming it. Valid only where a value, a name, a close or the end is expected. */
    Token peek() throws IOException {
        ws();
        if (pos >= s.length()) {
            return Token.END_DOCUMENT;
        }
        char c = s.charAt(pos);
        return switch (c) {
            case '{' -> Token.BEGIN_OBJECT;
            case '}' -> Token.END_OBJECT;
            case '[' -> Token.BEGIN_ARRAY;
            case ']' -> Token.END_ARRAY;
            case '"' -> Token.STRING;
            case 't', 'f', 'n' -> Token.LITERAL;
            default -> {
                if (c == '-' || (c >= '0' && c <= '9')) {
                    yield Token.NUMBER;
                }
                throw new IOException("unexpected character");
            }
        };
    }

    /** The text of a number token (digits, sign, fraction, exponent), consumed. */
    String nextNumber() throws IOException {
        ws();
        int start = pos;
        while (pos < s.length() && "+-0123456789.eE".indexOf(s.charAt(pos)) >= 0) {
            pos++;
        }
        if (pos == start) {
            throw new IOException("number expected");
        }
        return s.substring(start, pos);
    }

    /** True while the current object or array has another member; consumes a separating comma. */
    boolean hasNext() throws IOException {
        ws();
        if (pos >= s.length()) {
            throw new IOException("truncated");
        }
        char c = s.charAt(pos);
        if (c == '}' || c == ']') {
            return false;
        }
        if (c == ',') {
            pos++;
            ws();
            if (pos >= s.length() || s.charAt(pos) == '}' || s.charAt(pos) == ']') {
                throw new IOException("trailing comma");
            }
        }
        return true;
    }

    void beginObject() throws IOException {
        expect('{');
    }

    void endObject() throws IOException {
        expect('}');
    }

    /** A member name and its colon, consumed. */
    String nextName() throws IOException {
        String name = string();
        expect(':');
        return name;
    }

    /** Skips one value of any kind, including nested ones. */
    void skipValue() throws IOException {
        skip(0);
    }

    private void skip(int depth) throws IOException {
        if (depth > MAX_DEPTH) {
            throw new IOException("too deep");
        }
        switch (peek()) {
            case BEGIN_OBJECT -> {
                pos++;
                while (hasNext()) {
                    nextName();
                    skip(depth + 1);
                }
                expect('}');
            }
            case BEGIN_ARRAY -> {
                pos++;
                while (hasNext()) {
                    skip(depth + 1);
                }
                expect(']');
            }
            case STRING -> string();
            case NUMBER -> nextNumber();
            case LITERAL -> literal();
            default -> throw new IOException("value expected");
        }
    }

    private void literal() throws IOException {
        for (String w : new String[] {"true", "false", "null"}) {
            if (s.startsWith(w, pos)) {
                pos += w.length();
                return;
            }
        }
        throw new IOException("bad literal");
    }

    private void expect(char c) throws IOException {
        ws();
        if (pos >= s.length() || s.charAt(pos) != c) {
            throw new IOException("expected " + c);
        }
        pos++;
    }

    private String string() throws IOException {
        expect('"');
        StringBuilder b = new StringBuilder();
        while (true) {
            if (pos >= s.length()) {
                throw new IOException("truncated string");
            }
            char c = s.charAt(pos++);
            if (c == '"') {
                return b.toString();
            }
            if (c < 0x20) {
                throw new IOException("control character");
            }
            if (c != '\\') {
                b.append(c);
                continue;
            }
            if (pos >= s.length()) {
                throw new IOException("truncated escape");
            }
            char e = s.charAt(pos++);
            switch (e) {
                case '"', '\\', '/' -> b.append(e);
                case 'b' -> b.append('\b');
                case 'f' -> b.append('\f');
                case 'n' -> b.append('\n');
                case 'r' -> b.append('\r');
                case 't' -> b.append('\t');
                case 'u' -> {
                    if (pos + 4 > s.length()) {
                        throw new IOException("truncated escape");
                    }
                    try {
                        b.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                    } catch (NumberFormatException ex) {
                        throw new IOException("bad escape");
                    }
                    pos += 4;
                }
                default -> throw new IOException("bad escape");
            }
        }
    }
}
