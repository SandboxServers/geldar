package dev.geldar.ledger.neoforge.audit;

import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.Ledger;
import java.util.logging.Logger;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.CommandEvent;
import net.neoforged.neoforge.event.entity.living.LivingDamageEvent;
import net.neoforged.neoforge.event.entity.living.LivingDeathEvent;
import net.neoforged.neoforge.event.entity.player.PermissionsChangedEvent;

/**
 * The only Minecraft-facing part of PT-N8: reads the game events into plain values and hands them to the families.
 * Observation only (nothing is cancelled or changed). Every decision is a pure static or a constant
 * ({@link #PRIORITY}, {@link #RECEIVE_CANCELED}, {@link OperatorAuditFamily#commandKind}, {@link TextContentFamily#chatText})
 * and is tested; the readers below cannot be built without a running server. Fail-safe: a failure here leaves the families off.
 */
public final class AuditWiring {
    private static final Logger LOG = Logger.getLogger("ledger");

    /** Every listener runs after the other mods and never sees an event that was already cancelled (D-I). */
    static final EventPriority PRIORITY = EventPriority.LOWEST;

    static final boolean RECEIVE_CANCELED = false;

    private AuditWiring() {}

    /** Registers the listeners on the NeoForge bus; call from the mod constructor. Does nothing for a null ledger. */
    public static void install(Ledger ledger, HostInfo host) {
        if (ledger == null) {
            return;
        }
        try {
            CombatFamily combat = new CombatFamily(ledger, host);
            TextContentFamily text = new TextContentFamily(ledger, host);
            OperatorAuditFamily audit = new OperatorAuditFamily(ledger, host);
            NeoForge.EVENT_BUS.addListener(PRIORITY, RECEIVE_CANCELED, LivingDamageEvent.Post.class, e -> damage(combat, e));
            NeoForge.EVENT_BUS.addListener(PRIORITY, RECEIVE_CANCELED, LivingDeathEvent.class, e -> death(combat, e));
            NeoForge.EVENT_BUS.addListener(PRIORITY, RECEIVE_CANCELED, net.neoforged.neoforge.event.ServerChatEvent.class, e -> chat(text, e));
            NeoForge.EVENT_BUS.addListener(PRIORITY, RECEIVE_CANCELED, CommandEvent.class, e -> command(audit, e));
            NeoForge.EVENT_BUS.addListener(PRIORITY, RECEIVE_CANCELED, PermissionsChangedEvent.class, e -> operator(audit, e));
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger curated wiring failed: " + t.getClass().getName());
        }
    }

    static String playerName(Entity e) {
        return e instanceof ServerPlayer p ? p.getGameProfile().name() : null;
    }

    private static String dimension(Entity e) {
        return e.level().dimension().identifier().toString();
    }

    private static void damage(CombatFamily combat, LivingDamageEvent.Post e) {
        try {
            DamageSource src = e.getSource();
            combat.damage(playerName(e.getEntity()), playerName(src.getEntity()), e.getInflictedDamage(), src.getMsgId());
        } catch (Throwable t) {
            rethrowVmError(t);
        }
    }

    private static void death(CombatFamily combat, LivingDeathEvent e) {
        try {
            Entity dead = e.getEntity();
            DamageSource src = e.getSource();
            if (dead instanceof ServerPlayer p) {
                combat.playerDeath(playerName(p), src.getMsgId(), dimension(p));
            } else {
                combat.killed(playerName(src.getEntity()), false, () -> EntityType.getKey(dead.getType()).toString());
            }
        } catch (Throwable t) {
            rethrowVmError(t);
        }
    }

    private static void chat(TextContentFamily text, net.neoforged.neoforge.event.ServerChatEvent e) {
        try {
            ServerPlayer p = e.getPlayer();
            text.chat(e.isCanceled(), playerName(p), dimension(p), () -> TextContentFamily.chatText(e.getRawText()));
        } catch (Throwable t) {
            rethrowVmError(t);
        }
    }

    private static void command(OperatorAuditFamily audit, CommandEvent e) {
        try {
            CommandSourceStack source = e.getParseResults().getContext().getSource();
            String kind = OperatorAuditFamily.commandKind(source.getEntity() != null, source.getTextName());
            audit.command(kind, e.isCanceled(), () -> e.getParseResults().getReader().getString());
        } catch (Throwable t) {
            rethrowVmError(t);
        }
    }

    private static void operator(OperatorAuditFamily audit, PermissionsChangedEvent e) {
        try {
            audit.operatorChange(playerName(e.getEntity()), isOp(e));
        } catch (Throwable t) {
            rethrowVmError(t);
        }
    }

    private static boolean isOp(PermissionsChangedEvent e) {
        return e.getNewLevel().level().id() > 0;
    }

    private static void rethrowVmError(Throwable t) {
        if (t instanceof VirtualMachineError vme) {
            throw vme;
        }
    }
}
