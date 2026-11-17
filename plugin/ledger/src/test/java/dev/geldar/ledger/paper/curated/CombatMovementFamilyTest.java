package dev.geldar.ledger.paper.curated;

import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.fake;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.player;
import static dev.geldar.ledger.paper.curated.BlocksItemsFamilyTest.world;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.FakeHostInfo;
import dev.geldar.ledger.core.RecordingLedger;
import dev.geldar.ledger.paper.curated.CuratedRegistry.FieldSink;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Projectile;
import org.bukkit.event.Event;
import org.bukkit.event.entity.EntityDamageEvent.DamageCause;
import org.bukkit.event.player.PlayerTeleportEvent.TeleportCause;
import org.bukkit.plugin.EventExecutor;
import org.junit.jupiter.api.Test;

/**
 * The Bukkit events cannot be built without a server, so the extractors take plain values and are tested here; the
 * lambdas in {@code CombatMovementFamily.register} that pull the values out of the events are compile-only.
 */
class CombatMovementFamilyTest {
    final FakeHostInfo host = new FakeHostInfo().mainThread(true);
    final RecordingLedger ledger = new RecordingLedger(host);
    final Map<Class<?>, EventExecutor> executors = new LinkedHashMap<>();
    final List<Boolean> ignoreCancelled = new java.util.ArrayList<>();
    final CuratedRegistry registry = new CuratedRegistry(
            ledger.events(),
            ledger.guard("curated"),
            host,
            new CuratedRegistry.Binder() {
                @Override
                public void bind(Class<? extends Event> type, EventExecutor executor, boolean ignore) {
                    executors.put(type, executor);
                    ignoreCancelled.add(ignore);
                }

                @Override
                public void unbindAll() {
                    executors.clear();
                }
            });

    static Entity cow() {
        return fake(Cow.class, Map.of());
    }

    @Test
    void registersNineEventsAndNeverPlayerMove() {
        new CombatMovementFamily().register(registry);
        assertEquals(9, registry.registeredCount());
        assertEquals(9, executors.size());
        assertTrue(ignoreCancelled.stream().allMatch(b -> b));
        for (Class<?> c : executors.keySet()) {
            assertFalse(c.getSimpleName().contains("Move"), c.getName());
        }
        assertTrue(ledger.rejectedEventKeys().isEmpty());
        assertEquals(
                java.util.Arrays.asList("geldar.amount", "geldar.role", null, "geldar.life_id", "geldar.cause", null),
                ledger.eventFields("geldar.combat.damage"));
        assertEquals(
                java.util.Arrays.asList(null, null, "geldar.flag", "geldar.life_id", "geldar.cause", "geldar.world"),
                ledger.eventFields("geldar.movement.teleport"));
        assertEquals(
                java.util.Arrays.asList(null, null, null, "geldar.life_id", "geldar.subtype", null),
                ledger.eventFields("geldar.combat.kill"));
        assertEquals(
                java.util.Arrays.asList(null, null, null, "geldar.life_id", "geldar.cause", "geldar.world"),
                ledger.eventFields("geldar.combat.player_death"));
        assertTrue(ledger.rejectedEventKeys().isEmpty());
        registry.unbindAll();
        assertTrue(executors.isEmpty());
    }

    @Test
    void damageWithNoPlayerInvolvedRecordsNothing() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.damage(s, cow(), cow(), 5, DamageCause.ENTITY_ATTACK);
        assertTrue(skipped(s));
        s = new FieldSink();
        CombatMovementFamily.damage(s, cow(), null, 5, DamageCause.FALL);
        assertTrue(skipped(s));
    }

    @Test
    void damageToAPlayerRecordsRoleBucketCauseAndLifeId() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.damage(s, player("ag_mira_01"), cow(), 3.456, DamageCause.ENTITY_ATTACK);
        assertFalse(skipped(s));
        assertEquals(345, s.l1);
        assertEquals(CombatMovementFamily.ROLE_VICTIM, s.l2);
        assertEquals("ag_mira_01", s.s1);
        assertEquals("ENTITY_ATTACK", s.s2);
    }

    @Test
    void aPlayerHurtingAMobIsTheAttackerAndAProjectileShooterCounts() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.damage(s, cow(), player("ag_mira_01"), 1, DamageCause.ENTITY_ATTACK);
        assertEquals(CombatMovementFamily.ROLE_ATTACKER, s.l2);
        assertEquals("ag_mira_01", s.s1);
        FieldSink t = new FieldSink();
        Projectile arrow = fake(Projectile.class, Map.of("getShooter", player("ag_mira_01")));
        CombatMovementFamily.damage(t, cow(), arrow, 1, DamageCause.PROJECTILE);
        assertEquals(CombatMovementFamily.ROLE_ATTACKER, t.l2);
        FieldSink u = new FieldSink();
        Projectile skeletonArrow = fake(Projectile.class, Map.of("getShooter", cow()));
        CombatMovementFamily.damage(u, cow(), skeletonArrow, 1, DamageCause.PROJECTILE);
        assertTrue(skipped(u));
    }

    @Test
    void playerVersusPlayerIsRoleBothAndAHumanCarriesNoName() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.damage(s, player("Notch"), player("ag_mira_01"), 2, DamageCause.ENTITY_ATTACK);
        assertEquals(CombatMovementFamily.ROLE_BOTH, s.l2);
        assertNull(s.s1); // the victim is a human: no name, and the attacker's id is not substituted
        for (String v : new String[] {s.s1, s.s2, s.s3}) {
            assertFalse(String.valueOf(v).contains("Notch"));
        }
    }

    @Test
    void damageBucketIsClampedOnBothEnds() {
        assertEquals(0, CombatMovementFamily.damageX100(-4));
        assertEquals(0, CombatMovementFamily.damageX100(Double.NaN));
        assertEquals(0, CombatMovementFamily.damageX100(0));
        assertEquals(2050, CombatMovementFamily.damageX100(20.5));
        assertEquals(CombatMovementFamily.MAX_DAMAGE_X100, CombatMovementFamily.damageX100(1e12));
        assertEquals(CombatMovementFamily.MAX_DAMAGE_X100, CombatMovementFamily.damageX100(Double.POSITIVE_INFINITY));
    }

    @Test
    void aNullCauseIsUnknownNotAnError() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.damage(s, player("ag_mira_01"), null, 1, null);
        assertEquals("UNKNOWN", s.s2);
        FieldSink d = new FieldSink();
        CombatMovementFamily.death(d, player("ag_mira_01"), null, world());
        assertEquals("UNKNOWN", d.s2);
        assertEquals("world_nether", d.s3);
    }

    @Test
    void deathRecordsTheCauseEnumOnly() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.death(s, player("ag_mira_01"), DamageCause.LAVA, world());
        assertEquals("ag_mira_01", s.s1);
        assertEquals("LAVA", s.s2);
        assertEquals("world_nether", s.s3);
        assertEquals(0, s.l1 + s.l2 + s.l3); // no coordinates
    }

    @Test
    void theDeathMessageIsNeverRead() throws Exception {
        String src = Files.readString(Path.of(
                "src/main/java/dev/geldar/ledger/paper/curated/CombatMovementFamily.java"));
        // Only the comment may name it; no call and no PlayerMoveEvent import.
        assertFalse(src.contains(".getDeathMessage("));
        assertFalse(src.contains(".deathMessage("));
        assertFalse(src.contains("import org.bukkit.event.player.PlayerMoveEvent"));
    }

    @Test
    void killNeedsAPlayerKillerAndRecordsTheVictimType() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.kill(s, null, "ZOMBIE");
        assertTrue(skipped(s));
        FieldSink t = new FieldSink();
        CombatMovementFamily.kill(t, player("ag_mira_01"), "ZOMBIE");
        assertFalse(skipped(t));
        assertEquals("ag_mira_01", t.s1);
        assertEquals("ZOMBIE", t.s2);
    }

    /** A PlayerDeathEvent reaches the EntityDeathEvent executor (shared handler list): kill must skip it. */
    @Test
    void aPlayerDeathEventReachingTheKillExecutorRecordsNothing() throws Exception {
        var f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
        f.setAccessible(true);
        var unsafe = (sun.misc.Unsafe) f.get(null);
        var e = (org.bukkit.event.entity.EntityDeathEvent)
                unsafe.allocateInstance(org.bukkit.event.entity.PlayerDeathEvent.class);
        FieldSink s = new FieldSink();
        CombatMovementFamily.killed(e, s); // no entity behind it: any read of the event would throw
        assertTrue(skipped(s));
        assertNull(s.s1);
        assertNull(s.s2);
    }

    @Test
    void teleportByCommandSetsTheOperatorFlagAndOtherCausesDoNot() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.porting(s, player("ag_mira_01"), TeleportCause.COMMAND, world());
        assertEquals(1, s.l3);
        assertEquals("COMMAND", s.s2);
        for (TeleportCause c : TeleportCause.values()) {
            if (c == TeleportCause.COMMAND) {
                continue;
            }
            FieldSink o = new FieldSink();
            CombatMovementFamily.porting(o, player("ag_mira_01"), c, world());
            assertEquals(0, o.l3, c.name());
            assertEquals(c.name(), o.s2);
            assertEquals(0, o.l1 + o.l2); // no destination coordinates
        }
    }

    @Test
    void namedRecordsLifeIdNameAndWorldAndAHumanHasNoId() {
        FieldSink s = new FieldSink();
        CombatMovementFamily.named(s, player("Notch"), "SURVIVAL", world());
        assertNull(s.s1);
        assertEquals("SURVIVAL", s.s2);
        assertEquals("world_nether", s.s3);
        CombatMovementFamily.named(s, player("ag_mira_01"), null, null);
        assertEquals("ag_mira_01", s.s1);
        assertNull(s.s3);
    }

    private static boolean skipped(FieldSink s) {
        try {
            var m = FieldSink.class.getDeclaredMethod("skipped");
            m.setAccessible(true);
            return (boolean) m.invoke(s);
        } catch (ReflectiveOperationException e) {
            throw new AssertionError(e);
        }
    }
}
