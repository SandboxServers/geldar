package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.TokenBucket;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * Operator audit (PT-N8). {@code geldar.console.command}: a command that has no player behind it (console, RCON and any
 * other source without an entity; NeoForge's command event does not tell console from RCON, so both are subtype
 * {@code console}). A command a player typed is not exported. {@code geldar.operator.change}: a player was opped or
 * deopped ({@code geldar.flag} 1 = opped, 0 = deopped; the life id only when the name is one). Whitelist changes, kick
 * reasons, prelogin, sign and book edits have no NeoForge event (PT-N5): nothing is emitted for them.
 *
 * <p>The command text goes through {@link CommandText}. The token bucket comes first, so a flood costs no flatten or
 * scrub work. Commands may arrive on any thread; the guard is used only on the server thread.
 */
public final class OperatorAuditFamily {
    public static final String OPERATOR_CHANGE = "geldar.operator.change";
    static final String CONSOLE = "console";
    private static final int RATE = 20;
    private static final String[] COMMAND_FIELDS = {null, null, null, AttrKeys.COMMAND, AttrKeys.SUBTYPE, null};
    private static final String[] OP_FIELDS = {null, null, AttrKeys.FLAG, AttrKeys.LIFE_ID, null, null};

    private final EventLog events;
    private final Guarded guarded;
    private final TokenBucket bucket;
    private final LongAdder rateDrops = new LongAdder();
    private final int commandId;
    private final int opId;

    public OperatorAuditFamily(Ledger ledger, HostInfo host) {
        this(ledger, host, System::nanoTime);
    }

    OperatorAuditFamily(Ledger ledger, HostInfo host, LongSupplier nanoClock) {
        this.events = ledger.events();
        this.guarded = new Guarded(ledger.guard("operator"), host);
        this.bucket = new TokenBucket(RATE, nanoClock);
        this.commandId = events.register(Names.Events.CONSOLE_COMMAND, Severity.INFO, RATE, COMMAND_FIELDS);
        this.opId = events.register(OPERATOR_CHANGE, Severity.INFO, RATE, OP_FIELDS);
    }

    long errors() {
        return guarded.errors();
    }

    long rateDrops() {
        return rateDrops.sum();
    }

    /** {@code text} is only called once the command passed the bucket and has no player source. */
    public void command(boolean playerSource, boolean cancelled, Supplier<String> text) {
        if (playerSource || cancelled) {
            return;
        }
        if (!bucket.tryTake()) {
            rateDrops.increment();
            return;
        }
        guarded.run(() -> events.record(commandId, 0, 0, 0, CommandText.exportable(text.get()), CONSOLE, null));
    }

    public void operatorChange(String player, boolean opped) {
        guarded.run(() -> events.record(opId, 0, 0, opped ? 1 : 0, CombatFamily.lifeId(player), null, null));
    }
}
