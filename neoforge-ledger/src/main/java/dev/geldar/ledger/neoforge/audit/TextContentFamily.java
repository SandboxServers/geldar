package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.ContentLog;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.TokenBucket;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Chat text (PT-N8): owner-approved full-text capture, delivered only to the gateway through {@code ContentLog}.
 * Observation only: nothing here changes the event. Sign and book text are not captured (no NeoForge event for them was
 * found: PT-N5). On 26.1.2 chat is handled on the server thread, but this path still never touches the {@code CollectorGuard} (bounded by the bucket instead). /say, /msg and /me do not fire the chat event: private messages are not captured.
 *
 * <p>Exported per message: the text, s1 = the speaker's life id or nothing (a human's name is never copied, D-F; the
 * text itself is kept verbatim apart from the credential scrub and the byte cap), s2 = the world. A cancelled message is
 * not captured (D-I). Order: the token bucket first, so a flood costs no flatten, scrub or cap work.
 */
public final class TextContentFamily {
    static final int CHAT_RATE = 20;
    /** Pre-scrub bound on the text read from the event (a mod-supplied component can be huge). */
    static final int PRE_SCRUB_MAX_BYTES = 1 << 20;
    private static final String[] FIELDS = {AttrKeys.LIFE_ID, AttrKeys.WORLD};

    private final ContentLog content;
    private final EventLog events;
    private final AuditGate gate;
    private final int chatId;
    private final int dropId;
    private final TokenBucket bucket;
    private final LongAdder errors = new LongAdder();
    private final LongAdder rateDrops = new LongAdder();

    public TextContentFamily(Ledger ledger, HostInfo host) {
        this(ledger, System::nanoTime);
    }

    TextContentFamily(Ledger ledger, LongSupplier nanoClock) {
        this.content = ledger.content();
        this.events = ledger.events();
        this.gate = AuditGate.chat(ledger);
        this.chatId = content.register(Names.Events.CHAT, FIELDS);
        // Rate 0: always denies and counts, so a denial shows in the core's rate-drop counter like a core drop.
        this.dropId = events.register(Names.Events.CHAT + "._rate_drop", Severity.INFO, 0);
        int rate = Math.max(0, ledger.config().rates().getOrDefault(Names.Events.CHAT, CHAT_RATE));
        this.bucket = new TokenBucket(rate, nanoClock);
    }

    /** The text to capture: the raw typed text only, never the decorated message another mod may have prefixed. */
    static String chatText(String rawTyped) {
        return rawTyped == null ? "" : rawTyped;
    }

    long errors() {
        return errors.sum();
    }

    long rateDrops() {
        return rateDrops.sum();
    }

    /**
     * Records one chat message. {@code text} is only called once the message passed the bucket and was not cancelled.
     * {@code player} is the speaker's name (used only when it is a life id).
     */
    public void chat(boolean cancelled, String player, String world, Supplier<String> text) {
        try {
            if (!gate.getAsBoolean() || cancelled) {
                return;
            }
            if (!bucket.tryTake()) {
                rateDrops.increment();
                events.record(dropId, 0, 0, 0, null, null, null);
                return;
            }
            String raw = text.get();
            String clean = ContentCap.cap(Redactor.scrub(ContentCap.cap(raw == null ? "" : raw, PRE_SCRUB_MAX_BYTES)));
            content.record(chatId, clean, CombatFamily.lifeId(player), world, null);
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            errors.increment();
        }
    }
}
