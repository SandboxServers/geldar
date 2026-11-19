# Sheet cards, NeoForge twins: provenance, combat facts and their wiring on the NeoForge shard

Status: **proposal, nothing dispatched.** Written 2026-11-18 against geldar `origin/main` = `a8063b0a`; revised the same day for the operator rulings (recorded as decisions 0321 "Combat XP is keyed by encounter", 0322 "The sheet campaign includes NeoForge as inert code", OD-NF-7 yes, and 0329 "On the NeoForge shard players and agents are equals", NF-1 to NF-6, **Proposed**, pending the operator's acceptance). Why these cards exist and which cards need no twin: [../sheet/neoforge-delta.md](../sheet/neoforge-delta.md). Proximity chat on NeoForge (NF-CHAT-0 to NF-CHAT-3, owned by the NeoForge campaign): [../sheet/neoforge-chat-plan.md](../sheet/neoforge-chat-plan.md).

**Decision 0329 in one paragraph.** On the NeoForge shard players and agents are equals; 0387 item 7 and 0059 (the part it relies on) do not apply there, and nothing changes on Paper. A human is named like any actor (NF-1, NF-2, NF-6), but an agent is told only what its own Body saw (NF-1), so nothing here may send an out-of-sight event toward an agent. Container-taking stays inactive (NF-3, AN-NF-51a Dropped). Kill credit is the killing blow (NF-4). The provenance feed is skipped on NeoForge for v1 (0329 Q1, answered 2026-11-18: the Body derives observations itself; raise its priority for v2), so the provenance cards are **Deferred to v2** and the NATS widening to `geldar.<s>.provenance.>` is not written (v2 would need it). The Paper cards they twin are in [work-packets-sheet-w3-w5.md](work-packets-sheet-w3-w5.md) (W5) and [work-packets-sheet-w6-w8.md](work-packets-sheet-w6-w8.md) (W8); those stay as written for the Paper shard.

**Inert code (decision 0322).** Every card here ships code that is merged but **off**: nothing registers unless `export.enabled` and `provenance.enabled` are both true, and no shard file or deploy setting turns them on. Every card, AN-NF-00 included, **merges only after P3-LIVE and P4 have merged** (P3-LIVE: the NeoForge export reaches the NeoForge stream; P4: the NeoForge block-owner log), even where its code could be written earlier. Activation on the NeoForge shard follows the held-live ruling like every other sheet feature and is never part of a card.

Every card here is **BlockedDependency** until its prerequisites merge, except AN-NF-51a, which is **Dropped** (0329 NF-3), and AN-NF-26a, AN-NF-27a and AN-NF-28b, which are **Deferred to v2 (0329 Q1: not needed for v1)**. A coder (Haiku, low effort) implements a card exactly as written. Nothing here is a judgment call: where a fact is not known, the card says **STOP** and what to report.

**Facts every card respects.**

- Repo: **geldar**. Area: `neoforge/` (the server-side NeoForge 26.1.2 (build 126) mod `geldar_neoforge`, Java 25). It consumes `plugin/core-common` as a composite build and packs it in its jar (`neoforge/README.md`, "Shared code and jnats"). No card here edits `plugin/`. **One exception to the area:** AN-NF-25 edits `contract/` and `golem/` only (no `neoforge/` file), under its own may-edit list, which replaces R6's bans on those two folders for that card alone.
- `neoforge/` belongs to the NeoForge campaign (session geldar-neoforge). The orchestrator messages that campaign before dispatching any card here; the cards edit only the files they list.
- The mod is **server-side only**: no registry entries, no payloads, no mixins, no chat. `neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java` fails the build if any of these strings appears anywhere in `neoforge/src/main` or `plugin/core-common/src/main` (code **and comments**, case-insensitive): `DeferredRegister`, `RegisterEvent`, `registerPayload`, `PayloadRegistrar`, `RegisterPayloadHandlersEvent`, `CustomPacketPayload`, `.registrar(`, `playToClient`, `playToServer`, `playBidirectional`, `DeferredHolder`, `DeferredBlock`, `DeferredItem`, `BuiltInRegistries`, `Registry.register`, `NetworkRegistry`, `RegistryObject`, `ChatEvent`, `ChatReceivedEvent`, `PlayerChatMessage`, `ServerChatEvent`, `ChatType`, `CommandEvent`, `broadcastChatMessage`, `handleChat`, `name mask`, `name_mask`, `namemask`, `name-mask`, `name.mask`, `chat_export`, `chatexport`, `chat-export`, `chat.export`, `chat.enabled`. Never type any of them. (NF-CHAT-0, a NeoForge-campaign card, will allow four chat event names in one package `dev.geldar.neoforge.hearing` only; no card in this file goes there.)
- **Players and agents are equals; an agent hears only what it saw (decision 0329).** Every name in a message here is the player's name, human or agent, with no blanking: a break's `actor` and `prior_owner`, a pickup's `thrower` (NF-1, NF-6). No message here goes to an agent: provenance goes to Bodies, which pass on only what they saw (AN-26b, AN-27b), and `combat_fact` goes to the eventsink as XP evidence and is never agent-visible. A field is `null` or a message is skipped only for a structural reason the card states (a `combat_fact` needs a `life_id`, AN-46; a pickup is useful only to a picker that is a life, because only a life has a Body that reads it). The merged P3 export still writes human events anonymously (`neoforge/README.md`, "Privacy"): that is telemetry privacy, P3's files, and not changed here (0329 Q5).
- **Off by default.** Everything here runs only when the export is on (`export.enabled`) **and** the new key `provenance.enabled` is true. Off registers no listener.
- No new dependency. No change to `neoforge/build.gradle.kts`, `neoforge/gradle.lockfile`, `neoforge/gradle/verification-metadata.xml` or any lock file. A card that seems to need one: STOP.
- Never start a server: no `./gradlew runServer`, no `runGameTestServer`, no `shard up`, no `adam up`, no live NATS. Real-server checks are ops, serial, after the owner's go.

## Dependency table

Prerequisites outside this file (defined in [../sheet/neoforge-delta.md](../sheet/neoforge-delta.md) sections 3 to 5): **P3-LIVE** (P3-6 merged and its scratch run passed), **P4** (NeoForge block-owner log with the section 4 requirements), **A1 to A4** (amendments to the Paper cards, merged with them), **A6, A7** (amendments to AN-24 and AN-25, or AN-NF-25 after them), **NF-BODY** (a NeoForge Body role), **0329 Q1** (provenance: answered 2026-11-18, not needed for v1, v2 priority), **NF-CHAT** (proximity chat; NeoForge campaign, [../sheet/neoforge-chat-plan.md](../sheet/neoforge-chat-plan.md)).

| Card | Wave | Depends on | Status | Fan-out |
|---|---|---|---|---|
| AN-NF-00 evidence config, bus, world names, setup skeleton | W5-NF | P3-1 to P3-3 (merged), AN-24 merged (wave order); merge after P3-LIVE and P4 | BlockedDependency (AN-24; P3-LIVE, P4 for merge) | unblocks 47a, 50 (and 26a, 27a, 28b in v2, 0329 Q1) |
| AN-NF-25 named player actor (contract and golem) | W5-NF | AN-24 and AN-25 merged; merge after P3-LIVE and P4 (0322) | BlockedDependency (AN-24, AN-25; P3-LIVE, P4 for merge); closes as "already applied" if A6 and A7 were folded into AN-24 and AN-25 | independent of every `neoforge/` card |
| AN-NF-27a break provenance | W5-NF (v2) | v2 revisit (0329 Q1), AN-NF-00, AN-27a with A1, A2, A4; merge after P3-LIVE and P4 | **Deferred to v2 (0329 Q1: not needed for v1)**; in v2 then BlockedDependency (AN-27a; P3-LIVE, P4) | parallel with 26a |
| AN-NF-26a pickup provenance | W5-NF (v2) | v2 revisit (0329 Q1), AN-NF-00, AN-26a with A1, A2; merge after P3-LIVE and P4 | **Deferred to v2 (0329 Q1: not needed for v1)**; in v2 then BlockedDependency (AN-26a; P3-LIVE, P4) | parallel with 27a |
| AN-NF-28b W5 wiring on NeoForge | W5-NF (v2) | v2 revisit (0329 Q1), AN-NF-26a, AN-NF-27a, P3-LIVE, P4 | **Deferred to v2 (0329 Q1: not needed for v1)**; in v2 then BlockedDependency (P3-LIVE, P4). Its NATS rows are removed; a later card adds them only after a 0383 amendment is accepted (v2 would need one) | integration, last of W5-NF |
| AN-NF-47a combat facts | W8-NF | AN-NF-00, AN-46, AN-47a with A3; merge after P3-LIVE and P4 | BlockedDependency (AN-46, AN-47a; P3-LIVE, P4) | parallel with AN-NF-25 |
| ~~AN-NF-51a container-take provenance~~ | W8-NF | none | **Dropped (0329 NF-3)**: container-taking stays inactive on NeoForge; the agent notices a theft itself. Not blocked, not to be rewritten | none |
| AN-NF-50 W8 wiring (combat facts) | W8-NF | AN-NF-47a, AN-NF-00, P3-LIVE, P4 | BlockedDependency (AN-NF-47a; P3-LIVE, P4) | integration, last |

Merge rule (0322 and the owner's delta-packet choice): every card merges only after P3-LIVE **and** P4 have merged, even where its code could be written earlier; merged, it stays off. AN-NF-26a, AN-NF-27a and AN-NF-28b are deferred to v2 (0329 Q1, answered 2026-11-18: v1 does not need them; revisit for v2 at raised priority). They are kept in full, not dispatched in v1, and not retired; the v1 cost is in the delta note section 3b. Proximity chat is not a card in this file: NF-CHAT-0 to NF-CHAT-3 belong to the NeoForge campaign and block HC-27b `spoke_first` and AN-49 on NeoForge.

## Shared files and who owns them

| Shared file | Owner in this file, in order | Everyone else |
|---|---|---|
| `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` | AN-NF-00 (adds one guarded call), then AN-NF-28b if dispatched (adds one argument to that call) | read only. P4 and NF-CHAT-2 (NeoForge campaign) also edit this file: P4 merges before AN-NF-28b; NF-CHAT-2 adds its own separate block |
| `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java` | AN-NF-00 creates it; AN-NF-50 adds lines below its marker comment; AN-NF-28b, if dispatched, adds its lines below them | AN-NF-26a, 27a, 47a write "index line to add" in their worknote |
| `contract/schemas/observation-event.schema.json`, `contract/src/generated/**`, `contract/test/observation-player-actor.test.ts`, `golem/src/perception/provenance/visible-actor.ts`, `golem/src/perception/provenance/visible-actor-naming.test.ts` | AN-NF-25 | read only for every other card here. AN-24 and AN-25 (W5, Paper cards) create the first and the fourth |
| `EvidenceConfig.java`, `EvidenceBus.java`, `WorldNames.java`, `VanillaIds.java`, `ServerTicks.java` (same folder) | AN-NF-00 | read only |
| `neoforge/README.md` | AN-NF-00 adds the section "Sheet evidence (inactive)"; AN-NF-28b and AN-NF-50 append lines inside it | nobody else |
| `deploy/nats-auth-nf.ps1`, `tools/repo-checks/src/nats-auth-nf.test.ts` | AN-NF-28b | P4 and NF-BODY (NeoForge campaign) edit them too; serial, P4 first |
| `ExportListeners.java`, `ExportHandlers.java`, `EventMapping.java`, `ExportConfig.java`, `ExportLifecycle.java`, `NeoForgeFacts.java`, `NoRegistryScanTest.java`, `ExportListenersTest.java` | nobody (P3's files) | read only |
| `plugin/**`, `contract/**` (except AN-NF-25's two contract files and the regenerated output), `golem/**` (except AN-NF-25's two golem files), `eventsink/**` | nobody | the Paper cards and AN-24, AN-46 own them |
| ledger, RESUME, `docs/decisions/**`, number registry | orchestrator, from "index line to add" | nobody |

## Shapes the twins rely on (created by the amended Paper cards, A1 to A4, A6, A7)

A1, A2 and A4 are used here only by AN-NF-26a, AN-NF-27a and AN-NF-28b (Deferred to v2, 0329 Q1). A2's `combatJson` is no longer used on NeoForge (AN-NF-47a sends no combat provenance); Paper keeps it. A6 and A7 (the named player actor) are created by AN-NF-25 when AN-24 and AN-25 did not carry them; their exact text is in that card.

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
// encounterKey = "enc:" + player + ":" + mobUuid.toLowerCase(Locale.ROOT)  (AN-46 pattern; player is a life id)
// A3, plugin/core-common/src/main/java/dev/geldar/core/combat/HostileMobs.java
public static boolean isHostile(String mobType)   // mobType without namespace, the ALWAYS_HOSTILE list of golem/src/perception/hostile-types.ts
```

The `combat_fact` payload (AN-46, `contract/schemas/combat-fact-event.schema.json`) is exactly `{ life_id, kind, mob, encounter_key }`; the eventsink pays `encounter_key` as the one combat key of the encounter (0321, AN-47b), the same key the Body's own kill record pays, so a kill on NeoForge is paid once whichever source reports it.

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

- **id** AN-NF-00. **wave** W5-NF. **repo** geldar. **twin of** none (unblocker). **depends-on** P3-1 to P3-3 (merged at `a8063b0a`), AN-24 merged (wave order only; nothing here imports it); merge after P3-LIVE and P4 (0322). **status** BlockedDependency (AN-24; P3-LIVE, P4 for merge); inert when merged. Unchanged by 0329: its only listener is the tick counter. **size** 35k. **branch** `phase1/an-nf-00-evidence-skeleton`. **worktree** `.claude/worktrees/an-nf-00`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/EvidenceConfig.java`, `EvidenceBus.java`, `WorldNames.java`, `VanillaIds.java`, `ServerTicks.java`, `EvidenceSetup.java`; new tests `neoforge/src/test/java/dev/geldar/neoforge/EvidenceConfigTest.java`, `WorldNamesTest.java`, `VanillaIdsTest.java`, `EvidenceSetupTest.java`; edit: `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` (one block, step 7), `neoforge/README.md` (one new section, step 8); the worknote.
- **must-not-edit** R6; every other file under `neoforge/`.
- **decisions** none new. Key names chosen here: `provenance.enabled` (the same key name Paper reads in `BlockOwnerSetup`, AN-28c) and environment `GELDAR_NEOFORGE_PROVENANCE`.
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

  The character-sheet campaign's NeoForge twins (docs/analysis/harness/work-packets-sheet-neoforge.md) add their listeners through `EvidenceSetup`. They run only when the export is on and `provenance.enabled` is `true` (environment `GELDAR_NEOFORGE_PROVENANCE` wins over the file; only `true` enables). Default: off, and nothing is registered. When on, the setup registers one `ServerTickEvent.Post` listener that keeps the server tick count; the later cards add the combat listeners. Every evidence listener runs at the lowest priority and never sees a cancelled event. Nothing these listeners publish is shown to an agent (decision 0329). Operator log lines: `geldar_neoforge sheet evidence off`, `geldar_neoforge sheet evidence on, listeners <n>`.
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

## AN-NF-25: the named player actor (contract and golem; inert on Paper)

- **id** AN-NF-25. **wave** W5-NF. **repo** geldar. **twin of** AN-24 and AN-25 (amendments A6 and A7 of the delta note, for 0329 NF-2). **depends-on** AN-24 and AN-25 merged; a contract regeneration slot (ask the slot holder, as AN-24 does); merge after P3-LIVE and P4 (0322; the operator may waive this gate for this card, since it touches no `neoforge/` file). **status** BlockedDependency (AN-24, AN-25; P3-LIVE, P4 for merge). Inert on Paper: every existing payload and every default call is unchanged. **size** 35k. **branch** `phase1/an-nf-25-player-actor`. **worktree** `.claude/worktrees/an-nf-25`.
- **why.** NF-2: the attacker (and any observed actor) is named, human or agent. AN-24's `ObservedActor` requires a `life` (`LifeId`), and AN-25 fills it with `lifeIdFor(username)`, which never fails: it hashes any username into `ag_<stem><hash>_01` (`golem/src/registry.ts:51`, VERIFIED), so a human would get an invented life id. This card adds a name-keyed `PlayerActor` and a naming mode that never invents a life id.
- **may-edit** `contract/schemas/observation-event.schema.json` (the `ObservedActor` `$def` only, and two new `$defs`), `contract/src/generated/**` (by `generate` only), `contract/test/observation-player-actor.test.ts` (new), `golem/src/perception/provenance/visible-actor.ts` (the one function and one new type and constant), `golem/src/perception/provenance/visible-actor-naming.test.ts` (new); the worknote.
- **must-not-edit** R6, except the files above; `contract/schemas/hurt-event.schema.json` (it already refers to `ObservedActor` by `$ref`); `contract/src/index.ts`; `contract/src/observation.ts`; `golem/src/perception/hurt-trigger.ts`, `golem/src/perception/hurt.ts`; `golem/src/perception/provenance/visible-actor.test.ts` (AN-25's; it must pass unchanged); `golem/src/adam/**`; every `threshold/` and `player-core/` file.
- **decisions** 0329 NF-1 and NF-2. Nothing here passes `'named'` in production; the NeoForge Body wiring does that once NF-BODY exists (not carded).
- **Step 0.** Each must hold; otherwise STOP with the reason:
  - `Select-String -Path contract/schemas/observation-event.schema.json -SimpleMatch -Pattern '"ObservedActor"'` prints at least one line (`blocked: AN-24`).
  - `Select-String -Path contract/schemas/observation-event.schema.json -SimpleMatch -Pattern '"PlayerActor"'` prints nothing. If it prints a line, A6 was folded into AN-24: write `already applied: A6` in the worknote and skip steps 1 and 2.
  - `Select-String -Path golem/src/perception/provenance/visible-actor.ts -SimpleMatch -Pattern 'export function observedActor('` prints one line (`blocked: AN-25`). If `Select-String ... -SimpleMatch -Pattern 'ActorNaming'` prints a line, A7 was folded into AN-25: write `already applied: A7` and skip steps 3 and 4. If both are already applied, the card closes with only the worknote.
  - The `ObservedActor` `$def` in `observation-event.schema.json` is an object with `"required": ["name", "life"]` and `"additionalProperties": false` (read it). Any other shape: STOP (`blocked: ObservedActor shape`).
- **Step 1.** In `contract/schemas/observation-event.schema.json`, rename the existing `$defs.ObservedActor` object to `$defs.LifeActor`, unchanged inside, and add its description `"An agent actor: its name and its life id."`. Add `$defs.PlayerActor`:
  ```json
  "PlayerActor": {
    "description": "A player actor with no life id (a human on the NeoForge shard, decision 0329): its name only.",
    "type": "object",
    "additionalProperties": false,
    "required": ["kind", "name"],
    "properties": {
      "kind": { "const": "player" },
      "name": { "$ref": "#/$defs/ActorName" }
    }
  }
  ```
  and a new `$defs.ObservedActor`:
  ```json
  "ObservedActor": {
    "description": "The visible causal actor: an agent with its life id, or a player with its name only (decision 0329).",
    "oneOf": [{ "$ref": "#/$defs/LifeActor" }, { "$ref": "#/$defs/PlayerActor" }]
  }
  ```
  Every existing `$ref` to `#/$defs/ObservedActor` (in this file and in `hurt-event.schema.json`) stays as it is.
- **Step 2.** Run `./geldar.ps1 pnpm --filter @geldar/contract generate`. Then `Select-String -Path contract/src/generated/types.ts -Pattern 'ObservedActor'` must show that `ObservedActor` is still exported as a type. If the generator throws, renames `ObservedActor`, or emits no union, STOP (`blocked: generator oneOf`) and paste its message in the worknote.
- **Step 3.** In `golem/src/perception/provenance/visible-actor.ts`:
  - Add, above `observedActor`:
    ```ts
    /** How a visible player is named (decision 0329): 'life' as on Paper; 'named' on the NeoForge shard. */
    export type ActorNaming = 'life' | 'named';

    /** The LifeId pattern of contract/schemas/common.schema.json (as golem/src/registry.ts keeps it). */
    const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;
    ```
  - Add a fourth parameter `naming: ActorNaming = 'life'` to `observedActor`, after `lifeIdOf`.
  - Replace the function's final return (the one that returns `{ name: username, life: lifeIdOf(username) }`) with:
    ```ts
    if (naming === 'named') {
      return LIFE_ID.test(username) ? { name: username, life: username } : { kind: 'player', name: username };
    }
    return { name: username, life: lifeIdOf(username) };
    ```
  - Change nothing else: the null cases (undefined, self, bad name, not visible through `findVisibleAgent`) stay as AN-25 wrote them and run before this return in both modes.
  - If the final return is not exactly `{ name: username, life: lifeIdOf(username) }`, STOP (`blocked: AN-25 return changed`).
- **Step 4.** Run `./geldar.ps1 pnpm typecheck`. If it fails on a reader of `actor.life` anywhere (golem, threshold, player-core), STOP (`blocked: actor.life reader <file>:<line>`); do not narrow it yourself.
- **Tests to write.**
  - `contract/test/observation-player-actor.test.ts` (imports as `contract/test/px-perception.test.ts` does: `validateHurtEvent` and `validateObservationPayload` from `../src/generated/validators.js`; a validator returns a boolean): `a life actor validates exactly as before` (a `gift_received` with `actor: { name: 'Kestrel', life: 'ag_kestrel_01' }`); `a player actor validates` (`actor: { kind: 'player', name: 'SomeHuman' }`); `a player actor with a life fails`; `a life actor with a kind fails`; `a player actor with a bad name fails` (`'Some Human'`); `a hurt with a player actor validates` (`{ type: 'hurt', source: 'melee', amount: 2, actor: { kind: 'player', name: 'SomeHuman' } }`); `a hurt with no actor still validates`.
  - `golem/src/perception/provenance/visible-actor-naming.test.ts`: build the fake bot the way AN-25's `visible-actor.test.ts` does (import its builder if it exports one; otherwise copy the builder function into this file). If AN-25's test has no fake bot with a visible and a hidden player, STOP (`blocked: no visible-actor fixture`). Tests: `life naming (the default) gives a hashed life id for a non-LifeId name, as on Paper` (`observedActor(bot, 'SomeHuman')` equals `{ name: 'SomeHuman', life: lifeIdFor('SomeHuman') }`); `named naming gives a visible human kind player and no life`; `named naming keeps a LifeId player's own id` (`ag_kestrel_01` gives `{ name: 'ag_kestrel_01', life: 'ag_kestrel_01' }`); `named naming never invents a life id` (for `SomeHuman` and for a managed-style `ag_kestrel`, the result has no `life` key); `named naming: an out-of-sight player stays anonymous` (null); `named naming: the Body itself is never an actor` (null).
- **Revert-checks** (R10, with `./geldar.ps1 pnpm test contract/test/observation-player-actor golem/src/perception/provenance/visible-actor-naming` instead of gradle): (1) remove `{ "$ref": "#/$defs/PlayerActor" }` from the `oneOf` and regenerate : `a player actor validates` fails. (2) in `'named'` mode return `{ name: username, life: lifeIdOf(username) }` : `named naming gives a visible human kind player and no life` fails. (3) change the default to `naming: ActorNaming = 'named'` : `life naming (the default) ...` fails. Restore and regenerate after each.
- **Checks** (this card's own, not GATE-NF): `git diff --check`; `./geldar.ps1 pnpm --filter @geldar/contract generate` then `./geldar.ps1 pnpm check:generated` (clean); `./geldar.ps1 pnpm test contract/test/observation contract/test/px-perception contract/test/agent-visible-text golem/src/perception/provenance golem/src/perception/hurt`; `./geldar.ps1 pnpm typecheck`; `./geldar.ps1 pnpm format`; `./geldar.ps1 pnpm lint`; `./geldar.ps1 pnpm check:repo`; `git merge-tree --write-tree origin/phase1/sheet-nf HEAD` shows no `CONFLICT`.
- **Exit criteria** all named tests pass, AN-24's and AN-25's own tests unchanged and green, `check:generated` clean, three revert-checks recorded.
- **Index lines to add** (worknote): the kit's HC-30a adapter reads `actorLife` only when `'life' in actor` (message the kit owner); AN-28a's marked-word drop of an actor name stays until 0329 Q2 is answered.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-25.md`. **Commit** `feat(character): name-keyed player actor and a naming mode, off on Paper (AN-NF-25)`. **Split line** steps 1 and 2 with the contract test first; steps 3 and 4 with the golem test second.

## AN-NF-27a: break provenance on NeoForge

- **Deferred to v2 (0329 Q1: not needed for v1).** The operator answered on 2026-11-18: skip the provenance feed for v1, the Body derives observations itself, raise its priority for v2. Deferred to v2, revisit; v1 does not need it. The card is kept in full for v2: it names every actor, human or agent (NF-1, NF-6), and the Body side (AN-27b) then needs a NeoForge option that drops the unattributed observation (not carded). The 0383 widening is not written; v2 would need it (AN-NF-28b).
- **id** AN-NF-27a. **wave** W5-NF (v2). **repo** geldar. **twin of** AN-27a. **depends-on** v2 revisit (0329 Q1); AN-NF-00; AN-27a merged with amendments A1, A2 (`breakJson`), A4; merge after P3-LIVE and P4. **status** Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (AN-27a, P3-LIVE, P4); inert when merged. **size** 35k. **branch** `phase1/an-nf-27a-break-provenance`. **worktree** `.claude/worktrees/an-nf-27a`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/BreakProvenance.java`, `BreakProvenanceListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/BreakProvenanceTest.java`, `BreakProvenanceListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (registration is AN-NF-28b: write "index line to add: `BreakProvenanceListeners.install(bus, new BreakProvenance(<cache>, <sink>, ticks::get), sink); count++;`" in the worknote).
- **decisions** D-CS-06; 0329 NF-1 and NF-6 (every actor and owner by name, human or agent; no blanking); OD-NF-4 does not apply.
- **Step 0.** Each command must print one line; otherwise STOP with `blocked: <file> lacks <pattern>`:
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceSink.java -SimpleMatch -Pattern 'void send(String tail, String json);'`
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/ProvenanceJson.java -SimpleMatch -Pattern 'public static String breakJson(String world, int x, int y, int z, String actor, String priorOwner, String block, long tick)'`
  - `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/provenance/PriorOwner.java -SimpleMatch -Pattern 'public static String of(OwnerCache cache, OwnerCache.Pos pos)'`
  - `Select-String -Path neoforge/src/main/java/dev/geldar/neoforge/EvidenceBus.java -SimpleMatch -Pattern 'void listenLast('`
- **Step 1.** Create `BreakProvenance.java`:
  ```java
  package dev.geldar.neoforge;

  import dev.geldar.core.blockowner.OwnerCache;
  import dev.geldar.core.provenance.PriorOwner;
  import dev.geldar.core.provenance.ProvenanceJson;
  import dev.geldar.core.provenance.ProvenanceSink;
  import java.util.function.LongSupplier;

  /** A player broke a block: one break provenance message, every name as the player's name (decision 0329). Free of NeoForge types. */
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
          if (player == null || player.isBlank()) {
              return false;
          }
          String priorOwner = PriorOwner.of(cache, new OwnerCache.Pos(world, x, y, z));
          sink.send(TAIL, ProvenanceJson.breakJson(world, x, y, z, player, priorOwner, block, tick.getAsLong()));
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
  - `BreakProvenanceTest`. Fixtures: a `RecordingSink implements ProvenanceSink` that keeps `(tail, json)` pairs; `OwnerCache cache = new OwnerCache(() -> 0L)`; to own a block call `cache.storeBase(OwnerCache.chunkOf(new OwnerCache.Pos("world", 1, 64, 2)), new OwnerSource.Owners(List.of(new OwnerSource.OwnedBlock(1, 64, 2, "ag_owner_01")), false))` (imports `dev.geldar.core.blockowner.OwnerSource`); tick supplier `() -> 1234L`; a life breaker `ag_breaker_01`; a human name `SomeHuman`. Tests: `anOwnedBlockBrokenByAnotherLifeSendsOneMessage` (tail `break`; JSON `world` `world`, `x` 1, `y` 64, `z` 2, `actor` `ag_breaker_01`, `prior_owner` `ag_owner_01`, `block` `oak_planks`, `tick` 1234); `anUnownedBlockHasNoPriorOwner` (base stored, block at another cell: `prior_owner` is JSON null); `aCacheMissHasNoPriorOwner` (no base: `prior_owner` null, one message); `aCancelledBreakSendsNothing`; `aNullSinkSendsNothing` (returns false, no exception); `aNullCacheSendsNothing`; `aHumanBreakerIsNamed` (breaker `SomeHuman`: one message, `actor` `SomeHuman`); `aHumanPriorOwnerIsNamed` (base owner `SomeHuman`, breaker `ag_breaker_01`: `prior_owner` `SomeHuman`); `aBlankPlayerSendsNothing` (`""` and `null`); `aModdedBlockSendsNothing` (`examplemod:thing`); `anUnknownDimensionSendsNothing` (`minecraft:custom`); `theNetherIsWorldNether` (`world` `world_nether`).
  - `BreakProvenanceListenersTest`: a `RecordingBus implements EvidenceBus`; `install` registers exactly `List.of(BreakBlockEvent.class)`; no registered type's simple name contains `Chat` or `Command`.
- **Revert-checks** (R10): (1) in the `breakJson` call replace `player` with `null` : `aHumanBreakerIsNamed` fails. (2) delete `cancelled || ` : `aCancelledBreakSendsNothing` fails. (3) in the `breakJson` call replace `priorOwner` with `null` : `aHumanPriorOwnerIsNamed` fails. (4) replace `VanillaIds.path(blockId)` with `blockId` : `aModdedBlockSendsNothing` fails. (5) delete the `player == null || player.isBlank()` block : `aBlankPlayerSendsNothing` fails.
- **Checks** GATE-NF with classes `BreakProvenanceTest`, `BreakProvenanceListenersTest`.
- **Exit criteria** both classes pass; build passes; five revert-checks recorded; the index line for AN-NF-28b is in the worknote.
- **ops (serial, after AN-NF-28b, owner go):** on the scratch NeoForge shard, a life breaks a block another life placed, and a capture of the `geldar.nf-scratch.provenance.break` message is attached to the worknote before AN-27b's fixtures are reused for NeoForge. A capture must use test accounts only: no real person's name goes into the repo (repo rule).
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-27a.md`. **Commit** `feat(neoforge): break provenance naming every actor, unregistered (AN-NF-27a)`. **Split line** none.

## AN-NF-26a: pickup provenance on NeoForge

- **Deferred to v2 (0329 Q1: not needed for v1).** The operator answered on 2026-11-18: skip the provenance feed for v1, the Body derives observations itself, raise its priority for v2. Deferred to v2, revisit; v1 does not need it. The card is kept in full for v2: the thrower is named, human or agent (NF-1), and the Body side (AN-26b) then needs a NeoForge option that drops the unattributed gift (not carded). The 0383 widening is not written; v2 would need it (AN-NF-28b).
- **id** AN-NF-26a. **wave** W5-NF (v2). **repo** geldar. **twin of** AN-26a. **depends-on** v2 revisit (0329 Q1); AN-NF-00; AN-26a merged with A1 and A2 (`pickupJson`); merge after P3-LIVE and P4. **status** Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (AN-26a, P3-LIVE, P4); inert when merged. **size** 35k. **branch** `phase1/an-nf-26a-pickup-provenance`. **worktree** `.claude/worktrees/an-nf-26a`.
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/PickupProvenance.java`, `PickupProvenanceListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/PickupProvenanceTest.java`, `PickupProvenanceListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (index line to add: `PickupProvenanceListeners.install(bus, new PickupProvenance(<sink>, ticks::get), sink); count++;`).
- **decisions** D-CS-06; 0329 NF-1 (the thrower by name, human or agent). A human picker sends nothing: only a life has a Body that reads a pickup (a structural skip, not a naming rule). Known difference from Paper (record it in the worknote): Paper's `Item#getThrower()` is a UUID even when the thrower is offline; this twin reads `ItemEntity#getOwner()`, which is the thrower entity only while it is loaded, so a pickup of an offline player's toss sends nothing.
- **Step 0.** As AN-NF-27a step 0, with the second line replaced by `-Pattern 'public static String pickupJson(String world, String picker, String thrower, String item, int count, int ageTicks, Double distance, long tick)'` and without the `PriorOwner` line.
- **Step 1.** Create `PickupProvenance.java`:
  ```java
  package dev.geldar.neoforge;

  import dev.geldar.core.EventEnvelope;
  import dev.geldar.core.provenance.ProvenanceJson;
  import dev.geldar.core.provenance.ProvenanceSink;
  import java.util.function.LongSupplier;

  /** A life picked up a stack another player threw: one pickup provenance message, the thrower by name (decision 0329). */
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
          String thrower = throwerName == null || throwerName.isBlank() ? null : throwerName;
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
  - `PickupProvenanceTest` (a `RecordingSink`; a mutable tick holder, `long[] t = {100L}` with supplier `() -> t[0]`; lives `ag_picker_01`, `ag_giver_01`; UUID strings `"u-picker"`, `"u-giver"`; human `SomeHuman`): `aTossByAnotherLifeSendsOneMessage` (tail `pickup`; JSON `picker` `ag_picker_01`, `thrower` `ag_giver_01`, `item` `bread`, `count` 3, `age_ticks` 40, `distance` 2.5, `tick` 100, `world` `world`); `pickingUpYourOwnTossSendsNothing` (same UUID); `noThrowerSendsNothing` (`throwerUuid` null); `aHumanThrowerIsNamed` (thrower `SomeHuman`: one message, `thrower` `SomeHuman`); `aBlankThrowerNameIsNull` (thrower name `""`: one message, `thrower` JSON null); `aHumanPickerSendsNothing`; `zeroItemsSendsNothing`; `aModdedItemSendsNothing`; `theCapHolds` (65 calls in tick 100 send 64, `dropped()` is 1); `theCapResetsNextTick` (after 64 in tick 100, one call in tick 101 sends); `aNullSinkSendsNothing`.
  - `PickupProvenanceListenersTest`: `install` registers exactly `List.of(ItemEntityPickupEvent.Post.class)`; no `Chat` or `Command` type.
- **Revert-checks** (R10): (1) delete `|| throwerUuid.equals(pickerUuid)` : `pickingUpYourOwnTossSendsNothing` fails. (2) change `sentThisTick >= MAX_PER_TICK` to `false` : `theCapHolds` fails. (3) delete the block `if (!EventEnvelope.isLifeId(pickerName)) { return false; }` : `aHumanPickerSendsNothing` fails. (4) replace `throwerName == null || throwerName.isBlank() ? null : throwerName` with `null` : `aHumanThrowerIsNamed` fails.
- **Checks** GATE-NF with classes `PickupProvenanceTest`, `PickupProvenanceListenersTest`.
- **Exit criteria** both classes pass; build passes; four revert-checks recorded; the index line and the offline-thrower difference are in the worknote.
- **ops (serial, after AN-NF-28b, owner go):** a real toss between two lives on the scratch NeoForge shard; attach the captured message (test accounts only); confirm a death drop sends nothing (UNVERIFIED until then).
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-26a.md`. **Commit** `feat(neoforge): pickup provenance naming the thrower, unregistered (AN-NF-26a)`. **Split line** none.

## AN-NF-28b: W5 wiring on NeoForge

- **Deferred to v2 (0329 Q1: not needed for v1).** The operator answered on 2026-11-18: skip the provenance feed for v1, raise its priority for v2. Deferred to v2, revisit; v1 does not need it. The card is kept in full. **This card has no NATS step.** The `neoforge` user publishes `geldar.<s>.*` only (0383), so the provenance subjects (four tokens) cannot be published until a separate decision amends 0383 and a separate card adds the grant to `deploy/nats-auth-nf.ps1` and `tools/repo-checks/src/nats-auth-nf.test.ts`. Neither is written (operator instruction, 2026-11-18); v2 would need both. Merged without that grant, the listeners this card registers publish nothing that NATS accepts, so the card is inert twice over.
- **id** AN-NF-28b. **wave** W5-NF (v2). **repo** geldar. **twin of** AN-28c (the plugin-setup half split out of the old AN-28b; the Body half, AN-28b, needs NF-BODY and is not in this card). **depends-on** v2 revisit (0329 Q1); AN-NF-26a, AN-NF-27a, AN-NF-50, P3-LIVE and P4 merged. **status** Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (P4). **size** 30k. **branch** `phase1/an-nf-28b-evidence-wiring`. **worktree** `.claude/worktrees/an-nf-28b`.
- **may-edit** `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java`, `neoforge/src/test/java/dev/geldar/neoforge/EvidenceSetupTest.java`, `neoforge/src/main/java/dev/geldar/neoforge/GeldarNeoForge.java` (the `EvidenceSetup.install(` call only), `neoforge/README.md` (the "Sheet evidence (inactive)" section only); the worknote.
- **must-not-edit** R6; `deploy/nats-auth-nf.ps1`; `tools/repo-checks/src/nats-auth-nf.test.ts`; every other file.
- **decisions** D-CS-06; 0329 (Q1: deferred to v2; no 0383 widening in this card). The coder writes no decision record.
- **Step 0.** Each must hold; otherwise STOP with the reason:
  - `Test-Path neoforge/src/main/java/dev/geldar/neoforge/NeoForgeBlockOwners.java` is `True`, and `Select-String` on that file finds both `public OwnerCache cache()` and `public ProvenanceSink provenanceSink()` (`blocked: P4 shape`).
  - In `GeldarNeoForge.java`, `Select-String -SimpleMatch -Pattern 'new NeoForgeBlockOwners('` prints exactly one line, and its line number is smaller than the line number of `EvidenceSetup.install(` (`blocked: P4 wiring order`). Write the variable name assigned on that line in the worknote; call it `<owners>` below.
  - `neoforge/README.md` has a heading line that contains `Block owners`, and the text between that heading and the next `## ` heading contains `EventPriority.LOWEST` or `next server tick` (`blocked: P4 read-before-write rule`, delta note section 4 item 5).
  - `Select-String -Path neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java -SimpleMatch -Pattern 'count += 3;'` prints one line (`blocked: AN-NF-50`).
- **Step 1.** In `EvidenceSetup.java`: change the `install` signature to add a last parameter `NeoForgeBlockOwners owners` (it may be null). Directly below the line `        count += 3;` (AN-NF-50's) insert:
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
- **Step 3.** In `neoforge/README.md`, at the end of the "Sheet evidence (inactive)" section, add one paragraph: "With the block-owner feature on (`NeoForgeBlockOwners` gives a provenance sink), the setup also registers the break and pickup provenance listeners, which would publish on `geldar.<shard>.provenance.break` and `.pickup` through that sink. The `neoforge` NATS user may not publish there yet (`deploy/nats-auth-nf.ps1` grants `geldar.<shard>.*` only; a grant needs a decision amending 0383). No Body on the NeoForge shard reads them yet: the NeoForge auth set has no Body role for sheet Bodies. Each Body passes on only what it saw itself (decision 0329)."
- **Tests to write or change.** `EvidenceSetupTest`: update every `install(...)` call to pass `null` as the new last argument; add `withoutOwnersTickAndCombatOnly` (owners null: returns 4, types `[ServerTickEvent.Post, LivingDamageEvent.Post, LivingDeathEvent, ServerTickEvent.Post]`); add `withOwnersAlsoRegistersBreakAndPickup` (build a `NeoForgeBlockOwners` test instance the way P4's own tests build one; if P4's tests have no way to build one without a server, STOP `blocked: no test seam for NeoForgeBlockOwners`): returns 6, types `[ServerTickEvent.Post, LivingDamageEvent.Post, LivingDeathEvent, ServerTickEvent.Post, BreakBlockEvent, ItemEntityPickupEvent.Post]` in that order.
- **Revert-checks** (R10): (1) in `EvidenceSetup.java` delete the `count++;` after the pickup install : `withOwnersAlsoRegistersBreakAndPickup` fails. (2) change `if (provenance != null)` to `if (true)` and keep owners null in the test : `withoutOwnersTickAndCombatOnly` fails (a NullPointerException or the wrong count).
- **Checks** GATE-NF with class `EvidenceSetupTest`.
- **Exit criteria** all named tests pass; build passes; two revert-checks recorded; `git diff --stat` shows no file outside may-edit (in particular no `deploy/` or `tools/` file).
- **ops (serial, owner go, only after a 0383 amendment and its grant card have merged):** render the NeoForge auth set on the scratch stack only; confirm the mod can publish `geldar.nf-scratch.provenance.break` and the `sink` and `human` users cannot subscribe to it. The Body half of AN-28b (subscription, the NeoForge option that drops unattributed results, leakage gate) waits for NF-BODY.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-28b.md`. **Commit** `feat(neoforge): register break and pickup provenance behind provenance.enabled, no NATS grant (AN-NF-28b)`. **Split line** none.

---

# Wave W8-NF

## AN-NF-47a: combat facts on NeoForge

- **id** AN-NF-47a. **wave** W8-NF. **repo** geldar. **twin of** AN-47a (its `combat_fact` half; the combat provenance half is not twinned, see below). **depends-on** AN-NF-00; AN-46 merged; AN-47a merged with A3; merge after P3-LIVE and P4. **status** BlockedDependency (AN-46, AN-47a, P3-LIVE, P4); inert when merged. **size** 40k. **branch** `phase1/an-nf-47a-combat-facts`. **worktree** `.claude/worktrees/an-nf-47a`.
- **No combat provenance on NeoForge (0329 NF-1).** Paper's AN-47a also sends `engaged` and `killed` provenance for AN-47c (`fight_seen`). On NeoForge the Body sees a fight itself (the damage packet names the source entity; a death is seen), so a server message about a fight would only add what the Body did not see. This card sends none; provenance on NeoForge is deferred to v2 (0329 Q1: not needed for v1).
- **may-edit** new: `neoforge/src/main/java/dev/geldar/neoforge/CombatFacts.java`, `CombatFactListeners.java`, `neoforge/src/test/java/dev/geldar/neoforge/CombatFactsTest.java`, `CombatFactListenersTest.java`; the worknote.
- **must-not-edit** R6; `EvidenceSetup.java` (registration is AN-NF-50; index line to add: `CombatFactListeners.install(bus, new CombatFacts(lifecycle, export.shard(), Instant::now, ticks::get, sink), sink); count += 3;`).
- **decisions** D-CS-04 (one award per encounter), 0321 (one combat key per encounter, shared with the Body's kill record), D-CS-06, **0329 NF-4 (kill credit is the killing blow)**. A `combat_fact` is XP evidence keyed by `life_id` (AN-46) and never agent-visible, so it is written for lives only: a human has no life, so a human's hit, kill or death opens or closes no encounter. That is structural, not a naming rule (0329). Whether humans should take part in progression is 0329 Q7, not this card.
- **Kill credit differs from Paper (NF-4, record it in the worknote).** NeoForge credits the player whose hit is the death's source (`LivingDeathEvent#getSource()` entity). Paper credits `LivingEntity#getKiller()`, the last player to damage the mob within a window. So on NeoForge a mob that a life hit and that then dies of a fall, of fire or to another mob gives that life no `hostile_kill`; on Paper it does. When a human lands the killing blow on a mob a life engaged, the life gets no `hostile_kill`; what the tracker then emits for the life (for example `fight_survived` after `FIGHT_END_TICKS`, or nothing) is A3's `mobDied` rule with a null killer, not this card's.
- **Step 0.**
  - `Select-String` finds in `plugin/core-common/src/main/java/dev/geldar/core/combat/EncounterTracker.java` each of: `public record Fact(String kind, String player, String mob, String encounterKey)`, `public void playerHurtByMob(String player, String playerUuid, String mobUuid, String mobType, long tick)`, `public Optional<Step> playerHitMob(String player, String playerUuid, String mobUuid, String mobType, long tick)`, `public List<Fact> mobDied(String mobUuid, String mobType, String killer, String killerUuid, long tick)`, `public void playerDied(String player, long tick)`, `public List<Fact> advance(long tick)`; in `HostileMobs.java`: `public static boolean isHostile(String mobType)`. Missing: STOP `blocked: A3 shape`.
  - `Test-Path contract/schemas/combat-fact-event.schema.json` is `True`, and `Select-String -Path contract/schemas/combat-fact-event.schema.json -SimpleMatch -Pattern '"life_id"'` prints a line (`blocked: AN-46`). The payload is `{ life_id, kind, mob, encounter_key }`; there is no `player` field.
- **Step 1.** Create `CombatFacts.java`:
  ```java
  package dev.geldar.neoforge;

  import com.google.gson.JsonObject;
  import dev.geldar.core.EventEnvelope;
  import dev.geldar.core.combat.EncounterTracker;
  import dev.geldar.core.combat.HostileMobs;
  import java.time.Instant;
  import java.util.List;
  import java.util.function.LongSupplier;
  import java.util.function.Supplier;

  /**
   * Combat facts for the sheet: XP evidence for the eventsink, never agent-visible. Keyed by life id (AN-46), so only
   * lives take part. Kill credit is the death source's player (decision 0329 NF-4). Free of NeoForge types.
   */
  public final class CombatFacts {
      public static final String TYPE = "combat_fact";

      private final ExportLifecycle lifecycle;
      private final String shard;
      private final Supplier<Instant> clock;
      private final LongSupplier tick;
      private final OperatorSink log;
      private final EncounterTracker tracker = new EncounterTracker();

      /** Publishes through {@code lifecycle} on {@code shard}; {@code tick} is the server tick count. */
      public CombatFacts(ExportLifecycle lifecycle, String shard, Supplier<Instant> clock, LongSupplier tick,
              OperatorSink log) {
          this.lifecycle = lifecycle;
          this.shard = shard;
          this.clock = clock;
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
      public void mobHurt(String player, String playerUuid, String mobUuid, String mobTypeId) {
          String mob = hostile(mobTypeId);
          if (mob == null || !EventEnvelope.isLifeId(player)) {
              return;
          }
          tracker.playerHitMob(player, playerUuid, mobUuid, mob, tick.getAsLong());
      }

      /** A hostile mob died; {@code killer} is the death source's player (the killing blow), or null. */
      public void mobDied(String mobUuid, String mobTypeId, String killer, String killerUuid) {
          String mob = hostile(mobTypeId);
          if (mob == null) {
              return;
          }
          String life = EventEnvelope.isLifeId(killer) ? killer : null;
          List<EncounterTracker.Fact> facts =
                  tracker.mobDied(mobUuid, mob, life, life == null ? null : killerUuid, tick.getAsLong());
          for (EncounterTracker.Fact fact : facts) {
              publish(fact);
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
              payload.addProperty("life_id", fact.player());
              payload.addProperty("kind", fact.kind());
              payload.addProperty("mob", fact.mob());
              payload.addProperty("encounter_key", fact.encounterKey());
              lifecycle.publish(EventEnvelope.create(clock.get(), shard, tick.getAsLong(), TYPE, fact.player(), payload));
          } catch (RuntimeException e) {
              log.warn("geldar_neoforge could not export combat_fact (" + e.getClass().getSimpleName() + ")");
          }
      }
  }
  ```
  `fact.player()` is always a life id here (every entry point filters with `EventEnvelope.isLifeId`), so `life_id` equals the envelope's `agent_id` and the life part of `encounter_key`, which the eventsink requires before it pays (AN-47b).
- **Step 2.** Create `CombatFactListeners.java` with `public static void install(EvidenceBus bus, CombatFacts facts, OperatorSink sink)` registering three listeners through `bus.listenLast`, each body inside `try { ... } catch (RuntimeException e) { sink.warn("geldar_neoforge combat listener failed (" + e.getClass().getSimpleName() + ")"); }`:
  1. `LivingDamageEvent.Post.class`: `LivingEntity hurt = event.getEntity(); Entity source = event.getSource().getEntity();` then: if `hurt instanceof ServerPlayer p && source != null && !(source instanceof Player)`, call `facts.playerHurt(p.getGameProfile().name(), p.getUUID().toString(), source.getUUID().toString(), typeId(source))`; else if `source instanceof ServerPlayer a && !(hurt instanceof Player)`, call `facts.mobHurt(a.getGameProfile().name(), a.getUUID().toString(), hurt.getUUID().toString(), typeId(hurt))`.
  2. `LivingDeathEvent.class`: `LivingEntity dead = event.getEntity();` if `dead instanceof ServerPlayer p`, call `facts.playerDied(p.getGameProfile().name())`; else `Entity killer = event.getSource().getEntity();` and call `facts.mobDied(dead.getUUID().toString(), typeId(dead), killer instanceof ServerPlayer k ? k.getGameProfile().name() : null, killer instanceof ServerPlayer k2 ? k2.getUUID().toString() : null)`. The killer is the death source's entity (the killing blow, NF-4); a projectile's source entity is its shooter in vanilla (UNVERIFIED on 26.1).
  3. `ServerTickEvent.Post.class`: `facts.endOfTick()`.

  Add `private static String typeId(Entity e) { return e.getType().builtInRegistryHolder().key().identifier().toString(); }`. Imports: `net.minecraft.server.level.ServerPlayer`, `net.minecraft.world.entity.Entity`, `net.minecraft.world.entity.LivingEntity`, `net.minecraft.world.entity.player.Player`, `net.neoforged.neoforge.event.entity.living.LivingDamageEvent`, `net.neoforged.neoforge.event.entity.living.LivingDeathEvent`, `net.neoforged.neoforge.event.tick.ServerTickEvent`. UNVERIFIED names: `DamageSource#getEntity`, `Entity#getUUID`, the `EntityType` holder chain. R8 on a compile failure.
- **Tests to write.**
  - `CombatFactsTest`. Fixtures: `InMemoryEventPublisher pub = new InMemoryEventPublisher();` `ExportLifecycle lifecycle = new ExportLifecycle(new ExportConfig(true, "nats://example.invalid:4222", "nf", null, null, 10), (c, log) -> pub, quiet);` then `lifecycle.start();`; `long[] t = {1000L}`; `CombatFacts facts = new CombatFacts(lifecycle, "nf", () -> Instant.parse("2026-11-18T12:00:00Z"), () -> t[0], quiet)`; mob `minecraft:zombie`, uuid `"m-1"`; lives `ag_fighter_01` (uuid `"u-f"`), `ag_other_02`; human `SomeHuman`. Tests: `aKillByALifePublishesOneHostileKill` (`mobHurt` then `mobDied` with killer `ag_fighter_01`: exactly one envelope, type `combat_fact`, `agentId()` `ag_fighter_01`, payload keys exactly `life_id`, `kind`, `mob`, `encounter_key`; `life_id` `ag_fighter_01`, `kind` `hostile_kill`, `mob` `zombie`, `encounter_key` `enc:ag_fighter_01:m-1`; note that the fixture UUID `"m-1"` is not a real UUID, so this test checks the key shape the tracker builds, and the ops capture checks the schema pattern); `aHumanKillPublishesNothing` (no life engaged, killer `SomeHuman`: no envelope, because a fact needs a life id); `aHumanKillingBlowGivesTheLifeNoHostileKill` (`mobHurt` by `ag_fighter_01`, then `mobDied` with killer `SomeHuman`: no envelope with `kind` `hostile_kill`; NF-4); `aLifeHitThenNoKillerGivesNoHostileKill` (`mobHurt` by `ag_fighter_01`, then `mobDied` with killer null, as for a fall: no envelope with `kind` `hostile_kill`; NF-4); `aPeacefulMobPublishesNothing` (`minecraft:cow`); `aModdedMobPublishesNothing` (`examplemod:beast`); `survivingAFightPublishesOneFightSurvived` (`playerHurt` at 1000, `t[0] = 1000 + EncounterTracker.FIGHT_END_TICKS + 1`, `endOfTick()`: one envelope with `kind` `fight_survived` and `agentId()` `ag_fighter_01`); `dyingInAFightPublishesNothing` (`playerHurt`, `playerDied`, advance past the window, `endOfTick()`: no envelope); `aHumanHurtOpensNoEncounter` (`playerHurt` for `SomeHuman`, advance past the window, `endOfTick()`: no envelope).
  - `CombatFactListenersTest`: `install` registers exactly `List.of(LivingDamageEvent.Post.class, LivingDeathEvent.class, ServerTickEvent.Post.class)`; no `Chat` or `Command` type.
- **Revert-checks** (R10): (1) in `mobDied` replace `EventEnvelope.isLifeId(killer) ? killer : null` with `killer` : `aHumanKillingBlowGivesTheLifeNoHostileKill` or `aHumanKillPublishesNothing` fails (write which). (2) in `hostile` return `mob` without the `HostileMobs.isHostile(mob)` test : `aPeacefulMobPublishesNothing` fails. (3) in `endOfTick` delete the `publish(fact);` line : `survivingAFightPublishesOneFightSurvived` fails. (4) in `playerHurt` delete `&& EventEnvelope.isLifeId(player)` : `aHumanHurtOpensNoEncounter` fails (if it does not, because A3's tracker drops a non-life on its own, write that in the worknote and skip this check).
- **Checks** GATE-NF with classes `CombatFactsTest`, `CombatFactListenersTest`.
- **Exit criteria** both classes pass; build passes; the revert-checks recorded; the index line and the NF-4 kill-credit difference are in the worknote.
- **ops (serial, owner go, after AN-NF-50):** a real kill and a real survived fight by a life on the scratch NeoForge shard; capture both `combat_fact` envelopes from the NeoForge stream and check them against `contract/schemas/combat-fact-event.schema.json`. Also a life's hit followed by a fall death of the mob: confirm no `hostile_kill` (NF-4).
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-47a.md`. **Commit** `feat(neoforge): combat facts for lives, killing-blow credit, unregistered (AN-NF-47a)`. **Split line** step 1 and `CombatFactsTest` first; step 2 and `CombatFactListenersTest` second.

## AN-NF-51a: container-take provenance on NeoForge (Dropped)

- **id** AN-NF-51a. **wave** W8-NF. **twin of** AN-51a. **status** **Dropped (decision 0329 NF-3, operator ruling 2026-11-18).** Not blocked and not to be rewritten.
- **Reason.** Container-taking stays inactive on NeoForge. Whether someone stole from the agent is for the agent to notice itself, from what its own Body sees of its chest. No server message reports a take on NeoForge, so AN-51b (the observed take) is inactive there too. Paper's AN-51a and AN-51b are unchanged.
- **What is not needed any more.** The open facts this card was waiting for (a slot-level container event on NeoForge 26.1, the block position of an `AbstractContainerMenu`, the session-diff option) are not needed by the sheet campaign. A2's `takeJson` and A4 stay for Paper.

## AN-NF-50: W8 wiring on NeoForge

- **id** AN-NF-50. **wave** W8-NF. **repo** geldar. **twin of** AN-50a (the sink and plugin registration card). **depends-on** AN-NF-47a, AN-NF-00, P3-LIVE and P4 merged (no longer AN-NF-28b: combat facts need no provenance sink). **status** BlockedDependency (AN-NF-47a; P3-LIVE, P4); inert when merged. **size** 25k. **branch** `phase1/an-nf-50-combat-wiring`. **worktree** `.claude/worktrees/an-nf-50`.
- **may-edit** `neoforge/src/main/java/dev/geldar/neoforge/EvidenceSetup.java`, `neoforge/src/test/java/dev/geldar/neoforge/EvidenceSetupTest.java`, `neoforge/README.md` (the "Sheet evidence (inactive)" section only); the worknote.
- **must-not-edit** R6; every other file. No NATS change: `combat_fact` is a three-token subject the `neoforge` user already publishes (`geldar.<s>.*`).
- **decisions** D-CS-04, D-CS-06, 0329 NF-4; activation stays D-CS-10 and the held-live ruling.
- **Step 0.** `Select-String` finds in `EvidenceSetup.java` the text `// Sheet evidence listeners: AN-NF-28b and AN-NF-50 add their lines below this comment.` on exactly one line (`blocked: AN-NF-00`), and `Test-Path neoforge/src/main/java/dev/geldar/neoforge/CombatFacts.java` is `True` (`blocked: AN-NF-47a`). If `EvidenceSetup.java` already contains `ProvenanceSink provenance`, STOP (`blocked: AN-NF-28b merged first`; the order is AN-NF-50, then AN-NF-28b).
- **Step 1.** In `EvidenceSetup.java`, directly below that comment line, insert:
  ```java
          CombatFactListeners.install(
                  bus, new CombatFacts(lifecycle, export.shard(), Instant::now, ticks::get, sink), sink);
          count += 3;
  ```
  and add `import java.time.Instant;`.
- **Step 2.** In `neoforge/README.md`, at the end of the "Sheet evidence (inactive)" section, add: "When on, the setup also registers the combat listeners (`LivingDamageEvent.Post`, `LivingDeathEvent`, `ServerTickEvent.Post`). They publish `combat_fact` events (XP evidence, never agent-visible) for lives only, because a fact is keyed by life id. Kill credit is the player whose hit is the death's source (the killing blow), unlike Paper, which credits the last player to damage the mob (decision 0329 NF-4). No combat provenance is sent."
- **Tests to change.** In `EvidenceSetupTest` (AN-NF-00's): `onRegistersTheTickListener` becomes `onRegistersTheTickAndCombatListeners` (returns 4; types `[ServerTickEvent.Post, LivingDamageEvent.Post, LivingDeathEvent, ServerTickEvent.Post]`; info has `geldar_neoforge sheet evidence on, listeners 4`); `exportOffRegistersNothing`, `provenanceOffRegistersNothing` and `onRegistersNoChatOrCommandListener` unchanged and still pass (the combat listeners are inside the on branch).
- **Revert-checks** (R10): (1) delete the inserted `CombatFactListeners.install(...)` call (two lines) and keep `count += 3;` : `onRegistersTheTickAndCombatListeners` fails on the registered types. (2) change `count += 3;` to `count += 2;` : `onRegistersTheTickAndCombatListeners` fails on the count.
- **Checks** GATE-NF with class `EvidenceSetupTest`.
- **Exit criteria** the class passes; build passes; two revert-checks recorded.
- **ops (serial, owner go):** the AN-NF-47a ops capture; full `./geldar.ps1 check`; one scratch start with `provenance.enabled=true` and one with it absent, confirming the operator log lines `geldar_neoforge sheet evidence on, listeners <n>` and `... off`.
- **Worknote** `docs/analysis/harness/worknotes/AN-NF-50.md`. **Commit** `feat(neoforge): register combat facts behind provenance.enabled (AN-NF-50)`. **Split line** none.

---

# Prerequisite: NF-CHAT (owned by the NeoForge campaign)

Proximity chat on NeoForge (spec 5.8; decision 0329 NF-5). The full cards are in [../sheet/neoforge-chat-plan.md](../sheet/neoforge-chat-plan.md); they are listed here so this file shows every NeoForge card the sheet waits on. **The sheet campaign dispatches none of them**: they edit `neoforge/` and its guard test, which belong to the NeoForge campaign (session geldar-neoforge); the orchestrator hands that campaign the plan.

| Card | What | Status | Blocks in the sheet campaign |
|---|---|---|---|
| NF-CHAT-0 | `NoRegistryScanTest` allows four chat event names in `HearingChat.java` only; needs its own decision record first | BlockedDecision (record not written; 0329 acceptance) | everything below |
| NF-CHAT-1 | `HearingJudge` over core-common `ChatHearing`, NeoForge-free, unused | Ready for the NeoForge campaign | none directly |
| NF-CHAT-S | Delivery spike on the scratch shard (ops and a NeoForge-campaign session) | BlockedDependency (NF-CHAT-0, NF-CHAT-1; operator go) | NF-CHAT-2 |
| NF-CHAT-2 | Proximity chat on the server, `hearing.enabled` off by default | BlockedDependency (NF-CHAT-S) | **HC-27b `spoke_first` and AN-49 on NeoForge** stay inactive until NF-CHAT-2 is merged and switched on |
| NF-CHAT-3 | Muffled notices, no speech hash | BlockedDecision (a 0383 amendment for the hearing subject; NF-BODY) | none (no sheet row reads `heard_muffled`) |

---

## Card count and notes

Eight ids (decision 0329 revision, 2026-11-18):

| Card | Status |
|---|---|
| AN-NF-00 | BlockedDependency (AN-24; P3-LIVE, P4 for merge) |
| AN-NF-25 (new) | BlockedDependency (AN-24, AN-25; P3-LIVE, P4 for merge); closes as "already applied" if A6 and A7 were folded into AN-24 and AN-25 |
| AN-NF-27a | Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (AN-27a; P3-LIVE, P4) |
| AN-NF-26a | Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (AN-26a; P3-LIVE, P4) |
| AN-NF-28b | Deferred to v2 (0329 Q1: not needed for v1); in v2 then BlockedDependency (AN-NF-50; P3-LIVE, P4); no NATS step |
| AN-NF-47a | BlockedDependency (AN-46, AN-47a; P3-LIVE, P4); combat facts only |
| AN-NF-51a | Dropped (0329 NF-3) |
| AN-NF-50 | BlockedDependency (AN-NF-47a; P3-LIVE, P4) |

Order once unblocked (v1): AN-NF-00, then AN-NF-47a and AN-NF-25 in parallel, then AN-NF-50. AN-NF-27a, AN-NF-26a and AN-NF-28b are deferred to v2 (0329 Q1: not needed for v1); in v2 they follow AN-NF-50, after a 0383 amendment and its grant card. Only AN-NF-25 touches `contract/` and `golem/` (inert on Paper: defaults unchanged). None touches `plugin/`, `eventsink/` or SQL. None produces agent-visible text. All ship off (`provenance.enabled` absent means nothing is registered) and merge only after P3-LIVE and P4 (0322): merged, inert, off.

Not carded here, on purpose: the Body halves on NeoForge (AN-28b, AN-50b: subscription, the `'named'` actor naming of A7, leakage gate) wait for NF-BODY; Body-derived observation cards for NeoForge (AN-NF-26b-native, AN-NF-27b-native, AN-NF-47c-native) are not written, names reserved (0329 Q1 skipped provenance for v1; what each could cover is in the delta note section 3b); proximity chat (NF-CHAT-0 to NF-CHAT-3) is planned in [../sheet/neoforge-chat-plan.md](../sheet/neoforge-chat-plan.md) and belongs to the NeoForge campaign; P4 itself belongs to the NeoForge campaign.
