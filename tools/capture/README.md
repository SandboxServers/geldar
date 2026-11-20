# tools/capture: the provenance capture session (CAP-1, CAP-2)

Two developer tools for the real-payload capture in [capture-real-payloads.md](../../docs/runbooks/capture-real-payloads.md):

- `nats-capture.ts`: subscribes to the provenance subjects and writes every message it hears, byte for byte.
- `validate-captures.ts`: checks a capture directory against the contract and prints a pass/fail table.

Nothing here runs against a server by itself. The ops run (CAP-2) starts the subscriber, waits for `READY`, then triggers the case.

## Subscriber

```sh
node tools/capture/src/nats-capture.ts [--url <nats-url>] [--subjects <a,b,...>] [--out <dir>] [--duration <seconds>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `$GELDAR_NATS_URL`, else `nats://127.0.0.1:4222` | the NATS server (loopback only in the runbook) |
| `--subjects` | `geldar.phase0.provenance.>,geldar.phase0.combat_fact` | comma-separated subjects; the session's two |
| `--out` | `.capture/nats` | output directory, created if missing (`.capture/` is gitignored) |
| `--duration` | none: runs until SIGINT or SIGTERM | stop after N seconds (a positive number) |

**READY handshake.** Every subscription is on the server before the process prints one line, `READY`, to stdout.
The capture script waits for that line before it triggers a case; a message sent before READY is not captured
(core NATS has no replay). Everything else goes to stderr (`captured <seq> <subject> <bytes> bytes`, then a final
`wrote N message(s) to <dir>`).

**Exit codes.** `0` after a clean stop (SIGINT, SIGTERM or `--duration`). `2` on a bad flag, or when the connection or a
write fails.

**Output.** For each message, in arrival order with a running sequence number:

- `<dir>/<seq>-<subject with dots as dashes>.json`: the payload bytes exactly as received (never parsed or re-encoded).
- `<dir>/<seq>-<subject with dots as dashes>.meta.json`: the sidecar `{seq, subject, received_at, bytes, file}`.
  `bytes` is the received length. The validator does not read it.
- `<dir>/index.jsonl`: one line per message with the same fields as the sidecar, appended.

The subscriber does not write a payload it did not receive, and it does not de-duplicate: two messages are two files.

## Validator

```sh
node tools/capture/src/validate-captures.ts <capture-dir> [--expect <case=N,...>]
```

- A case is the subject kind: `break`, `pickup`, `take`, `combat` (the `provenance.combat` tail), `combat_fact`.
- Each file is checked with the contract: provenance tails with `validateProvenance`; `combat_fact` as the stream's
  WorldEvent envelope (`validateWorldEvent`, with `type` = `combat_fact`) and its `payload` with
  `validateCombatFactPayload`.
- Claim rows, printed next to the file they belong to (schema column `n/a`):
  - `combat_fact`: the payload has the `player` key (AN-47a); `encounter_key`'s life part equals `life_id` (decision 0321).
  - `break`: `prior_owner` is printed, never judged (AN-27a: null without CoreProtect, non-null with it).
  - `take`: `item` and `count` are printed (AN-51a).
- A claim row that says `fail` means the capture refutes that claim. It is not a validator error, but it does exit 1.
- `--expect break=2,combat_fact=1` adds one row per case: `fail` when that case has fewer files than asked.

**Table.** Columns `case`, `file`, `schema`, `result`, `detail`, then `N row(s), M failing`.

**Exit codes.** `0`: every row passes. `1`: at least one row fails (a schema failure, an unknown subject, a payload without a
sidecar, a missing payload file, or an `--expect` shortfall). `2`: a usage error, an unknown `--expect` case, or a missing
directory.

## Tests

```sh
./geldar.ps1 pnpm exec vitest run tools/capture/src
./geldar.ps1 pnpm --filter @geldar/capture typecheck
```

The tests never connect to NATS. `fixtures-synthetic/` holds hand-built files (not captures) that the validator
test reads; real captures belong in their own folders, never there.
