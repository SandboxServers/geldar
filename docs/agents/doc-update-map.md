---
title: Doc-update map
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [README.md, documentation-style.md, doc-verification.md, ../analysis/docs-library/plan.md]
sources: [tools/repo-checks/src/run-checks.ts, tools/repo-checks/src/cli.ts, tools/repo-checks/src/decision-index.ts, tools/repo-checks/src/decision-rows.ts, tools/repo-checks/src/ip-literals.ts, tools/repo-checks/src/mcp-token.ts, tools/repo-checks/src/file-caps.ts, tools/repo-checks/src/legal-drafts.test.ts, tools/repo-checks/src/no-credentials.test.ts, tools/repo-checks/src/open-signup-runbook.test.ts, tools/repo-checks/src/nats-auth-runbook.test.ts, deploy/test/install-body-helper-runbook.test.ts, deploy/test/kino-deploy.test.ts, plugins/bluemap/test/sky-wiring.test.ts, threshold/register/test/players-readme.test.ts, threshold/register/test/revocation-wording.test.ts, threshold/register/test/legal-pages.test.ts, threshold/register/scripts/gen-legal.ts, threshold/mcp-mock/src/prompts.ts, threshold/mcp/src/resources.ts, contract/test/agent-visible-text.test.ts, animus/src/prompts/agent-text.test.ts, .github/workflows/ci.yml, package.json, docs/runbooks]
---

# Doc-update map

Which documents a change has to update. Read it before you open a PR, and when you review one.

A change that alters behaviour, an interface, configuration, file layout, a build step or a procedure includes the matching document update in the same PR. **Most of this map is not gated: reviewers enforce it.** The [gates table](#gates-that-read-documents) below lists the few documents a check does read. Write or update documents with the documentation-writer agent and the [style rules](documentation-style.md); check them with [doc verification](doc-verification.md).

## How to read the table

- **Update now** lists documents that exist at cd4499da. Update them in the same PR. **Gated** means a test in `pnpm test` reads that document and fails the PR when it disagrees (see the [gates table](#gates-that-read-documents)).
- **Planned** lists documents the approved [docs-library plan](../analysis/docs-library/plan.md) schedules but has not written yet, with their wave (W1 to W5). The links do not resolve yet. Until a planned document exists, you have nothing to update there: note the debt in the PR. Once it exists, it moves to "Update now".

## If you change X, update Y

| If you change… | Update now | Planned |
|---|---|---|
| `contract/schemas/*` | Regenerate the generated code (`./geldar.ps1 check` runs the drift check; never hand-edit generated files). A schema an agent reads (`mcp-world`, `mcp-play`, `mcp-common`, `common`) must pass the agent-text scan in `contract/test/agent-visible-text.test.ts`. | [contract-schemas](../reference/contract-schemas.md) W2; [nats-subjects](../reference/nats-subjects.md) W2; [data-flow-events](../architecture/data-flow-events.md) W1 |
| A new migration under `sql/` | [sql/README.md](../../sql/README.md); [runbooks/account-deletion.md](../runbooks/account-deletion.md) when the change touches personal data. Add a new `sql/test/check-schema-*.sql` to the CI psql step if you add one. | [database-schema](../reference/database-schema.md) W2; [add-a-migration](../runbooks/add-a-migration.md) W3; [privacy-and-data-retention](../security/privacy-and-data-retention.md) W4 when personal data moves |
| `compose/*.yml`, `shards/*.yaml`, `envs/*` | [runbooks/scratch-stack.md](../runbooks/scratch-stack.md); [runbooks/signcheck-shard.md](../runbooks/signcheck-shard.md); [reference/repo-layout.md](../reference/repo-layout.md) when a file is added or removed. | [compose-stacks](../reference/compose-stacks.md) W2; [shard-config](../reference/shard-config.md) W2; [environment-variables](../reference/environment-variables.md) W2 (names only); [network-and-trust-zones](../architecture/network-and-trust-zones.md) W1; [deployment-topology-colo](../architecture/deployment-topology-colo.md) W1 |
| The `register` service's `REGISTER_*` environment in `compose/colo.yml` | [runbooks/open-signup.md](../runbooks/open-signup.md): name the variable under the operator list or the compose sentence. **Gated** (`open-signup-runbook.test.ts`). | none |
| `deploy/*`, `.github/workflows/colo-*` | [deploy/README.md](../../deploy/README.md); [runbooks/colo-deploy.md](../runbooks/colo-deploy.md); [runbooks/node-only-config.md](../runbooks/node-only-config.md); the component's rollback section. | [deploy-scripts](../reference/deploy-scripts.md) W2; [deployment-topology-colo](../architecture/deployment-topology-colo.md) W1 |
| NATS subjects, users or auth (the generator in `geldar.ps1`, `compose/nats-auth*.yml`) | [runbooks/nats-auth-inplace.md](../runbooks/nats-auth-inplace.md); [runbooks/body-helper-node-steps.md](../runbooks/body-helper-node-steps.md) for the `helper`, `supervisor`, `body` and `paper` users (**gated**). | [nats-subjects](../reference/nats-subjects.md) W2; [nats-topology](../architecture/nats-topology.md) W1; [authn-authz-map](../security/authn-authz-map.md) W4 |
| `threshold/mcp` or `threshold/mcp-mock` tools, resources, prompts or budgets | [threshold/mcp/README.md](../../threshold/mcp/README.md); [threshold/mcp-mock/README.md](../../threshold/mcp-mock/README.md); [players/README.md](../players/README.md) when a player sees the change; [runbooks/mcp-tokens.md](../runbooks/mcp-tokens.md). Tool and prompt text is agent-read: follow the [agents-never rule](documentation-style.md#agents-never-learn-they-are-watched). The MCP prompts live in `threshold/mcp-mock/src/prompts.ts` and the production server serves them from there (`threshold/mcp/src/resources.ts`). | [mcp-tools](../reference/mcp-tools.md) W2; [economy-and-budgets](../concepts/economy-and-budgets.md) W1 |
| `threshold/register` routes, tokens or the sign-up flow | [threshold/register/README.md](../../threshold/register/README.md); [players/README.md](../players/README.md) (**gated** wording on tokens and URLs); [runbooks/open-signup.md](../runbooks/open-signup.md); [runbooks/account-deletion.md](../runbooks/account-deletion.md); [runbooks/skins.md](../runbooks/skins.md). | [register-service](../reference/register-service.md) W2; [life-cycle-of-a-life](../concepts/life-cycle-of-a-life.md) W1; [privacy-and-data-retention](../security/privacy-and-data-retention.md) W4 |
| `docs/legal/*` | Regenerate `threshold/register/src/legal-texts.generated.ts` with `node threshold/register/scripts/gen-legal.ts` in the same change (**gated**). Keep the version stamp and contact line (**gated**). | [privacy-and-data-retention](../security/privacy-and-data-retention.md) W4 |
| `golem/src` actions, perception or body | [golem/README.md](../../golem/README.md); the `body-bench` skill ([.claude/skills/body-bench/SKILL.md](../../.claude/skills/body-bench/SKILL.md)). Failure text is agent-read. | [golem-body](../reference/golem-body.md) W2; [body-and-mind](../concepts/body-and-mind.md) W1 |
| `plugin/core` features | [plugin/README.md](../../plugin/README.md); the matching runbook ([block-owner](../runbooks/block-owner.md), [kino](../runbooks/kino.md), [maintenance-notice](../runbooks/maintenance-notice.md), [skins](../runbooks/skins.md)). | [geldar-core-plugin](../reference/geldar-core-plugin.md) W2 |
| `plugin/velocity-identity` | [plugin/README.md](../../plugin/README.md). | [velocity-identity-plugin](../reference/velocity-identity-plugin.md) W2; [identity-and-ingress](../concepts/identity-and-ingress.md) W1 |
| `plugins/` (BlueMap, Chunky, CoreProtect) | [runbooks/map-chat-panel.md](../runbooks/map-chat-panel.md) (**gated** for the BlueMap scripts); [runbooks/chunky.md](../runbooks/chunky.md); [runbooks/coreprotect.md](../runbooks/coreprotect.md). | [third-party-plugins](../reference/third-party-plugins.md) W2 |
| `glass/` routes, Kino, or visibility rules | [glass/README.md](../../glass/README.md); [runbooks/glass-aliases.md](../runbooks/glass-aliases.md); [runbooks/kino.md](../runbooks/kino.md) (**gated** for secret values). All `agents-never`. | [glass-and-kino](../reference/glass-and-kino.md) W2; [observation-and-privacy](../concepts/observation-and-privacy.md) W1 |
| A new version under `prompts/` | [prompts/README.md](../../prompts/README.md). Never edit a released template; add a version. The prompt scan in `animus/src/prompts/agent-text.test.ts` runs on the new file. `agents-never`. | [prompt-templates](../reference/prompt-templates.md) W2; [release-a-prompt-version](../runbooks/release-a-prompt-version.md) W3 |
| `psyche/` | [psyche/README.md](../../psyche/README.md) (the mirror contract). | [psyche-engine](../reference/psyche-engine.md) W2; [character-and-memory](../concepts/character-and-memory.md) W1; the `psyche-release` entry in [cli-tools](../reference/cli-tools.md) W2 |
| `supervisor/` or `body-helper/` | [runbooks/body-helper-node-steps.md](../runbooks/body-helper-node-steps.md). Neither package has a README at cd4499da. | [supervisor-and-body-helper](../reference/supervisor-and-body-helper.md) W2 |
| A tool under `tools/` added or removed | The runbook that uses it ([progress-metrics](../runbooks/progress-metrics.md), [mcp-tokens](../runbooks/mcp-tokens.md)); the tool table in [reference/repo-layout.md](../reference/repo-layout.md#tool-packages). | [cli-tools](../reference/cli-tools.md) W2; [repo-checks](../reference/repo-checks.md) W2 when it is a gate |
| A gate in `tools/repo-checks` or a CI workflow | The [gates table](#gates-that-read-documents) below when the gate reads documents; [runbooks/merge-queue.md](../runbooks/merge-queue.md). | [repo-checks](../reference/repo-checks.md) W2; [ci-workflows](../reference/ci-workflows.md) W2 |
| A new decision record | The row in [decisions/README.md](../decisions/README.md) (**gated**); [reference/spec-section-map.md](../reference/spec-section-map.md) when the record names a spec section. | [decisions-by-topic](../reference/decisions-by-topic.md) W5; [decision-timeline](../history/decision-timeline.md) W5; [superseded-and-reversed](../history/superseded-and-reversed.md) W5 for a superseding record |
| A component added, split or retired | [reference/repo-layout.md](../reference/repo-layout.md); [reference/glossary.md](../reference/glossary.md) for its name; `pnpm-workspace.yaml`; this map. | [components](../reference/components.md) W2; [system-overview](../architecture/system-overview.md) W1; [repo-map-and-dependencies](../architecture/repo-map-and-dependencies.md) W1 |
| `.claude/skills` or `.claude/agents` | The skill stays the source of truth for the agent's procedure. Mirror a repo rule in [CLAUDE.md](../../CLAUDE.md) and [AGENTS.md](../../AGENTS.md) together. | [skills-and-agents](../reference/skills-and-agents.md) W2 |
| A campaign opens or closes | The campaign's own `RESUME.md` under [docs/analysis/](../analysis/). | [campaign-index](../history/campaign-index.md) W5 |
| A world-operations exception (a human acts in the world under a decision) | The decision record. State that the exception is bounded and temporary where the decision says so. | [world-operations-exceptions](../concepts/world-operations-exceptions.md) W1; [world-and-memory-reset](../runbooks/world-and-memory-reset.md) W3 |
| Anything an agent in the world reads (prompts, tool text, kit, persona, signs) | Check it against the [agents-never rule](documentation-style.md#agents-never-learn-they-are-watched). Never link an operator document from it. | none |
| Public copy in the root [README.md](../../README.md) | Keep it consistent with what is deployed; record a deliberate gap (for example a feature not yet public) in the PR. | none |
| A new document under `docs/` | Its section `README.md` index; [docs/README.md](../README.md); a row here if it is a new kind of change. | none |
| An idea outside the spec and the current packet | [docs/ideas.md](../ideas.md), not code. | none |
| `docs/spec.md` | Owner only. A writer never edits it; when the spec is wrong or silent, write a decision record instead. | none |

## Gates that read documents

Read from the sources at cd4499da on 2026-11-16. These are the gates that read documents, not every gate. `pnpm check:repo` also runs checks that read no document: env-definitions, identity-mode, integration-floor, loopback-ports, pin-rules, release-age and workflow-yaml (the imports of `tools/repo-checks/src/run-checks.ts`); the planned [repo-checks](../reference/repo-checks.md) reference (W2) will list every gate.

Two runners carry the gates: `pnpm check:repo` (`node tools/repo-checks/src/cli.ts`, the checks in `run-checks.ts`) and `pnpm test` (Vitest across the workspace). CI runs both (`.github/workflows/ci.yml`), and `./geldar.ps1 check` runs both locally.

### In `pnpm check:repo`

| Gate | Source | What it checks in documents |
|---|---|---|
| line-endings | `line-endings.ts`, `run-checks.ts` | Fails a tracked file committed with CRLF (from `git ls-files --eol`). `.gitattributes` exempts `*.bat` and `*.cmd`. |
| control-chars | `control-chars.ts`, `run-checks.ts` | Fails a raw control byte or a lone CR in a committed file, a working-tree edit or an untracked file. |
| file caps | `file-caps.ts` | Applies the 500 and 700 line caps to code and config extensions only. Markdown is not capped. |
| decision-index | `decision-index.ts` | Every `docs/decisions/NNNN-*.md` has a row in `docs/decisions/README.md` whose first cell links it; every such link points at an existing record; any other `.md` in that folder (except `README.md`) fails. |
| decision-rows | `decision-rows.ts` | The README rows go up in number and no number repeats. |
| ip-literals | `ip-literals.ts`, `ip-literal-allowlist.json` | Every scanned text file, `docs/` included: loopback, `0.0.0.0` and the RFC 5737 documentation ranges pass anywhere; a private-range address passes only in an allowlisted file; any other address fails (decision [0132](../decisions/0132-ipv4-literal-policy.md)). A line with a `version` key is skipped. |
| MCP token | `mcp-token.ts` | Fails any text file holding a string shaped like a sovereign player's MCP bearer token. |

### In `pnpm test`

| Gate | Source | What it checks in documents |
|---|---|---|
| no-credentials | `tools/repo-checks/src/no-credentials.test.ts` | No tracked secret file by path; no tracked file with a private-key header, a NATS URL with a password, or a long password assignment. |
| legal-drafts | `tools/repo-checks/src/legal-drafts.test.ts` | `docs/legal/` holds exactly `terms.md`, `privacy.md`, `acceptable-use.md`; each has a `Version N, effective YYYY-MM-DD` line and `abuse@sandboxservers.games`, and no placeholder or DRAFT marker (decision [0155](../decisions/0155-legal-text-v1-approved-and-contact-published.md)). |
| legal pages | `threshold/register/test/legal-pages.test.ts` | The committed `legal-texts.generated.ts` equals a fresh run of `gen-legal.ts` over `docs/legal/`, and the served pages match the files. |
| open-signup-runbook | `tools/repo-checks/src/open-signup-runbook.test.ts` | `docs/runbooks/open-signup.md` names every `REGISTER_*` variable the register service sets in `compose/colo.yml`, names none it does not set (except a listed pending set), files each under the operator list or the compose sentence to match compose, and holds no UUID or long token-like string. Also: `deploy/README.md` has no "Keep it off until C2-08d" sentence. |
| nats-auth-runbook | `tools/repo-checks/src/nats-auth-runbook.test.ts` | Despite its name, it checks `docs/runbooks/body-helper-node-steps.md`: the Pub and Sub subjects of the `helper` and `supervisor` users match the generator in `geldar.ps1`, and the `helper.body.>` PubDeny of `body` and `paper` matches. |
| body-helper runbook | `deploy/test/install-body-helper-runbook.test.ts` | `body-helper-node-steps.md` keeps its dry-run-first order, its prohibitions, rollbacks and no secret-shaped values, and links `docs/runbooks/nats-auth-inplace.md`, which must contain the `docker kill -s HUP` step. |
| kino runbook | `deploy/test/kino-deploy.test.ts` | `docs/runbooks/kino.md` names the client-secret file variable and holds no client-secret value. |
| map-chat-panel runbook | `plugins/bluemap/test/sky-wiring.test.ts` | `docs/runbooks/map-chat-panel.md` loads both BlueMap scripts through `settings.json`. |
| player guide | `threshold/register/test/players-readme.test.ts`, `revocation-wording.test.ts` | `docs/players/README.md` wording on sign-in, token revocation, lifetime and the URLs it names agrees with the register service. |
| agent-text scans | `contract/test/agent-visible-text.test.ts`, `animus/src/prompts/agent-text.test.ts`, `tools/mcp-tokens/src/persona-lint.ts` | Agent-read text (MCP schemas, `prompts/`, persona files) carries no marker words. These scan code and prompts, not `docs/`. |

### Not gated

No check reads document metadata, relative links, the section indexes, this map, or audience labels. The plan proposes a link checker, a metadata linter, an agent-visibility check and generated lists as coder packets after the freeze (plan decision D7). Until then, run the manual scans in [doc verification](doc-verification.md#mechanical-scans).

Index entries in [docs/README.md](../README.md) and each section `README.md` stay in sync with the documents they list: adding or renaming a document updates its index in the same PR.
