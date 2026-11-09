# 0007. The spec is frozen at v0.8; changes are recorded here

- Status: Accepted
- Kind: Process
- Date: 2026-11-08
- Spec: closing line ("Changes go through pull requests against `docs/spec.md`")

## Decision

`docs/spec.md` stays exactly as v0.8 was merged. Nobody edits it, not even to fix a typo or a contradiction. Every change to the plan, every error found in it, and every gap filled is a record in this folder. Each record names the spec sections it affects and says whether it **changes** the plan, **fixes** an error in it, or **settles** something the spec left open.

This replaces the spec's closing line, which said changes go through pull requests against `docs/spec.md`.

## Why

We want to look back later and see what changed from the original plan and why. Editing the spec in place loses that: the diff shows what changed but not the reasoning, and the original plan is only recoverable from git history. Frozen spec plus records keeps both the plan and every departure from it readable side by side.

## Consequences

- When the spec and a record disagree, the record wins. When the spec and `contract/` disagree, the contract wins (0001).
- Anyone reading the spec reads the index in this folder's README too. Filtering its Kind column for `Changes` and `Fixes` gives the retro list.
- If the plan drifts far enough that the spec stops being useful as a guide, write a v0.9 as a new file and keep v0.8 next to it. Don't overwrite it.
