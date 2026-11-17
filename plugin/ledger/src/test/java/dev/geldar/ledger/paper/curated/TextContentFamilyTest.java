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
