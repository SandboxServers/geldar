package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.junit.jupiter.api.Test;

class PickupProvenanceListenerTest {
    private static final UUID THROWER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID PICKER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    private final List<String> tails = new ArrayList<>();
    private final List<String> bodies = new ArrayList<>();
    private final ProvenanceSink sink = (tail, json) -> {
        tails.add(tail);
        bodies.add(json);
    };
    private final Map<UUID, Player> online = new HashMap<>();
    private final World world = stub(World.class, "getName", "world");
    private long tick = 10;

    /** A proxy that answers only the methods named in the pairs; any other call throws. */
    private static <T> T stub(Class<T> type, Object... pairs) {
        Map<String, Object> answers = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            answers.put((String) pairs[i], pairs[i + 1]);
        }
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (p, m, a) -> {
            if (answers.containsKey(m.getName())) {
                return answers.get(m.getName());
            }
            throw new UnsupportedOperationException(m.getName());
        }));
    }

    private Player player(String name, UUID id, double x, double z) {
        return stub(Player.class, "getName", name, "getUniqueId", id, "getWorld", world, "getLocation",
                new Location(world, x, 64, z));
    }

    /**
     * An Item that answers the thrower and age only. getItemStack is not answered, so reaching it throws: the early
     * returns in onPickup must not read the stack.
     */
    private Item item(UUID thrower, int ticksLived) {
        return stub(Item.class, "getThrower", thrower, "getTicksLived", ticksLived);
    }

    private Location at(double x, double z) {
        return new Location(world, x, 64, z);
    }

    private PickupProvenanceListener listener(ProvenanceSink s, boolean on) {
        return new PickupProvenanceListener(s, () -> on, () -> tick, online::get);
    }

    private static JsonObject parse(String json) {
        return JsonParser.parseString(json).getAsJsonObject();
    }

    @Test
    void thrownByAnotherPlayerAndPickedUpSendsOneMessageWithTheRightFields() {
        online.put(THROWER_ID, player("Thrower", THROWER_ID, 3, 4));

        listener(sink, true).publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 4, 7, tick);

        assertEquals(List.of("pickup"), tails);
        JsonObject json = parse(bodies.get(0));
        assertEquals("pickup", json.get("kind").getAsString());
        assertEquals("world", json.get("world").getAsString());
        assertEquals("Picker", json.get("picker").getAsString());
        assertEquals("Thrower", json.get("thrower").getAsString());
        assertEquals("cobblestone", json.get("item").getAsString());
        assertEquals(4, json.get("count").getAsInt());
        assertEquals(7, json.get("age_ticks").getAsInt());
        assertEquals(5.0, json.get("distance").getAsDouble(), 1e-9);
        assertEquals(10, json.get("tick").getAsLong());
    }

    @Test
    void pickedUpByTheThrowerSendsNothing() {
        online.put(THROWER_ID, player("Thrower", THROWER_ID, 0, 0));
        Player picker = player("Thrower", THROWER_ID, 0, 0);

        listener(sink, true).onPickup(new EntityPickupItemEvent(picker, item(THROWER_ID, 1), 0));

        assertTrue(tails.isEmpty());
    }

    @Test
    void noThrowerDeathOrMobDropSendsNothing() {
        Player picker = player("Picker", PICKER_ID, 0, 0);

        listener(sink, true).onPickup(new EntityPickupItemEvent(picker, item(null, 1), 0));

        assertTrue(tails.isEmpty());
    }

    @Test
    void throwerOfflineSendsThrowerNullAndDistanceNull() {
        listener(sink, true).publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 1, 1, tick);

        assertEquals(1, tails.size());
        JsonObject json = parse(bodies.get(0));
        assertTrue(json.get("thrower").isJsonNull());
        assertTrue(json.get("distance").isJsonNull());
    }

    @Test
    void partialPickupSendsTheCountTaken() {
        online.put(THROWER_ID, player("Thrower", THROWER_ID, 0, 0));

        listener(sink, true).publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 3, 1, tick);

        assertEquals(3, parse(bodies.get(0)).get("count").getAsInt());
    }

    @Test
    void the65thPickupInOneTickIsDroppedAndCounted() {
        PickupProvenanceListener l = listener(sink, true);

        for (int i = 0; i < 65; i++) {
            l.publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 1, 1, tick);
        }
        assertEquals(64, tails.size());
        assertEquals(1, l.dropped());

        tick++;
        l.publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 1, 1, tick);
        assertEquals(65, tails.size());
        assertEquals(1, l.dropped());
    }

    @Test
    void aPickupOfZeroItemsSendsNothing() {
        PickupProvenanceListener l = listener(sink, true);

        for (int i = 0; i < 64; i++) {
            l.publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 0, 1, tick);
        }
        assertTrue(tails.isEmpty());

        l.publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 1, 1, tick);
        assertEquals(1, tails.size());
        assertEquals(0, l.dropped());
    }

    @Test
    void throwerInAnotherWorldSendsDistanceNull() {
        World nether = stub(World.class, "getName", "nether");
        online.put(THROWER_ID, stub(Player.class, "getName", "Thrower", "getUniqueId", THROWER_ID, "getWorld", nether,
                "getLocation", at(0, 0)));

        listener(sink, true).publish("world", "Picker", at(0, 0), THROWER_ID, "cobblestone", 1, 1, tick);

        JsonObject json = parse(bodies.get(0));
        assertEquals("Thrower", json.get("thrower").getAsString());
        assertTrue(json.get("distance").isJsonNull());
    }

    @Test
    void aNonPlayerPickupSendsNothing() {
        LivingEntity mob = stub(LivingEntity.class);
        EntityPickupItemEvent event = new EntityPickupItemEvent(mob, item(THROWER_ID, 1), 0);

        listener(sink, true).onPickup(event);

        assertTrue(tails.isEmpty());
    }

    @Test
    void flagOffOrNullSinkSendsNothing() {
        Player picker = player("Picker", PICKER_ID, 0, 0);
        EntityPickupItemEvent event = new EntityPickupItemEvent(picker, item(THROWER_ID, 1), 0);

        listener(sink, false).onPickup(event);
        listener(null, true).onPickup(event);

        assertTrue(tails.isEmpty());
    }

    @Test
    void pickupJsonWritesExactlyTheNineKeysWithNullsAsJsonNull() {
        String json = PickupProvenanceListener.pickupJson("w", "p", null, "stone", 1, 2, null, 3L);

        JsonObject o = parse(json);
        assertEquals(Set.of("kind", "world", "picker", "thrower", "item", "count", "age_ticks", "distance", "tick"),
                o.keySet());
        assertEquals("pickup", o.get("kind").getAsString());
        assertTrue(o.get("thrower").isJsonNull());
        assertTrue(o.get("distance").isJsonNull());
        assertEquals(3L, o.get("tick").getAsLong());
        assertFalse(o.get("count").isJsonNull());
    }
}
