# Wave 5 interface requests (collected from the packet reports, to be applied by P0-32a)

P0-32a is the only packet that may change the P0-20 and P0-21 files after they merged. Each request names the report it came from (`.claude/reports/w5-p0-NN.md` in the packet worktree `p0-NN`, and committed on the branch).

## Ports and ids (animus/src/ports, animus/src/ids.ts, golem/src/mind-link/senses.ts)

1. (P0-24) `SayRefusal` in `golem/src/mind-link/senses.ts` gets a `'command'` case; `BotVoice.say()` maps `refused_command` to it instead of `empty`.
2. (P0-24) `Ears` is split in the code: `BotEars` implements `heard()`, `RecentEvents` implements `drainEvents()`; compose them into one `Ears` (a small `composeEars(botEars, recentEvents)` in `golem/src/adam/` or `mind-link/`). The wiring must call `RecentEvents.noteHealth(health, tick)` on the bot's `health` event, and give `BotEars` the display name "Adam" (`displayName` option; add `chat.display_name` to the shard config only if P0-20's config has no suitable key).
3. (P0-27) `SuppressionReason` gets `coalesced_in_flight` (today recorded as `thinking`); `MindWakeReason` gets `speech_about_my_commitments` (today emitted as `speech_about_me`); `WakeDecision.digest` is typed to carry the per-speaker conversation digest (today only `Attention.digestSummary()`); decide how unknown Body wake reasons are handled (today `intent_running`, no wake) and keep the Body's reason list and the Mind's in one place.
4. (P0-28) `Journal.journalSince` gets an optional `limit`; `writeMemoriesPartial`, `backfillEmbeddings` and `resolveCommitment` are put on the `MemoryStore` port (so the Mind and `MemoryRetriever.remember` depend on the port, not on `PgMemoryStore`).
5. (P0-29) `OutputValidator.correctiveMessage(errors, rejected?)` takes the optional rejected text (JSON-escaped, capped at 512 characters by the implementation); the loop (P0-30) passes it. The library's `thoughtVersion`, `reflectionVersion` and `bodyApiVersion` become part of the `PromptLibrary` port.
6. (P0-31) `animus/src/ports/` gets a `ReflectionAdmission` port (reserve, settle, release; reflection costs 2) used by `trigger.ts` and implemented by the loop's admission (P0-30 `admission.ts`); `ReflectionPromptVars` gets a `digest` slot that P0-29's renderer reads (rendered inside the user message as data, escaped like other text); `ids.ts` gets an `ev` prefix (`newId('ev')`), replacing the `ev_` plus ULID-of-thought-id workaround; `ThoughtRow.parsed` may hold a parsed reflection (or add `kind: 'thought'|'reflection'`), replacing `rawOutput` with `parsed: null`.
7. (P0-30) the program allow-list: export one from `animus/src/validate/` (P0-29) and make `animus/src/loop/fallback.ts` import it instead of its own copy; `ModelJob` gets an `effort` field (the Thinker still receives only `reasoning` and `maxTokens`; the field is for records).
8. (P0-21) `relationships` (overnight decision 40): confirm `RelationshipRow.otherId` holds the resolved agent id and the fallback writes a `relationship:<name>` memory; no schema change.

## Wiring notes for P0-32a and P0-32b

- (P0-26) the Body-side `MindLinkServer` takes `buildSnapshot(options)` and the executor as `Pick<IntentExecutor, 'submit' | 'intentId' | 'intentState'>`; P0-32b passes `(o) => buildSnapshot(bot, o)`.
- (P0-23) beds are named by kind (`red_bed 8 east`), not "your bed".
- (P0-22) `lantern-local` heartbeat frame is `heartbeat` (as Appendix H), advertised `max_tokens` is a constant 1024: make it come from config if the pins gain a per-model value (small change in `shards/phase0.yaml` and the loaders, only if cheap).
- (P0-25) the hub refuses connections that carry an `Origin` header and allows at most 8 connections; the real lantern-local client sends no `Origin` (proven by the interop test).
- Placeholders in `shards/phase0.yaml` (`sha256:RECORD_AT_DISPATCH`, `DRAFT_PENDING_OWNER_APPROVAL`) stay: the loaders refuse them outside tests; recording the digests and approving the seed happen in P0-33 and at the first run.
