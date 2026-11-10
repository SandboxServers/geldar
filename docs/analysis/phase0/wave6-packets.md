# Wave 6: the Glass, the Adam runs and the campaign review

Draft by a planning agent, 2026-11-10, from `origin/main` at `74857cf` (wave M merged). Part of the Phase 0 campaign ledger ([README.md](README.md)). Plan shape follows [wave5-packets.md](wave5-packets.md). Owner questions are at the end; nothing here is decided until the owner answers. This wave implements nothing by itself: it is the plan the orchestrator dispatches from.

## 1. Context and exit criteria

Wave 6 is the last wave of Phase 0. The spec (section 10, "Phase 0 — Adam") ends the phase with three things: a Thought Stream v0 for humans, two measured Adam runs (Qwen3 32B first, then Qwen3 8B) and the campaign review. Wave 5 built the Mind; wave M built the ranger front door (a separate track, not Phase 0 Adam). Wave 6 does not add behaviour to the Body or the Mind beyond the review fixes that the exit runs depend on.

**Exit criteria, quoted from spec section 10, Phase 0** (the ledger's Exit block copies them; the spec is the source):

1. An agent survives **5 consecutive in-game days** (about 100 real minutes at 20 TPS; the 5 days are 120,000 ticks) with a bed, food and stone tools. The stack also runs **24 real hours** of continuous operation across restarts.
2. At least **three durable intents ran to completion** through chatter and interruptions **without a model call**.
3. **Every action has a receipt.**
4. **A Body restart mid-intent resumed from its checkpoint.**
5. **Recorded:** the **model floor** (smallest model that passed) and **inference calls per useful autonomous minute**. **Thought latency under 15 s.**
6. If no model passes, stop and fix the Body/Mind split.

The spec also says: "Survival alone mostly measures the reflex code; the intent metrics measure the thesis." The report must show both.

Background that the runs rely on: the 20 TPS benchmark gate is a precondition (spec section 10: "The body benchmark runs first, before any model is attached"; decision D-P0-17 pass bar: 100% at 20 TPS, with 10 and 5 TPS recorded as findings only). Decision 0051 fixes the models: `qwen3:32b` (strong) and `qwen3:8b` (fast), Q4_K_M, `num_ctx` 8192, one job at a time per model, the 8B run as a separate life `ag_adam_02` on a fresh world volume. Decision 0058 sets the character knowledge boundary (thought prompt v2). Decision 0059 means humans may watch the shard, and the agents are never told. The Thought Stream is for humans only and must never feed any agent (spec 5.13; threat model Principle 1 and section 4 item 9: nothing lets a human act in the world, so the Glass is read-only).

**Where the spec is vague, the packets do not invent thresholds.** These are Open questions for the owner (section 4 below), each with a recommendation:

- **"Survives"**: whether any death in the window fails the run (recommendation: yes; the `death` event is the measure).
- **"Useful autonomous minute"** is not defined anywhere in the spec. Without a definition, "inference calls per useful autonomous minute" cannot be computed.
- **"Thought latency under 15 s"**: p50, p95 or max (recommendation: p95 under 15 s, with p50 and max reported; the 25 s job deadline in wave 5 stays the hard limit).
- **"A bed, food and stone tools"**: no measurable definition (which item, how many eats, at which day).
- **5 days and 24 hours**: the same run or two runs (recommendation: one continuous run of at least 24 real hours, which contains the 5-day segment, with a planned restart and a Body restart mid-intent).
- **Model floor**: the spec gives no tier below 8B for Phase 0, so "smallest model that passed" can only be 8B or 32B.

The rest of the plan is conditional on these answers. Packets that depend on an owner answer are marked `BlockedDecision`.

## 2. Packets

Each packet fits one coder run (about 30 tool uses; the coder commits what passes and writes the rest to the report). Status vocabulary is the ledger's: Ready, BlockedDependency, BlockedDecision. Branch `phase0/w6-<id>`, worktree `w6-<id>`, commit message per card. Every packet ends with `./geldar.ps1 check` exit 0 unless the card says otherwise.

| Packet | Title | Status | Depends on | Owns (files) | Budget |
|---|---|---|---|---|---|
| W6-01 | Mind review fixes: E-13, E-2, E-8, E-11, E-14 | Ready | — | `animus/src/**` named by the worknotes; their tests | 30 |
| W6-02 | Validator bounds read from shard config (BC-11) and the E-16 worknote redaction | Ready | — | `animus/src/main.ts`, `animus/src/config.ts`, one worknote | 25 |
| W6-03 | Body `stuck` signal (AD-11): watchdog, or a recorded decision | BlockedDecision | owner item 7 | `golem/src/**` (watchdog) or a decision file | 30 |
| W6-04 | Velocity marker ordering | Ready (diagnose first) | — | `plugin/**` velocity module and its tests | 25 |
| W6-05 | BC-10: the thought template v3 line (memories, beliefs and goals are data) | BlockedDecision | owner item 8 | `prompts/thought/v3.md`, prompt library, tests | 25 |
| W6-06 | Warm-up: every pinned model loaded and warmed before it is advertised | Ready (verify P0-22 first) | — | `lantern-local/src/**` and tests | 25 |
| W6-07 | Split files over 500 lines: `pg-store.ts`, mock `server.ts`, `front.test.ts` | Ready | — | the three files and their new siblings | 30 |
| W6-08 | Investigate `intent_link_gave_up` (read-only, worknote only) | Ready (needs ops logs) | ops: 32B logs | one worknote | 20 |
| W6-09 | `glass/` server: loopback-only, read-only API and SSE | Ready | — | `glass/**` (new package) | 35 |
| W6-10 | `glass/` page: escaped rendering, filters, per-agent view | BlockedDependency | W6-09 | `glass/public/**`, `glass/src/render-*.ts` | 35 |
| W6-11 | Glass security: adversarial fixtures, read-only route test, XSS review | BlockedDependency | W6-10, W6-13 | `glass/test/**`, `glass/README.md`, one review worknote | 30 |
| W6-12 | Adam run report generator (JSON and Markdown, read-only DB) | Ready | — | `tools/adam-report/**` (new) | 35 |
| W6-13 | Run protocol script `./geldar.ps1 adam-run`, and `./geldar.ps1 glass up` | BlockedDependency | W6-09, W6-12 | `tools/adam-run/**`, the `adam-run` and `glass` blocks in `geldar.ps1` | 35 |
| W6-14 | Run protocol documents for the 32B and 8B runs | BlockedDecision | owner items 1 to 6 | `docs/analysis/phase0/adam-run-*.md` | 20 |
| W6-20 | Campaign review: Body and Golem (read-only) | BlockedDependency | all coder packets merged, OPS-2 | a review worknote | 30 |
| W6-21 | Campaign review: Mind, memory and prompts (read-only) | BlockedDependency | all coder packets merged, OPS-2 | a review worknote | 30 |
| W6-22 | Campaign review: contract, sql, infra, Glass security, secrets (read-only) | BlockedDependency | all coder packets merged | a review worknote | 30 |
| W6-23 | Campaign retro: learnings from every wave and both runs | BlockedDependency | W6-20 to W6-22, OPS-3 | `docs/analysis/phase0/retro/campaign.md` | 30 |
| W6-24 | Apply the campaign retro actions (agents, skills, checks) | BlockedDependency | W6-23 | `.claude/agents/**`, `.claude/skills/**`, repo checks | 30 |

**File ownership rules.** `geldar.ps1` is touched only by W6-13 (the `adam-run` and `glass` blocks). `animus/src/main.ts` is touched only by W6-02. `docs/spec.md` is never edited by any wave 6 packet. No packet adds a SQL migration (D-P0-11). No packet touches `contract/` unless its card says so.

### Cards

**W6-01: Mind review fixes.** Depends on `origin/main`. Branch `phase0/w6-01-mind-fixes`. Commit: `fix(animus): close the wave 5 review items E-13, E-2, E-8, E-11 and E-14`.
- Steps: list the files each item names in the wave 5 worknotes (`docs/analysis/phase0/worknotes/wave5-review-1-*.md`, as cited in `retro/wave-5.md`). E-13: the provenance guard checks the structure of the quoted section, not its wording. E-2: `dueTick` is set from the due tick, not left null. E-8: trigger skips record a reason, and `creditsSettled` is set from the settled credits, not the constant 2. E-11: the fatigue switch reads from config. E-14: the COALESCE test becomes a query test under `GELDAR_IT=1` against a real Postgres (no text-only test).
- Tests: one per item, each revert-checked (revert the fix locally, the test fails, restore). No Ollama, NATS or Minecraft in unit tests.
- Checks: `./geldar.ps1 check`.

**W6-02: Validator bounds and the redaction.** Depends on `origin/main`. Branch `phase0/w6-02-wiring`. Commit: `fix(animus): read validator bounds from the shard config and redact a private address from a worknote`.
- Steps: `animus/src/main.ts` reads the output validator's bounds from `shards/phase0.yaml` (BC-11) instead of constants. The worknote `p0-06-fix-2.md` (E-16) is edited to remove the one private-network address; the card does not copy it into any file. Redact by replacing it with `<redacted address>`.
- Tests: a wiring test (`animus/test/main.wiring.test.ts`) that starts the Mind's composition with a shard config whose bound differs from the default and asserts the validator sees the config value; revert-check.
- Checks: `./geldar.ps1 check`; a grep for IPv4 literals in the worknote shows only `127.0.0.1`.

**W6-03: Body `stuck` signal (AD-11).** BlockedDecision until owner item 7 is answered. Branch `phase0/w6-03-watchdog`. Commit: `feat(golem): set the stuck signal when a plan makes no progress` (or `docs: record that the stuck signal is not implemented in phase 0`, if the owner chooses).
- Steps (if implemented): a watchdog in `golem/src/` that sets `stuck` after N ticks with no change in the intent's checkpoint; N is a shard config value, not a constant.
- Tests: a fake clock test that `stuck` is set after N ticks and cleared on progress; an abort path test (the watchdog stops when the intent ends); revert-check.

**W6-04: Velocity marker ordering.** Diagnose first: the retro names the item but not the defect. The coder reads `plugin/` velocity code and the wave 5 notes, writes the defect in the worknote, then fixes it if it is under one day of work. Branch `phase0/w6-04-velocity-marker`. Commit: `fix(velocity): order the bot-ingress marker before the forward`.
- Tests: a JUnit test on the marker order, revert-checked. Checks: `cd plugin; ./gradlew build`, then `./geldar.ps1 check`.

**W6-05: BC-10 v3 line.** BlockedDecision until owner item 8 is answered (the recommendation is one v3 line). Branch `phase0/w6-05-thought-v3`. Commit: `feat(prompts): thought template v3 marks memories, beliefs and goals as data`.
- Steps: copy `prompts/thought/v2.md` to `v3.md` (templates are immutable once used, so v2 is not edited); add the one data line; the prompt library loads v3 only behind config. Decision 0058 default stays v2 until the owner says otherwise.
- Tests: the rendered prompt for v3 places the three sections inside the quoted section; v2 output is byte-identical to before (golden test); revert-check.

**W6-06: Warm-up before advertising.** Verify first whether P0-22's warm-up shipped; the wave 5 retro (cold model load) says the 32B first thoughts hit the 25 s deadline. Branch `phase0/w6-06-warmup`. Commit: `fix(lantern-local): warm every pinned model before advertising it`.
- Steps: a one-token call with the pin's `keep_alive` for each model before `hello` lists it; a partial warm-up advertises only the warmed models on that dial.
- Tests: fake Ollama counts the warm-up calls; a model not warmed is not advertised; revert-check.

**W6-07: File splits.** Confirm the three files by line count at dispatch (`pg-store.ts`, the mock `server.ts`, `front.test.ts`; each is over 500 lines, the limit is 700). Branch `phase0/w6-07-splits`. Commit: `refactor: split three files over 500 lines`.
- Steps: move code into siblings by responsibility (no `utils`/`helpers` names); no behaviour change; exports keep their names.
- Tests: characterisation. The existing tests pass before and after, with the same count. No new behaviour, so no revert check; say so in the report.

**W6-08: `intent_link_gave_up` investigation.** Read-only except one worknote. Ops supplies the 32B run logs first (wave 5 retro: the logs were never checked). Branch `phase0/w6-08-link-gave-up`. Commit: `docs: record the intent_link_gave_up investigation`.
- Steps: find every emitter of the event; check the eventsink projection lag hypothesis against the logs; state whether it is a bug, a projection race or a log artefact, with evidence (file and line).
- Output: a finding. A fix, if small, goes to a new packet (W6-08b), not into this one.

**W6-09: `glass/` server.** Depends on `origin/main`. Branch `phase0/w6-09-glass-server`. Commit: `feat(glass): add the Thought Stream server (loopback, read-only, SSE)`.
- Design: Node 22 and TypeScript, `node:http`, one new package `@geldar/glass`. Binds to `127.0.0.1` only and refuses to start otherwise. Routes (GET only; any other method gets 405): `/api/agents`, `/api/thoughts?agent=&tier=&outcome=&since=` (paged, newest first), `/api/thoughts/:id` (adds `model_input`, capped at 64 KiB), `/api/receipts?action_id=`, `/api/stream` (SSE from NATS, ephemeral consumer, deliver new, heartbeat comment every 15 s, a bounded buffer that drops the oldest frame for a slow client). Data source: Postgres `thoughts`, `actions`, `receipts`, `intents`, `agents` through a read-only role (`GELDAR_GLASS_PG_*`, password from a secret file); NATS read-only subscription, no publish permission. Frames validated with the contract validators.
- Headers on every response: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, no CORS.
- No secret in any response or log: no connection strings, no password file paths, no tokens.
- Tests: unit tests with fake DB and NATS; the route table test; the loopback refusal; the CSP header; an IT case (`GELDAR_IT=1`) against the dev Postgres. Revert-check the loopback refusal and the 405.
- Checks: `./geldar.ps1 check`.

**W6-10: `glass/` page.** Depends on W6-09. Branch `phase0/w6-10-glass-page`. Commit: `feat(glass): add the Thought Stream page with escaped agent text and filters`.
- Design: static files in `glass/public/`, vanilla JavaScript, no inline script or style (the CSP forbids them). Every agent-authored string (names, speech, book text, reasoning, plans, signs) is set with `textContent`; no `innerHTML` anywhere; no `href` built from agent text, so no link from agent text is clickable. Filters: agent, model tier (from `model_config`), outcome, location, keyword (client side). Per-agent view: the thought list with `prompt_template_version`, `latency_ms`, outcome, reasoning, plans and receipts. Journal, goals, relationships, skills and budget are deferred to v1 (noted in the README).
- Tests: the render functions are pure (`render-model.ts`) and unit-tested with hostile strings (`<img onerror>`, `javascript:` URLs, bidi overrides, a 10 KB string, a NUL byte); revert-check the escaping.
- Checks: `./geldar.ps1 check`.

**W6-11: Glass security.** Depends on W6-10 and W6-13 (W6-13 adds the `glass up` command; this card only tests it). Branch `phase0/w6-11-glass-security`. Commit: `test(glass): adversarial fixtures and a read-only route test`.
- Steps: adversarial fixtures across the API and the page (the same set as W6-10, plus NATS frames with hostile text); a test that drives every route with POST, PUT, PATCH and DELETE and expects 405 with no state change; a test that `./geldar.ps1 glass up` refuses a non-loopback bind; the README. The XSS review item: a written review in `docs/analysis/phase0/worknotes/w6-11-xss-review.md` by a reviewer who did not write W6-10, listing each sink and its escaping.
- Checks: `./geldar.ps1 check`.

**W6-12: Adam run report generator.** Depends on `origin/main`. Branch `phase0/w6-12-report`. Commit: `feat(tools): add the Adam run report generator (JSON and Markdown, read-only)`.
- Input: a run id and its `manifest.json` (from W6-13's format, which this card defines: life id, world seed, git sha, model tags and digests, shard config hash, start time, restart times, TPS target). Reads Postgres through a read-only role.
- Output: `run-report.json` (byte-stable for the same data: sorted keys, no wall-clock values beyond the window) and `run-report.md`, written to `docs/analysis/phase0/runs/<run-id>/`. Measures, one per exit criterion: survival (days, deaths from the `death` event, bed, food and stone tools at each day boundary from the snapshot); continuity (longest run without a gap over a set threshold, restart count); intents (completed, interrupted by chatter, with zero thoughts during the intent: the "without a model call" count); receipts (terminal actions with exactly one final receipt, economic actions with a prepared row); checkpoint resume (a Body restart with an intent that completed on a later `body_generation`); model floor (the verdict, from the criteria file); calls per useful minute (thoughts and reflections separately); latency p50, p95 and max from `thoughts.latency_ms`; outcome histogram.
- Criteria file `tools/adam-report/criteria.yaml`: every threshold and definition is a key with value `null` until the owner answers. A null key makes that measure print "not computed: definition pending" and never a guessed number.
- Tests: pure computation tests on fixture rows; an IT case (`GELDAR_IT=1`) that seeds a small life in the dev database and checks the report is byte-identical on a second run; revert-check each measure.
- Checks: `./geldar.ps1 check`.

**W6-13: Run protocol script and the Glass command.** Depends on W6-09 (the Glass server it starts) and W6-12 (the manifest format). Branch `phase0/w6-13-adam-run`. Commit: `feat(tools): add the adam-run protocol script and the glass up command`.
- Steps: `./geldar.ps1 glass up` starts the W6-09 server on `127.0.0.1` (the only `geldar.ps1` block for Glass). `./geldar.ps1 adam-run start|status|stop|report`. `start` writes `manifest.json` (git sha, `ollama list` tags and digests checked against `model_pins`, shard config hash, life id, seed) and starts the stack through the existing `adam up` path; it does not run `adam up` for live cases. `status` appends one line per minute to `status.log` (ticks, TPS, thoughts, deaths, latency p95 over 30 min). Abort checks, each with its threshold from the criteria file: TPS under 19.5 for 5 minutes; latency p95 over the limit for 30 minutes; Ollama, Postgres or NATS down for 5 minutes; a death when the criteria say a death fails the run; disk under 10 GB free. An abort stops the stack and writes the reason; it never deletes data. `report` calls W6-12.
- Tests: the manifest writer and the abort rules are pure and unit-tested (fake clock); revert-check the abort rules. No stack needed.
- Checks: `./geldar.ps1 check`.

**W6-14: Run protocol documents.** BlockedDecision until owner items 1 to 6. Branch `phase0/w6-14-run-docs`. Commit: `docs: add the 32B and 8B Adam run protocols`.
- Files: `docs/analysis/phase0/adam-run-32b.md`, `adam-run-8b.md`, and a shared preamble (which one is the owner's call; default: each file is self-contained).
- Each protocol has: preconditions (benchmark gate PASS at 20 TPS, digests pinned, personality seed approved, fresh world volume, GPU free); steps for ops in order; duration (about 100 real minutes for the 5-day segment, at least 24 real hours in total, plus setup); the planned restart and the Body restart mid-intent, with the times set at dispatch; what to record (manifest, `status.log`, the two report files, a database export path, the commit); abort criteria, quoted from W6-13's criteria file; the verdict rule for the model floor.
- Numbers come only from the criteria file, never typed here. Until the owner answers, the file says "owner: pending".
- Checks: `./geldar.ps1 check`.

**W6-20, W6-21, W6-22: campaign reviews (read-only).** Three independent reviewers, none of whom wrote the code they review. Each writes one worknote with findings by severity (blocker, major, minor), each with file and line and the spec section it checks. No fixes in these packets; every fix becomes a new packet, dispatched by the orchestrator.
- W6-20 Body and Golem: spec 5.2 (reflexes, container actions, authorised perception), 5.14 (tick rate, decision 0038), Appendix A; `golem/**`, `plugin/**`.
- W6-21 Mind, memory and prompts: spec 5.3, 5.4, 5.6, 5.7, Appendices B and D; decisions 0051, 0058, 0059; `animus/**`, `lantern-local/**`, `prompts/**`.
- W6-22 Contract, sql, infra and security: spec section 7 and 8 items that apply in Phase 0, threat model sections 3 to 5 (Principle 1 applies to code: the Glass must stay read-only, no human act in the world), the no-IP and no-secret rules (a scan over the repo and the worknotes), `contract/**`, `sql/**`, `compose/**`, `glass/**`.
- Budget: 30 tool uses each. Branch: none (worknote commit only, `docs: campaign review <area>`).

**W6-23: Campaign retro.** Depends on the three reviews, OPS-3 and the run reports. Branch `phase0/w6-23-campaign-retro`. Commit: `docs: write the Phase 0 campaign retro`.
- Sources, all read: `docs/analysis/phase0/retro/wave-1.md` to `wave-5.md` and `wave-m.md`, `overnight-decisions.md`, `bench-results.md`, the two run reports, the three review worknotes, and W6-08's finding. For each learning: what happened, the evidence (file and line), an action (agent, skill, check, or docs), and the owner. Learnings that repeat across waves are listed first.
- Output: `docs/analysis/phase0/retro/campaign.md`. It states what the Adam runs showed about the thesis (the intent metrics) and about survival (the reflex code), as the spec asks.

**W6-24: Campaign process actions.** Depends on W6-23. Branch `phase0/w6-24-campaign-process`. Commit: `chore: apply the campaign retro actions to agents, skills and checks`. Same shape as the earlier `W*-process` packets: one action per item, each checked by a test or a grep where it can be.

## 3. Dependency diagram, order, parallelism and ops gates

```
day 0 (Ready now)
  W6-01 Mind fixes ─┐
  W6-02 validator wiring ─┤
  W6-09 glass server ─┼── Phase A (4 coders)
  W6-12 report generator ─┘
        │
Phase B (after A) ── W6-06 warm-up, W6-07 splits, W6-04 Velocity, W6-08 link investigation (needs ops logs)
        │
        ├── W6-10 glass page (after W6-09)
        ├── W6-13 adam-run script and glass up (after W6-09, W6-12)
        └── W6-14 run docs (after owner items 1 to 6)
              │
        W6-11 glass security + glass command (after W6-10 and W6-13)
              │
        OPS-0 benchmark gate, OPS-1 smoke, OPS-2 32B run, OPS-3 8B run, OPS-4 final benchmark gate
              │
        W6-20, W6-21, W6-22 reviews (read-only, parallel), W6-23 retro, W6-24 process actions
```

W6-03 and W6-05 join Phase B when the owner answers items 7 and 8.

**Maximum parallelism: 4 coders.** Phase A has 4 packets, all in different packages, so no file is shared. Phase B has up to 4. The reviews (three) run in parallel after the runs, as read-only work.

**Recommended order.** Phase A, then Phase B, then W6-10, W6-13, W6-14, W6-11. Then the gates below, then the reviews and the retro. Each coder merges to the wave 6 integration branch `wave6-main` (as `wave-m-main` was for wave M, not `main`) and the orchestrator runs `./geldar.ps1 check` after each merge. The wave closes into `main` as one PR, as in waves 5 and M.

**Ops runs and gates.** Ops is the `ops` agent. No coder runs a live stack. Each gate has a pass rule; a fail stops the next step.

| Gate | Ops step | Pass rule | If it fails |
|---|---|---|---|
| G-A | After Phase A merges | `./geldar.ps1 check` exit 0 on `wave6-main` | Fix round (5 max), then stop |
| G-B | After Phase B merges | `./geldar.ps1 check` exit 0; W6-08 finding read | Fix round; a link-gave-up bug becomes W6-08b before the runs |
| OPS-0 | Benchmark gate, 20 TPS, `--runs 10` (D-P0-18 pending; owner item 9); digests of `qwen3:32b`, `qwen3:8b` and `nomic-embed-text` recorded into `shards/phase0.yaml` `model_pins` | 100% at 20 TPS (D-P0-17); 10 and 5 TPS recorded as findings | Stop. Fix the Body, not the model. Do not run Adam |
| OPS-1 | 20-minute smoke on a throwaway life `ag_smoke_01`: harness writes the manifest and status log, Glass shows the thoughts, the report generator produces a report | Every artefact written; no abort rule fires | Fix the harness in a new packet; no Adam run until it passes |
| OPS-2 | 32B run on `ag_adam_01`, fresh world volume: about 100 real minutes for the 5-day segment, at least 24 real hours in total, one planned restart, one Body restart mid-intent | The report gives a verdict under the owner's criteria; no abort rule fired | If the 32B run fails, the spec says stop and fix the Body/Mind split: no 8B run until the owner rules |
| OPS-3 | 8B run on `ag_adam_02` (decision 0051), fresh volume, same seed, the same protocol; GPU must be free, so the 32B run has finished | A verdict, whatever it is, is recorded; the model floor is the smallest passing model | Record the failure as the floor finding; the wave does not stop |
| OPS-4 | Final benchmark gate on the final commit; if any Body or Mind code changed after OPS-2, OPS-2 is repeated or the owner accepts the change in writing | Same as OPS-0 | As OPS-0 |

**Gates between packets.** G-C: owner items 1 to 6 answered, so W6-14 and the report criteria file can be filled. G-D: OPS-0 passes, which is the precondition for any Adam run. G-E: OPS-1 passes. G-F: OPS-2 has a report. G-G: OPS-3 has a report. G-H: OPS-4 passes and the three reviews are written. Then W6-23.

**Ops rules for every run** (from the wave M retro): never `adam up` for a live case; a clean journal per test life; no leftover background monitors when ops finishes; each run's manifest and status log are kept with the report.

## 4. Owner decisions and open questions

Recommendation first. Items 1 to 6 are needed before W6-14 and the report can give a verdict. Items 7 and 8 gate W6-03 and W6-05.

1. **"Survives 5 consecutive in-game days"**: does any death in the window fail the run? Recommendation: yes, and the `death` event is the measure.
2. **"Useful autonomous minute"**: define it. Recommendation: a real minute in which an intent was running and the Body issued at least one action with a receipt, with no model call waited on that minute.
3. **"Inference calls per useful autonomous minute"**: which calls count? Recommendation: thoughts and reflections, reported separately; the total is the headline.
4. **"Thought latency under 15 s"**: p50, p95 or max? Recommendation: p95 under 15 s, with p50 and max reported. The 25 s deadline stays the hard limit.
5. **"A bed, food and stone tools"**: the measurable form. Recommendation: at each day boundary, a placed and slept-in bed owned by the agent, at least one food eaten in the day, a stone pickaxe in the inventory.
6. **Five days and 24 hours**: one run or two? Recommendation: one continuous run of at least 24 real hours that contains the 5-day segment, with one planned restart and one Body restart mid-intent. Also: the model floor has no tier below 8B in Phase 0; confirm that nothing lower is run.
7. **AD-11, the `stuck` signal**: implement a watchdog (W6-03), or record a decision that Phase 0 has no `stuck` signal? Recommendation: record the decision unless the runs need it, since no exit criterion names it.
8. **BC-10, the thought template v3 line** (carried from wave 5 and wave M). Recommendation: one v3 line (W6-05); decision 0058 stays v2 as the default until you say so.
9. **D-P0-18** (the benchmark `--runs` count of 10 for the recorded run) is still Proposed. Accept it for OPS-0 and OPS-4?
10. **Glass access** in Phase 0: loopback only, no authentication, no tunnel. Recommendation: yes, as a v0. The Observatory edge is deferred to Phase 2 (D-P0-13), so the SSO rule in spec 5.13 and 8.4 does not apply yet. The tunnel design is a Phase 1 item.
11. **Least-privilege roles** (carried from wave 5): a read-only Postgres role for the Glass and the report, and a read-only NATS consumer. Recommendation: yes, before OPS-1.
12. **The spec edit** for the observer disclosure variable (decision 0059) and the `uuid` override (carried from wave 5 and wave M). Only the owner edits `docs/spec.md`; no wave 6 packet does.
13. **Decision 0060** (persona size limits) has no file under `docs/decisions/`. Write it, or confirm it is not needed for Phase 0.
14. **Review independence**: the three campaign reviewers are fresh agents, not the coders. Recommendation: yes; the orchestrator aggregates and dispatches the fixes.
15. **The campaign retro's scope**: the sources listed in W6-23. Is anything outside `docs/analysis/phase0/` to be read (for example the wave M ranger logs, which the retro may need)? Recommendation: no, unless the owner asks.
16. **Coder agent**: the W6 coders run the `packet-coder` agent. Confirm that, and that the commit trailer is written once into `.claude/agents/packet-coder.md`, as the wave 5 retro asks.
