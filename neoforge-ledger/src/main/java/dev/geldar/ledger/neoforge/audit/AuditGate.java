package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.LedgerConfig;
import java.util.function.BooleanSupplier;

/**
 * The audit opt-in (console and RCON command text, combat, operator change). Off unless the master switch is
 * on AND {@code collector.audit.enabled=true} is set explicitly (absent means off), and, for a family with its own id
 * (combat, operator), that collector is not switched off. Read from the ledger's config on every call, so it holds on
 * any thread (chat and RCON are not server-thread events). A gate that is off means nothing is recorded and no text
 * (chat, command) is read; the wiring may still read names, dimension, cause and the command source name first.
 */
final class AuditGate implements BooleanSupplier {
    static final String ID = "audit";
    /** Human chat export has its own switch: off unless {@code collector.chat.enabled=true} (owner decision D-F pending). */
    static final String CHAT_ID = "chat";

    private final Ledger ledger;
    private final String collectorId;
    private final boolean explicit;

    /** {@code collectorId} is the family's own collector id, or null when it has none; it defaults to on. */
    AuditGate(Ledger ledger, String collectorId) {
        this(ledger, collectorId, false);
    }

    /** {@code explicit}: the family's own key must be set to true (absent or malformed means off). */
    AuditGate(Ledger ledger, String collectorId, boolean explicit) {
        this.ledger = ledger;
        this.collectorId = collectorId;
        this.explicit = explicit;
    }

    /** The chat gate: audit on, and {@code collector.chat.enabled=true} set explicitly. */
    static AuditGate chat(Ledger ledger) {
        return new AuditGate(ledger, CHAT_ID, true);
    }

    @Override
    public boolean getAsBoolean() {
        try {
            LedgerConfig c = ledger.config();
            return c.collectorEnabled(ID)
                    && Boolean.TRUE.equals(c.collectorEnabled().get(ID))
                    && (collectorId == null
                            || (c.collectorEnabled(collectorId)
                                    && (!explicit || Boolean.TRUE.equals(c.collectorEnabled().get(collectorId)))));
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            return false;
        }
    }
}
