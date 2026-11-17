# NeoForge 26.1.2 server-side mod API notes

Date 2026-11-16. Author: geldar-docs research. Status: reference; each item tagged VERIFIED (read in the 26.1 docs, the 26.1.x branch source, or the 26.1 porting primer) or UNVERIFIED (not read, or only older knowledge). Target: NeoForge 26.1.2 (build 26.1.2.126), Java 25, ModDevGradle 2.0.148, Gradle 9.1+, official Mojang names, no obfuscation.

Sources (short names used below):
- DOCS = https://docs.neoforged.net/docs/ (26.1 pages)
- SRC = https://github.com/neoforged/NeoForge, branch `26.1.x` (read as raw files; its own gradle.properties says minecraft_version=26.1.2, java_version=25, MDG 2.0.140)
- PRIMER = https://github.com/neoforged/.github/blob/main/primers/26.1/index.md (5038 lines)
- NEWS = https://neoforged.net/news/26.1release/
- MDG = https://docs.neoforged.net/toolchain/docs/plugins/mdg/

Naming note (VERIFIED, PRIMER): `ResourceLocation` is now `Identifier` (`Identifier.fromNamespaceAndPath("ns", "path")`). `DimensionDataStorage` is now `SavedDataStorage`.

## 1. Mod entry, side, vanilla clients

Entry point, dedicated-server-only (VERIFIED, DOCS concepts/sides):
```java
@Mod(value = "examplemod", dist = Dist.DEDICATED_SERVER)
public class ExampleModDedicatedServer {
    public ExampleModDedicatedServer(IEventBus modBus, ModContainer container) { }
}
```
- `@Mod` loads on both sides unless `dist` is set. Constructor params may include `IEventBus`, `ModContainer`, `Dist`. Physical side: `FMLEnvironment#getDist()`; logical side: `Level#isClientSide()`.
- The docs warn to test on a real dedicated server, because singleplayer hides missing-class errors. Keep shared code out of client classes.

neoforge.mods.toml (VERIFIED, DOCS gettingstarted/modfiles), path `src/main/resources/META-INF/neoforge.mods.toml`:
```toml
modLoader="javafml"
loaderVersion="[1,)"
license="MIT"
[[mods]]
modId="examplemod"
version="${file.jarVersion}"
displayName="Example"
[[dependencies.examplemod]]
modId="neoforge"
type="required"
versionRange="[26.1.2,)"
ordering="NONE"
side="BOTH"
```
- The only side field in the toml is `side` (`CLIENT`, `SERVER`, `BOTH`) inside `[[dependencies.<modid>]]`; it says where the dependency must be present. The page documents no top-level "server only" flag. The `dist` parameter on `@Mod` is the documented way. The loaderVersion value is a sketch; check the template MDG generates.
- `displayTest` and `acceptableRemoteVersions`: DOCS modfiles mentions neither. UNVERIFIED that any equivalent exists in 26.1 (they were Forge-era fields).

Do vanilla clients get in? Read from SRC `network/registration/NetworkRegistry.java` (`initializeOtherConnection`; source VERIFIED, conclusion is inference):
- When a client does not announce NeoForge, the server runs `NetworkComponentNegotiator.negotiate(<all registered payloads>, <empty client list>)` per protocol. On failure it disconnects with "neoforge.network.negotiation.failure.vanilla.client.not_supported". Registrations flagged `optional` do not cause failure. So a mod that registers no payloads (or only optional ones) is accepted from vanilla clients.
- `PayloadRegistrar` carries an `optional` flag (`PayloadRegistrar(String version)`); the javadoc says "Any connection with missing non-optional payloads is denied". The public method that sets it was not read: UNVERIFIED (older docs call it `registrar.optional()`).
- DOCS networking/payload (VERIFIED): `event.registrar("1")` from `RegisterPayloadHandlersEvent`; methods are `play*`, `configuration*`, `common*` crossed with `*Bidirectional`, `*ToClient`, `*ToServer`; client handlers go through `RegisterClientPayloadHandlersEvent`. Limits: 1 MiB to client, under 32 KiB to server. For Geldar, register no payloads.
- Registry sync with vanilla clients (added blocks, items, entity types): UNVERIFIED. Register no new registry entries; use only data (advancements, recipes, loot) and commands.
- The older `docs/networking/payload-registration` URL is 404; use `docs/networking/payload/`.

## 2. Events (game bus, `NeoForge.EVENT_BUS`)

Registering (VERIFIED, DOCS concepts/events):
```java
@EventBusSubscriber(modid = "examplemod")
public class Handlers {
    @SubscribeEvent
    public static void onBreak(BreakBlockEvent event) { }
}
```
Or `NeoForge.EVENT_BUS.addListener(Handlers::onBreak)` in the constructor. With `@EventBusSubscriber`, handlers must be static; each event goes to the right bus automatically. Priority: `@SubscribeEvent(priority = EventPriority.LOW)`. Cancel with `ICancellableEvent#setCanceled(true)`.

Classes below were read in SRC under `src/main/java/net/neoforged/neoforge/event/` (VERIFIED unless noted):

| Need | Class (package under event/) | Accessors read |
|---|---|---|
| Block break | `level.block.BreakBlockEvent` (extends `BlockEvent`, cancellable) | `getPlayer()`, `getLevel()`, `getPos()`, `getState()`, `setNotifyClient(boolean)` |
| Block place | `level.BlockEvent.EntityPlaceEvent` (cancellable); `EntityMultiPlaceEvent` extends it | `getEntity()`, `getBlockSnapshot()`, `getPlacedBlock()`, `getPlacedAgainst()` |
| Item crafted | `entity.player.PlayerEvent.ItemCraftedEvent` | `getEntity()` (Player), `getCrafting()` (ItemStack) |
| Item smelted | `PlayerEvent.ItemSmeltedEvent` | `getSmelting()` |
| Join / leave | `PlayerEvent.PlayerLoggedInEvent`, `PlayerLoggedOutEvent` | `getEntity()` |
| Respawn / dimension | `PlayerEvent.PlayerRespawnEvent`, `PlayerChangedDimensionEvent` | named in the class javadoc |
| Chat | `ServerChatEvent` (cancellable, logical server only) | `getPlayer()` (ServerPlayer), `getUsername()`, `getRawText()`, `getMessage()` |
| Death | `entity.living.LivingDeathEvent` (cancellable) | `getEntity()`, `getSource()` (DamageSource) |
| Container | `entity.player.PlayerContainerEvent.Open` / `.Close` | `getEntity()`, `getContainer()` (AbstractContainerMenu) |
| Server tick | `tick.ServerTickEvent.Pre` / `.Post` | `getServer()` |
| Commands | `RegisterCommandsEvent` | `getDispatcher()`, `getCommandSelection()`, `getBuildContext()` |
| Advancement | `entity.player.AdvancementEvent.AdvancementEarnEvent`, `AdvancementProgressEvent` | `getAdvancement()` (AdvancementHolder); progress: `getCriterionName()`, `getProgressType()` |
| Server lifecycle | `server.ServerStartingEvent`, `ServerStartedEvent`, `ServerStoppingEvent`, `ServerStoppedEvent` | class names present in the file tree; accessors not read |

Pitfalls found:
- There is NO `BlockEvent.BreakEvent` in the 26.1.x source. `BlockEvent` only has `EntityPlaceEvent`, `EntityMultiPlaceEvent`, `NeighborNotifyEvent`, `FluidPlaceBlockEvent`, `FarmlandTrampleEvent`, `PortalSpawnEvent`, `BlockToolModificationEvent`. Break is the new `BreakBlockEvent`, fired on client and server; check `!getLevel().isClientSide()`. Its javadoc says it can arrive already cancelled, and un-cancelling does not always permit the break.
- `ItemCraftedEvent` exposes the crafted stack and a craft matrix `Container` (constructor `(Player, ItemStack, Container)`), not the recipe. Whether the recipe id is obtainable from it: UNVERIFIED.
- Player death: use `LivingDeathEvent` and test `event.getEntity() instanceof ServerPlayer`. A dedicated player-death event was not seen.
- Dedicated-only lifecycle event `FMLDedicatedServerSetupEvent` exists (VERIFIED, DOCS events), mod bus.

## 3. Saved data (VERIFIED, DOCS datastorage/saveddata and PRIMER "Splitting the Primary Level Data into Saved Data")

26.1 pattern: `SavedData` subclass plus a static `SavedDataType` (id, default constructor, codec, data fixer type). From DOCS:
```java
public class CounterData extends SavedData {
    public static final SavedDataType<CounterData> TYPE = new SavedDataType<>(
        Identifier.fromNamespaceAndPath("examplemod", "counter"),
        CounterData::new,                       // used when no file exists
        RecordCodecBuilder.create(inst -> inst.group(
            Codec.INT.fieldOf("count").forGetter(d -> d.count)
        ).apply(inst, CounterData::new))
    );
    private int count;
    public CounterData() { this(0); }
    public CounterData(int count) { this.count = count; }
    public void increment() { count++; setDirty(); }   // without setDirty nothing is written
}
CounterData d = server.getDataStorage().computeIfAbsent(CounterData.TYPE);
```
- The PRIMER version has a fourth constructor argument, the data fixer type: `null` ("either some patched enum value or null depending on mod loader implementation"). The DOCS sketch shows three. Which compiles on 26.1.2 is UNVERIFIED; try three, add `null` if the compiler asks.
- Storage class is `SavedDataStorage` (was `DimensionDataStorage`). Global data: `MinecraftServer#getDataStorage()`; per level: `ServerLevel#getDataStorage()` (also on `ServerChunkCache`). The PRIMER says global data belongs on the server instance, not the overworld.
- Files: global `<world>/data/<namespace>/<path>.dat`; per level `<world>/dimensions/<ns>/<path>/data/<namespace>/<path>.dat`. The id may contain subdirectories.
- Per-world map keyed by UUID: no page shows it. Sketch (UNVERIFIED, compile-check): codec `Codec.unboundedMap(UUIDUtil.STRING_CODEC, valueCodec)` inside a record codec with `fieldOf("entries")`, a mutable copy (`new HashMap<>(map)`) in the constructor, and `setDirty()` on every mutation. The name `UUIDUtil.STRING_CODEC` is UNVERIFIED.

## 4. Advancements and recipe gating

- Data-driven advancements: JSON under `data/<ns>/advancement/` (singular folder since 1.21). UNVERIFIED for 26.1 (the DOCS server advancement page redirected and was not read). A datapack inside the mod jar works server-side with no client mod.
- Granting: vanilla `PlayerAdvancements#award(AdvancementHolder, String criterion)` exists and NeoForge hooks it with `EventHooks.onAdvancementEarnedEvent` (VERIFIED, SRC patch `PlayerAdvancements.java.patch`). Reaching it via `serverPlayer.getAdvancements()` and the holder via `server.getAdvancements().get(id)`, and `revoke(holder, criterion)`: UNVERIFIED for 26.1.
- Recipe book: `ServerPlayer#awardRecipes(...)` and `resetRecipes(...)` did not appear in the SRC patch grep: UNVERIFIED for 26.1. The PRIMER has recipe builder changes (around line 1379), not read in detail.
- Gating crafting without a client mod: nothing documented was read. `ItemCraftedEvent` extends `PlayerEvent` and is not `ICancellableEvent` in the source read, so it cannot cancel; it can only react after the fact. Options, all UNVERIFIED: remove or override recipes through a datapack, recipe conditions, or controlling the recipe book. Test on the shard before relying on any.

## 5. NATS from a mod

- ModDevGradle jar-in-jar (VERIFIED, MDG): the `jarJar` configuration:
```groovy
dependencies {
    implementation("io.nats:jnats:2.26.4")
    jarJar(implementation("io.nats:jnats")) {
        version { strictly '[2.26,3)'; prefer '2.26.4' }
    }
}
```
- Since Minecraft 1.21.9, dev runs need no `additionalRuntimeClasspath` (VERIFIED, MDG). jnats 2.26.4 is what plugin/core uses (from the brief, not re-checked). Jar-in-jar wants strict version ranges. Shadow relocation as an alternative: UNVERIFIED for 26.1.
- Whether jnats (its transitive deps, signed jars, module layout) loads cleanly under the NeoForge module layer: UNVERIFIED; prove it with a `runServer` smoke.

## 6. Config (VERIFIED, DOCS misc/config)
```java
static {
    Pair<MyCfg, ModConfigSpec> p = new ModConfigSpec.Builder().configure(MyCfg::new);
    CONFIG = p.getLeft(); SPEC = p.getRight();
}
// in the mod constructor:
container.registerConfig(ModConfig.Type.SERVER, SPEC);
```
- Values are defined with `builder.define("key", default)` in the config class constructor; read with `ConfigValue#get`.
- SERVER configs load just before `ServerAboutToStartEvent`; do not read them earlier. File: `config/<modid>-server.toml`; per-world override in `<world>/serverconfig`.
- `ModConfigEvent.Loading` / `Reloading` / `Unloading` are mod-bus events for all of the mod's configs; check which `ModConfig` fired.

## 7. Dev server, tests, CI

- Run types (VERIFIED, MDG): `client`, `data`, `gameTestServer`, `server`; shorthand `server()`. A run named `server` gives a Gradle task of the run name (`runServer`); exact task names for this build are UNVERIFIED. EULA: MDG page silent, UNVERIFIED; write `eula=true` to `eula.txt` in the run directory.
- GameTest (VERIFIED, DOCS misc/gametest): the 26.1 page documents NO `@GameTest` annotation. Test functions are `Consumer<GameTestHelper>` registered in `BuiltInRegistries.TEST_FUNCTION` (a `DeferredRegister`), plus a structure at `data/<ns>/structure/<name>.nbt`, plus `RegisterGameTestsEvent` (mod bus):
```java
event.registerTest(id, new FunctionGameTestInstance(EXAMPLE_FUNCTION.getKey(),
    new TestData<>(environmentHolder, Identifier.fromNamespaceAndPath("examplemod", "example_structure"),
        400, 50, true, Rotation.NONE, false, 1, 1, false)));
```
  Helper calls: `helper.succeedIf(() -> ...)`, `succeedWhen`, `succeedOnTickWhen`, `runAfterDelay`. Environments: `event.registerEnvironment(id, new TestEnvironmentDefinition.Weather(...))`. Tests run every tick until success, so a check must fail on earlier ticks.
- Run: `gradlew runGameTestServer` (VERIFIED). "The build server returns an exit code of the number of required, failed Game Tests." Enable in other runs with property `neoforge.enableGameTest=true`. No CI example on the page; running that task in a Linux job and failing on non-zero exit follows from the exit-code statement (inference). It needs no client.
- Unit tests (VERIFIED, MDG): `neoForge { unitTest { enable(); testedMod = mods.<name> } }`, then `@Test` under `src/test`; server-backed tests need `testImplementation "net.neoforged:testframework:<neoforge version>"` and `@ExtendWith(EphemeralTestServerProvider.class)`. That class's package was not given: UNVERIFIED.
- Plain JUnit on pure logic (no Minecraft classes) is the cheapest headless test and needs none of the above.

## 8. Mixins

- NeoForge itself ships Mixin: SRC has `src/main/resources/neoforge.mixins.json` and accessor mixins `BlockEntityTypeAccessor`, `MappedRegistryAccessor` in package `net.neoforged.neoforge.mixins` (VERIFIED), with `"required": true`, `"minVersion": "0.8"`, `"injectors": {"defaultRequire": 1}`.
- A mod config of the same shape, `src/main/resources/<modid>.mixins.json` (`package`, `mixins`, `client`, `server`, `compatibilityLevel`), declared in the toml with `[[mixins]] config="<modid>.mixins.json"`. The `[[mixins]]` table is UNVERIFIED for 26.1 (the MDG page says nothing on mixins; the modfiles page does not list it). `compatibilityLevel` for Java 25: UNVERIFIED (try `JAVA_25`, fall back to `JAVA_21`).
- With obfuscation removed, mixin targets use the real Mojang class names; no refmap mapping is needed (inference from NEWS).

## 9. Tick time per dimension

- VERIFIED (SRC patch `MinecraftServer.java.patch`): NeoForge keeps `Map<ResourceKey<Level>, long[]> perWorldTickTimes` (ring buffer of 100 nanosecond values indexed by `tickCount % 100`) and exposes `public long[] getTickTime(ResourceKey<Level> dim)` (may be null for an unknown dimension). Average it yourself: sum / length / 1e6 gives milliseconds. A buffer not yet full is zero-filled.
- The patch also shows vanilla fields `nextTickTimeNanos` and `smoothedTickTimeMillis` (smoothing 0.8 old + 0.2 new). A method named `getAverageTickTimeNanos` was not found in the patch: UNVERIFIED. Prefer `getTickTime(dim)`. Overall MSPT is also derivable from `ServerTickEvent.Pre` / `Post` with `System.nanoTime()`.

## 10. 26.1 breaking changes to avoid (VERIFIED, NEWS)

- Requirements: Java 25, Gradle 9.1.0+, MDG 2.0.141+ at the time of writing (the brief pins 2.0.148). Versions have four components, e.g. `26.1.0.10-beta`; `-beta` means breaking changes are allowed. NeoForm versions are `<mc>-<build>`.
- No obfuscation: official Mojang parameter names; Parchment not needed.
- `ItemStack` creation needs loaded registries. Data files use `ItemStackTemplate` (empty is `null`): `template.create()`, `ItemStackTemplate.fromNonEmptyStack(stack)`. Do not build `ItemStack`s in static initializers or the mod constructor. Same for `FluidStack` / `FluidStackTemplate`. Helper: `ItemStack#isSameItemSameComponents(stack, template)`.
- `GuiGraphics` renamed `GuiGraphicsExtractor`; `Screen#render` is `extractRenderState` (client only; irrelevant to a server mod).
- `ChunkPos`: `new ChunkPos(BlockPos)` becomes `ChunkPos.containing(blockPos)`; `ChunkPos.asLong(...)` becomes `ChunkPos.pack(...)`; `new ChunkPos(long)` becomes `ChunkPos.unpack(long)`.
- Also (PRIMER and SRC): `ResourceLocation` is `Identifier`; `DimensionDataStorage` is `SavedDataStorage`; `BlockEvent.BreakEvent` is gone in favour of `BreakBlockEvent`.
- Game tests are registry-based (section 7). World clocks and timelines are new in the PRIMER (`WORLD_CLOCK` registry); which day-time calls remain is UNVERIFIED.
- The PRIMER is 5038 lines; only the saved-data, gametest and identifier parts were read. Search it by class name before porting any vanilla call.

## Not verified

1. `SavedDataType` constructor arity on 26.1.2 (3 arguments in DOCS, 4 with data fixer in PRIMER) and the `UUIDUtil.STRING_CODEC` name for the UUID-keyed map.
2. Server-side crafting gating: no cancellable craft event found; recipe conditions and datapack override paths unread. Also `ServerPlayer#awardRecipes` / `resetRecipes`, `PlayerAdvancements#revoke` and `getAdvancements()` names on 26.1.
3. Behaviour for vanilla clients when a server-only mod adds registry entries; the `[[mixins]]` toml table; the public `optional` registrar method; any `displayTest` / `acceptableRemoteVersions` equivalent (likely none).
4. Vanilla `getAverageTickTimeNanos` (use NeoForge `getTickTime(ResourceKey<Level>)`).
5. jnats loading under the NeoForge module layer; shadow relocation.
6. Exact `runServer` / `runGameTestServer` task names for this build, EULA handling, the `EphemeralTestServerProvider` package, and the Mixin `compatibilityLevel` for Java 25.
7. Data-driven advancement folder name and JSON format on 26.1.
