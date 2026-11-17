package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.paper.curated.CuratedRegistry.ContentSink;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.function.IntFunction;
import net.kyori.adventure.text.Component;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.player.PlayerEditBookEvent;
import org.bukkit.inventory.meta.BookMeta;

/**
 * Chat, sign and book text (PT-07d): owner-approved full-text capture (0350 point 2), delivered only to the gateway
 * through {@code ContentLog}. Observation only (S1): the handlers read; they never call a setter, never touch the
 * recipients or renderer, and never cancel. Nothing is logged, echoed or stored here (S3).
 *
 * <p>Exported per event: chat = text, s1 life id, s2 world; sign = the lines of the changed side joined with a newline,
 * s1 life id, s2 world, s3 block position {@code x,y,z}; book = title (only when signing) and pages joined with a form
 * feed, s1 life id, s2 world. The speaker is a life id or nothing (a human carries no name). The book author, the chat
 * recipients and any UUID or address are never read.
 *
 * <p>Two layers (defence in depth): the read is bounded before conversion ({@link #MAX_BOOK_PAGES},
 * {@link #MAX_TOTAL_CHARS}, {@link #MAX_LINE_CHARS}; past a bound the text is cut and {@link #MARKER} appended), then
 * {@link Redactor#scrub} and {@link ContentCap#cap} run in {@link #prepare}, before the text reaches the ring. The core
 * sink scrubs and caps again. Chat arrives off the main thread: that path uses no guard. The pure functions below take
 * plain strings and are unit-tested; the lambdas in {@link #register} that read the Bukkit events are compile-only.
 */
public final class TextContentFamily implements CuratedFamily {
    static final int MAX_BOOK_PAGES = 100;
    static final int MAX_TOTAL_CHARS = 1 << 20;
    static final int MAX_LINE_CHARS = 32 * 1024;
    static final String MARKER = " [truncated by plugin bound]";
    static final char PAGE_SEP = '\f';

    private static final int CHAT_RATE = 20;
    private static final int RARE_RATE = 5;
    private static final String[] FIELDS = {AttrKeys.LIFE_ID, AttrKeys.WORLD};
    private static final String[] SIGN_FIELDS = {AttrKeys.LIFE_ID, AttrKeys.WORLD, AttrKeys.POS};

    /** Reads page {@code index}, at most {@code maxChars} + 1 characters. */
    @FunctionalInterface
    interface PageReader {
        String read(int index, int maxChars);
    }

    @Override
    public void register(CuratedRegistry r) {
        r.onContent(AsyncChatEvent.class, Names.Events.CHAT, CHAT_RATE, FIELDS, true, (e, s) -> {
            s.player(e.getPlayer());
            s.s2 = e.getPlayer().getWorld().getName();
            s.text = prepare(cut(PlainText.bounded(e.message(), MAX_TOTAL_CHARS), MAX_TOTAL_CHARS));
        });
        r.onContent(SignChangeEvent.class, Names.Events.SIGN, RARE_RATE, SIGN_FIELDS, true, (e, s) -> {
            s.player(e.getPlayer());
            s.s2 = e.getBlock().getWorld().getName();
            s.s3 = position(e.getBlock().getX(), e.getBlock().getY(), e.getBlock().getZ());
            java.util.List<Component> lines = e.lines();
            s.text = prepare(sign(lines.size(), i -> PlainText.bounded(lines.get(i), MAX_LINE_CHARS)));
        });
        r.onContent(PlayerEditBookEvent.class, Names.Events.BOOK, RARE_RATE, FIELDS, true, (e, s) -> {
            s.player(e.getPlayer());
            s.s2 = e.getPlayer().getWorld().getName();
            BookMeta meta = e.getNewBookMeta();
            String title = e.isSigning() ? PlainText.bounded(meta.title(), MAX_LINE_CHARS) : null;
            // the author is a human-chosen name: never read
            s.text = prepare(book(title, meta.getPageCount(), (i, max) -> PlainText.bounded(meta.page(i + 1), max)));
        });
    }

    /** Cuts {@code s} at {@code max} characters (not inside a surrogate pair) and appends the marker. */
    static String cut(String s, int max) {
        if (s == null) {
            return "";
        }
        if (s.length() <= max) {
            return s;
        }
        int end = max;
        if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(0, end) + MARKER;
    }

    /** The four lines of one sign side joined with a newline; each line is bounded. */
    static String sign(int lineCount, IntFunction<String> line) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(lineCount, 8); i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(cut(line.apply(i), MAX_LINE_CHARS));
        }
        return sb.toString();
    }

    /** Title (when signing) and the first pages joined with a form feed, never more than the bounds. */
    static String book(String title, int pageCount, PageReader pages) {
        StringBuilder sb = new StringBuilder();
        boolean truncated = false;
        if (title != null) {
            sb.append(cut(title, MAX_LINE_CHARS)).append(PAGE_SEP);
        }
        int n = Math.min(pageCount, MAX_BOOK_PAGES);
        for (int i = 0; i < n; i++) {
            int room = MAX_TOTAL_CHARS - sb.length();
            if (room <= 0) {
                truncated = true;
                break;
            }
            String page = pages.read(i, room);
            if (page == null) {
                page = "";
            }
            if (page.length() > room) {
                sb.append(cut(page, room));
                return sb.toString(); // the marker is already in
            }
            if (i > 0) {
                sb.append(PAGE_SEP);
            }
            sb.append(page);
        }
        if (pageCount > MAX_BOOK_PAGES || truncated) {
            sb.append(MARKER);
        }
        return sb.toString();
    }

    /** Scrubs credentials and addresses, then caps to 32 KiB, before the text reaches the ring (S3, S4, S5). */
    static String prepare(String text) {
        return ContentCap.cap(Redactor.scrub(text));
    }

    static String position(int x, int y, int z) {
        return x + "," + y + "," + z;
    }
}
