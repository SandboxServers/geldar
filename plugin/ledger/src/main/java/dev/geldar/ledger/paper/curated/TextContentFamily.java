package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.paper.curated.CuratedRegistry.ContentSink;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.List;
import java.util.function.IntFunction;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
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
        r.onContent(AsyncChatEvent.class, Names.Events.CHAT, CHAT_RATE, FIELDS, true, (e, s) ->
                fillChat(s, e.getPlayer(), e.getPlayer().getWorld().getName(), e.message()));
        r.onContent(SignChangeEvent.class, Names.Events.SIGN, RARE_RATE, SIGN_FIELDS, true, (e, s) ->
                fillSign(s, e.getPlayer(), e.getBlock().getWorld().getName(), e.getBlock().getX(), e.getBlock().getY(),
                        e.getBlock().getZ(), e.lines()));
        r.onContent(PlayerEditBookEvent.class, Names.Events.BOOK, RARE_RATE, FIELDS, true, (e, s) -> {
            BookMeta meta = e.getNewBookMeta();
            // the author is a human-chosen name: never read
            fillBook(s, e.getPlayer(), e.getPlayer().getWorld().getName(), e.isSigning() ? meta.title() : null,
                    e.isSigning(), meta.getPageCount(), i -> meta.page(i));
        });
    }

    /** Chat: s1 life id (or nothing), s2 world, text. Plain values in, so it is testable without a server. */
    static void fillChat(ContentSink s, Player player, String world, Component message) {
        s.player(player);
        s.s2 = world;
        s.text = prepare(cut(PlainText.bounded(message, MAX_TOTAL_CHARS), MAX_TOTAL_CHARS));
    }

    /** Sign: s1 life id, s2 world, s3 {@code x,y,z}, the lines joined with a newline. */
    static void fillSign(ContentSink s, Player player, String world, int x, int y, int z, List<Component> lines) {
        s.player(player);
        s.s2 = world;
        s.s3 = position(x, y, z);
        s.text = prepare(sign(lines.size(), i -> PlainText.bounded(lines.get(i), MAX_LINE_CHARS)));
    }

    /** Book: s1 life id, s2 world; the title only when signing, then the pages (one-based in {@code page}). */
    static void fillBook(
            ContentSink s, Player player, String world, Component title, boolean signing, int pageCount,
            IntFunction<Component> page) {
        s.player(player);
        s.s2 = world;
        String t = signing ? PlainText.bounded(title, MAX_LINE_CHARS) : null;
        s.text = prepare(book(t, pageCount, (i, max) -> PlainText.bounded(page.apply(i + 1), max)));
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
