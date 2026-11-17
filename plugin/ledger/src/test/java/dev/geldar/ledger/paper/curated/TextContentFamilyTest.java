package dev.geldar.ledger.paper.curated;

import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.player;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.paper.curated.CuratedRegistry.ContentSink;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.Component;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

/**
 * Bukkit chat, sign and book events cannot be built without a server, so the pure functions and the registry path are
 * tested here; the lambdas in {@code TextContentFamily.register} that read the events are compile-only.
 */
class TextContentFamilyTest {
    static final class Spoken extends Event {
        private static final HandlerList HANDLERS = new HandlerList();

        Spoken() {
            super(true);
        }

        static HandlerList getHandlerList() {
            return HANDLERS;
        }

        @Override
        public HandlerList getHandlers() {
            return HANDLERS;
        }
    }

    static String secret() {
        return "pass" + "word=" + "Zq9xK2mP7vL4AbR5tY";
    }

    @Test
    void registersTheThreeContentEventsWithTheRightFields() {
        FakeHostInfo host = new FakeHostInfo().mainThread(true);
        RecordingLedger ledger = new RecordingLedger(host);
        List<Class<?>> bound = new ArrayList<>();
        CuratedRegistry r = new CuratedRegistry(ledger.events(), ledger.content(), ledger.guard("curated"), host,
                new CuratedRegistry.Binder() {
                    @Override
                    public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignoreCancelled) {
                        assertTrue(ignoreCancelled);
                        bound.add(type);
                    }

                    @Override
                    public void unbindAll() {}
                });
        new TextContentFamily().register(r);
        assertEquals(3, bound.size());
        assertTrue(bound.stream().noneMatch(c -> c.getSimpleName().contains("AsyncPlayerChat")));
        assertEquals(3, r.registeredCount());
    }

    @Test
    void aCredentialTypedInChatIsScrubbedBeforeTheRing() {
        String out = TextContentFamily.prepare("my " + secret() + " ok");
        assertFalse(out.contains("Zq9xK2mP7vL4AbR5tY"), out);
        assertTrue(out.contains("[redacted]"), out);
    }

    @Test
    void aFortyKilobyteBookArrivesWhole() {
        String page = "a".repeat(10_000);
        String text = TextContentFamily.book(null, 4, (i, max) -> page);
        assertEquals(40_000 + 3, text.length());
        assertFalse(text.contains(TextContentFamily.MARKER));
        assertEquals(4, text.split("\f", -1).length);
    }

    @Test
    void aTenMebibyteBookIsBoundedInTimeAndSize() {
        String huge = "b".repeat(10 * 1024 * 1024);
        long t0 = System.nanoTime();
        String text = TextContentFamily.book("t", 500, (i, max) -> huge.substring(0, Math.min(huge.length(), max + 1)));
        String ready = TextContentFamily.prepare(text);
        long ms = (System.nanoTime() - t0) / 1_000_000;
        assertTrue(ms < 1000, "ms=" + ms);
        assertTrue(text.length() <= TextContentFamily.MAX_TOTAL_CHARS + TextContentFamily.MARKER.length(), "len=" + text.length());
        assertTrue(text.endsWith(TextContentFamily.MARKER));
        assertTrue(ready.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= ContentCap.DEFAULT_MAX_BYTES);
    }

    @Test
    void moreThanOneHundredPagesAreCutAtOneHundred() {
        int[] reads = {0};
        String text = TextContentFamily.book(null, 5000, (i, max) -> {
            reads[0]++;
            return "p";
        });
        assertEquals(100, reads[0]);
        assertTrue(text.endsWith(TextContentFamily.MARKER));
    }

    @Test
    void anEnormousComponentIsNeverSerialisedWhole() {
        Component huge = Component.text("c".repeat(10 * 1024 * 1024));
        long t0 = System.nanoTime();
        String s = PlainText.bounded(huge, 1000);
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 1000);
        assertEquals(1001, s.length());
        assertEquals("hello", PlainText.bounded(Component.text("hel").append(Component.text("lo")), 100));
        assertEquals("", PlainText.bounded(null, 10));
        // a deeply fan-out tree stops at the bound too
        Component wide = Component.empty();
        for (int i = 0; i < 2000; i++) {
            wide = wide.append(Component.text("0123456789"));
        }
        assertEquals(101, PlainText.bounded(wide, 100).length());
    }

    @Test
    void signJoinsLinesAndBoundsEachLine() {
        String text = TextContentFamily.sign(4, i -> i == 2 ? "x".repeat(40_000) : "line" + i);
        String[] lines = text.split("\n", -1);
        assertEquals(4, lines.length);
        assertEquals("line0", lines[0]);
        assertTrue(lines[2].endsWith(TextContentFamily.MARKER));
        assertEquals("1,-2,3", TextContentFamily.position(1, -2, 3));
    }

    @Test
    void aHumanSpeakerCarriesNoNameAndALifeIdIsKept() {
        ContentSink human = new ContentSink();
        human.player(player("SomeHuman"));
        assertNull(human.s1);
        ContentSink agent = new ContentSink();
        agent.player(player("ag_mira_01"));
        assertEquals("ag_mira_01", agent.s1);
    }

    private static List<String> all(ContentSink s) {
        return java.util.Arrays.asList(s.s1, s.s2, s.s3);
    }

    @Test
    void chatFillsLifeIdWorldAndText() {
        ContentSink s = new ContentSink();
        TextContentFamily.fillChat(s, player("ag_mira_01"), "overworld", Component.text("hi there"));
        assertEquals("ag_mira_01", s.s1);
        assertEquals("overworld", s.s2);
        assertNull(s.s3);
        assertEquals("hi there", s.text);
    }

    @Test
    void aHumanNeverAppearsInAnyChatSignOrBookField() {
        ContentSink chat = new ContentSink();
        TextContentFamily.fillChat(chat, player("SomeHuman"), "overworld", Component.text("t"));
        ContentSink sign = new ContentSink();
        TextContentFamily.fillSign(sign, player("SomeHuman"), "nether", 1, 2, 3, List.of(Component.text("t")));
        ContentSink book = new ContentSink();
        TextContentFamily.fillBook(book, player("SomeHuman"), "the_end", Component.text("T"), true, 1,
                i -> Component.text("p"));
        for (ContentSink s : List.of(chat, sign, book)) {
            assertNull(s.s1);
            for (String f : all(s)) {
                assertFalse(f != null && f.contains("SomeHuman"), f);
            }
        }
        assertEquals("overworld", chat.s2);
        assertEquals("nether", sign.s2);
        assertEquals("the_end", book.s2);
    }

    @Test
    void signPositionIsXyzInOrderAndLinesKeepTheirOrder() {
        ContentSink s = new ContentSink();
        TextContentFamily.fillSign(s, player("ag_mira_01"), "w", 1, 2, 3,
                List.of(Component.text("a"), Component.text("b"), Component.text("c"), Component.text("d")));
        assertEquals("1,2,3", s.s3);
        assertEquals("ag_mira_01", s.s1);
        assertEquals("a\nb\nc\nd", s.text);
        ContentSink neg = new ContentSink();
        TextContentFamily.fillSign(neg, player("ag_mira_01"), "w", -7, 64, 900, List.of());
        assertEquals("-7,64,900", neg.s3);
    }

    @Test
    void bookPagesAreOneBasedAndTheTitleComesFirstOnlyWhenSigning() {
        List<Integer> asked = new ArrayList<>();
        ContentSink signed = new ContentSink();
        TextContentFamily.fillBook(signed, player("ag_mira_01"), "w", Component.text("TITLE"), true, 3, i -> {
            asked.add(i);
            return Component.text("p" + i);
        });
        assertEquals(List.of(1, 2, 3), asked);
        assertEquals("TITLE\fp1\fp2\fp3", signed.text);
        assertEquals("ag_mira_01", signed.s1);
        ContentSink edited = new ContentSink();
        TextContentFamily.fillBook(edited, player("ag_mira_01"), "w", Component.text("TITLE"), false, 2,
                i -> Component.text("p" + i));
        assertEquals("p1\fp2", edited.text);
    }

    @Test
    void sourceNeverCallsASetterOrReadsRecipientsAuthorOrAddress() throws Exception {
        Path dir = Path.of("src/main/java/dev/geldar/ledger/paper/curated");
        for (String f : List.of("TextContentFamily.java", "PlainText.java")) {
            String code = Files.readString(dir.resolve(f));
            code = code.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
            for (String bad : List.of("setMessage", "setCancelled", "setLine(", "viewers", "renderer(", "recipients",
                    "getAuthor", "author(", "getAddress", "getUniqueId", "sendMessage", "getLogger", "Logger", "setTitle")) {
                assertFalse(code.contains(bad), f + " uses " + bad);
            }
        }
        assertThrows(IllegalStateException.class, () -> {
            FakeHostInfo host = new FakeHostInfo().mainThread(true);
            RecordingLedger ledger = new RecordingLedger(host);
            new TextContentFamily().register(
                    new CuratedRegistry(ledger.events(), ledger.guard("curated"), host, new CuratedRegistry.Binder() {
                        @Override
                        public void bind(Class<? extends Event> t, EventExecutor e, boolean i) {}

                        @Override
                        public void unbindAll() {}
                    }));
        });
    }
}
