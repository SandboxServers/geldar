package dev.geldar.ledger.paper.curated;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.flattener.ComponentFlattener;

/**
 * The one place an Adventure component becomes plain text (PT-07d). The read is bounded: the component tree is walked
 * piece by piece and the walk is abandoned as soon as more than {@code maxChars} characters were produced, so an
 * enormous component is never serialised whole (it may be converted on the main thread).
 */
final class PlainText {
    private static final ComponentFlattener FLATTENER = ComponentFlattener.basic(); // the flattener PlainTextComponentSerializer.plainText() uses

    /** Thrown to leave the flattener walk once the bound is passed; carries no stack. */
    private static final class Stop extends RuntimeException {
        private static final long serialVersionUID = 1L;

        Stop() {
            super(null, null, false, false);
        }
    }

    private PlainText() {}

    /**
     * Plain text of {@code c}, at most {@code maxChars + 1} characters long: a result longer than {@code maxChars} means
     * the component was longer than the bound. Null gives the empty string.
     */
    static String bounded(Component c, int maxChars) {
        if (c == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(Math.min(maxChars + 1, 256));
        try {
            FLATTENER.flatten(c, piece -> {
                if (piece == null) {
                    return;
                }
                int room = maxChars + 1 - sb.length();
                if (piece.length() >= room) {
                    sb.append(piece, 0, room);
                    throw new Stop();
                }
                sb.append(piece);
            });
        } catch (Stop stop) {
            // the bound was reached
        }
        return sb.toString();
    }
}
