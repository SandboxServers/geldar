package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.EventLog;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.TokenBucket;
import java.util.concurrent.atomic.LongAdder;
import java.util.function.LongSupplier;
import java.util.function.Predicate;
import java.util.function.Supplier;

/**
 * Operator audit (PT-N8). {@code geldar.console.command} and {@code geldar.rcon.command}: only a command whose source
 * is the server console (no entity, text name {@code Server}) or RCON (no entity, text name {@code Rcon}); see
 * {@link #commandKind}. Player commands and command-block, function and every other source are not exported (a
 * repeating command block would otherwise flood the stream with automation that is not an operator action).
 * {@code geldar.operator.change}: an ONLINE player was opped or deopped to a different level ({@code geldar.flag}
 * 1 = opped, 0 = deopped; the life id only when the name is one). The event fires before the change, so the flag comes
 * from the new level the event carries; an offline op or deop and a change to the same level emit nothing. Whitelist
 * changes, kick reasons, prelogin, sign and book edits have no NeoForge event (PT-N5): nothing is emitted for them.
 *
 * <p>Only the command name (geldar.command) and the argument count (geldar.amount) are exported ({@link CommandText}); no argument text. The token bucket comes first, so a flood costs no flatten or
 * scrub work. Commands may arrive on any thread; the guard is used only on the server thread.
 */
public final class OperatorAuditFamily {
    public static final String OPERATOR_CHANGE = "geldar.operator.change";
    static final String CONSOLE = "console";
    static final String RCON = "rcon";
    private static final int RATE = 20;
    private static final String[] COMMAND_FIELDS = {null, null, AttrKeys.AMOUNT, AttrKeys.COMMAND, AttrKeys.SUBTYPE, null};
    private static final String[] OP_FIELDS = {null, null, AttrKeys.FLAG, AttrKeys.LIFE_ID, null, null};

    private final EventLog events;
    private final Guarded guarded;
    private final AuditGate gate;
    private final TokenBucket consoleBucket;
    private final TokenBucket rconBucket;
    private final LongAdder rateDrops = new LongAdder();
    private final int consoleId;
    private final int rconId;
    private final int consoleDropId;
    private final int rconDropId;
    private final int opId;

    public OperatorAuditFamily(Ledger ledger, HostInfo host) {
        this(ledger, host, System::nanoTime);
    }

    OperatorAuditFamily(Ledger ledger, HostInfo host, LongSupplier nanoClock) {
        this.events = ledger.events();
        this.gate = new AuditGate(ledger, "operator");
        this.guarded = new Guarded(ledger.guard("operator"), host, gate);
        java.util.Map<String, Integer> rates = ledger.config().rates();
        this.consoleBucket = new TokenBucket(
                Math.max(0, rates.getOrDefault(Names.Events.CONSOLE_COMMAND, RATE)), nanoClock);
        this.rconBucket = new TokenBucket(
                Math.max(0, rates.getOrDefault(Names.Events.RCON_COMMAND, RATE)), nanoClock);
        this.consoleId = events.register(Names.Events.CONSOLE_COMMAND, Severity.INFO, RATE, COMMAND_FIELDS);
        this.rconId = events.register(Names.Events.RCON_COMMAND, Severity.INFO, RATE, COMMAND_FIELDS);
        this.opId = events.register(OPERATOR_CHANGE, Severity.INFO, RATE, OP_FIELDS);
        // Rate 0: always denies and counts, so a family denial shows in the core's rate-drop counter.
        this.consoleDropId = events.register(Names.Events.CONSOLE_COMMAND + "._rate_drop", Severity.INFO, 0);
        this.rconDropId = events.register(Names.Events.RCON_COMMAND + "._rate_drop", Severity.INFO, 0);
    }

    long errors() {
        return guarded.errors();
    }

    long rateDrops() {
        return rateDrops.sum();
    }

    /**
     * The source kind to export: {@code console}, {@code rcon}, or null (player, command block, anything else).
     * {@code serverSource}: the stack's source is the MinecraftServer; {@code rconSource}: it is an RconConsoleSource
     * (26.1.2: MinecraftServer.createCommandSourceStack passes the server itself; RconConsoleSource implements CommandSource).
     */
    static String commandKind(boolean hasEntity, String textName, boolean serverSource, boolean rconSource) {
        if (hasEntity || textName == null) {
            return null;
        }
        // The name alone is not enough: a command block can be renamed "Server" or "Rcon". The source object must be
        // the MinecraftServer itself (console) or an RconConsoleSource (RCON).
        return switch (textName) {
            case "Server" -> serverSource ? CONSOLE : null;
            case "Rcon" -> rconSource ? RCON : null;
            default -> null;
        };
    }

    /** Tests only: every name counts as a registered command. */
    void command(String kind, boolean cancelled, Supplier<String> text) {
        command(kind, cancelled, text, n -> true);
    }

    /**
     * {@code text} is only called once the command passed the bucket; a null {@code kind} exports nothing.
     * {@code registered} says whether a name is a registered root command of the server dispatcher (read on the thread
     * that runs the command); the name is exported only if it is, else {@code unknown}.
     */
    public void command(String kind, boolean cancelled, Supplier<String> text, Predicate<String> registered) {
        if (kind == null || cancelled || !gate.getAsBoolean()) {
            return;
        }
        boolean rcon = kind.equals(RCON);
        if (!(rcon ? rconBucket : consoleBucket).tryTake()) {
            rateDrops.increment();
            guarded.run(() -> events.record(rcon ? rconDropId : consoleDropId, 0, 0, 0, null, null, null));
            return;
        }
        guarded.run(() -> {
            CommandText.Parsed c = CommandText.parse(text.get(), registered);
            events.record(rcon ? rconId : consoleId, 0, 0, c.argCount(), c.name(), kind, null);
        });
    }

    public void operatorChange(String player, boolean opped) {
        guarded.run(() -> events.record(opId, 0, 0, opped ? 1 : 0, CombatFamily.lifeId(player), null, null));
    }
}
