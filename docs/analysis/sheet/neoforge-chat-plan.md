# NF-CHAT: proximity chat on the NeoForge shard (plan and cards)

Status: **proposal, nothing dispatched.** Written 2026-11-18 by the sheet campaign against geldar `origin/main` = `a8063b0a`, for operator ruling NF-5 (decision 0329, Proposed): "Plan proximity chat for NeoForge (NF-CHAT, spec 5.8) as its own prerequisite card set." It edits no code. Delta note: [neoforge-delta.md](neoforge-delta.md); twin cards: [../harness/work-packets-sheet-neoforge.md](../harness/work-packets-sheet-neoforge.md).

Tags as in the delta note: **VERIFIED** = read in this repo (path given) or compiled by merged code; **UNVERIFIED** = needs a GameTest, a scratch run, an owner answer, or a source read not done here. Every UNVERIFIED NeoForge or Minecraft name in a card is a **STOP** point (rule C8 below), never a guess.

## 1. Summary

| Question | Answer |
|---|---|
| What it is | Spec 5.8 on the NeoForge shard: speech reaches only listeners within 32 raw blocks whose effective distance (raw distance plus block absorption) is within 32; listeners in the muffle margin get a notice with no words; "There is no global chat" |
| What it blocks | **HC-27b `spoke_first`** (kit: reads `speech` with `to_me`) and **AN-49** (eventsink conversation exchange: "B's Body heard A"). Both stay inactive on NeoForge until NF-CHAT-2 is merged and switched on. More broadly, every agent on the NeoForge shard hears global chat until then (telepathy, against spec 5.8), whatever the sheet does |
| Owner on the NeoForge side | **The NeoForge campaign** (session geldar-neoforge), which owns `neoforge/`, `NoRegistryScanTest` and the NeoForge auth set. The sheet campaign writes this plan and consumes the result; it dispatches none of these cards |
| Which campaign | **The NeoForge campaign, not the sheet campaign.** Reasons: (1) `neoforge/` and its guard test belong to it; (2) spec 5.8 is a world rule for every agent, not a sheet feature; (3) it changes what human players on a public shard experience, which is an operator-facing product change; (4) it narrows a guard that implements a decision (0375 context) and needs its own record. The sheet campaign tracks it as prerequisite NF-CHAT in the delta note and the ledger |
| Prerequisites | NF-CHAT-0 (a decision record and the guard narrowing); the delivery proof (NF-CHAT-S, ops); for muffled notices only: a 0383 amendment for the hearing subject and NF-BODY |
| Off by default | Yes: nothing registers unless `hearing.enabled` is `true`. The key avoids the banned text `chat.enabled`. Switching it on is an operator-approved node step (section 5, Q-C4) |

## 2. What exists (VERIFIED)

- **Paper.** `plugin/core/src/main/java/dev/geldar/core/proximity/ProximityChatListener.java` (123 lines): on Paper's async chat event it hops to the server thread (`ChatHop`), judges every other player with `ChatHearing`, removes the players who do not hear clearly from the event's viewers, and sends `heard_muffled` notices to agents in the muffle tier through `HearingNoticeSink`. The speaker keeps their line; a failed hop silences everyone else (fail closed). `ProximityDeathListener.java` limits death messages to 32 blocks (spec 5.9). Wiring: `plugin/core/src/main/java/dev/geldar/core/GeldarCore.java` lines 134 to 154, settings `chat.muffle.*`.
- **Shared, Bukkit-free (core-common, packed into the NeoForge jar).** `plugin/core-common/src/main/java/dev/geldar/core/proximity/`: `ChatHearing` (`judge(long tick, String speaker, double sx, double sy, double sz, List<Candidate> listeners, BlockReader reader)` returns `List<Verdict>`; `Candidate(String key, boolean sameWorld, double x, double y, double z)`; `Verdict(String key, Tier tier, MuffledNotice notice)`; it catches `UnloadedBlock`, lines 95 and 118), `BlockReader` (`BlockProbe at(int x, int y, int z)`, `default int buildLimit()`), `BlockProbe(String id, boolean solid, boolean open)`, `MuffleSettings.defaults()`, `Tier` (`CLEAR`, `MUFFLED`, `SILENT`), `ProximityRule.HEARING_RADIUS_BLOCKS = 32.0`, `NatsHearingSink` (publishes on `geldar.<shard>.body.<life_id>.hearing`). `NoRegistryScanTest` already scans core-common for the chat words, so these files hold none of them.
- **The Body.** `golem/src/voice/ears.ts`: "player chat only, never system messages"; it reads the `playerChat` client packet (`sender`, `senderName`, `plainMessage`) and mineflayer's `chat` event. So a line re-delivered as a system message would never be heard: delivery must stay player chat.
- **The guard.** `neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java`, `CHAT_WORDS` (18 strings, matched case-insensitively anywhere in `neoforge/src/main`, `plugin/core-common/src/main` and `neoforge/src/main/resources`, comments included): `ChatEvent`, `ChatReceivedEvent`, `PlayerChatMessage`, `ServerChatEvent`, `ChatType`, `CommandEvent`, `broadcastChatMessage`, `handleChat`, five spellings of "name mask", four of "chat export", `chat.enabled`. Its comment: "Chat is not exported and no name mask exists (README, Events)".
- **Decision 0375** (Proposed) is about **telemetry**: the separate ledger mod (`neoforge-ledger/`) exports human chat only with a name mask, off by `collector.chat.enabled=false`. NF-CHAT exports no chat text and builds no mask, so 0375 is not changed. What NF-CHAT changes is the guard: the mod would read the chat event for the first time.
- **NATS.** The `neoforge` user publishes `geldar.<s>.*` only (0383, `deploy/nats-auth-nf.ps1`). The hearing subject has five tokens, so muffled notices need a grant (NF-CHAT-3).
- **The bus seam.** `neoforge/src/main/java/dev/geldar/neoforge/ExportListeners.java`: `public interface Bus { <E extends Event> void listen(Class<E> type, Consumer<E> handler); }` and `ExportListeners.neoForgeBus()`. Public, so the hearing setup reuses it read-only.

## 3. Design

1. On the NeoForge chat event (`ServerChatEvent`, UNVERIFIED accessors on 26.1), the mod **cancels the event** and then delivers the line itself, as player chat, to the speaker and to each other player whose tier is `CLEAR`. Vanilla has no viewer set to trim (Paper's approach); cancel and re-send is the replacement (UNVERIFIED, proven by NF-CHAT-S).
2. The judge is `ChatHearing` from core-common, unchanged, through a small NeoForge-free class (`HearingJudge`) so it is unit-tested without a server.
3. Fail closed: if anything fails after the cancel (off the server thread, an exception), only the speaker gets the line. Global chat is never the fallback.
4. Same rule for every listener, agent or human (players and agents are equals, 0329), unless the operator rules otherwise (Q-C1).
5. Muffled notices (`heard_muffled`) are a later card (NF-CHAT-3); until then the muffle tier is silent on NeoForge. The notice never carries a speech hash on NeoForge (a hash of possibly human-written text is telemetry, 0387 item 8 and 0375).
6. Only one file reads chat: `neoforge/src/main/java/dev/geldar/neoforge/HearingChat.java`. The guard allows four chat event names there and nowhere else (NF-CHAT-0). The mask and export words stay banned everywhere.

## 4. Cards

Rules for every card (C1 to C9; they mirror the twin file's R1 to R11):

- **C1 size** one Haiku coder, about 40k tokens. **C2 branch** `phase1/nf-chat-<n>-<slug>` from the NeoForge campaign's wave branch (its orchestrator names it); worktree `.claude/worktrees/nf-chat-<n>`. Never push, tag, open a PR or merge. **C3 worknote** `docs/analysis/neoforge/worknotes/NF-CHAT-<n>.md` (base SHA, each step, each revert-check, every STOP). **C4 commit** the subject on the card plus the dispatch's attribution lines. **C5 on-cap** commit what passes, note the rest, stop.
- **C6 must-not-edit** `docs/spec.md`; accepted decisions; `plugin/**`; `contract/**`; `golem/**`; `eventsink/**`; `sql/**`; `prompts/**`; `compose/**`; `shards/**`; `geldar.ps1`; `deploy/**`; every lock file and `neoforge/build.gradle.kts`, `neoforge/gradle/**`; `neoforge-ledger/**`; P3's files (`ExportListeners.java`, `ExportHandlers.java`, `EventMapping.java`, `ExportConfig.java`, `ExportLifecycle.java`, `NeoForgeFacts.java`, `ExportListenersTest.java`); any file not on the card's may-edit list.
- **C7 gate** (PowerShell, worktree root): `git diff --check` prints nothing; `Push-Location neoforge; ./gradlew test --tests 'dev.geldar.neoforge.<Class>'; Pop-Location` for each named class; `Push-Location neoforge; ./gradlew build; Pop-Location` (a network error: once more, then STOP `blocked: gradle network`); `./geldar.ps1 pnpm check:repo`.
- **C8 compile stops.** A `cannot find symbol`, `does not exist`, `cannot be applied to given types` or `incompatible types` on a NeoForge or Minecraft name the card wrote: STOP, paste the compiler line, report `blocked: compile <symbol>`. Never try another name.
- **C9 style** as `neoforge/src/main/java/dev/geldar/neoforge/ExportHandlers.java`: four spaces, braces on every `if`, javadoc on every public class and method, no wildcard imports; JUnit 6; LF; soft 500 and hard 700 lines; no `Utils` or `Helpers` class. Never start a server (`runServer`, `runGameTestServer`, `shard up`, `adam up`).

| Card | What | Depends on | Status |
|---|---|---|---|
| NF-CHAT-0 | Guard narrowing in `NoRegistryScanTest` (four chat event names allowed in `HearingChat.java` only) | A decision record written by the NeoForge orchestrator before dispatch | BlockedDecision (record not written; operator acceptance of 0329 NF-5) |
| NF-CHAT-1 | `HearingJudge`, a NeoForge-free wrapper over `ChatHearing`, and its tests | none (core-common is merged) | Ready for the NeoForge campaign once it schedules NF-CHAT; inert (nothing calls it) |
| NF-CHAT-S | Delivery spike (ops plus a NeoForge-campaign session, not a Haiku card): prove the cancel and re-send path on the scratch NeoForge shard | NF-CHAT-0, NF-CHAT-1 | BlockedDependency; operator go for a scratch run |
| NF-CHAT-2 | `HearingConfig`, `LevelBlockReader`, `HearingChat`, `HearingSetup`, one block in `GeldarNeoForge.java`, README | NF-CHAT-0, NF-CHAT-1, NF-CHAT-S result | BlockedDependency (NF-CHAT-S) |
| NF-CHAT-3 | Muffled notices through `NatsHearingSink` with no speech hash | NF-CHAT-2; a 0383 amendment granting `neoforge` publish on `geldar.<s>.body.*.hearing`; NF-BODY | BlockedDecision (0383 amendment, NF-BODY); not prescriptive |

### NF-CHAT-0: the guard allows the chat event in one file

- **Before dispatch (orchestrator, not the coder):** write a decision record "NeoForge proximity chat may read the chat event in one file" (Proposed): the mod reads `ServerChatEvent` in `HearingChat.java` only, to route speech by distance (spec 5.8); it exports no chat text and has no name mask (0375 unaffected); the guard keeps every other word everywhere. Put its number in the card brief as `<NNNN>`.
- **may-edit** `neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java`; the worknote. **must-not-edit** C6; every file under `neoforge/src/main`.
- **Step 0.** `Select-String -Path neoforge/src/test/java/dev/geldar/neoforge/NoRegistryScanTest.java -SimpleMatch -Pattern 'private static final List<String> CHAT_WORDS = List.of('` prints one line; and `Test-Path neoforge/src/main/java/dev/geldar/neoforge/HearingChat.java` is `False`. Otherwise STOP (`blocked: guard changed`).
- **Step 1.** Replace the `CHAT_WORDS` declaration (with its javadoc line) by:
  ```java
      /** Chat is not exported and no name mask exists (README, Events). Matched case-insensitively, as FORBIDDEN is. */
      private static final List<String> CHAT_WORDS = List.of(
              "ChatReceivedEvent", "CommandEvent", "broadcastChatMessage", "handleChat", "name mask", "name_mask",
              "namemask", "name-mask", "name.mask", "chat_export", "chatexport", "chat-export", "chat.export",
              "chat.enabled");

      /**
       * The chat event names that proximity chat (spec 5.8, decision <NNNN>) may use in {@link #HEARING_FILE} and
       * nowhere else. "ChatEvent" also matches "ServerChatEvent".
       */
      private static final List<String> CHAT_EVENT_WORDS = List.of(
              "ChatEvent", "ServerChatEvent", "PlayerChatMessage", "ChatType");

      /** The one main source file that may read the chat event. */
      private static final Path HEARING_FILE = JAVA_ROOT.resolve(Path.of("dev", "geldar", "neoforge", "HearingChat.java"));

      /** The 18 chat words before decision <NNNN>, so the split cannot drop one. */
      private static final List<String> CHAT_WORDS_BEFORE = List.of(
              "ChatEvent", "ChatReceivedEvent", "PlayerChatMessage", "ServerChatEvent", "ChatType", "CommandEvent",
              "broadcastChatMessage", "handleChat", "name mask", "name_mask", "namemask", "name-mask", "name.mask",
              "chat_export", "chatexport", "chat-export", "chat.export", "chat.enabled");
  ```
  `JAVA_ROOT` is declared below `CHAT_WORDS` today: move the three `Path` constants (`JAVA_ROOT`, `RESOURCE_ROOT`, `CORE_COMMON_JAVA_ROOT`) above the new lists so `HEARING_FILE` compiles. Change nothing else in those three lines.
- **Step 2.** Add a helper `private static List<String> both() { List<String> all = new ArrayList<>(CHAT_WORDS); all.addAll(CHAT_EVENT_WORDS); return all; }`. In `packedCoreCommonSourcesReferenceNoChatEventOrNameMask` and `mainResourcesHaveNoChatExportOrNameMaskKey`, replace `CHAT_WORDS` with `both()` (core-common and the resources keep the full ban). Leave `mainSourcesReferenceNoChatEventOrNameMask` scanning `CHAT_WORDS` (now without the four event names).
- **Step 3.** Change the four-argument `scan` into a five-argument one with a last parameter `Path skip`, and inside the file loop, first thing, add `if (skip != null && file.normalize().equals(skip.normalize())) { continue; }`. Keep a four-argument overload that calls it with `null`, so every existing call compiles unchanged.
- **Step 4.** Add the tests:
  ```java
      /** Proximity chat reads the chat event in one file only (decision <NNNN>). */
      @Test
      void chatEventNamesOnlyInTheHearingFile() throws IOException {
          assertEquals(List.of(), scan(JAVA_ROOT, ".java", CHAT_EVENT_WORDS, HEARING_FILE),
                  "chat event name found outside HearingChat.java");
      }

      /** The split keeps every word the guard had before; none was dropped. */
      @Test
      void theSplitKeepsEveryChatWord() {
          assertEquals(new java.util.TreeSet<>(CHAT_WORDS_BEFORE), new java.util.TreeSet<>(both()));
      }
  ```
  (Use an import for `java.util.TreeSet` instead of the qualified name, per C9.)
- **Step 5.** Change the class javadoc's last sentence to: "Scans the main sources and resources for the registry and payload APIs by name, case-insensitively, and allows the chat event names in HearingChat.java only (decision <NNNN>)."
- **Revert-checks** (make the edit, run `NoRegistryScanTest`, confirm the named test fails, restore with `git checkout --`): (1) remove `"chat.enabled"` from `CHAT_WORDS` : `theSplitKeepsEveryChatWord` fails. (2) pass `null` instead of `HEARING_FILE` and create a scratch file `neoforge/src/main/java/dev/geldar/neoforge/Scratch.java` holding the comment `// ServerChatEvent` : `chatEventNamesOnlyInTheHearingFile` fails (delete the scratch file after). (3) in `both()` drop `addAll(CHAT_EVENT_WORDS)` and put the comment `// ServerChatEvent` into a scratch file under `plugin/core-common/src/main/java/dev/geldar/core/` : `packedCoreCommonSourcesReferenceNoChatEventOrNameMask` fails (delete the scratch file after; it is outside may-edit and must not be committed).
- **Checks** C7 with class `NoRegistryScanTest`. **Exit** green; three revert-checks recorded; `git status` clean apart from the one test file and the worknote.
- **Commit** `test(neoforge): the chat event may be read in HearingChat.java only (NF-CHAT-0)`.

### NF-CHAT-1: the judge, free of NeoForge types

- **may-edit** new `neoforge/src/main/java/dev/geldar/neoforge/HearingJudge.java`, new `neoforge/src/test/java/dev/geldar/neoforge/HearingJudgeTest.java`; the worknote. **must-not-edit** C6. No chat word from `NoRegistryScanTest` may appear in either file (the main file is scanned; keep the test file clean too).
- **Step 0.** `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/proximity/ChatHearing.java -SimpleMatch -Pattern 'public List<Verdict> judge(long tick, String speaker, double sx, double sy, double sz,'` prints one line, and `Select-String -Path plugin/core-common/src/main/java/dev/geldar/core/proximity/MuffleSettings.java -SimpleMatch -Pattern 'public static MuffleSettings defaults()'` prints one line. Otherwise STOP (`blocked: core-common proximity API changed`).
- **Step 1.** Create `HearingJudge.java`:
  ```java
  package dev.geldar.neoforge;

  import dev.geldar.core.proximity.BlockReader;
  import dev.geldar.core.proximity.ChatHearing;
  import dev.geldar.core.proximity.Tier;
  import java.util.ArrayList;
  import java.util.HashSet;
  import java.util.List;
  import java.util.Set;

  /**
   * Who hears one spoken line (spec 5.8, decision 0199): the shared ChatHearing judge over plain positions, so it is
   * tested without a server. Every listener is judged the same way, agent or human (decision 0329).
   */
  public final class HearingJudge {
      /** One other player: its name, its dimension id and its feet position. */
      public record Listener(String name, String dimension, double x, double y, double z) {}

      /** The names that hear the words, and the verdicts of those in the muffle tier. */
      public record Result(Set<String> clear, List<ChatHearing.Verdict> muffled) {}

      private final ChatHearing hearing;

      /** Judges with {@code hearing}; not thread-safe, as ChatHearing is not. Server thread only. */
      public HearingJudge(ChatHearing hearing) {
          this.hearing = hearing;
      }

      /** Judges {@code others} for a line from {@code speaker}; the speaker is never one of its own listeners. */
      public Result judge(long tick, String speaker, String dimension, double x, double y, double z,
              List<Listener> others, BlockReader reader) {
          List<ChatHearing.Candidate> candidates = new ArrayList<>();
          for (Listener listener : others) {
              if (listener.name() == null || listener.name().equals(speaker)) {
                  continue;
              }
              boolean sameWorld = dimension != null && dimension.equals(listener.dimension());
              candidates.add(new ChatHearing.Candidate(listener.name(), sameWorld, listener.x(), listener.y(),
                      listener.z()));
          }
          Set<String> clear = new HashSet<>();
          List<ChatHearing.Verdict> muffled = new ArrayList<>();
          for (ChatHearing.Verdict verdict : hearing.judge(tick, speaker, x, y, z, candidates, reader)) {
              if (verdict.tier() == Tier.CLEAR) {
                  clear.add(verdict.key());
              } else if (verdict.tier() == Tier.MUFFLED) {
                  muffled.add(verdict);
              }
          }
          return new Result(Set.copyOf(clear), List.copyOf(muffled));
      }
  }
  ```
- **Tests** (`HearingJudgeTest`; `HearingJudge judge = new HearingJudge(new ChatHearing(MuffleSettings.defaults(), line -> {}))`; an air reader `BlockReader air = (x, y, z) -> new BlockProbe("minecraft:air", false, false)`; a stone reader with `"minecraft:stone", true, false`; an unloaded reader `(x, y, z) -> { throw new UnloadedBlock(); }`; speaker `ag_speaker_01` at `(0, 64, 0)` in `minecraft:overworld`): `aListenerTenBlocksAwayInTheOpenHearsClearly` (`SomeHuman` at `(10, 64, 0)`: `clear` is `Set.of("SomeHuman")`); `aHumanAndAnAgentAreJudgedAlike` (`SomeHuman` and `ag_other_02` both at 10 blocks: both in `clear`); `aListenerFortyBlocksAwayHearsNothing` (`(40, 64, 0)`: `clear` and `muffled` empty); `anotherDimensionHearsNothing` (`minecraft:the_nether`, 5 blocks); `aNullSpeakerDimensionHearsNothing`; `theSpeakerIsNeverItsOwnListener` (the speaker's own name in `others`: `clear` empty); `throughSolidStoneIsNotClear` (stone reader, `(20, 64, 0)`: not in `clear`); `anUnloadedChunkIsNotClear` (unloaded reader, `(20, 64, 0)`: not in `clear`).
- **Revert-checks:** (1) delete `|| listener.name().equals(speaker)` : `theSpeakerIsNeverItsOwnListener` fails. (2) replace `dimension != null && dimension.equals(listener.dimension())` with `true` : `anotherDimensionHearsNothing` fails. (3) replace `verdict.tier() == Tier.CLEAR` with `verdict.tier() != Tier.SILENT` : `throughSolidStoneIsNotClear` fails if stone gives a muffled verdict; if it does not fail, write that in the worknote (the stone case is then silent, which is also correct) and record checks (1) and (2) only.
- **Checks** C7 with class `HearingJudgeTest`. **Commit** `feat(neoforge): proximity hearing judge over the shared ChatHearing, unused (NF-CHAT-1)`.

### NF-CHAT-S: delivery spike (ops and a NeoForge-campaign session; not a Haiku card)

The re-send path uses Minecraft names no merged NeoForge code compiles against. Before NF-CHAT-2 is written as final code, one session proves on the **scratch** NeoForge shard (operator go; never `geldar-nf`), on a throwaway branch that is not merged:

1. The chat event class and accessors on 26.1.2: `net.neoforged.neoforge.event.ServerChatEvent` with `getPlayer()`, `getMessage()` (a `Component`), `getRawText()`, `setCanceled(boolean)`; and on which thread it fires (`MinecraftServer#isSameThread()`).
2. A re-send that a mineflayer Body hears through `golem/src/voice/ears.ts` (a `playerChat` packet with `sender` and `plainMessage`) and that a vanilla online-mode client shows: candidates `PlayerChatMessage.unsigned(UUID, String)`, `OutgoingChatMessage.create(PlayerChatMessage)`, `ChatType.bind(ChatType.CHAT, ServerPlayer)` and `ServerPlayer#sendChatMessage(OutgoingChatMessage, boolean, ChatType.Bound)`. Record whether the client marks the line as not secure or hides it under "only show secure chat", and how the server's `enforce-secure-profile` behind Velocity affects it.
3. That cancelling at the default priority stops vanilla's broadcast, and what the ledger mod's chat listener (`neoforge-ledger/.../audit/AuditWiring.java:87`) then sees (it may skip cancelled events; chat export is off anyway).
4. The block reader names: `ServerLevel#getChunkSource().getChunkNow(int, int)` (null for an unloaded chunk), `LevelChunk#getBlockState(BlockPos)`, a solid test matching Paper's `isCollidable` (candidates `BlockState#blocksMotion()` or `isSolid()`), the open state (`BlockStateProperties.OPEN`), and the level's height bounds (`getMinY()` and `getMaxY()` or their 26.1 names).
5. Positions: `Entity#getX()`, `getY()`, `getZ()` on a `ServerPlayer`, and `server.getPlayerList().getPlayers()`.

The result goes in `docs/analysis/neoforge/worknotes/NF-CHAT-S.md` as a table of proven names and the line `delivery: proven <method>`, or `delivery: not possible` with the reason. If delivery is not possible without a mixin (banned) or a payload (banned), NF-CHAT stops there and the operator decides (speech rows stay inactive on NeoForge).

### NF-CHAT-2: proximity chat on the server (written as final code only after NF-CHAT-S)

- **Step 0.** `docs/analysis/neoforge/worknotes/NF-CHAT-S.md` exists and contains `delivery: proven`; `NoRegistryScanTest.java` contains `HEARING_FILE` (NF-CHAT-0); `HearingJudge.java` exists (NF-CHAT-1). Otherwise STOP (`blocked: <which>`). Every Minecraft or NeoForge name the card uses must be in the spike's proven table; one that is not: STOP.
- **may-edit** new `neoforge/src/main/java/dev/geldar/neoforge/HearingConfig.java`, `LevelBlockReader.java`, `HearingChat.java`, `HearingSetup.java`; new tests `HearingConfigTest.java`, `HearingSetupTest.java`; `GeldarNeoForge.java` (one new guarded block after the `startMaintenance(config, event);` line, with its own `try`, independent of the export); `neoforge/README.md` (one new section "Proximity chat (off by default)" and one sentence added to the paragraph that says the mod exports no chat: "The mod reads the chat event in `HearingChat.java` only, to route speech by distance; it exports no chat text."); the worknote.
- **Shapes** (prescriptive; names marked (S) are taken from the spike's proven table, UNVERIFIED until then):
  - `HearingConfig`: `public record HearingConfig(boolean enabled)` with `KEY = "hearing.enabled"`, `ENV = "GELDAR_NEOFORGE_HEARING"`, `off()`, `load(Path file, Function<String, String> env, OperatorSink log)` and `resolve(Properties file, Function<String, String> env)`, read from `config/` plus `ExportConfig.FILE_NAME`, the environment winning over the file, only `true` (trimmed, any case) enabling, never throwing: the same code as `EvidenceConfig` in the twin file's AN-NF-00 step 1, without the export argument (proximity chat does not depend on the export). It must not contain the text `chat.enabled`.
  - `LevelBlockReader implements BlockReader`: over one `ServerLevel` (S); a cell outside the height bounds (S) reads as `minecraft:air`; an unloaded chunk (`getChunkNow` (S) returns null) throws `UnloadedBlock`; otherwise `new BlockProbe(id, solid, open)` with the id from `getBlock().builtInRegistryHolder().key().identifier().toString()` (VERIFIED for blocks), solid (S), open (S). `buildLimit()` returns the top bound (S).
  - `HearingChat`: `public static void install(ExportListeners.Bus bus, HearingJudge judge, OperatorSink sink)` registers one listener on the chat event (S). The handler: cancel first; if not on the server thread (S), deliver to the speaker only and log `geldar_neoforge proximity chat off the server thread; line kept to the speaker`; otherwise build one `HearingJudge.Listener` per other online player (name `getGameProfile().name()` VERIFIED; dimension `level().dimension().identifier().toString()` VERIFIED; position (S)), judge with `new LevelBlockReader(<speaker's level>)` and `server.getTickCount()` (VERIFIED), and deliver (S) to the speaker plus every player whose name is in `clear`. The whole handler body after the cancel sits in `try { ... } catch (RuntimeException e) { sink.warn("geldar_neoforge proximity chat failed (" + e.getClass().getSimpleName() + "); line kept to the speaker"); <deliver to the speaker only> }`. It never logs the words, never publishes to NATS, never builds a mask. Muffled verdicts are ignored here (NF-CHAT-3).
  - `HearingSetup`: `public static int install(HearingConfig config, ExportListeners.Bus bus, OperatorSink sink)`: off logs `geldar_neoforge proximity chat off` and returns 0; on builds `new HearingJudge(new ChatHearing(MuffleSettings.defaults(), sink::info))`, calls `HearingChat.install`, logs `geldar_neoforge proximity chat on` and returns 1.
- **Tests.** `HearingConfigTest` (as AN-NF-00's `EvidenceConfigTest`, without the export cases: nothing set is off; file true is on; environment wins; only `true` enables; trimmed and case-free; a missing file is off). `HearingSetupTest` with a recording `ExportListeners.Bus`: `offRegistersNothing`; `onRegistersOneChatListener` (exactly one registered type, the chat event class from the spike); `onRegistersNoCommandListener` (no registered type's simple name contains `Command`). The test files sit in `src/test`, which the guard does not scan; the event class name may appear there.
- **Revert-checks:** (1) in `HearingSetup.install` remove the off branch's early return : `offRegistersNothing` fails. (2) in `HearingConfig.resolve` accept any non-null value : the only-`true` test fails. (3) put the comment `// ServerChatEvent` into `HearingSetup.java` : `NoRegistryScanTest.chatEventNamesOnlyInTheHearingFile` fails.
- **ops (serial, scratch only, operator go):** two Bodies and one test human 10 blocks apart in the open hear each other; at 40 blocks nobody hears; a Body behind a thick stone wall at 30 blocks does not hear clearly; the speaker always sees their own line; with `hearing.enabled` absent, chat is global as today. Capture with test accounts only. The bench constants (`chat.muffle.*`, MH-8a) stay at their defaults.
- **Commit** `feat(neoforge): proximity chat by effective distance, off by default (NF-CHAT-2)`. **Split line** `HearingConfig` and `LevelBlockReader` with their tests first; `HearingChat`, `HearingSetup`, the `GeldarNeoForge.java` block and the README second.

### NF-CHAT-3: muffled notices (BlockedDecision; not prescriptive)

On Paper a listener in the muffle tier who is an agent gets a `heard_muffled` notice on `geldar.<shard>.body.<life_id>.hearing` through `NatsHearingSink` (core-common). On NeoForge that needs: a decision amending 0383 so the `neoforge` user may publish `geldar.<s>.body.*.hearing` (five tokens), its grant and test in `deploy/nats-auth-nf.ps1` and `tools/repo-checks/src/nats-auth-nf.test.ts`, and NF-BODY (a Body role that subscribes). The notice must pass `null` as the speech hash on NeoForge. Which listeners count as agents for a notice follows the NeoForge Body username shape (NF-BODY; `EventEnvelope.isLifeId` does not match managed lives, delta note section 1). Written as a card when those exist.

## 5. Questions for the operator (NF-CHAT; also 0329 Q3 and Q4)

- **Q-C1. Humans as listeners and speakers.** Does the 32-block rule apply to every listener on NeoForge, humans included (the plan's default, since players and agents are equals), or only to agent listeners, leaving humans a global chat among themselves?
- **Q-C2. Commands that carry chat.** `/msg`, `/tell`, `/w`, `/me`, `/say`, `/teammsg` reach players at any distance, and a Body hears a private message as a `playerChat` packet. Options: (a) the mod refuses or limits these commands (needs the command event, which the guard bans as chat too; another narrowing); (b) the Body's ears drop chat types other than plain chat (golem, both shards; the `playerChat` packet's chat type field is UNVERIFIED in mineflayer 4.39); (c) leave them. Recommendation: (a), as the server-side rule spec 5.8 describes, with its own record.
- **Q-C3. Death messages.** Vanilla announces deaths to everyone as system messages. Paper limits them to 32 blocks (spec 5.9, `ProximityDeathListener`). The Body's ears ignore system messages, but other Body readers listen to all messages (`golem/src/actions/sleepers.ts`, `sleep-refusal.ts`). Port the death rule too (a later NF-CHAT card)?
- **Q-C4. Switching it on.** Turning `hearing.enabled` on changes chat for every human on the public NeoForge shard at once. An operator-approved node step, with a notice to players first?
- **Q-C5. The server log** (0329 Q4). Cancelling the event drops vanilla's chat log line. Write a replacement log line (human-written text in the server log, as vanilla does today, useful for abuse reports), or none?
- **Q-C6. Rate and length caps.** Spec 5.8 caps speech at 256 characters and one message per 3 seconds per agent. The plan routes chat only; a server-side cap for humans is not planned.

## 6. UNVERIFIED claims in this plan

1. Every name marked (S) in NF-CHAT-2 and listed in NF-CHAT-S: the 26.1.2 chat event and its accessors, its thread, the re-send method and its display on a secure-chat client, the chunk and block-state reader names, the level height names, entity position accessors.
2. That cancel and re-send reaches a mineflayer 4.39 Body as a `playerChat` packet the ears accept.
3. That the ledger mod's chat listener is unaffected or merely skips cancelled events.
4. That no merged code in `neoforge/src/main` other than `HearingChat.java` would need a chat event name (true at `a8063b0a` by the guard; true for later P4 work only if P4 adds none).
5. That the `playerChat` packet carries a chat type mineflayer exposes (Q-C2 option b).
