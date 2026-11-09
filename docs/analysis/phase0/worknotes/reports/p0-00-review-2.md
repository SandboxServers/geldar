# P0-00 review, pass 2

Verdict: ship

Range: 894b999 and af5a028. The second commit touches only `docs/threat-model.md` (8 insertions, 8 deletions). The README.md and RESUME.md differences in the `origin/phase0/wave1..HEAD` diff come from the wave branch's newer ledger commit (as noted in pass 1), not from this branch.

## Fix notes from pass 1

1. RCON row (`docs/threat-model.md:61`): applied. Exposure is `127.0.0.1:25575` on the host for ops and the benchmark. The residual risk names the Paper console and `compose/secrets/rcon.txt`. The password is random, 32 characters.
2. Postgres and NATS (`:62`, `:63`): applied. Ports 5432, 4222 and 8222 are named. 8222 is described as an unauthenticated monitoring endpoint. "Or compose network only" is gone. Matches P0-06 lines 164 and 165.
3. Scope (`:9`): applied. Compose holds Paper, Velocity, Postgres and NATS. The other components are host processes that use the published loopback ports.
4. Checkable loopback rule (`:13`, `:55`): applied. Every `ports:` entry must carry the `127.0.0.1:` prefix, and a violation fails review and CI.
5. Rule 9 carve-out (`:81`): applied. Benchmark and test control over RCON may run with no model attached and never gives items to, or moves, an agent outside a benchmark.
6. Prompt-injection line (`:93`): applied. It is worded as a default Animus should adopt, cites 8.5 for the Historian only, and says it is not a built control.

## Regression checks

- Length is 121 lines, under the 250 limit.
- Line endings: `ls-files --eol` reports `i/lf w/lf`; no CR characters and no non-ASCII characters.
- The only dotted-quad string is `127.0.0.1`.
- Both decision links resolve (0021, 0022). Spec anchors were checked in pass 1 and the fix commit did not change them.
- Consistency with spec 8 and the packet: the Paper row (no published port, compose network only) matches P0-06. Section 7 still discloses the deviations. No new contradiction found.
- Note: the text says CI checks the `127.0.0.1:` prefix and repo secrets. No such CI check is built by this doc-only packet. P0-06 or a later packet should add it.

## Findings

None blocking.
