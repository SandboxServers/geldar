# Retarget map: the 62 original packets after the in-house Mind was dropped

The original campaign (geldar `docs/analysis/character-sheet/`, written against geldar `8eac28ba`) had 62 packet candidates, AN-00 to AN-61, in waves W0 to W12. On 2026-11-14 the owner ruled that the in-house Mind (`animus/`) is abandoned and that the player kit is the one Mind, with a harness per model family (D-HC-01). This table says what became of each packet.

Dispositions:

- **Keep**: stays a geldar packet. Its Body, contract, SQL, eventsink or plugin work is unchanged. "Trimmed" means every Animus consumer was removed from its scope.
- **Retarget**: the behaviour is still wanted, but it is implemented in the kit as the packet shown. The original card is the behavioural source; the new card is the work order.
- **Split**: one half stays in geldar, the other half becomes a kit packet.
- **Defer**: depends on a kit design that does not exist (a commitment store). Held as `BlockedDecision` (D-HC-06).
- **Retire**: no longer needed.

The geldar plan's rules still hold for kept packets: contract first, one owner per shared file, a revert-check per behaviour, number allocation only through the registry.

## W0

| Original | Disposition | Now |
|---|---|---|
| AN-00 settle and freeze the campaign | **Retire**, replaced | HC-00 (kit decision record) and the D-HC table in the README. The world side still records its own ADRs through its own registry |
| AN-01 optional Codex adapters | **Keep, optional**, no change | Separate; not part of the critical path |

## W1: durable foundations (world)

| Original | Disposition | Now |
|---|---|---|
| AN-02 core contract unblocker | **Keep, trimmed** | Drop the heuristic-thought-outcome and Mind decision-link shapes. Keep sheet and config shapes, roll and decision audit payloads, proficiency state and level-change, typed outcome facts |
| AN-03 pure psyche engine | **Keep** | Unchanged. It is also the source of the kit's mirror (GX-02, HC-17) |
| AN-04 core persistence and grants | **Keep, trimmed** | Drop heuristic-state tables (those move to the kit-local store, D-HC-04). Keep sheet adoption, roll and decision projections, unique XP evidence, proficiency, export and retention map |
| AN-05 sheet adoption and config loaders | **Keep, trimmed** | Body and roster paths only (`golem` Adam and player config, `tools/mcp-tokens`). Drop `animus/src/config.ts` and the Mind agent store |
| AN-06 durable roll and decision projection | **Keep** | Producers are now Golem and the kit's operator export; the eventsink side is unchanged |
| AN-07 foundation wiring and inactive deployment | **Keep, trimmed** | Drop Mind startup and Mind Dockerfile wiring. Keep Golem, eventsink, auth generation, sample shard config |
| *(new)* | | GX-01 stamp harness and model on every world event; GX-02 release the engine for mirroring |

## W2: Body diversity and proficiency (world)

| Original | Disposition | Now |
|---|---|---|
| AN-08 per-life threat policy | **Keep** | Unchanged |
| AN-09 proficiency evidence normalization | **Keep** | Unchanged |
| AN-10 exactly-once XP and level publication | **Keep** | Unchanged |
| AN-11 proficiency query service and Body cache | **Keep** | Unchanged |
| AN-12 Body and learning integration milestone | **Keep** | Unchanged |

## W3: Mind heuristic core, now the instinct step (kit)

| Original | Disposition | Now |
|---|---|---|
| AN-13 heuristic ports and durable state | **Retarget** | HC-18 (the `geldar-instinct` skeleton, world link, result protocol, kit-local state) |
| AN-14 idle habits and weighted selection | **Retarget** | HC-21 |
| AN-15 failure variations and insight | **Retarget** | HC-20 |
| AN-16 no-call execution and honest journaling | **Retarget** | HC-19 (the supervisor runs the step before each waking; a settled act is sent through the world's normal checked path and logged to `instinct.jsonl` with source "instinct") |
| AN-17 Mind core integration | **Retarget** | HC-24 (integration against a fake world) |

## W4: checks, attention and prose

| Original | Disposition | Now |
|---|---|---|
| AN-18 novelty from authorized knowledge | **Retarget** | HC-22 |
| AN-19 sanity policy and shared retry allowance | **Split** | Sanity veto: HC-23 (inside `mind-loop`, owned-loop harnesses only, D-HC-07). The shared retry allowance becomes the loop's own call budget: HC-10 and HC-11 |
| AN-20 future commitment scheduling | **Defer** | No commitment store in the kit (D-HC-06). Question card HC-33 |
| AN-21 versioned Mind temperament prompts | **Retarget** | HC-25 (the temperament sentences go into the birth-time `identity.md`, not a template version). Prompt versioning no longer applies |
| AN-22 sovereign persona export | **Retarget** | HC-25 (same generator; the geldar `tools/mcp-tokens` export stays for self-registered players and is untouched) |
| AN-23 checks and prose integration | **Retarget** | HC-24 and HC-26 |

## W5: evidence an observer can actually know (world)

| Original | Disposition | Now |
|---|---|---|
| AN-24 observed-actor contract unblocker | **Keep** | Unchanged. The evidence reaches the kit through the MCP events the agent already receives |
| AN-25 visible attacker identity | **Keep** | Unchanged |
| AN-26 observed gift provenance | **Keep** | Unchanged |
| AN-27 observed property break provenance | **Keep** | Unchanged |
| AN-28 attribution integration and leakage gate | **Keep** | Unchanged. Add: the leakage gate also checks the kit-side event reader (HC-27) sees only what a player can see |

## W6: estimated sheets and prediction (kit)

| Original | Disposition | Now |
|---|---|---|
| AN-29 social model persistence and evidence updates | **Retarget** | HC-27 (kit-local store, no SQL) |
| AN-30 prediction and stranger choices | **Retarget** | HC-28 |
| AN-31 bounded social-model prose | **Retarget** | HC-29 (prompt facts added by the instinct step) |
| AN-32 theory-of-mind integration | **Retarget** | HC-30 |

## W7: explore, farm and patrol

| Original | Disposition | Now |
|---|---|---|
| AN-44 program contract and API unblocker | **Keep** | Unchanged |
| AN-39 explore program | **Keep** | Unchanged |
| AN-40 farm program | **Keep** | Unchanged |
| AN-41 patrol program | **Keep** | Unchanged |
| AN-45 program publication and idle integration | **Split** | World half: register the programs and publish the Body API version (AN-45, trimmed). Kit half: idle candidates use them (HC-31) |

## W8: complete evidence and proficiency sources (world)

| Original | Disposition | Now |
|---|---|---|
| AN-46 complete evidence contract unblocker | **Keep, trimmed** | Drop the promise declaration adapter for the Mind memory (deferred with AN-48); keep combat, bilateral exchange and container-taking contracts |
| AN-47 own and observed combat evidence | **Keep** | Unchanged |
| AN-48 observed promise outcomes | **Defer** | Needs a kit promise design (D-HC-06, HC-33) |
| AN-49 conversation exchange and social XP | **Keep** | Unchanged; the kept-promise award waits for AN-48 |
| AN-51 observed taking from owned containers | **Keep** | Unchanged |
| AN-50 complete evidence integration | **Keep, trimmed** | The promise row is marked inactive; everything else as written |

## W9: moral hooks and reflective trust

| Original | Disposition | Now |
|---|---|---|
| AN-52 moral decision and reflection contract unblocker | **Keep, trimmed** | Keep the property-refusal reason code and decision identity. Reflection-input shapes become kit-local (HC-32) |
| AN-37 trait-based deliberate property refusal | **Keep** | Unchanged. It is a Body action hook, so it needs no Mind |
| AN-38 law-weighted due commitment wakes | **Defer** | Depends on commitments (D-HC-06) |
| AN-61 reflection uses estimated traits to revise trust | **Retarget** | HC-32 (estimates become facts in the prompt the supervisor builds; the existing `reflect` skill does the revising, no code trust delta) |
| AN-53 morality and reflective trust integration | **Keep, trimmed** | World half only |

## W10: lineage

| Original | Disposition | Now |
|---|---|---|
| AN-54 lineage contract and storage unblocker | **Keep** | Unchanged |
| AN-42 pure inherited-sheet factory | **Keep** | Unchanged (pure `psyche/` code) |
| AN-55 birth transaction and creation adapters | **Split** | World half: server-authorized birth, durable child sheet and ancestry (AN-55, trimmed). Kit half: `geldar-play new --parents` (HC-34) |
| AN-56 child prose synthesis and limited memory handoff | **Retarget** | HC-35 (synthesis runs through the player's own harness, or the owner's chosen model) |
| AN-57 end-to-end lineage integration | **Keep, trimmed** | World half; the real two-path gate needs HC-34 and HC-35 |

## W11: drift

| Original | Disposition | Now |
|---|---|---|
| AN-58 drift contract, policy and history unblocker | **Keep** | Unchanged |
| AN-59 seven-day evidence and drift eligibility | **Keep, trimmed** | World-side evidence only (Body and eventsink records). The instinct step's own decisions are an extra evidence source via HC-37 |
| AN-43 bounded drift transition and publication | **Keep** | Unchanged |
| AN-60 drift triggers, cache and prose coherence | **Split** | World half: Body cache reload and revision publication. Kit half: sleep trigger and the persona refresh artifact (HC-36) |

## W12: measurement and rollout

| Original | Disposition | Now |
|---|---|---|
| AN-33 operator evidence export | **Keep** | Plus HC-37 for the supervisor volume's ledgers |
| AN-34 cohort metrics and comparison report | **Keep, extended** | Add the harness (Claude, ChatGPT, local) and model as comparison dimensions (hypotheses H7 to H9 of the v3 plan) |
| AN-35 cohort fixtures and run evidence | **Keep, extended** | HC-38 provides cohort arms by harness |
| AN-36 campaign review and rollout close | **Keep** | Joined by HC-39 |

## Counts

62 original packets: 38 keep (some trimmed), 1 optional (AN-01), 4 split (AN-19, AN-45, AN-55, AN-60), 15 retarget (AN-13 to AN-18, AN-21 to AN-23, AN-29 to AN-32, AN-56, AN-61), 3 deferred (AN-20, AN-38, AN-48) and 1 retired (AN-00). That is 38 + 1 + 4 + 15 + 3 + 1 = 62.

New cards: HC-00 to HC-16 (ground truth and the local harness), HC-17 and HC-26 (engine mirror, sheet delivery), HC-27 to HC-39 (social model, program binding, reflection, promises, lineage and drift kit halves, export, cohorts, close) and GX-01 and GX-02 (world side of the cross-repo work). 40 kit cards and 2 new world cards, on top of the 42 world cards (38 keep, 4 split) that stay in geldar.
