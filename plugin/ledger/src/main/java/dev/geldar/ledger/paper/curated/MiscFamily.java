package dev.geldar.ledger.paper.curated;

import com.destroystokyo.paper.event.server.ServerExceptionEvent;
import dev.geldar.ledger.core.AttrKeys;
import dev.geldar.ledger.core.Names;
import dev.geldar.ledger.core.Severity;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import java.util.function.LongSupplier;
import org.bukkit.Raid;
import org.bukkit.entity.Player;
import org.bukkit.event.raid.RaidFinishEvent;
import org.bukkit.event.raid.RaidTriggerEvent;
import org.bukkit.event.server.PluginDisableEvent;
import org.bukkit.event.server.PluginEnableEvent;
import org.bukkit.event.server.TabCompleteEvent;
import org.bukkit.plugin.Plugin;

/**
 * Raids, tab completion, plugin lifecycle and server exceptions (PT-07f). Every handler only reads (S1). Fields, in
 * ring order l1,l2,l3,s1,s2,s3; a null key leaves the slot unexported.
 *
 * <ul>
 *   <li>{@code geldar.raid.trigger|finish}: l1,l2 = the raid centre's block x and z, l3 ({@code geldar.amount}) = the
 *       wave number (spawned groups); trigger adds s1 = life id of the triggering player; s3 = world name. Nothing
 *       else of the raid or its winners is read.
 *   <li>{@code geldar.tabcomplete}: l1 ({@code geldar.amount}) = the typed buffer's LENGTH, capped; s2
 *       ({@code geldar.subtype}) = {@code player} or {@code console}. The typed buffer itself and the completion list
 *       are NEVER read for content: a buffer can carry a secret (card PT-07f, S4). Rate limited here as well as by the
 *       event bucket. {@code AsyncTabCompleteEvent} is not registered.
 *   <li>{@code geldar.server.plugin_enabled|disabled}: s2 ({@code geldar.plugin}) = the plugin name, capped to 48
 *       characters. No version: the allow-list has no version key and this card may not edit the core (reported).
 *   <li>{@code geldar.server.exception}: s2 ({@code geldar.exception.class}) = the exception class name (cause when
 *       there is one), capped; s3 ({@code geldar.subtype}) = the first stack frame as {@code Class.method}, capped.
 *       The message is NEVER read. Hard cap of {@value #EXCEPTION_PER_SECOND} per second and a thread-local
 *       re-entrancy flag: an extraction that throws or recurses cannot loop.
 * </ul>
 *
 * <p>No log appender or default uncaught-exception handler is installed: the card uses Paper's
 * {@code ServerExceptionEvent}, which needs nothing to remove on stop.
 */
public final class MiscFamily implements CuratedFamily {
    static final int NAME_CAP = 48;
    static final int FRAME_CAP = 160;
    static final long LENGTH_CAP = 32_768;
    static final int EXCEPTION_PER_SECOND = 10;
    static final int TAB_PER_SECOND = 20;
    private static final long SECOND_NANOS = 1_000_000_000L;
    private static final String[] RAID_TRIGGER = {
        AttrKeys.X, AttrKeys.Z, AttrKeys.AMOUNT, AttrKeys.LIFE_ID, null, AttrKeys.WORLD
    };
    private static final String[] RAID_FINISH = {AttrKeys.X, AttrKeys.Z, AttrKeys.AMOUNT, null, null, AttrKeys.WORLD};
    private static final String[] TAB_FIELDS = {AttrKeys.AMOUNT, null, null, null, AttrKeys.SUBTYPE, null};
    private static final String[] PLUGIN_FIELDS = {null, null, null, null, AttrKeys.PLUGIN, null};
    private static final String[] EXCEPTION_FIELDS = {
        null, null, null, null, AttrKeys.EXCEPTION_CLASS, AttrKeys.SUBTYPE
    };
    private static final ThreadLocal<Boolean> EXTRACTING = new ThreadLocal<>();

    private final SecondCap exceptionCap;
    private final SecondCap tabCap;

    public MiscFamily() {
        this(System::nanoTime);
    }

    MiscFamily(LongSupplier nanos) {
        this.exceptionCap = new SecondCap(EXCEPTION_PER_SECOND, nanos);
        this.tabCap = new SecondCap(TAB_PER_SECOND, nanos);
    }

    @Override
    public void register(CuratedRegistry r) {
        String raid = Names.Events.RAID_FAMILY + ".";
        r.on(RaidTriggerEvent.class, raid + "trigger", Severity.INFO, RAID_TRIGGER, true, (e, s) -> {
            raid(s, e.getRaid(), e.getWorld().getName());
            s.player(e.getPlayer());
        });
        r.on(RaidFinishEvent.class, raid + "finish", Severity.INFO, RAID_FINISH, true, (e, s) ->
                raid(s, e.getRaid(), e.getWorld().getName()));
        // ignoreCancelled=false: a cancelled tab completion is still a tab completion.
        r.on(TabCompleteEvent.class, Names.Events.TABCOMPLETE, Severity.DEBUG, TAB_FIELDS, false, (e, s) -> {
            if (!tabCap.allow()) {
                s.skip();
                return;
            }
            tab(s, e.getBuffer() == null ? 0 : e.getBuffer().length(), e.getSender() instanceof Player);
        });
        r.on(PluginEnableEvent.class, Names.Events.SERVER_PLUGIN_ENABLED, Severity.INFO, PLUGIN_FIELDS, true, (e, s) ->
                plugin(s, e.getPlugin()));
        r.on(PluginDisableEvent.class, Names.Events.SERVER_PLUGIN_DISABLED, Severity.INFO, PLUGIN_FIELDS, true, (e, s) ->
                plugin(s, e.getPlugin()));
        r.on(ServerExceptionEvent.class, Names.Events.SERVER_EXCEPTION, Severity.WARN, EXCEPTION_FIELDS, true, (e, s) -> {
            if (!exceptionCap.allow()) {
                s.skip();
                return;
            }
            Throwable t = e.getException();
            exception(s, t != null && t.getCause() != null ? t.getCause() : t);
        });
    }

    static void raid(FieldSink s, Raid raid, String world) {
        s.l1 = raid.getLocation().getBlockX();
        s.l2 = raid.getLocation().getBlockZ();
        s.l3 = raid.getSpawnedGroups();
        s.s3 = world;
    }

    /** The length of the typed buffer, capped, and the sender kind. The text is never passed in. */
    static void tab(FieldSink s, int bufferLength, boolean player) {
        s.l1 = Math.min(Math.max(bufferLength, 0), LENGTH_CAP);
        s.s2 = player ? "player" : "console";
    }

    static void plugin(FieldSink s, Plugin p) {
        s.s2 = cap(p == null ? null : p.getName(), NAME_CAP);
    }

    /** Class name and first frame only. Re-entrant or throwing extraction records nothing and never propagates. */
    static void exception(FieldSink s, Throwable t) {
        if (t == null || EXTRACTING.get() != null) {
            s.skip();
            return;
        }
        EXTRACTING.set(Boolean.TRUE);
        try {
            s.s2 = cap(t.getClass().getName(), FRAME_CAP);
            StackTraceElement[] frames = t.getStackTrace();
            if (frames != null && frames.length > 0 && frames[0] != null) {
                s.s3 = cap(frames[0].getClassName() + "." + frames[0].getMethodName(), FRAME_CAP);
            }
        } catch (Throwable ignored) {
            s.skip();
        } finally {
            EXTRACTING.remove();
        }
    }

    static String cap(String v, int max) {
        if (v == null) {
            return null;
        }
        return v.length() > max ? v.substring(0, max) : v;
    }

    /** At most {@code limit} passes per one-second window; main-thread state like the rest of the registry. */
    static final class SecondCap {
        private final int limit;
        private final LongSupplier nanos;
        private long windowStart;
        private int used;
        private boolean started;

        SecondCap(int limit, LongSupplier nanos) {
            this.limit = limit;
            this.nanos = nanos;
        }

        boolean allow() {
            long now = nanos.getAsLong();
            if (!started || now - windowStart >= SECOND_NANOS) {
                started = true;
                windowStart = now;
                used = 0;
            }
            if (used >= limit) {
                return false;
            }
            used++;
            return true;
        }
    }
}
