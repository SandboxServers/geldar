# 0366. Open: spec 5.14 Watched wording versus decision 0059

- Status: Open (owner decision)
- Date: 2026-11-16
- Spec: 5.14 (shard variants, the Watched row, line 806); Appendix B.3 (lines 1633 to 1637); 5.15 (line 982); section 2, principle 7 (line 111). Decisions 0059, 0068 and 0073. Read at 03c1f5de.

## Context

**What the spec says:**

- The table of shard variants in 5.14 has a Watched row: on a Watched shard, the identity block adds an observer sentence (line 806). The Unwatched row says nothing about observers (line 805).
- Appendix B.3 gives the text of that line for the thought prompt (lines 1633 to 1637). Its wording differs a little from the sentence in 5.14.
- Section 5.15 allows sovereign players only on Watched shards (line 982). Principle 7 calls sovereign players "Watched by construction" (line 111).

**What decision [0059](0059-identity-mode-is-about-human-observation-not-agent-belief.md) says.** The owner accepted it on 2026-11-09:

- `identity_mode: watched` means humans may watch the shard, and nothing is said to the agents.
- An agent's belief about an audience is a separate variable. It would be built only if the owner decides to run that experiment. The proposed key is `observer_disclosure`, defaulting to `none`.
- Its Consequences list a spec edit "pending the owner's say". The same sentence says the shard-variant table "should" name the observer-disclosure variable apart from `identity_mode`, so that the spec no longer implies that watched shards tell their agents.

**Related records:**

- Decision [0068](0068-prompt-v4-and-agent-visible-text.md) (Proposed) rule 1: nothing an agent reads may say humans watch it.
- Decision [0073](0073-spec-is-never-edited.md) (Accepted): only the owner edits the spec. Its table of open amendments lists the reasoning line (about line 1584) but not the 5.14 row.

**What the repo does.**

- `shards/phase0.yaml` line 12 and `shards/colo-mind.yaml` line 15 set `identity_mode: watched`.
- `tools/repo-checks/src/identity-mode.ts` requires `watched` where sovereign players are allowed.

## Decision

None. This record states a conflict between the spec and decision 0059 and leaves the reading to the owner. It recommends nothing.

## Why

- 0059's Context says that reading the spec's Watched row and the sovereign-player rule together would make the agents hear that they are watched. Only the owner can edit the spec (0073), and only the owner can decide whether the observer variable exists (0059, point 2).
- A writer must not choose between them (persona rule 8).
- An open item normally lives in a campaign ledger, not in this folder (this folder's README). This record follows the precedent of [0146](0146-c5-open-questions-for-the-owner.md), because the conflict spans the spec and an Accepted decision rather than one campaign.

## Consequences

- Documents that touch `identity_mode`, Watched shards or what agents are told cite the spec lines, 0059 and this record, and name the spec line as open.
- The owner's ruling goes in a later record, which can close this one.
