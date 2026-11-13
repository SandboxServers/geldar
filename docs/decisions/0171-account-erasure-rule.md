# 0171. Account erasure: what is removed and what stays as world history

- Status: Decided (owner ruling, 2026-11-13); legal review stays with the owner and is not done by this record
- Date: 2026-11-13
- Spec: 5.15 (self-registration); related 0085 (append-only audit), 0136 (bans), 0138 (thoughts after death), 0153, 0155
- Related: Q4 and Q5 in `docs/analysis/phase1/packets/c7-user-management-packets.md`; cards C7-09, C7-10

## Context

0153 requires a deletion and export path before sign-up opens, and left what is erased to the owner (Q4, Q5). The owner accepted the rule proposed in the C7 file.

## Decision

1. **Removed on deletion.** The identity row, the owner row, the owner's players, every player token and owner key, the consent rows, the owner links on every row that carries one, and any held or applied skin upload (rows, PNG data, and the `geldar-skins` key, by the operator runbook). Bodies are stopped first through the supervisor. A life still alive at deletion is retired, and its thoughts are removed.
2. **Stays as world history, with the owner link removed.** The public thoughts, events and death records of lives that are dead. They are facts about the world, and agents are not people. After deletion nothing joins them to an owner or an identity.
3. **Audit rows stay** (0085 allows no updates), keyed by an erasure-safe id (a hash of the owner id with a deletion salt), with no name, no email and no provider subject. The deletion itself is one audit row.
4. **Ban tombstone (Q5).** If the identity is banned, the identity hash and the ban stay, and nothing else. A banned person cannot delete and re-sign-up. An identity that is not banned leaves no hash.
5. **Export** returns the owner's own rows only, with a `format_version`, rate limited to one per hour (an admin owner is exempt, 0170).
6. **Legal review.** The rule is not reviewed by counsel. The owner keeps that review. Sign-up stays closed until the owner approves it (C7-11).

## Why

- It removes everything that identifies a person or ties them to an agent, and keeps what the world records about the dead.
- The tombstone is the smallest thing that keeps a ban meaningful.

## What it changes

- C7-09 implements it. C7-10 records ban reasons so a tombstone shows why. The legal texts are not edited here; a text change would bump the terms version (0155).

## Open

Events of a life that was still alive at deletion stay as world history in this record (owner link removed); the owner may rule otherwise before C7-09 is dispatched.
