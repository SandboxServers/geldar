package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.networknt.schema.InputFormat;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaRegistryConfig;
import com.networknt.schema.SpecificationVersion;
import dev.geldar.core.blockowner.OwnerCache.Pos;
import dev.geldar.core.blockowner.OwnerSource.OwnedBlock;
import dev.geldar.core.blockowner.OwnerSource.Owners;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.block.Container;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.inventory.InventoryHolder;
import org.junit.jupiter.api.Test;

/**
 * The container take listener, driven through its package-private seams: a click is one call, and the queued next-tick
 * task is run by hand. Bukkit stacks cannot be built outside a server, so the Bukkit read is only the counts map.
 */
class ContainerTakeListenerTest {
    private static final String BASE = "https://geldar.dev/schemas/";
    private static final Schema PROVENANCE = loadProvenanceSchema();
    private static final String OWNER = "ag_kestrel_01";
    private static final String ACTOR = "ag_wren_02";
    private static final Pos CHEST = new Pos("world", 10, 64, -3);

    private final List<String> sent = new ArrayList<>();
    private final ProvenanceSink sink = (tail, json) -> sent.add(tail + " " + json);
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicLong clock = new AtomicLong(1_000L);
    private final AtomicLong tick = new AtomicLong(50L);
    private final OwnerCache cache = new OwnerCache(clock::get);
    private final List<Runnable> nextTick = new ArrayList<>();
    private final ContainerTakeListener listener =
            new ContainerTakeListener(sink, cache, enabled::get, tick::get, nextTick::add);

    private static Schema loadProvenanceSchema() {
        Path dir = Path.of(System.getProperty("geldar.schemas")).toAbsolutePath().normalize();
        SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
                SpecificationVersion.DRAFT_2020_12,
                builder -> builder
                        .schemas(id -> readSchema(dir, id))
                        .schemaRegistryConfig(
                                SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build()));
        return registry.getSchema(SchemaLocation.of(BASE + "provenance.schema.json"));
    }

    private static String readSchema(Path dir, String id) {
        if (!id.startsWith(BASE)) {
            return null;
        }
        try {
            return Files.readString(dir.resolve(id.substring(BASE.length())));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private void storeOwner(String owner) {
        cache.storeBase(
                OwnerCache.chunkOf(CHEST),
                new Owners(List.of(new OwnedBlock(CHEST.x(), CHEST.y(), CHEST.z(), owner, "chest")), false));
    }

    private void click(String actor, Map<String, Integer> before, Map<String, Integer> after) {
        listener.clicked(actor, CHEST, before, () -> after);
    }

    private void runNextTick() {
        List<Runnable> due = List.copyOf(nextTick);
        nextTick.clear();
        due.forEach(Runnable::run);
    }

    private JsonObject take(int index) {
        String line = sent.get(index);
        assertTrue(line.startsWith("take "), line);
        return JsonParser.parseString(line.substring("take ".length())).getAsJsonObject();
    }

    @Test
    void aShiftClickTakeOfAFullStackSendsOneTakeWithTheStackCount() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        runNextTick();

        assertEquals(1, sent.size());
        JsonObject body = take(0);
        assertEquals(ACTOR, body.get("actor").getAsString());
        assertEquals(OWNER, body.get("prior_owner").getAsString());
        assertEquals("diamond", body.get("item").getAsString());
        assertEquals(64, body.get("count").getAsInt());
        assertEquals("world", body.get("world").getAsString());
        assertEquals(10, body.get("x").getAsInt());
        assertEquals(-3, body.get("z").getAsInt());
    }

    @Test
    void aTakeFromAnotherPlayersChestNamesThatOwner() {
        storeOwner("ag_other_09");
        click(ACTOR, Map.of("iron_ingot", 3), Map.of());
        runNextTick();

        assertEquals("ag_other_09", take(0).get("prior_owner").getAsString());
    }

    @Test
    void aCacheMissIsANullPriorOwnerAndStillSends() {
        click(ACTOR, Map.of("stone", 2), Map.of());
        runNextTick();

        assertEquals(1, sent.size());
        assertTrue(take(0).get("prior_owner").isJsonNull());
    }

    @Test
    void openingAContainerWithoutTakingSendsNothing() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 64), Map.of("diamond", 64));
        runNextTick();

        assertTrue(sent.isEmpty());
    }

    @Test
    void aDepositSendsNothing() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("stone", 1), Map.of("stone", 2));
        runNextTick();

        assertTrue(sent.isEmpty());
    }

    @Test
    void aHumanPlayerSendsNothing() {
        storeOwner(OWNER);
        click("Steve", Map.of("diamond", 64), Map.of());
        assertTrue(nextTick.isEmpty());
        runNextTick();

        assertTrue(sent.isEmpty());
    }

    @Test
    void theClickTimeOwnerWinsWhenTheOwnerChangesBeforeTheNextTick() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 1), Map.of());
        cache.recordChange(CHEST, "ag_other_09");
        runNextTick();

        assertEquals(OWNER, take(0).get("prior_owner").getAsString());
    }

    @Test
    void thePerTickCapDropsTheRestAndTheNextTickStartsAgain() {
        for (int i = 0; i < ContainerTakeListener.PER_TICK_CAP + 6; i++) {
            listener.clicked(ACTOR, new Pos("world", i, 64, 0), Map.of("stone", 1), Map::of);
        }
        runNextTick();
        assertEquals(ContainerTakeListener.PER_TICK_CAP, sent.size());
        assertEquals(6, listener.dropped());

        tick.set(51L);
        listener.clicked(ACTOR, new Pos("world", 999, 64, 0), Map.of("stone", 1), Map::of);
        runNextTick();
        assertEquals(ContainerTakeListener.PER_TICK_CAP + 1, sent.size());
    }

    @Test
    void theSameActorAndChestInOneTickCountsTheTakeOnce() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("stone", 128), Map.of());
        click(ACTOR, Map.of("stone", 64), Map.of());
        assertEquals(1, nextTick.size());
        runNextTick();

        assertEquals(1, sent.size());
        assertEquals(128, take(0).get("count").getAsInt());
    }

    @Test
    void aTakeIsSettledOnTheNextTickNotAtTheClick() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        assertTrue(sent.isEmpty());
        assertEquals(1, nextTick.size());

        runNextTick();
        assertEquals(1, sent.size());
    }

    @Test
    void aTakeAboveTheSchemaMaximumIsClampedToIt() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("stone", 3000), Map.of());
        runNextTick();

        assertEquals(2304, take(0).get("count").getAsInt());
        assertTrue(PROVENANCE.validate(sent.get(0).substring("take ".length()), InputFormat.JSON).isEmpty());
    }

    @Test
    void anOwnContainerNamesTheActorAsThePriorOwner() {
        storeOwner(ACTOR);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        runNextTick();

        assertEquals(ACTOR, take(0).get("prior_owner").getAsString());
    }

    @Test
    void aTakeAfterTheListenerIsSwitchedOffBeforeTheTickSendsNothing() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        enabled.set(false);
        runNextTick();

        assertTrue(sent.isEmpty());
    }

    @Test
    void aClickWhileDisabledOrWithoutASinkSchedulesNothing() {
        enabled.set(false);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        assertTrue(nextTick.isEmpty());

        enabled.set(true);
        ContainerTakeListener noSink = new ContainerTakeListener(null, cache, enabled::get, tick::get, nextTick::add);
        noSink.clicked(ACTOR, CHEST, Map.of("diamond", 64), Map::of);
        assertTrue(nextTick.isEmpty());
    }

    @Test
    void settleWithoutASinkSendsNothingAndDoesNotThrow() {
        ContainerTakeListener noSink = new ContainerTakeListener(null, cache, enabled::get, tick::get, nextTick::add);
        noSink.settle(ACTOR, CHEST, OWNER, Map.of("diamond", 64), Map.of());

        assertTrue(sent.isEmpty());
    }

    @Test
    void onlyAPlayerClickingALocatedStorageHolderIsATakeSource() {
        assertTrue(ContainerTakeListener.isTakeSource(true, true, true));
    }

    @Test
    void aNonPlayerClickSendsNothing() {
        assertFalse(ContainerTakeListener.isTakeSource(false, true, true));
    }

    @Test
    void aClickWithNoLocationSendsNothing() {
        assertFalse(ContainerTakeListener.isTakeSource(true, false, true));
    }

    @Test
    void aClickOnANonStorageMenuSendsNothing() {
        assertFalse(ContainerTakeListener.isTakeSource(true, true, false));
        assertTrue(ContainerTakeListener.isStorage(holderOf(Container.class)));
        assertFalse(ContainerTakeListener.isStorage(holderOf(InventoryHolder.class)));
        assertFalse(ContainerTakeListener.isStorage(null));
    }

    @Test
    void twoStacksOfOneItemAddUp() {
        Map<String, Integer> counts = ContainerTakeListener.countsOf(
                List.of(Map.entry("stone", 64), Map.entry("stone", 64), Map.entry("dirt", 3)));

        assertEquals(Map.of("stone", 128, "dirt", 3), counts);
    }

    private static Object holderOf(Class<?> type) {
        return Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, (proxy, method, args) -> null);
    }

    @Test
    void aDisabledListenerOrANullSinkSendsNothing() {
        enabled.set(false);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        runNextTick();
        assertTrue(sent.isEmpty());

        enabled.set(true);
        ContainerTakeListener noSink = new ContainerTakeListener(null, cache, enabled::get, tick::get, nextTick::add);
        noSink.clicked(ACTOR, CHEST, Map.of("diamond", 64), Map::of);
        runNextTick();
        assertTrue(sent.isEmpty());
    }

    @Test
    void theTakePayloadValidatesAgainstTheLiveProvenanceSchema() {
        storeOwner(OWNER);
        click(ACTOR, Map.of("diamond", 64), Map.of());
        runNextTick();

        assertTrue(PROVENANCE.validate(sent.get(0).substring("take ".length()), InputFormat.JSON).isEmpty());
        assertFalse(PROVENANCE.validate("{\"world\":\"world\"}", InputFormat.JSON).isEmpty());
    }

    @Test
    void onClickIsAMonitorHandlerThatIgnoresCancelledClicks() throws NoSuchMethodException {
        Method onClick = ContainerTakeListener.class.getMethod("onClick", InventoryClickEvent.class);
        EventHandler handler = onClick.getAnnotation(EventHandler.class);

        assertEquals(EventPriority.MONITOR, handler.priority());
        assertTrue(handler.ignoreCancelled());
    }
}
