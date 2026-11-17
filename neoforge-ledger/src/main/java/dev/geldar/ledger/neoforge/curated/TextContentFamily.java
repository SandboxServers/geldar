package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.ContentLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.core.TokenBucket;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Chat text (PT-N8): owner-approved full-text capture, delivered only to the gateway through {@code ContentLog}.
 * Observation only: nothing here changes the event. Sign and book text are not captured (no NeoForge event for them was
 * found: PT-N5). Chat arrives off the server thread, so this path never touches the {@code CollectorGuard} (S6).
 *
 * <p>Exported per message: the text, s1 = the speaker's life id or nothing (a human's name is never copied, D-F; the
 * text itself is kept verbatim apart from the credential scrub and the byte cap), s2 = the world. A cancelled message is
 * not captured (D-I). Order: the token bucket first, so a flood costs no flatten, scrub or cap work.
 */
public final class TextContentFamily {
    private static final int CHAT_RATE = 20;
    private static final String[] FIELDS = {AttrKeys.LIFE_ID, AttrKeys.WORLD};

    private final ContentLog content;
    private final int chatId;
    private final TokenBucket bucket;
    private final LongAdder errors = new LongAdder();
    private final LongAdder rateDrops = new LongAdder();

    public TextContentFamily(Ledger ledger, HostInfo host) {
        this(ledger, System::nanoTime);
    }

    TextContentFamily(Ledger ledger, LongSupplier nanoClock) {
        this.content = ledger.content();
        this.chatId = content.register(Names.Events.CHAT, FIELDS);
        this.bucket = new TokenBucket(CHAT_RATE, nanoClock);
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
            if (cancelled) {
                return;
            }
            if (!bucket.tryTake()) {
                rateDrops.increment();
                return;
            }
            String raw = text.get();
            String clean = ContentCap.cap(Redactor.scrub(raw == null ? "" : raw));
            content.record(chatId, clean, CombatFamily.lifeId(player), world, null);
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            errors.increment();
        }
    }
}
