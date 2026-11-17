package dev.geldar.ledger.paper.curated;

import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.ContentCap;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Redactor;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.core.ids.LifeIds;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import com.destroystokyo.paper.event.server.WhitelistToggleEvent;
import io.papermc.paper.event.server.WhitelistStateUpdateEvent;
import java.util.Locale;
import java.util.Set;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.server.BroadcastMessageEvent;
import org.bukkit.event.server.RemoteServerCommandEvent;
import org.bukkit.event.server.ServerCommandEvent;

/**
 * Operator audit (PT-07e): console and RCON commands, broadcasts and whitelist changes. Observation only (MONITOR, no
 * setter, no reply, no dispatch).
 *
 * <p>Exported text fields per event:
 * <ul>
 *   <li>{@code geldar.console.command} and {@code geldar.rcon.command}: {@code geldar.command} = the command text and
 *       {@code geldar.subtype} = the fixed enum string {@code console} or {@code rcon}. Nothing else. The sender object,
 *       its name, its address and any configuration (the RCON password, port, {@code server.properties}) are never read.
 *   <li>The server-message event ({@code Names.Events.BROADCAST}): {@code geldar.text} = the plain text of the message.
 *   <li>{@code geldar.whitelist.update}: {@code geldar.life_id} only when the profile name is a life id,
 *       {@code geldar.subtype} = ADDED or REMOVED. {@code geldar.whitelist.toggle}: {@code geldar.flag} = 1 when enabled.
 * </ul>
 *
 * <p>Bounds: every text goes through {@link Redactor#scrub} and then {@link ContentCap#cap} to {@link #TEXT_MAX_BYTES}
 * (the core's per-attribute limit) before it reaches the ring, after a coarse pre-cap that bounds scrub work. A command
 * whose root is an authentication verb ({@link #AUTH_ROOTS}) is exported as its root only: the arguments are dropped,
 * because a password has no recognisable shape. A human operator is not named at all (these events carry no player
 * identity); the actor is the enum {@code console} or {@code rcon}.
 *
 * <p>Documented limit: the plugin cannot know a secret typed as plain text in a command that is not an auth verb. The
 * scrub removes credential-shaped values ({@code key=value}, {@code --password x}, tokens, addresses); the gateway rules
 * (PT-12) and the operator's discipline are the other layers.
 *
 * <p>Deviation from the card: the text travels as an event attribute through {@code EventLog} (the registry's only
 * channel; the family has no {@code ContentLog} handle), so the core's 1 KiB attribute bound applies.
 */
public final class OperatorAuditFamily implements CuratedFamily {
    /** The core caps a string attribute at 1 KiB; cap here so the marker is ours and the bound is explicit. */
    static final int TEXT_MAX_BYTES = 1024;

    private static final int PRE_CAP_BYTES = 65536;
    static final String CONSOLE = "console";
    static final String RCON = "rcon";

    /** Command roots whose arguments are never exported (login-style plugins and password changes). */
    static final Set<String> AUTH_ROOTS = Set.of(
            "login", "l", "log", "register", "reg", "changepassword", "changepass", "cp", "authme", "unregister", "unreg",
            "passwd", "password");

    private static final String[] COMMAND_FIELDS = {null, null, null, AttrKeys.COMMAND, AttrKeys.SUBTYPE, null};
    private static final String[] TEXT_FIELDS = {null, null, null, AttrKeys.TEXT, null, null};
    private static final String[] WHITELIST_FIELDS = {null, null, null, AttrKeys.LIFE_ID, AttrKeys.SUBTYPE, null};
    private static final String[] TOGGLE_FIELDS = {null, null, AttrKeys.FLAG, null, null, null};

    @Override
    public void register(CuratedRegistry r) {
        r.on(ServerCommandEvent.class, Names.Events.CONSOLE_COMMAND, Severity.INFO, COMMAND_FIELDS, true, (e, s) -> {
            if (e instanceof RemoteServerCommandEvent) { // recorded once, by the rcon registration
                s.skip();
                return;
            }
            command(s, e.getCommand(), CONSOLE);
        });
        r.on(RemoteServerCommandEvent.class, Names.Events.RCON_COMMAND, Severity.INFO, COMMAND_FIELDS, true, (e, s) ->
                command(s, e.getCommand(), RCON));
        // BroadcastMessageEvent is not deprecated as a class in this paper-api (only its String constructors are).
        r.on(BroadcastMessageEvent.class, Names.Events.BROADCAST, Severity.INFO, TEXT_FIELDS, true, (e, s) ->
                s.s1 = bound(PlainTextComponentSerializer.plainText().serialize(e.message())));
        r.on(WhitelistStateUpdateEvent.class, Names.Events.WHITELIST_FAMILY + ".update", Severity.INFO, WHITELIST_FIELDS, true,
                (e, s) -> {
                    String name = e.getPlayerProfile().getName();
                    s.s1 = LifeIds.isLifeId(name) ? name : null;
                    s.s2 = e.getStatus().name();
                });
        r.on(WhitelistToggleEvent.class, Names.Events.WHITELIST_FAMILY + ".toggle", Severity.INFO, TOGGLE_FIELDS, true, (e, s) ->
                s.l3 = e.isEnabled() ? 1 : 0);
    }

    static void command(FieldSink s, String raw, String kind) {
        s.s1 = exportable(raw);
        s.s2 = kind;
    }

    /** The command text to export: the bare root for an auth command, else the scrubbed and capped text. */
    static String exportable(String raw) {
        if (raw == null) {
            return "";
        }
        if (raw.isBlank()) {
            return "";
        }
        String root = root(raw);
        if (AUTH_ROOTS.contains(root)) {
            return root;
        }
        return bound(raw);
    }

    /** The lower-case command root: leading slashes and spaces dropped, up to the first space, without a plugin prefix. */
    static String root(String raw) {
        int i = 0;
        int n = raw.length();
        while (i < n && (raw.charAt(i) == '/' || separator(raw.charAt(i)))) {
            i++;
        }
        int j = i;
        while (j < n && !separator(raw.charAt(j))) {
            j++;
        }
        String word = raw.substring(i, j).toLowerCase(Locale.ROOT);
        int colon = word.lastIndexOf(':');
        return colon >= 0 ? word.substring(colon + 1) : word;
    }

    private static boolean separator(char c) {
        return c <= ' ' || Character.isWhitespace(c) || Character.isSpaceChar(c);
    }

    /** Pre-cap (bounds work), scrub, then cap to the exported bound. */
    static String bound(String text) {
        if (text == null) {
            return "";
        }
        return ContentCap.cap(Redactor.scrub(ContentCap.cap(text, PRE_CAP_BYTES)), TEXT_MAX_BYTES);
    }
}
