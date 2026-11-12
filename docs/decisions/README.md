# Decisions

One short record per decision as it is settled: an open decision from spec section 13, a gap the spec leaves, or a place where we chose differently from the spec. The spec stays the design. A record says what we decided, why, and what it changes. A decision that is still open lives in the Decisions table of the campaign ledger that needs it (for Phase 0, [docs/analysis/phase0/README.md](../analysis/phase0/README.md)), not here.

Name records `NNNN-short-slug.md`, numbered in order. Sessions working in parallel may each pick numbers well apart to avoid collisions; gaps in the sequence are fine. A record is never rewritten to say something else: a later record supersedes it, and the old one's status says `Superseded by NNNN`.

```markdown
# NNNN. Title

- Status: Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Spec: section or open-decision number this settles

## Decision
## Why
## Consequences
```

| # | Decision | Status |
|---|---|---|
| [0001](0001-contract-json-schema.md) | The contract is JSON Schema with code generation | Accepted |
| [0002](0002-phase0-host-and-models.md) | Phase 0 runs on the owner's Windows PC with Ollama, Qwen3 32B and 8B | Accepted |
| [0003](0003-task-runner.md) | `geldar.ps1` is the task runner, not `make` | Accepted |
| [0004](0004-phase0-repo-layout.md) | Phase 0 code lives in this one repo | Accepted |
| [0005](0005-pinning-and-security-updates.md) | Exact pins, two-week minimum age, Dependabot security updates only | Accepted |
| [0006](0006-typescript-toolchain.md) | pnpm, TypeScript 7, Biome and Vitest | Accepted |
| [0020](0020-receipts.md) | Every action gets a receipt; economic actions get two | Accepted |
| [0021](0021-velocity-from-phase0.md) | Velocity bot ingress from Phase 0, matching production | Accepted |
| [0022](0022-minecraft-26-1.md) | Minecraft 26.1 and the pinned body stack | Accepted |
| [0023](0023-skill-foreign-keys.md) | Books and the skill library point at one edition of a skill | Accepted |
| [0024](0024-gamerules-26-1.md) | Gamerule names on Minecraft 26.1 are snake_case | Accepted |
| [0025](0025-snapshot-revision.md) | Snapshots and action records carry a revision | Accepted |
| [0026](0026-one-database-per-shard.md) | Phase 0 is one database per shard | Accepted |
| [0027](0027-final-receipt-constraints.md) | The database enforces one final receipt per action | Accepted |
| [0028](0028-model-names.md) | Phase 0 names models by their Ollama tag | Accepted |
| [0029](0029-rcon-reply-framing.md) | RCON replies end on a quiet period, not an empty packet | Accepted |
| [0030](0030-world-time-ticks.md) | `world_time.ticks` is the world age; an unnamed biome is omitted | Accepted |
| [0031](0031-place-at-feet.md) | `place ... at: "feet"` is the cell the bot's feet are in | Accepted |
| [0032](0032-table-crafting-and-recipe-book.md) | Crafting on 26.1 goes through the recipe book, and the shard unlocks recipes | Accepted |
| [0033](0033-mock-wake-and-interest-vocabulary.md) | The mock's wake and interest vocabulary is provisional; the character is woken only by wake_on and long-poll events | Accepted |
| [0034](0034-mock-result-shapes-and-untrusted-text.md) | Mock result shapes: untrusted-text wrapper, and the waking event is never trimmed | Accepted |
| [0035](0035-mcp-tool-schema-shapes.md) | MCP tool schemas: write_book oneOf, and results without a root type are not published as outputSchema | Accepted |
| [0036](0036-launcher-workspace-named-volume.md) | The launcher keeps the player workspace in a named Docker volume on every OS | Accepted |
| [0037](0037-chest-transfers-by-explicit-clicks.md) | Chest deposits and withdrawals are an explicit, server-confirmed click sequence | Accepted |
| [0038](0038-tick-rate-does-not-slow-a-client-driven-body.md) | `/tick rate` does not slow a Mineflayer-driven Body; the world clock has a 20-tick resolution | Accepted |
| [0039](0039-pathing-forbids-corner-cutting.md) | The Body's pathing forbids diagonal moves that cut a block corner | Accepted |
| [0040](0040-bot-ingress-registry-in-nats-kv.md) | The bot-ingress gate reads a NATS KV registry, fails closed, and Golem registers before it connects | Accepted |
| [0041](0041-event-export-stream-and-sink.md) | Events go to one JetStream stream with dedup headers, and the sink dead-letters what it cannot store | Accepted |
| [0042](0042-path-rule-case-folded-identity-prefix.md) | The session path rule never allows `memory/identity.md/` as a prefix, case-folded | Accepted |
| [0043](0043-phase0-body-state-in-nats-kv-and-record-rules.md) | Phase 0 keeps Body checkpoints and generations in NATS KV; record rules for intents, audit records and receipts | Accepted |
| [0044](0044-malicious-book-corpus-world-side.md) | The malicious-book corpus: world side in the mock, hostile text stays untrusted, the model half is local | Accepted |
| [0045](0045-live-malicious-book-check-is-local-only.md) | The live malicious-book check is local only; CI proves the deterministic half (D-SC-01) | Accepted |
| [0046](0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md) | A scripted stub CLI stands in for the vendor CLI in CI (D-SC-10) | Accepted |
| [0047](0047-thinking-time-comes-from-intents-and-waits-not-dilation.md) | Adam's thinking time comes from intents, waits and reflexes; time dilation is not a Phase 0 mechanism | Accepted (owner) |
| [0048](0048-recipe-discovery-is-part-of-the-game.md) | Recipe discovery is part of the game; the plugin stops granting the recipe book | Accepted (owner) |
| [0049](0049-thinker-job-gets-response-format-and-reasoning.md) | The Thinker job frame gains `response_format` and `reasoning` (Appendix H) | Accepted (owner) |
| [0050](0050-phase0-mind-processes-run-on-the-host.md) | In Phase 0 the Mind, the local Thinker and Adam's Body run as host processes | Accepted (owner) |
| [0051](0051-adam-identity-and-model-pins.md) | Adam's identity and the Phase 0 model pins | Accepted (owner; seed approved 2026-11-09) |
| [0052](0052-per-owner-sovereign-player-cap-raised-to-20.md) | The per-owner cap on sovereign players is raised to 20 for the owner; the real Geldar MCP is built alongside wave 6 | Accepted (owner) |
| [0053](0053-public-mcp-through-an-outbound-tunnel-deferred.md) | The sovereign MCP is loopback-only now; a public name through an outbound tunnel waits for the colo move | Superseded by 0071 (2026-11-10) |
| [0054](0054-static-hashed-per-player-bearer-tokens.md) | Sovereign MCP clients use static, hashed, per-player Bearer tokens, not OAuth 2.1 | Accepted |
| [0055](0055-phase0-sovereign-tool-subset-and-mappings.md) | The Phase 0 sovereign MCP serves the frozen 14-tool vocabulary; six tools are not available and the action list is atomic | Accepted |
| [0056](0056-first-migration-runner-and-least-privilege-grants.md) | The first migration runner, the migration ledger rule, and the least-privilege grants for the MCP role | Accepted |
| [0057](0057-sovereign-budget-numbers-and-wake-spacing.md) | Sovereign budget numbers, rate limits, wake spacing and presence timings for Phase 0 | Accepted |
| [0058](0058-the-character-knowledge-boundary-and-thought-v2.md) | Characters honour the in-world knowledge of the character, not the model's training data; thought prompt v2 carries the knowledge, sleep and anti-loop rules | Accepted (owner) |
| [0059](0059-identity-mode-is-about-human-observation-not-agent-belief.md) | `identity_mode` governs whether humans may observe a shard; the agents are never told they are watched | Accepted (owner) |
| [0060](0060-persona-size-limits.md) | Persona files are not artificially size-limited (identity 8192 bytes, goals 4096); the prompt fit is open for Wave M | Accepted (owner) |
| [0061](0061-phase-0-exit-criteria-readings.md) | Readings of the Phase 0 exit criteria (survival, useful minute, latency, 24 hours, model floor) and the read-only Glass role | Accepted provisionally (orchestrator, owner may revise) |
| [0062](0062-no-settled-credits-in-phase-0.md) | No settled-credits value reaches the reflection in Phase 0; the completed reflection keeps its reserved cost, and E-8 is deferred | Accepted provisionally (orchestrator, owner may revise) |
| [0063](0063-phase-0-has-no-stuck-signal.md) | Phase 0 has no `stuck` signal (AD-11); the exit runs measure whether intents complete, and the watchdog is a Phase 1 item | Accepted provisionally (orchestrator, owner may revise) |
| [0064](0064-exit-run-lives.md) | The exit runs use fresh lives (`ag_adam_03` 32B, `ag_adam_04` 8B) and fresh volumes; the smoke run has its own life (`ag_smoke_01`); journals are append-only | Accepted provisionally (orchestrator, owner may revise) |
| [0065](0065-damage-wakes-the-mind.md) | Damage wakes the Mind when no intent is running; death still ends the life | Accepted provisionally (orchestrator, owner may revise) |
| [0066](0066-phase0-closed-as-proof-of-life.md) | Phase 0 is closed as proof of life; the spec's section 10 exit criteria are waived by the owner and the exit runs are deferred | Accepted (owner) |
| [0068](0068-prompt-v4-and-agent-visible-text.md) | Nothing an agent reads may say humans watch it or reveal the shard, harness or credits; prompt v4 is the default and released templates are immutable; persona lint with `--allow-meta` | Proposed (fix-c; owner amends the spec line ~1584) |
| [0067](0067-nats-accounts-and-least-privilege.md) | NATS accounts and least-privilege users, opt-in until the stack is cut over | Accepted provisionally (orchestrator, owner may revise) |
| [0069](0069-no-plan-wake-is-not-a-failure.md) | A no_plan wake with no intent is a neutral wake, not a failed intent; the player event type list gains `wake` | Accepted (fix-perception) |
| [0070](0070-phase1-is-the-colo-first-shard.md) | Phase 1 is the colo-first shard: final environment, invite-only, not announced | Accepted (owner) |
| [0071](0071-public-endpoints-and-ports.md) | The public Minecraft endpoint is a new TCP port with an SRV record; HTTPS ingress is the shared Caddy, reloaded and never restarted | Accepted (owner) |
| [0072](0072-glass-and-bluemap-are-public.md) | Glass and BlueMap are public, read-only, and hardened before exposure | Accepted (owner) |
| [0073](0073-spec-is-never-edited.md) | docs/spec.md is never edited by agents; decision records amend it, with the open amendments listed | Accepted (owner) |
| [0074](0074-shelter-means-an-enclosed-safe-space.md) | Shelter means an enclosed safe space, not only a bed; a night rested in any enclosed shelter counts for the fatigue rule; prompt v5 and body-api v2 are the defaults | Accepted (owner) |
| [0075](0075-glass-is-a-lakitu-camera.md) | The Glass gets Lakitu cameras: free-fly, collision-bound, invisible in the world, targeted by login | Accepted (owner, 2026-11-11; the name is Kino) |
| [0076](0076-backup-scope-and-destination.md) | Backup scope and destination: what a coordinated checkpoint contains, the destination, append-only journals, and a restore test | Accepted (owner confirmed 2026-11-10); destination and backup build deferred (0130) |
| [0077](0077-invitee-auth-and-the-0072-0075-login-rule.md) | Invitee auth, and the login rule for Lakitu cameras: anonymous reads the thought stream and map; owner or admin login for cameras; interim auth before Entra SSO | Accepted (owner, 2026-11-11) |
| [0078](0078-mind-placement-for-phase1.md) | Mind placement for Phase 1: the Mind on the colo Record/Mind host (spec 6.1), Thinkers on home GPUs through a gateway, sovereign players run no Mind | Accepted (owner confirmed 2026-11-10) |
| [0079](0079-credit-numbers-and-charge-rules.md) | Credit numbers and charge rules: spec tiers for Mind-driven agents, 0057 numbers for sovereign players, refund on failure before output, reserve before dispatch, per-address caps scaled to players | Proposed (owner confirms the numbers and charge rules) |
| [0080](0080-nats-auth-cutover.md) | NATS auth cutover: default-on after a live nats-server test, credentials through compose/secrets, least-privilege users, per-Thinker users in Phase 1 and Gateway mTLS at Phase 2 | Accepted (owner confirmed 2026-11-10) |
| [0081](0081-c1-unblocker-checks-and-first-party-pin-exemption.md) | C1 unblocker checks and the first-party pin exemption: release-age floor with a dated list, first-party image allowlist (digest pin still required), integration-test floor, decision-index drift check, checkpoint manifest and shard-config schemas | Accepted (owner ruled 2026-11-10) |
| [0082](0082-colo-compose-network-and-limits.md) | Colo compose layout: own network, CPU and memory limits, loopback binds and ports (Velocity on 127.0.0.1:25567, never 25565 or 25566) | Proposed (the orchestrator may accept at the ops merge) |
| [0083](0083-c1-body-and-mind-image-contents.md) | Body and Mind image contents, base pins, and what is never baked in | Proposed |
| [0084](0084-colo-deploy-by-pull-with-a-project-scoped-script.md) | Colo deploy by pull, with a project-scoped script | Proposed |
| [0085](0085-append-only-audit-tables.md) | Append-only audit tables: receipts, thoughts, suppressed wakeups and mcp_journal refuse UPDATE and DELETE statements (0007; a superuser can still TRUNCATE or bypass the trigger; hardening in C2); geldar_mcp loses UPDATE and DELETE on mcp_journal | Accepted (orchestrator, under 0064 and 0076) |
| [0087](0087-nats-overlay-live-test-and-scoped-subjects.md) | NATS overlay live test and scoped subjects | Proposed |
| [0088](0088-metrics-exporters-and-replay-window.md) | Metrics exporters are push-only OTLP to a configured URL; the MCP replay window is bounded and optional | Proposed |
| [0089](0089-crash-hygiene-defaults-and-refusals.md) | Crash hygiene: the owner cap default, the start refusal while a name lease is held, and `players down` | Accepted (orchestrator) |
| [0090](0090-public-mcp-contract.md) | Public MCP contract: client-ip header, error shapes, kill-switch config | Proposed |
| [0091](0091-public-mcp-behind-caddy.md) | Public MCP behind Caddy: trusted peer from config, the `public:` block, kill switch, rate limit defaults, negative cache, invitee issuing | Proposed |
| [0092](0092-velocity-spectator-whitelist.md) | Velocity spectator whitelist and ghost rule | Proposed |
| [0093](0093-glass-hardening.md) | Glass hardening: defaults (rate limit, size caps, delay 60 s, living sovereign hidden, no board) and the test for each 0072 item | Proposed (orchestrator; owner rulings recorded) |
| [0094](0094-public-sites-read-only-through-caddy.md) | BlueMap, Glass and MCP read-only Caddy sites with kill switches; no Caddy rate limit | Proposed |
| [0095](0095-look-projection-and-mcp-image.md) | Look carries no internal ids and has in-world time; the MCP image keeps the animus and mcp-mock modules its runtime imports | Proposed |
| [0096](0096-public-topology-as-built.md) | Public topology as built on the Colo node: host-network Caddy, loopback publishes, the colo-public overlay for Minecraft | Proposed |
| [0100](0100-lakitu-feed-contract.md) | Lakitu feed contract: one-way feed, no input path, no names or tokens in the feed, positions only in the login-scoped feed, pane cap 4 per session (proposed) | Proposed (orchestrator, 2026-11-11; owner to confirm) |
| [0101](0101-lakitu-feed-plugin.md) | Lakitu feed plugin: invisible and read-only by static scan, config caps, load cap (tick budget to be measured) | Proposed (orchestrator, 2026-11-11; owner to confirm) |
| [0130](0130-phase1-owner-rulings-for-c1.md) | Phase 1 owner rulings: deploy by runner or SSH, backups deferred, telemetry to the node's SigNoz, long-running tests deferred to the end of the phase | Accepted (owner ruling 2026-11-10) |
| [0131](0131-colo-in-container-hosts-and-mind-shard-file.md) | Colo containers reach their compose peers by name through a closed, opt-in allowlist; the Mind's shard file is `shards/colo-mind.yaml`, separate from the budget file | Accepted (orchestrator, 2026-11-10) |
| [0132](0132-ipv4-literal-policy.md) | IPv4 literal policy: loopback and documentation addresses anywhere, private addresses only in an allowlisted file, public addresses never | Accepted (orchestrator, 2026-11-10) |
| [0133](0133-colo-admin-by-one-shot-container.md) | Colo administration runs in a one-shot `geldar-admin` container (migrate, owner, player, token) inside the compose network | Accepted (orchestrator, 2026-11-10) |
| [0134](0134-mind-is-a-profile-until-a-thinker-exists.md) | The Mind (`animus`) is a compose profile on the Colo until a Thinker path exists | Accepted (orchestrator, 2026-11-11) |
| [0135](0135-self-registration-with-github-and-discord.md) | Self-registration: Microsoft sign-in only (amended 2026-11-11, R40 to R42), rate limits instead of a daily cap, one host with Glass, no manual approval, off until the C2 gates pass | Accepted in principle (owner 2026-11-11); design Proposed |
| [0136](0136-register-ban-procedure.md) | Banning a registered identity: by provider account, tokens revoked, unban leaves them revoked | Accepted (orchestrator, 2026-11-11) |
| [0137](0137-public-spectator-proxy-is-separate-and-online.md) | The public Minecraft port is a separate online-mode spectator proxy (spec 8.4); Paper holds every player without a signed live property in spectator | Accepted (orchestrator, 2026-11-11) |
| [0138](0138-thought-visibility.md) | Who reads a sovereign player's thoughts: the owner live, everyone once the life is over, the public delayed only on the owner's opt-in | Accepted (orchestrator, 2026-11-11) |
| [0139](0139-kino-feed-agents-only.md) | The Kino entity feed lists agent bodies and mobs only; every other player is excluded | Accepted (orchestrator, 2026-11-11) |
>
| [0140](0140-agent-skins.md) | Agent skins: MineSkin-signed textures in geldar-skins, applied by the Velocity identity plugin; ranger skins uploaded with owner approval | Accepted (orchestrator, owner request, 2026-11-11) |
| [0141](0141-soft-dig-pathing-for-natural-soft-blocks.md) | The Body's pathing may dig natural soft blocks (leaves, vines, snow layers, plant cover) and nothing else | Proposed (owner confirmation pending) |
| [0142](0142-stall-and-replan-numbers.md) | A stalled move replans after about 60 ticks, up to 6 times, and follows partial paths | Proposed (owner confirmation pending) |
| [0143](0143-outcome-events-extend-the-provisional-vocabulary.md) | Per-action `action` and `action_failed` events extend the provisional event vocabulary | Proposed (owner confirmation pending) |
| [0144](0144-death-is-an-event-and-a-dated-fact-and-there-is-no-revive.md) | Death is a distinct event with `died_at` and a cause; there is no revive | Proposed (owner confirmation pending) |
| [0145](0145-agent-names-need-line-of-sight-and-proximity.md) | A target agent can be named only when seen and near | Proposed (owner confirmation pending) |
| [0146](0146-c5-open-questions-for-the-owner.md) | Wave C5 open questions: write_book stamping, Moot Stone governance, plugin item consumption | Open |
| [0150](0150-register-loopback-port-18090.md) | The register service publishes on loopback port 18090, not 8090 (held by another tenant on the shared node) | Accepted |