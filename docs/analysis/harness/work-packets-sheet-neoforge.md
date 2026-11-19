# Sheet cards, NeoForge twins: provenance, combat facts and their wiring on the NeoForge shard

Status: **proposal, nothing dispatched.** Written 2026-11-18 against geldar `origin/main` = `a8063b0a`. Why these cards exist and which cards need no twin: [../sheet/neoforge-delta.md](../sheet/neoforge-delta.md). The Paper cards they twin are in [work-packets-sheet-w3-w5.md](work-packets-sheet-w3-w5.md) (W5) and [work-packets-sheet-w6-w8.md](work-packets-sheet-w6-w8.md) (W8); those stay as written for the Paper shard.

Every card here is **BlockedDependency** or **BlockedDecision** until its prerequisites merge. A coder (Haiku, low effort) implements a card exactly as written. Nothing here is a judgment call: where a fact is not known, the card says **STOP** and what to report.

**Facts every card respects.**

- Repo: **geldar**. Area: `neoforge/` (the server-side NeoForge 26.1.2 (build 126) mod `geldar_neoforge`, Java 25). It consumes `plugin/core-common` as a composite build and packs it in its jar (`neoforge/README.md`, "Shared code and jnats"). No card here edits `plugin/`.
- `neoforge/` belongs to the NeoForge campaign (session geldar-neoforge). The orchestrator messages that campaign before dispatching any card here; the cards edit only the files they list.
- The mod is **server-side only**: no registry entries, no payloads, no mixins, no chat. `neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java` fails the build if any of these strings appears anywhere in `neoforge/src/main` or `plugin/core-common/src/main` (code **and comments**, case-insensitive): `DeferredRegister`, `RegisterEvent`, `registerPayload`, `PayloadRegistrar`, `RegisterPayloadHandlersEvent`, `CustomPacketPayload`, `.registrar(`, `playToClient`, `playToServer`, `playBidirectional`, `DeferredHolder`, `DeferredBlock`, `DeferredItem`, `BuiltInRegistries`, `Registry.register`, `NetworkRegistry`, `RegistryObject`, `ChatEvent`, `ChatReceivedEvent`, `PlayerChatMessage`, `ServerChatEvent`, `ChatType`, `CommandEvent`, `broadcastChatMessage`, `handleChat`, `name mask`, `name_mask`, `namemask`, `name-mask`, `name.mask`, `chat_export`, `chatexport`, `chat-export`, `chat.export`, `chat.enabled`. Never type any of them.
- **No human name leaves the server.** The NeoForge shard is human-directed (decision 0387, Proposed). A name goes into a message only when `dev.geldar.core.EventEnvelope.isLifeId(name)` is true (pattern `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`); otherwise that field is `null`. This is the rule the merged export already keeps (`neoforge/README.md`, "Privacy"). OD-NF-1 may change it later; the code ships off either way.
- **Off by default.** Everything here runs only when the export is on (`export.enabled`) **and** the new key `provenance.enabled` is true. Off registers no listener.
- No new dependency. No change to `neoforge/build.gradle.kts`, `neoforge/gradle.lockfile`, `neoforge/gradle/verification-metadata.xml` or any lock file. A card that seems to need one: STOP.
- Never start a server: no `./gradlew runServer`, no `runGameTestServer`, no `shard up`, no `adam up`, no live NATS. Real-server checks are ops, serial, after the owner's go.

## Dependency table

Prerequisites outside this file (defined in [../sheet/neoforge-delta.md](../sheet/neoforge-delta.md) sections 3 to 5): **P3-LIVE** (P3-6 merged and its scratch run passed), **P4** (NeoForge block-owner log with the section 4 requirements), **A1 to A4** (amendments to the Paper cards, merged with them), **NF-BODY** (a NeoForge Body role).

| Card | Wave | Depends on | Status | Fan-out |
|---|---|---|---|---|
| AN-NF-00 evidence config, bus, world names, setup skeleton | W5-NF | P3-1 to P3-3 (merged), AN-24 merged (wave order) | BlockedDependency (AN-24) | unblocks every other card |
| AN-NF-27a break provenance | W5-NF | AN-NF-00, AN-27a with A1, A2, A4 | BlockedDependency (AN-27a, P4 for merge) | parallel with 26a, 47a |
| AN-NF-26a pickup provenance | W5-NF | AN-NF-00, AN-26a with A1, A2 | BlockedDependency (AN-26a, P4 for merge) | parallel with 27a, 47a |
| AN-NF-28b W5 wiring and NeoForge NATS rows | W5-NF | AN-NF-26a, AN-NF-27a, P4 | BlockedDependency (P4) | integration, last of W5-NF |
| AN-NF-47a combat facts and combat provenance | W8-NF | AN-NF-00, AN-46, AN-47a with A1 to A3, P3-LIVE | BlockedDependency (AN-46, AN-47a, P3-LIVE) | parallel with W5-NF cards once its deps merge |
| AN-NF-51a container-take provenance | W8-NF | OD-NF-3, AN-51a, P4 | **BlockedDecision** (OD-NF-3); not prescriptive | none |
| AN-NF-50 W8 wiring | W8-NF | AN-NF-47a, AN-NF-28b | BlockedDependency | integration, last |

Merge rule from the owner's delta-packet choice: a twin merges only after its P3 or P4 prerequisite has merged, even where its code could be written earlier. AN-NF-26a and AN-NF-27a can be coded once their Paper card merges, but merge after P4, because without P4 there is no NeoForge provenance publisher to wire them to.

## Shared files and who owns them

| Shared file | Owner in this file, in order | Everyone else |
|---|---|---|
| `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` | AN-NF-00 (adds one guarded call), then AN-NF-28b (adds one argument to that call) | read only. P4 (NeoForge campaign) also edits this file: P4 merges before AN-NF-28b |
| `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java` | AN-NF-00 creates it; AN-NF-28b, then AN-NF-50 add lines below its marker comment | AN-NF-26a, 27a, 47a write "index line to add" in their worknote |
| `EvidenceConfig.java`, `EvidenceBus.java`, `WorldNames.java`, `VanillaIds.java`, `ServerTicks.java` (same folder) | AN-NF-00 | read only |
| `neoforge/README.md` | AN-NF-00 adds the section "Sheet evidence (inactive)"; AN-NF-28b and AN-NF-50 append lines inside it | nobody else |
| `deploy/nats-auth-nf.ps1`, `tools/repo-checks/src/nats-auth-nf.test.ts` | AN-NF-28b | P4 and NF-BODY (NeoForge campaign) edit them too; serial, P4 first |
| `ExportListeners.java`, `ExportHandlers.java`, `EventMapping.java`, `ExportConfig.java`, `ExportLifecycle.java`, `NeoForgeFacts.java`, `NoRegistryScanTest.java`, `ExportListenersTest.java` | nobody (P3's files) | read only |
| `plugin/**`, `contract/**`, `golem/**`, `eventsink/**` | nobody | the Paper cards and AN-24, AN-46 own them |
| ledger, RESUME, `docs/decisions/**`, number registry | orchestrator, from "index line to add" | nobody |

## Shapes the twins rely on (created by the amended Paper cards, A1 to A4)

Step 0 of each card checks the lines it needs with `Select-String`. A missing line means STOP, report `blocked: <file> lacks <line>`.

```java
// A1, plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceSink.java
package dev.geldar.core.provenance;
public interface ProvenanceSink { void send(String tail, String json); }

// A2, plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java (a null argument is JSON null)
public static String breakJson(String world, int x, int y, int z, String actor, String priorOwner, String block, long tick)
public static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)
public static String combatJson(String world, String actor, String target, String kind, long tick)

// A4, plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java
public static String of(OwnerCache cache, OwnerCache.Pos pos)   // null on a miss; never a CoreProtect call

// A3, plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java
public final class EncounterTracker {
    public static final int FIGHT_END_TICKS = 200;
    public static final int MAX_OPEN = 512;
    public record Fact(String kind, String player, String mob, String encounterKey) {}   // kind: hostile_kill | fight_survived
    public record Step(String kind, String player, String mob) {}                      // kind: engaged
    public void playerHurtByMob(String player, String playerUuid, String mobUuid, String mobType, long tick)
    public Optional<Step> playerHitMob(String player, String playerUuid, String mobUuid, String mobType, long tick)
    public List<Fact> mobDied(String mobUuid, String mobType, String killer, String killerUuid, long tick)
    public void playerDied(String player, long tick)
    public List<Fact> advance(long tick)
}
// A3, plugin/core-common/src/main/java/dev/geldar/core/combat/HostileMobs.java
public static boolean isHostile(String mobType)   // mobType without namespace, the list of golem/src/perception/hostile-types.ts
```

## Rules common to every card

- **R1 size.** One Haiku coder, about 40k working tokens including reading, checks and the report. Past that, split at the card's split line.
- **R2 branch and worktree.** Branch `phase1/an-nf-<nn>-<slug>` (exact name on the card) from `origin/phase1/sheet-nf` (the orchestrator creates and pushes that wave branch before the first dispatch). Worktree `.claude/worktrees/an-nf-<nn>` in geldar; create it with `git worktree add .claude/worktrees/an-nf-<nn> -b <branch> origin/phase1/sheet-nf` if it does not exist. Never push, tag, open a PR or merge.
- **R3 worknote.** `docs/analysis/harness/worknotes/AN-NF-<nn>.md`: base SHA, each step done, each revert-check with the test that failed, every STOP with the exact message, and any "index line to add".
- **R4 commit.** The subject on the card, then the attribution lines the dispatch gives, verbatim. Commit each passing group of steps.
- **R5 on-cap.** Commit what passes, write the base SHA, the passing tests and the unfinished steps in the worknote, leave the branch clean, stop. Never weaken a test or invent a design.
- **R6 must-not-edit (every card).** `docs/spec.md`; accepted decisions; `plugin/**`; `contract/**`; `golem/**`; `eventsink/**`; `sql/**`; `prompts/**`; `compose/**`; `shards/**`; `geldar.ps1`; every `package.json`, `pnpm-lock.yaml`, `neoforge/build.gradle.kts`, `neoforge/settings.gradle.kts`, `neoforge/gradle.lockfile`, `neoforge/settings-gradle.lockfile`, `neoforge/gradle/**`; `neoforge-ledger/**`; other cards' worknotes; any file the card does not list under may-edit.
- **R7 GATE-NF** (run from the worktree root, in PowerShell, in this order):
  1. `git diff --check` prints nothing.
  2. For each test class the card names: `Push-Location neoforge; ./gradlew test --tests 'dev.geldar.neoforge.<Class>'; Pop-Location` passes.
  3. `Push-Location neoforge; ./gradlew build; Pop-Location` passes (it runs every neoforge test, `NoRegistryScanTest` included). The first build downloads NeoForge and can take several minutes. A network error: run it once more; a second network error: STOP, report `blocked: gradle network`.
  4. `./geldar.ps1 pnpm check:repo` passes (line caps: 500 soft, 700 hard).
  5. `git merge-tree --write-tree origin/phase1/sheet-nf HEAD` prints a tree id and no line containing `CONFLICT`.
- **R8 compile stops.** If `./gradlew` fails with `cannot find symbol`, `does not exist`, `cannot be applied to given types` or `incompatible types` on a NeoForge or Minecraft name that the card wrote, STOP. Report the exact compiler line in the worknote and in the return line (`blocked: compile <symbol>`). Do not try another name, cast or overload. Those names are the UNVERIFIED ones; the orchestrator rules on them.
- **R9 files.** Soft 500 lines, hard 700. No `Utils`, `Helpers` or similar class. LF line endings.
- **R10 revert-checks.** Each card lists them. For each: make the one edit, run the named test class (R7 step 2), confirm the named test fails, write its name in the worknote, then restore the file with `git checkout -- <path>` and rerun the class to confirm it passes.
- **R11 style.** Copy the style of `neoforge/src/main/java/dev/geldar/neoforge/ExportHandlers.java`: four-space indent, braces on every `if`, a javadoc line on every public class and method, no wildcard imports. Tests use JUnit 6 (`org.junit.jupiter.api.Test`, `Assertions`), as `ExportListenersTest.java` does. Parse JSON in tests with `com.google.gson.JsonParser.parseString(json).getAsJsonObject()`.

---

# Wave W5-NF

## AN-NF-00: evidence config, bus, world names and the setup skeleton

- **id** AN-NF-00. **wave** W5-NF. **repo** geldar. **twin of** none (unblocker). **depends-on** P3-1 to P3-3 (merged at `a8063b0a`), AN-24 merged (wave order only; nothing here imports it). **status** BlockedDependency (AN-24). **size** 35k. **branch** `phase1/an-nf-00-evidence-skeleton`. **worktree** `.claude/worktrees/an-nf-00`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/EvidenceConfig.java`, `EvidenceBus.java`, `WorldNames.java`, `VanillaIds.java`, `ServerTicks.java`, `EvidenceSetup.java`; new tests `neoforge/src/test/java/dev/geldar/neoforge/EvidenceConfigTest.java`, `WorldNamesTest.java`, `VanillaIdsTest.java`, `EvidenceSetupTest.java`; edit: `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` (one block, step 7), `neoforge/README.md` (one new section, step 8); the worknote.
- **must-not-edit** R6; every other file under `neoforge/`.
- **decisions** none new. Key names chosen here: `provenance.enabled` (the same key name as Paper's AN-28b) and environment `GELDAR_NEOFORGE_PROVENANCE`.
- **Step 0.** Run `Test-Path neoforge/src/main/java/dev/geldar/neoforge/ExportLifecycle.java` and `Test-Path neoforge/src/main/java/dev/geldar/neoforge/OperatorSink.java`. Both must print `True`; otherwise STOP (`blocked: P3 files missing`). Run `Select-String -Path neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java -SimpleMatch -Pattern 'startMaintenance(config, event);'`. It must print exactly one line; otherwise STOP (`blocked: GeldarNeoForge changed`).
- **Step 1.** Create `EvidenceConfig.java`:
  ```java
  package dev.geldar.neoforge;

  import java.io.IOException;
  import java.io.Reader;
  import java.nio.charset.StandardCharsets;
  import java.nio.file.Files;
  import java.nio.file.Path;
  import java.util.Properties;
  import java.util.function.Function;

  /**
   * Sheet evidence settings (character-sheet campaign, NeoForge twins). Off unless the export is on and
   * provenance.enabled is true. The environment wins over the file. Never throws.
   */
  public record EvidenceConfig(boolean provenance) {
      public static final String PROVENANCE_KEY = "provenance.enabled";
      public static final String PROVENANCE_ENV = "GELDAR_NEOFORGE_PROVENANCE";

      /** The off setting. */
      public static EvidenceConfig off() {
          return new EvidenceConfig(false);
      }

      /** Reads {@code file} (absent means no file) and the environment. Off when the export is off. */
      public static EvidenceConfig load(boolean exportEnabled, Path file, Function<String, String> env, OperatorSink log) {
          if (!exportEnabled) {
              return off();
          }
          return resolve(true, readFile(file, log), env);
      }

      static EvidenceConfig resolve(boolean exportEnabled, Properties file, Function<String, String> env) {
          if (!exportEnabled) {
              return off();
          }
          String value = first(env.apply(PROVENANCE_ENV), file.getProperty(PROVENANCE_KEY));
          return new EvidenceConfig("true".equalsIgnoreCase(value));
      }

      private static Properties readFile(Path file, OperatorSink log) {
          Properties props = new Properties();
          if (!Files.exists(file)) {
              return props;
          }
          try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
              props.load(reader);
              return props;
          } catch (IOException | IllegalArgumentException e) {
              log.warn("geldar_neoforge sheet evidence config cannot be read (" + e.getClass().getSimpleName() + ")");
              return new Properties();
          }
      }

      private static String first(String... values) {
          for (String value : values) {
              if (value != null && !value.isBlank()) {
                  return value.trim();
              }
          }
          return null;
      }
  }
  ```
- **Step 2.** Create `EvidenceBus.java`:
  ```java
  package dev.geldar.neoforge;

  import java.util.function.Consumer;
  import net.neoforged.bus.api.Event;
  import net.neoforged.bus.api.EventPriority;
  import net.neoforged.neoforge.common.NeoForge;

  /** The game bus for the sheet evidence listeners: lowest priority, cancelled events skipped. Tests record calls. */
  public interface EvidenceBus {
      /** Registers {@code handler} for {@code type} at the lowest priority; a cancelled event never reaches it. */
      <E extends Event> void listenLast(Class<E> type, Consumer<E> handler);

      /** The real bus. UNVERIFIED on 26.1: the addListener overload (priority, receiveCanceled, type, handler). */
      static EvidenceBus neoForge() {
          return new EvidenceBus() {
              @Override
              public <E extends Event> void listenLast(Class<E> type, Consumer<E> handler) {
                  NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, false, type, handler);
              }
          };
      }
  }
  ```
  If this file does not compile, R8 applies (STOP; do not change the overload).
- **Step 3.** Create `WorldNames.java`: a `public final class WorldNames` with a private constructor and `public static String of(String dimensionId)` that returns `"world"` for `"minecraft:overworld"`, `"world_nether"` for `"minecraft:the_nether"`, `"world_the_end"` for `"minecraft:the_end"`, and `null` for anything else, including `null`. Javadoc: "The Paper world name the Body uses for block owners (decision 0164; golem/src/body/block-owners.ts), or null for a dimension it does not name."
- **Step 4.** Create `VanillaIds.java`: a `public final class VanillaIds` with a private constructor, `public static final String PREFIX = "minecraft:";` and `public static String path(String id)`: returns `null` when `id` is `null` or does not start with `PREFIX`; otherwise the text after `PREFIX`, or `null` when that text is empty. Javadoc: "The path of a vanilla id (minecraft:oak_planks gives oak_planks); null for any other namespace."
- **Step 5.** Create `ServerTicks.java`: a `public final class ServerTicks` with a field `private volatile long tick;`, `public long get()` returning it and `public void set(long tick)` storing it. Javadoc: "The server tick count, updated at the end of each tick by the evidence setup."
- **Step 6.** Create `EvidenceSetup.java`:
  ```java
  package dev.geldar.neoforge;

  import net.neoforged.neoforge.event.tick.ServerTickEvent;

  /** Registers the sheet evidence listeners (character-sheet campaign). Off unless the export and provenance.enabled are on. */
  public final class EvidenceSetup {
      private EvidenceSetup() {}

      /** Registers the listeners and returns how many; off registers none and returns 0. */
      public static int install(
              ExportConfig export, EvidenceConfig evidence, EvidenceBus bus, ExportLifecycle lifecycle, OperatorSink sink) {
          if (!export.enabled() || !evidence.provenance()) {
              sink.info("geldar_neoforge sheet evidence off");
              return 0;
          }
          ServerTicks ticks = new ServerTicks();
          int count = 0;
          bus.listenLast(ServerTickEvent.Post.class, event -> ticks.set(event.getServer().getTickCount()));
          count++;
          // Sheet evidence listeners: AN-NF-28b and AN-NF-50 add their lines below this comment.
          sink.info("geldar_neoforge sheet evidence on, listeners " + count);
          return count;
      }
  }
  ```
- **Step 7.** In `GeldarNeoForge.java`, directly after the line `            startMaintenance(config, event);` insert exactly:
  ```java
              try {
                  EvidenceSetup.install(
                          config,
                          EvidenceConfig.load(config.enabled(), Path.of("config", ExportConfig.FILE_NAME), System::getenv, SINK),
                          EvidenceBus.neoForge(),
                          lifecycle,
                          SINK);
              } catch (RuntimeException e) {
                  SINK.warn("geldar_neoforge sheet evidence disabled: setup failed (" + e.getClass().getSimpleName() + ")");
              }
  ```
  Change nothing else in the file.
- **Step 8.** In `neoforge/README.md`, insert before the line `## Rules this project keeps` a section:
  ```
  ## Sheet evidence (inactive)

  The character-sheet campaign's NeoForge twins (docs/analysis/harness/work-packets-sheet-neoforge.md) add their listeners through `EvidenceSetup`. They run only when the export is on and `provenance.enabled` is `true` (environment `GELDAR_NEOFORGE_PROVENANCE` wins over the file; only `true` enables). Default: off, and nothing is registered. When on, the setup registers one `ServerTickEvent.Post` listener that keeps the server tick count; the later cards add the provenance and combat listeners. Every evidence listener runs at the lowest priority and never sees a cancelled event. No human name leaves the server: a name is written only when it is a life id. Operator log lines: `geldar_neoforge sheet evidence off`, `geldar_neoforge sheet evidence on, listeners <n>`.
  ```
- **Tests to write** (test classes in `neoforge/src/test/java/dev/geldar/neoforge/`, package `dev.geldar.neoforge`; build the `Properties` and an environment `Function` from a `java.util.Map` in each test):
  - `EvidenceConfigTest`: `exportOffKeepsEvidenceOff` (`resolve(false, file with provenance.enabled=true, env with GELDAR_NEOFORGE_PROVENANCE=true)` gives `provenance() == false`); `nothingSetIsOff`; `fileTrueIsOn`; `environmentWinsOverTheFile` (env `false`, file `true` gives off); `onlyTrueEnables` (env `yes` gives off; env `1` gives off); `trueIsTrimmedAndCaseFree` (env `" TRUE "` gives on); `missingFileIsOff` (`load(true, Path.of("does-not-exist.properties"), name -> null, quiet sink)` gives off).
  - `WorldNamesTest`: `theThreeVanillaDimensions` (three asserts); `otherDimensionsAreNull` (`"minecraft:custom"`, `"overworld"`, `""`, `null`).
  - `VanillaIdsTest`: `vanillaIdGivesItsPath` (`minecraft:oak_planks` gives `oak_planks`); `otherNamespacesAreNull` (`examplemod:thing`); `blankPathIsNull` (`minecraft:`); `nullIsNull`.
  - `EvidenceSetupTest`: a `RecordingBus implements EvidenceBus` that adds each `type` to a `List<Class<?>>`; a `CapturingSink implements OperatorSink` that keeps `info` lines; configs `new ExportConfig(true, "nats://example.invalid:4222", "nf", null, null, 10)` and the same with `false`; lifecycle `new ExportLifecycle(on, (c, log) -> new InMemoryEventPublisher(), sink)` (import `dev.geldar.core.InMemoryEventPublisher`; not started). Tests: `exportOffRegistersNothing` (returns 0, bus empty, info has `geldar_neoforge sheet evidence off`); `provenanceOffRegistersNothing` (export on, `new EvidenceConfig(false)`: returns 0, bus empty); `onRegistersTheTickListener` (returns 1, `bus.types` equals `List.of(ServerTickEvent.Post.class)`, info has `geldar_neoforge sheet evidence on, listeners 1`); `onRegistersNoChatOrCommandListener` (no registered type's simple name contains `Chat` or `Command`).
- **Revert-checks** (R10): (1) in `EvidenceSetup.java` delete `!evidence.provenance() || ` : `provenanceOffRegistersNothing` fails. (2) delete `!export.enabled() || ` : `exportOffRegistersNothing` fails. (3) in `EvidenceConfig.resolve` replace `"true".equalsIgnoreCase(value)` with `value != null` : `onlyTrueEnables` fails. (4) in `resolve` swap the two arguments of `first(...)` : `environmentWinsOverTheFile` fails.
- **Checks** GATE-NF with classes `EvidenceConfigTest`, `WorldNamesTest`, `VanillaIdsTest`, `EvidenceSetupTest`.
- **Exit criteria** all four classes pass; `./gradlew build` passes (so `ExportListenersTest` and `NoRegistryScanTest` are unchanged and green); the four revert-checks recorded; `GeldarNeoForge.java` diff is the one inserted block.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-00.md`. **Commit** `feat(neoforge): sheet evidence config, bus and setup skeleton, off by default (AN-NF-00)`. **Split line** steps 1 to 5 with their tests first; steps 6 to 8 second.

## AN-NF-27a: break provenance on NeoForge

- **id** AN-NF-27a. **wave** W5-NF. **repo** geldar. **twin of** AN-27a. **depends-on** AN-NF-00; AN-27a merged with amendments A1, A2 (`breakJson`), A4; merge after P4. **status** BlockedDependency (AN-27a, P4). **size** 35k. **branch** `phase1/an-nf-27a-break-provenance`. **worktree** `.claude/worktrees/an-nf-27a`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/BreakProvenance.java`, `BreakProvenanceListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/BreakProvenanceTest.java`, `BreakProvenanceListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (registration is AN-NF-28b: write "index line to add: `BreakProvenanceListeners.install(bus, new BreakProvenance(<cache>, <sink>, ticks::get), sink); count++;`" in the worknote).
- **decisions** D-CS-06; OD-NF-1 (default: null name for a human); OD-NF-4 does not apply.
- **Step 0.** Each command must print one line; otherwise STOP with `blocked: <file> lacks <pattern>`:
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceSink.java -SimpleMatch -Pattern 'void send(String tail, String json);'`
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java -SimpleMatch -Pattern 'public static String breakJson(String world, int x, int y, int z, String actor, String priorOwner, String block, long tick)'`
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java -SimpleMatch -Pattern 'public static String of(OwnerCache cache, OwnerCache.Pos pos)'`
  - `Select-String -Path neoforge/src/main/java/dev/geldar/neoforge/EvidenceBus.java -SimpleMatch -Pattern 'void listenLast('`
- **Step 1.** Create `BreakProvenance.java`:
  ```java
  package dev.geldar.neoforge;

  import dev.geldar.core.EventEnvelope;
  import dev.geldar.core.blockowner.OwnerCache;
  import dev.geldar.core.provenance.PriorOwner;
  import dev.geldar.core.provenance.ProvenanceJson;
  import dev.geldar.core.provenance.ProvenanceSink;
  import java.util.function.LongSupplier;

  /** A player broke a block: one break provenance message, with no human name. Free of NeoForge types. */
  public final class BreakProvenance {
      public static final String TAIL = "break";

      private final OwnerCache cache;
      private final ProvenanceSink sink;
      private final LongSupplier tick;

      /** {@code cache} and {@code sink} may be null; then nothing is sent. */
      public BreakProvenance(OwnerCache cache, ProvenanceSink sink, LongSupplier tick) {
          this.cache = cache;
          this.sink = sink;
          this.tick = tick;
      }

      /** Sends one message and returns true, or returns false and sends nothing. */
      public boolean onBreak(String player, String dimensionId, int x, int y, int z, String blockId, boolean cancelled) {
          if (cancelled || sink == null || cache == null) {
              return false;
          }
          String world = WorldNames.of(dimensionId);
          String block = VanillaIds.path(blockId);
          if (world == null || block == null) {
              return false;
          }
          String actor = EventEnvelope.isLifeId(player) ? player : null;
          String prior = PriorOwner.of(cache, new OwnerCache.Pos(world, x, y, z));
          String priorOwner = EventEnvelope.isLifeId(prior) ? prior : null;
          sink.send(TAIL, ProvenanceJson.breakJson(world, x, y, z, actor, priorOwner, block, tick.getAsLong()));
          return true;
      }
  }
  ```
- **Step 2.** Create `BreakProvenanceListeners.java`:
  ```java
  package dev.geldar.neoforge;

  import net.minecraft.core.BlockPos;
  import net.minecraft.server.level.ServerPlayer;
  import net.neoforged.neoforge.event.level.block.BreakBlockEvent;

  /** Registers the break provenance listener. Server side and players only. */
  public final class BreakProvenanceListeners {
      private BreakProvenanceListeners() {}

      /** One listener on BreakBlockEvent; an exception in it is logged and never reaches the game bus. */
      public static void install(EvidenceBus bus, BreakProvenance handler, OperatorSink sink) {
          bus.listenLast(BreakBlockEvent.class, event -> {
              try {
                  if (event.getLevel().isClientSide()) {
                      return;
                  }
                  if (!(event.getPlayer() instanceof ServerPlayer player)) {
                      return;
                  }
                  BlockPos pos = event.getPos();
                  handler.onBreak(
                          player.getGameProfile().name(),
                          player.level().dimension().identifier().toString(),
                          pos.getX(), pos.getY(), pos.getZ(),
                          event.getState().getBlock().builtInRegistryHolder().key().identifier().toString(),
                          event.isCanceled());
              } catch (RuntimeException e) {
                  sink.warn("geldar_neoforge break provenance listener failed (" + e.getClass().getSimpleName() + ")");
              }
          });
      }
  }
  ```
  These names compile in merged code (`neoforge-ledger/.../curated/McReaders.java`, `neoforge/.../NeoForgeFacts.java`); if one does not, R8.
- **Tests to write.**
  - `BreakProvenanceTest`. Fixtures: a `RecordingSink implements ProvenanceSink` that keeps `(tail, json)` pairs; `OwnerCache cache = new OwnerCache(() -> 0L)`; to own a block call `cache.storeBase(OwnerCache.chunkOf(new OwnerCache.Pos("world", 1, 64, 2)), new OwnerSource.Owners(List.of(new OwnerSource.OwnedBlock(1, 64, 2, "ag_owner_01")), false))` (imports `dev.geldar.core.blockowner.OwnerSource`); tick supplier `() -> 1234L`; a life breaker `ag_breaker_01`; a human name `SomeHuman`. Tests: `anOwnedBlockBrokenByAnotherLifeSendsOneMessage` (tail `break`; JSON `world` `world`, `x` 1, `y` 64, `z` 2, `actor` `ag_breaker_01`, `prior_owner` `ag_owner_01`, `block` `oak_planks`, `tick` 1234); `anUnownedBlockHasNoPriorOwner` (base stored, block at another cell: `prior_owner` is JSON null); `aCacheMissHasNoPriorOwner` (no base: `prior_owner` null, one message); `aCancelledBreakSendsNothing`; `aNullSinkSendsNothing` (returns false, no exception); `aNullCacheSendsNothing`; `aHumanBreakerIsUnnamed` (`actor` null, one message, the JSON text does not contain `SomeHuman`); `aHumanPriorOwnerIsUnnamed` (base owner `SomeHuman`: `prior_owner` null, the JSON does not contain `SomeHuman`); `aModdedBlockSendsNothing` (`examplemod:thing`); `anUnknownDimensionSendsNothing` (`minecraft:custom`); `theNetherIsWorldNether` (`world` `world_nether`).
  - `BreakProvenanceListenersTest`: a `RecordingBus implements EvidenceBus`; `install` registers exactly `List.of(BreakBlockEvent.class)`; no registered type's simple name contains `Chat` or `Command`.
- **Revert-checks** (R10): (1) in `onBreak` replace `EventEnvelope.isLifeId(player) ? player : null` with `player` : `aHumanBreakerIsUnnamed` fails. (2) delete `cancelled || ` : `aCancelledBreakSendsNothing` fails. (3) replace `EventEnvelope.isLifeId(prior) ? prior : null` with `prior` : `aHumanPriorOwnerIsUnnamed` fails. (4) replace `VanillaIds.path(blockId)` with `blockId` : `aModdedBlockSendsNothing` fails.
- **Checks** GATE-NF with classes `BreakProvenanceTest`, `BreakProvenanceListenersTest`.
- **Exit criteria** both classes pass; build passes; four revert-checks recorded; the index line for AN-NF-28b is in the worknote.
- **ops (serial, after AN-NF-28b, owner go):** on the scratch NeoForge shard, a life breaks a block another life placed, and a human-free capture of the `geldar.nf-scratch.provenance.break` message is attached to the worknote before AN-27b's fixtures are reused for NeoForge.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-27a.md`. **Commit** `feat(neoforge): break provenance with no human name, unregistered (AN-NF-27a)`. **Split line** none.

## AN-NF-26a: pickup provenance on NeoForge

- **id** AN-NF-26a. **wave** W5-NF. **repo** geldar. **twin of** AN-26a. **depends-on** AN-NF-00; AN-26a merged with A1 and A2 (`pickupJson`); merge after P4. **status** BlockedDependency (AN-26a, P4). **size** 35k. **branch** `phase1/an-nf-26a-pickup-provenance`. **worktree** `.claude/worktrees/an-nf-26a`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/PickupProvenance.java`, `PickupProvenanceListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/PickupProvenanceTest.java`, `PickupProvenanceListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (index line to add: `PickupProvenanceListeners.install(bus, new PickupProvenance(<sink>, ticks::get), sink); count++;`).
- **decisions** D-CS-06; OD-NF-1. Known difference from Paper (record it in the worknote): Paper's `Item#getThrower()` is a UUID even when the thrower is offline; this twin reads `ItemEntity#getOwner()`, which is the thrower entity only while it is loaded, so a pickup of an offline player's toss sends nothing.
- **Step 0.** As AN-NF-27a step 0, with the second line replaced by `-Pattern 'public static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)'` and without the `PriorOwner` line.
- **Step 1.** Create `PickupProvenance.java`:
  ```java
  package dev.geldar.neoforge;

  import dev.geldar.core.EventEnvelope;
  import dev.geldar.core.provenance.ProvenanceJson;
  import dev.geldar.core.provenance.ProvenanceSink;
  import java.util.function.LongSupplier;

  /** A life picked up a stack another player threw: one pickup provenance message, with no human name. */
  public final class PickupProvenance {
      public static final String TAIL = "pickup";
      public static final int MAX_PER_TICK = 64;

      private final ProvenanceSink sink;
      private final LongSupplier tick;
      private long currentTick = Long.MIN_VALUE;
      private int sentThisTick;
      private long dropped;

      /** {@code sink} may be null; then nothing is sent. */
      public PickupProvenance(ProvenanceSink sink, LongSupplier tick) {
          this.sink = sink;
          this.tick = tick;
      }

      /** Sends one message and returns true, or returns false and sends nothing. Server thread only. */
      public boolean onPickup(
              String pickerUuid, String pickerName, String throwerUuid, String throwerName,
              String itemId, int count, int ageTicks, Double distance, String dimensionId) {
          if (sink == null || throwerUuid == null || throwerUuid.equals(pickerUuid) || count < 1) {
              return false;
          }
          if (!EventEnvelope.isLifeId(pickerName)) {
              return false;
          }
          String world = WorldNames.of(dimensionId);
          String item = VanillaIds.path(itemId);
          if (world == null || item == null) {
              return false;
          }
          long now = tick.getAsLong();
          if (now != currentTick) {
              currentTick = now;
              sentThisTick = 0;
          }
          if (sentThisTick >= MAX_PER_TICK) {
              dropped++;
              return false;
          }
          sentThisTick++;
          String thrower = EventEnvelope.isLifeId(throwerName) ? throwerName : null;
          sink.send(TAIL, ProvenanceJson.pickupJson(world, pickerName, thrower, item, count, ageTicks, distance, now));
          return true;
      }

      /** Messages dropped by the per-tick cap so far. */
      public long dropped() {
          return dropped;
      }
  }
  ```
- **Step 2.** Create `PickupProvenanceListeners.java`, with `public static void install(EvidenceBus bus, PickupProvenance handler, OperatorSink sink)` that calls `bus.listenLast(ItemEntityPickupEvent.Post.class, event -> { ... })` (import `net.neoforged.neoforge.event.entity.player.ItemEntityPickupEvent`). The body, inside `try { ... } catch (RuntimeException e) { sink.warn("geldar_neoforge pickup provenance listener failed (" + e.getClass().getSimpleName() + ")"); }`, in this order:
  1. `if (!(event.getPlayer() instanceof ServerPlayer picker)) { return; }`
  2. `ItemEntity entity = event.getItemEntity();` (import `net.minecraft.world.entity.item.ItemEntity`)
  3. `if (!(entity.getOwner() instanceof ServerPlayer thrower)) { return; }`
  4. `int taken = event.getOriginalStack().getCount() - event.getCurrentStack().getCount();`
  5. `double distance = Math.hypot(thrower.getX() - picker.getX(), thrower.getZ() - picker.getZ());`
  6. `handler.onPickup(picker.getUUID().toString(), picker.getGameProfile().name(), thrower.getUUID().toString(), thrower.getGameProfile().name(), event.getOriginalStack().getItem().builtInRegistryHolder().key().identifier().toString(), taken, entity.getAge(), distance, picker.level().dimension().identifier().toString());`

  UNVERIFIED names here: `ItemEntityPickupEvent.Post`, `getPlayer`, `getItemEntity`, `getOriginalStack`, `getCurrentStack`, `ItemEntity#getOwner`, `getAge`, `getUUID`, `getX`, `getZ`. Any compile failure on them: R8.
- **Tests to write.**
  - `PickupProvenanceTest` (a `RecordingSink`; a mutable tick holder, `long[] t = {100L}` with supplier `() -> t[0]`; lives `ag_picker_01`, `ag_giver_01`; UUID strings `"u-picker"`, `"u-giver"`; human `SomeHuman`): `aTossByAnotherLifeSendsOneMessage` (tail `pickup`; JSON `picker` `ag_picker_01`, `thrower` `ag_giver_01`, `item` `bread`, `count` 3, `age_ticks` 40, `distance` 2.5, `tick` 100, `world` `world`); `pickingUpYourOwnTossSendsNothing` (same UUID); `noThrowerSendsNothing` (`throwerUuid` null); `aHumanThrowerIsUnnamed` (`thrower` null, one message, JSON has no `SomeHuman`); `aHumanPickerSendsNothing`; `zeroItemsSendsNothing`; `aModdedItemSendsNothing`; `theCapHolds` (65 calls in tick 100 send 64, `dropped()` is 1); `theCapResetsNextTick` (after 64 in tick 100, one call in tick 101 sends); `aNullSinkSendsNothing`.
  - `PickupProvenanceListenersTest`: `install` registers exactly `List.of(ItemEntityPickupEvent.Post.class)`; no `Chat` or `Command` type.
- **Revert-checks** (R10): (1) delete `|| throwerUuid.equals(pickerUuid)` : `pickingUpYourOwnTossSendsNothing` fails. (2) change `sentThisTick >= MAX_PER_TICK` to `false` : `theCapHolds` fails. (3) delete the block `if (!EventEnvelope.isLifeId(pickerName)) { return false; }` : `aHumanPickerSendsNothing` fails. (4) replace `EventEnvelope.isLifeId(throwerName) ? throwerName : null` with `throwerName` : `aHumanThrowerIsUnnamed` fails.
- **Checks** GATE-NF with classes `PickupProvenanceTest`, `PickupProvenanceListenersTest`.
- **Exit criteria** both classes pass; build passes; four revert-checks recorded; the index line and the offline-thrower difference are in the worknote.
- **ops (serial, after AN-NF-28b, owner go):** a real toss between two lives on the scratch NeoForge shard; attach the captured message; confirm a death drop sends nothing (UNVERIFIED until then).
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-26a.md`. **Commit** `feat(neoforge): pickup provenance with no human name, unregistered (AN-NF-26a)`. **Split line** none.

## AN-NF-28b: W5 wiring on NeoForge and the NeoForge NATS rows

- **id** AN-NF-28b. **wave** W5-NF. **repo** geldar. **twin of** AN-28b (its plugin-setup and ACL half; the Body half needs NF-BODY and is not in this card). **depends-on** AN-NF-26a, AN-NF-27a, P4 merged. **status** BlockedDependency (P4). **size** 40k. **branch** `phase1/an-nf-28b-evidence-wiring`. **worktree** `.claude/worktrees/an-nf-28b`.
- **may-edit** `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java`, `neoforge/src/test/java/dev/geldar/neoforge/EvidenceSetupTest.java`, `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` (the `EvidenceSetup.install(` call only), `neoforge/README.md` (the "Sheet evidence (inactive)" section only), `deploy/nats-auth-nf.ps1` (the `neoforge` entry only), `tools/repo-checks/src/nats-auth-nf.test.ts`; the worknote.
- **must-not-edit** R6; every other file.
- **decisions** D-CS-06. The `neoforge` user's new publish grant widens decision 0383 item 1; write "index line to add: a decision record amending 0383 (the mod publishes `geldar.<s>.provenance.>`)" in the worknote. The coder writes no decision record.
- **Step 0.** Each must hold; otherwise STOP with the reason:
  - `Test-Path neoforge/src/main/java/dev/geldar/neoforge/NeoForgeBlockOwners.java` is `True`, and `Select-String` on that file finds both `public OwnerCache cache()` and `public ProvenanceSink provenanceSink()` (`blocked: P4 shape`).
  - In `GeldarNeoForge.java`, `Select-String -SimpleMatch -Pattern 'new NeoForgeBlockOwners('` prints exactly one line, and its line number is smaller than the line number of `EvidenceSetup.install(` (`blocked: P4 wiring order`). Write the variable name assigned on that line in the worknote; call it `<owners>` below.
  - `neoforge/README.md` has a heading line that contains `Block owners`, and the text between that heading and the next `## ` heading contains `EventPriority.LOWEST` or `next server tick` (`blocked: P4 read-before-write rule`, delta note section 4 item 5).
  - `deploy/nats-auth-nf.ps1` has exactly one line that starts (after spaces) with `neoforge = @{` and it contains `Pub = @("geldar.$s.*"` (`blocked: auth table changed`).
- **Step 1.** In `EvidenceSetup.java`: change the `install` signature to add a last parameter `NeoForgeBlockOwners owners` (it may be null). Directly below the comment line `// Sheet evidence listeners: AN-NF-28b and AN-NF-50 add their lines below this comment.` insert:
  ```java
          ProvenanceSink provenance = owners == null ? null : owners.provenanceSink();
          if (provenance != null) {
              BreakProvenanceListeners.install(bus, new BreakProvenance(owners.cache(), provenance, ticks::get), sink);
              count++;
              PickupProvenanceListeners.install(bus, new PickupProvenance(provenance, ticks::get), sink);
              count++;
          }
  ```
  and add `import dev.geldar.core.provenance.ProvenanceSink;`.
- **Step 2.** In `GeldarNeoForge.java`, find the first line after `EvidenceSetup.install(` whose text, without leading spaces, is exactly `SINK);`. Replace `SINK);` on that line with `SINK,`, and insert below it a new line with the same leading spaces followed by `<owners>);` (the variable from step 0). Change nothing else. If no such line exists within the next eight lines, STOP (`blocked: evidence call changed`).
- **Step 3.** In `deploy/nats-auth-nf.ps1`, on the `neoforge = @{` line, insert `, "geldar.$s.provenance.>"` directly after `"geldar.$s.*"` inside `Pub = @(`. Change nothing else.
- **Step 4.** In `tools/repo-checks/src/nats-auth-nf.test.ts`:
  - In the `EXPECTED` object's `neoforge` entry, in its `pub` array, insert `'geldar.nf.provenance.>'` directly after `'geldar.nf.*'`.
  - In the test whose title starts `gives the NeoForge mod no publish on maintenance or the dead letter`, change `toEqual(['geldar.nf.*'])` to `toEqual(['geldar.nf.*', 'geldar.nf.provenance.>'])`, and change the title's ending `and no wider subject than geldar.nf.*` to `and no wider subject than geldar.nf.* and geldar.nf.provenance.>`.
  - Add, after that test, a new test `it('lets the mod publish provenance for the four tails, and not the state subtree', () => { ... })` that asserts `publishAllowed(entry('neoforge'), s)` is `true` for `geldar.nf.provenance.break`, `geldar.nf.provenance.pickup`, `geldar.nf.provenance.take`, `geldar.nf.provenance.combat`, and `false` for `geldar.nf.state.ag_x_01.level`.
  - If either quoted text is not found, STOP (`blocked: nats-auth-nf.test.ts changed`).
- **Step 5.** In `neoforge/README.md`, at the end of the "Sheet evidence (inactive)" section, add one paragraph: "With the block-owner feature on (`NeoForgeBlockOwners` gives a provenance sink), the setup also registers the break and pickup provenance listeners, which publish on `geldar.<shard>.provenance.break` and `.pickup` through that sink. The `neoforge` NATS user may publish `geldar.<shard>.provenance.>` (`deploy/nats-auth-nf.ps1`). A Body on the NeoForge shard cannot subscribe to it yet: the NeoForge auth set has no Body role for sheet Bodies."
- **Tests to write or change.** `EvidenceSetupTest`: update every `install(...)` call to pass `null` as the new last argument; add `withoutOwnersOnlyTheTickListener` (owners null: returns 1, types `[ServerTickEvent.Post]`); add `withOwnersRegistersBreakAndPickup` (build a `NeoForgeBlockOwners` test instance the way P4's own tests build one; if P4's tests have no way to build one without a server, STOP `blocked: no test seam for NeoForgeBlockOwners`): returns 3, types `[ServerTickEvent.Post, BreakBlockEvent, ItemEntityPickupEvent.Post]` in that order. `nats-auth-nf.test.ts` as in step 4.
- **Revert-checks** (R10): (1) in `EvidenceSetup.java` delete the `count++;` after the pickup install : `withOwnersRegistersBreakAndPickup` fails. (2) remove `, "geldar.$s.provenance.>"` from `deploy/nats-auth-nf.ps1` : the new provenance test fails. (3) change `if (provenance != null)` to `if (true)` and keep owners null in the test : `withoutOwnersOnlyTheTickListener` fails (a NullPointerException or the wrong count).
- **Checks** GATE-NF with class `EvidenceSetupTest`; plus `./geldar.ps1 pnpm test tools/repo-checks/src/nats-auth-nf`, `./geldar.ps1 pnpm format`, `./geldar.ps1 pnpm lint`. If `tools/repo-checks/src/nats-auth-nf-upgrade.test.ts` or `nats-human-grants-nf.test.ts` fails, or any test in `nats-auth-nf.test.ts` other than the two step 4 touches fails (for example the scope test), STOP (`blocked: auth fixture pin` and the failing test's title); do not edit them.
- **Exit criteria** all named tests pass; build passes; three revert-checks recorded; the decision index line is in the worknote.
- **ops (serial, owner go):** render the NeoForge auth set (`./geldar.ps1 shard nats-auth nf` with the flags its runbook names) on the scratch stack only; confirm the mod can publish `geldar.nf-scratch.provenance.break` and the `sink` and `human` users cannot subscribe to it. The Body half of AN-28b (subscription, leakage gate on NeoForge) waits for NF-BODY.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-28b.md`. **Commit** `feat(neoforge): register break and pickup provenance behind provenance.enabled; mod may publish provenance (AN-NF-28b)`. **Split line** steps 1, 2, 5 and `EvidenceSetupTest` first; steps 3 and 4 second.

---

# Wave W8-NF

## AN-NF-47a: combat facts and combat provenance on NeoForge

- **id** AN-NF-47a. **wave** W8-NF. **repo** geldar. **twin of** AN-47a. **depends-on** AN-NF-00; AN-46 merged; AN-47a merged with A1, A2 (`combatJson`) and A3; P3-LIVE. **status** BlockedDependency (AN-46, AN-47a, P3-LIVE). **size** 45k, over R1: dispatch it as two coder sessions at the split line below. **branch** `phase1/an-nf-47a-combat-facts`. **worktree** `.claude/worktrees/an-nf-47a`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/CombatFacts.java`, `CombatFactListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/CombatFactsTest.java`, `CombatFactListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (index line to add: `CombatFactListeners.install(bus, new CombatFacts(lifecycle, export.shard(), Instant::now, provenance, ticks::get, sink), sink); count += 3;`).
- **decisions** D-CS-04 (one award per encounter), D-CS-06, OD-NF-4 (kill credit: the death source's entity). Humans earn nothing and are never named (0387 item 6): a human's hit, kill or death is ignored.
- **Step 0.**
  - `Select-String` finds in `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java` each of: `public record Fact(String kind, String player, String mob, String encounterKey)`, `public record Step(String kind, String player, String mob)`, `public void playerHurtByMob(String player, String playerUuid, String mobUuid, String mobType, long tick)`, `public Optional<Step> playerHitMob(String player, String playerUuid, String mobUuid, String mobType, long tick)`, `public List<Fact> mobDied(String mobUuid, String mobType, String killer, String killerUuid, long tick)`, `public void playerDied(String player, long tick)`, `public List<Fact> advance(long tick)`; in `HostileMobs.java`: `public static boolean isHostile(String mobType)`; in `ProvenanceJson.java`: `public static String combatJson(String world, String actor, String target, String kind, long tick)`; `ProvenanceSink.java` as in AN-NF-27a. Missing: STOP `blocked: A3 shape`.
  - `Test-Path contract/schemas/combat-fact-event.schema.json` is `True` (`blocked: AN-46`). Then run `Select-String -Path contract/schemas/combat-fact-event.schema.json -SimpleMatch -Pattern '"player"'`. Write in the worknote **PLAYER=yes** if it prints a line, **PLAYER=no** if it prints nothing. Step 1 uses this.
- **Step 1.** Create `CombatFacts.java`:
  ```java
  package dev.geldar.neoforge;

  import com.google.gson.JsonObject;
  import dev.geldar.core.EventEnvelope;
  import dev.geldar.core.combat.EncounterTracker;
  import dev.geldar.core.combat.HostileMobs;
  import dev.geldar.core.provenance.ProvenanceJson;
  import dev.geldar.core.provenance.ProvenanceSink;
  import java.time.Instant;
  import java.util.List;
  import java.util.Optional;
  import java.util.function.LongSupplier;
  import java.util.function.Supplier;

  /** Combat facts for the sheet (XP only, never agent-visible) and combat provenance. Lives only; free of NeoForge types. */
  public final class CombatFacts {
      public static final String TYPE = "combat_fact";
      public static final String TAIL = "combat";
      static final boolean WRITE_PLAYER = false;   // set from step 0: true when PLAYER=yes, false when PLAYER=no

      private final ExportLifecycle lifecycle;
      private final String shard;
      private final Supplier<Instant> clock;
      private final ProvenanceSink provenance;
      private final LongSupplier tick;
      private final OperatorSink log;
      private final EncounterTracker tracker = new EncounterTracker();

      /** {@code provenance} may be null: then the facts are still published and no provenance is sent. */
      public CombatFacts(ExportLifecycle lifecycle, String shard, Supplier<Instant> clock, ProvenanceSink provenance,
              LongSupplier tick, OperatorSink log) {
          this.lifecycle = lifecycle;
          this.shard = shard;
          this.clock = clock;
          this.provenance = provenance;
          this.tick = tick;
          this.log = log;
      }

      /** A hostile mob hurt a player. */
      public void playerHurt(String player, String playerUuid, String mobUuid, String mobTypeId) {
          String mob = hostile(mobTypeId);
          if (mob != null && EventEnvelope.isLifeId(player)) {
              tracker.playerHurtByMob(player, playerUuid, mobUuid, mob, tick.getAsLong());
          }
      }

      /** A player hurt a hostile mob. */
      public void mobHurt(String player, String playerUuid, String mobUuid, String mobTypeId, String dimensionId) {
          String mob = hostile(mobTypeId);
          if (mob == null || !EventEnvelope.isLifeId(player)) {
              return;
          }
          Optional<EncounterTracker.Step> step = tracker.playerHitMob(player, playerUuid, mobUuid, mob, tick.getAsLong());
          step.ifPresent(s -> sendProvenance(dimensionId, s.player(), s.mob(), s.kind()));
      }

      /** A hostile mob died; {@code killer} is the death source's player, or null. */
      public void mobDied(String mobUuid, String mobTypeId, String killer, String killerUuid, String dimensionId) {
          String mob = hostile(mobTypeId);
          if (mob == null) {
              return;
          }
          String life = EventEnvelope.isLifeId(killer) ? killer : null;
          List<EncounterTracker.Fact> facts =
                  tracker.mobDied(mobUuid, mob, life, life == null ? null : killerUuid, tick.getAsLong());
          for (EncounterTracker.Fact fact : facts) {
              publish(fact);
              if ("hostile_kill".equals(fact.kind())) {
                  sendProvenance(dimensionId, fact.player(), fact.mob(), "killed");
              }
          }
      }

      /** A player died. */
      public void playerDied(String player) {
          if (EventEnvelope.isLifeId(player)) {
              tracker.playerDied(player, tick.getAsLong());
          }
      }

      /** The end of a server tick: closes timed-out encounters. */
      public void endOfTick() {
          for (EncounterTracker.Fact fact : tracker.advance(tick.getAsLong())) {
              publish(fact);
          }
      }

      private static String hostile(String mobTypeId) {
          String mob = VanillaIds.path(mobTypeId);
          return mob != null && HostileMobs.isHostile(mob) ? mob : null;
      }

      private void publish(EncounterTracker.Fact fact) {
          try {
              JsonObject payload = new JsonObject();
              payload.addProperty("kind", fact.kind());
              payload.addProperty("mob", fact.mob());
              payload.addProperty("encounter_key", fact.encounterKey());
              if (WRITE_PLAYER) {
                  payload.addProperty("player", fact.player());
              }
              lifecycle.publish(EventEnvelope.create(clock.get(), shard, tick.getAsLong(), TYPE, fact.player(), payload));
          } catch (RuntimeException e) {
              log.warn("geldar_neoforge could not export combat_fact (" + e.getClass().getSimpleName() + ")");
          }
      }

      private void sendProvenance(String dimensionId, String actor, String target, String kind) {
          String world = WorldNames.of(dimensionId);
          if (provenance == null || world == null) {
              return;
          }
          provenance.send(TAIL, ProvenanceJson.combatJson(world, actor, target, kind, tick.getAsLong()));
      }
  }
  ```
  Set `WRITE_PLAYER` to `true` if the worknote says PLAYER=yes; leave `false` for PLAYER=no. Replace the trailing comment with `// PLAYER=yes in AN-NF-47a step 0` or `// PLAYER=no in AN-NF-47a step 0`.
- **Step 2.** Create `CombatFactListeners.java` with `public static void install(EvidenceBus bus, CombatFacts facts, OperatorSink sink)` registering three listeners through `bus.listenLast`, each body inside `try { ... } catch (RuntimeException e) { sink.warn("geldar_neoforge combat listener failed (" + e.getClass().getSimpleName() + ")"); }`:
  1. `LivingDamageEvent.Post.class`: `LivingEntity hurt = event.getEntity(); Entity source = event.getSource().getEntity();` then: if `hurt instanceof ServerPlayer p && source != null && !(source instanceof Player)`, call `facts.playerHurt(p.getGameProfile().name(), p.getUUID().toString(), source.getUUID().toString(), typeId(source))`; else if `source instanceof ServerPlayer a && !(hurt instanceof Player)`, call `facts.mobHurt(a.getGameProfile().name(), a.getUUID().toString(), hurt.getUUID().toString(), typeId(hurt), a.level().dimension().identifier().toString())`.
  2. `LivingDeathEvent.class`: `LivingEntity dead = event.getEntity();` if `dead instanceof ServerPlayer p`, call `facts.playerDied(p.getGameProfile().name())`; else `Entity killer = event.getSource().getEntity();` and call `facts.mobDied(dead.getUUID().toString(), typeId(dead), killer instanceof ServerPlayer k ? k.getGameProfile().name() : null, killer instanceof ServerPlayer k2 ? k2.getUUID().toString() : null, dead.level().dimension().identifier().toString())`.
  3. `ServerTickEvent.Post.class`: `facts.endOfTick()`.

  Add `private static String typeId(Entity e) { return e.getType().builtInRegistryHolder().key().identifier().toString(); }`. Imports: `net.minecraft.server.level.ServerPlayer`, `net.minecraft.world.entity.Entity`, `net.minecraft.world.entity.LivingEntity`, `net.minecraft.world.entity.player.Player`, `net.neoforged.neoforge.event.entity.living.LivingDamageEvent`, `net.neoforged.neoforge.event.entity.living.LivingDeathEvent`, `net.neoforged.neoforge.event.tick.ServerTickEvent`. UNVERIFIED names: `DamageSource#getEntity`, `Entity#getUUID`, the `EntityType` holder chain, `Entity#level` on a non-player. R8 on a compile failure.
- **Tests to write.**
  - `CombatFactsTest`. Fixtures: `InMemoryEventPublisher pub = new InMemoryEventPublisher();` `ExportLifecycle lifecycle = new ExportLifecycle(new ExportConfig(true, "nats://example.invalid:4222", "nf", null, null, 10), (c, log) -> pub, quiet);` then `lifecycle.start();`; a `RecordingSink implements ProvenanceSink`; `long[] t = {1000L}`; `CombatFacts facts = new CombatFacts(lifecycle, "nf", () -> Instant.parse("2026-11-18T12:00:00Z"), sink, () -> t[0], quiet)`; mob `minecraft:zombie`, uuid `"m-1"`; lives `ag_fighter_01` (uuid `"u-f"`), `ag_other_02`; human `SomeHuman`. Tests: `aKillByALifePublishesOneHostileKill` (`mobHurt` then `mobDied` with killer `ag_fighter_01`: exactly one envelope, type `combat_fact`, `agentId()` `ag_fighter_01`, payload `kind` `hostile_kill`, `mob` `zombie`, `encounter_key` non-empty; payload has `player` only when `WRITE_PLAYER`); `aHumanKillPublishesNothing` (killer `SomeHuman`: no envelope; no recorded text contains `SomeHuman`); `aPeacefulMobPublishesNothing` (`minecraft:cow`); `aModdedMobPublishesNothing` (`examplemod:beast`); `survivingAFightPublishesOneFightSurvived` (`playerHurt` at 1000, `t[0] = 1000 + EncounterTracker.FIGHT_END_TICKS + 1`, `endOfTick()`: one envelope with `kind` `fight_survived` and `agentId()` `ag_fighter_01`); `dyingInAFightPublishesNothing` (`playerHurt`, `playerDied`, advance past the window, `endOfTick()`: no envelope); `engagedIsSentOncePerEncounter` (two `mobHurt` calls on the same mob: one provenance message with `kind` `engaged`); `aKillSendsKilledProvenance` (`killed` message after the kill); `withoutASinkFactsStillPublish` (`provenance` null: the kill envelope is published, nothing thrown); `anUnknownDimensionSendsNoProvenanceButStillPublishes` (`minecraft:custom`).
  - `CombatFactListenersTest`: `install` registers exactly `List.of(LivingDamageEvent.Post.class, LivingDeathEvent.class, ServerTickEvent.Post.class)`; no `Chat` or `Command` type.
- **Revert-checks** (R10): (1) in `mobDied` replace `EventEnvelope.isLifeId(killer) ? killer : null` with `killer` : `aHumanKillPublishesNothing` fails. (2) in `hostile` return `mob` without the `HostileMobs.isHostile(mob)` test : `aPeacefulMobPublishesNothing` fails. (3) in `endOfTick` delete the `publish(fact);` line : `survivingAFightPublishesOneFightSurvived` fails. (4) in `sendProvenance` delete `provenance == null || ` : `withoutASinkFactsStillPublish` fails.
- **Checks** GATE-NF with classes `CombatFactsTest`, `CombatFactListenersTest`.
- **Exit criteria** both classes pass; build passes; four revert-checks recorded; the PLAYER line, the index line and the OD-NF-4 difference are in the worknote.
- **ops (serial, owner go, after AN-NF-50):** a real kill and a real survived fight by a life on the scratch NeoForge shard; capture both `combat_fact` envelopes from the NeoForge stream and check them against `contract/schemas/combat-fact-event.schema.json`.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-47a.md`. **Commit** `feat(neoforge): combat facts and combat provenance for lives only, unregistered (AN-NF-47a)`. **Split line** step 1 and `CombatFactsTest` first; step 2 and `CombatFactListenersTest` second.

## AN-NF-51a: container-take provenance on NeoForge (BlockedDecision; not prescriptive)

- **id** AN-NF-51a. **wave** W8-NF. **repo** geldar. **twin of** AN-51a. **depends-on** OD-NF-3 answered; AN-51a merged with A1, A2 (`takeJson`), A4; P4 merged. **status** **BlockedDecision** (OD-NF-3). **Do not dispatch.**
- **Why this card cannot be prescriptive yet.** Paper's AN-51a reads `InventoryClickEvent` and `InventoryDragEvent` and the container's block from `Inventory#getLocation()`. In the NeoForge events this repo has compiled, only `PlayerContainerEvent.Open` and `.Close` exist (`getEntity()`, `getContainer()`, VERIFIED in `neoforge-ledger/.../curated/McReaders.java`), and `McReaders` reads only the menu's class name because the menu's block position is not read anywhere. Two facts are missing: (1) a slot-level event, or a ruling that a take is detected by comparing the container's contents at open and at close; (2) how to get the container's block position from an `AbstractContainerMenu` (UNVERIFIED; no accessor found).
- **What the owner chooses (OD-NF-3).** (a) Keep container taking inactive on NeoForge (recommended until a GameTest shows a slot-level hook); this card is then closed as "not needed". (b) Session diff: at `Open`, record the player's UUID, the container's block position and its item counts; at `Close`, for each item whose count fell, send one `take` message with the difference, `prior_owner` read with `PriorOwner.of` at open time. This sends one message per item per session, not one per click, and cannot tell a take by this player from a take by a hopper during the session. (c) Another mechanism the NeoForge campaign proves with a GameTest.
- **When answered** the orchestrator rewrites this card in the format of AN-NF-27a, with the names the GameTest proved.

## AN-NF-50: W8 wiring on NeoForge

- **id** AN-NF-50. **wave** W8-NF. **repo** geldar. **twin of** AN-50 (its plugin registration half). **depends-on** AN-NF-47a, AN-NF-28b merged. **status** BlockedDependency. **size** 25k. **branch** `phase1/an-nf-50-combat-wiring`. **worktree** `.claude/worktrees/an-nf-50`.
- **may-edit** `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java`, `neoforge/src/test/java/dev/geldar/neoforge/EvidenceSetupTest.java`, `neoforge/README.md` (the "Sheet evidence (inactive)" section only); the worknote.
- **must-not-edit** R6; every other file. No NATS change: `combat_fact` is a three-token subject the `neoforge` user already publishes (`geldar.<s>.*`), and `provenance.combat` is covered by AN-NF-28b's `geldar.<s>.provenance.>`.
- **decisions** D-CS-04, D-CS-06; activation stays D-CS-10 and the held-live ruling.
- **Step 0.** `Select-String` finds in `EvidenceSetup.java` the line `ProvenanceSink provenance = owners == null ? null : owners.provenanceSink();` (`blocked: AN-NF-28b`), and `Test-Path neoforge/src/main/java/dev/geldar/neoforge/CombatFacts.java` is `True` (`blocked: AN-NF-47a`).
- **Step 1.** In `EvidenceSetup.java`, directly after the closing `}` of the `if (provenance != null) { ... }` block, insert:
  ```java
          CombatFactListeners.install(
                  bus, new CombatFacts(lifecycle, export.shard(), Instant::now, provenance, ticks::get, sink), sink);
          count += 3;
  ```
  and add `import java.time.Instant;`. Combat facts are registered with or without the block-owner feature; their provenance is sent only when the sink exists.
- **Step 2.** In `neoforge/README.md`, at the end of the "Sheet evidence (inactive)" section, add: "When on, the setup also registers the combat listeners (`LivingDamageEvent.Post`, `LivingDeathEvent`, `ServerTickEvent.Post`). They publish `combat_fact` events (XP evidence, never agent-visible) for lives only, and combat provenance when the block-owner feature gives a sink. A human's fights are ignored."
- **Tests to change.** In `EvidenceSetupTest`: `withoutOwnersOnlyTheTickListener` becomes `withoutOwnersTheTickAndCombatListeners` (returns 4; types `[ServerTickEvent.Post, LivingDamageEvent.Post, LivingDeathEvent, ServerTickEvent.Post]`); `withOwnersRegistersBreakAndPickup` becomes `withOwnersRegistersEverything` (returns 6; types `[ServerTickEvent.Post, BreakBlockEvent, ItemEntityPickupEvent.Post, LivingDamageEvent.Post, LivingDeathEvent, ServerTickEvent.Post]`); `exportOffRegistersNothing` and `provenanceOffRegistersNothing` unchanged and still pass (the combat listeners are inside the on branch).
- **Revert-checks** (R10): (1) delete the inserted `CombatFactListeners.install(...)` call (two lines) and keep `count += 3;` : `withOwnersRegistersEverything` fails on the registered types. (2) change `count += 3;` to `count += 2;` : `withoutOwnersTheTickAndCombatListeners` fails.
- **Checks** GATE-NF with class `EvidenceSetupTest`.
- **Exit criteria** the class passes; build passes; two revert-checks recorded.
- **ops (serial, owner go):** the AN-NF-47a ops capture; full `./geldar.ps1 check`; one scratch start with `provenance.enabled=true` and one with it absent, confirming the operator log lines `geldar_neoforge sheet evidence on, listeners <n>` and `... off`.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-50.md`. **Commit** `feat(neoforge): register combat facts behind provenance.enabled (AN-NF-50)`. **Split line** none.

---

## Card count and notes

Seven cards: AN-NF-00, AN-NF-27a, AN-NF-26a, AN-NF-28b (W5-NF); AN-NF-47a, AN-NF-51a, AN-NF-50 (W8-NF). Six are prescriptive; AN-NF-51a is a decision card until OD-NF-3 is answered. None touches `contract/`, `plugin/`, `golem/`, `eventsink/` or SQL. None produces agent-visible text. All ship off (`provenance.enabled` absent means nothing is registered).

Not carded here, on purpose: the Body halves of AN-28b and AN-50 on NeoForge (subscription, leakage gate) wait for NF-BODY; proximity chat on NeoForge (NF-CHAT, OD-NF-5) is not a sheet card; P4 itself belongs to the NeoForge campaign.
