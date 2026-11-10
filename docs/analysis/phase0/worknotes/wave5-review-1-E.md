# Wave 5 review, round 1: area E (memory, reflection, SQL, projection, docs)

Reviewer verdict: ship after fixes; 7 major, 10 minor. SQL is all parameterised, no new migration, no secrets or control characters. Paths relative to the repo root.

## Major (fix before the wave 5 PR)
1. The thought prompt loads every belief with no limit, and `MemoryRetriever` is dead code in production (`animus/src/memory/pg-store.ts:168-173`, `loop/thinking-loop.ts:305`, `prompts/render-memory.ts:41-43`, `memory/retrieval.ts:83`). Over a 24-hour exit run (about 70 days) beliefs grow without bound against `num_ctx` 8192 and every thought ends in context overflow, surviving restarts. Fix: wire the retriever in, or LIMIT the load plus a prompt budget that drops the oldest; test with 500 beliefs.
2. Commitments cannot work end to end (`reflection/apply.ts:68,81-87`, `pg-store.ts:174-180,256`, `reflection/digest.ts:133-134`): `dueTick` always null, due-commitments section always empty, `resolveCommitment` has no caller, the integration test passes only through a hand-written row. Fix: load unresolved commitments where `due_tick IS NULL OR <= now`; resolve on removal; test through `applyReflection`.
3. Reflection apply is not atomic or idempotent, and the failure is swallowed (`apply.ts:99-130`, `reflect.ts:4,183-185`): a late-step failure leaves memories written and `last_sleep_day` unset, so the same day's next sleep reruns the model and duplicates rows and costs 2 more credits. Fix: one transaction (a port method) or key writes on `source_thought`; log the error; test that fails at `replaceGoals`.
4. One embedder failure discards the whole reflection (`apply.ts:100-105`, `retrieval.ts:146`, `pg-store.ts:339`): P0-28 item 6 required a NULL embedding on failure, but `writeMemoriesPartial` and `backfillEmbeddings` have no production callers. Cold 32B load makes this likely. Fix: catch the embed, use the partial writer, backfill at start and after each reflection.
5. `bornDay: 0` is hardcoded (`animus/src/main.ts:106`, `thinking-loop.ts:279`, `reflect.ts:98`, `retrieval.ts:62`): in a world older than a few days Adam starts with `days_since_sleep >= 3` and a degraded first reflection. Fix: `bornDay: null` and fall back to the snapshot's `world_time.day`.
6. The animus Postgres pool has no error handler or timeouts (`pg-store.ts:33-42`; compare `eventsink/src/main.ts:11-18`): a Postgres restart kills the Mind, a hung connection leaves the attention controller in flight forever. Fix: copy the eventsink pool settings and race the memory load against a timeout.
7. Relationship updates for unknown names pile up as duplicate rows and the `relationships` table is unreachable (`pg-store.ts:294-311`, `fakes/memory.fakes.ts:194-208`, `overnight-decisions.md` row 40): nothing creates `agents` rows for other lives, so each reflection inserts a new `relationship:<name>` memory without deactivating the old one, and the fake hides it. Fix: deactivate earlier rows for the subject in the same transaction; make the fake match; correct decision 40.

## Minor
8. Reflection skips and failures are invisible; cost accounting is wrong on a model failure (`mind.ts:192-195`, `reflection/trigger.ts:98-101`, `reflect.ts:157-167,215-216,234`; snake_case vs camelCase usage keys).
9. The one-in-flight slot can be raced by a reflection, and `pending` is never cleared on `already_slept` (`trigger.ts:87-105,140-145`).
10. `sinceTick` resets to 0 at every Mind start (`mind.ts:92-97`, `trigger.ts:61`).
11. The fatigue working window is never applied and the fatigue switch is not configurable (`thinking-loop.ts:289-292`, `mind.ts:110`, `main.ts:191-206`).
12. Life scoping gaps in the journal: `recordThought` upsert can overwrite `life_id`; `linkIntent` takes no life (`memory/journal.ts:22-34,71-79`).
13. The provenance guard is bypassed by rewording (`apply.ts:46-58,75`, `digest.ts:86-94`).
14. Test gaps: the COALESCE test only checks SQL text; no link-then-projection integration test; no cross-life isolation assertion; a typo in `fakes/memory.fakes.ts:132`.
15. Docs drift: `docs/decisions/README.md:58` (0051 approved), RESUME.md at wave 4, ledger rows P0-19 to P0-33 and decisions 0047, 0049 to 0052, `animus/README.md` still a skeleton, `shards/phase0.yaml:5` still mentions dilation.
16. Repo rules: `animus/src/loop/thinking-loop.ts` is 640 lines (over the 500 soft cap); `worknotes/reports/p0-06-fix-2.md:24,25,44` holds a private-network IP.
17. Latent for Phase 1: the pgvector search filters after the HNSW scan (`sql/0001_init.sql:60`, `pg-store.ts:366-371`).
