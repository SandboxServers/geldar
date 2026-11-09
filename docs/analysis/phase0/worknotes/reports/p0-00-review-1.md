# P0-00 review, pass 1

Verdict: fix

Scope: commit 894b999 adds only `docs/threat-model.md` (121 lines). The `origin/phase0/wave1..HEAD` diff also shows README.md and RESUME.md changes; those are the wave branch's newer ledger commit 6e0780f (this branch was cut from db4db46), not part of this commit. A `--no-ff` merge will not revert them.

Checked and fine: length (121 of about 250), LF endings (`ls-files --eol` i/lf w/lf, matches .gitattributes), only IP is 127.0.0.1, no secrets, every spec anchor (8.1 to 8.10, 8.4b, `#8-security`) and both decision links resolve, all six packet content items are present, Appendix H numbers (1 MiB, 32 KiB, one hello) and the ownership rule match, sign 60 / book 8192 caps match P0-02, section 7 discloses the Velocity, loopback and local-Thinker deviations.

## Fix notes

1. **RCON row contradicts the packet.** `docs/threat-model.md:61` says "Compose network only, no published port". Packet P0-06 publishes "RCON 25575 ... on `127.0.0.1` for ops and the benchmark", and P0-07's Golem runs on the host and uses it. Change Exposure to `127.0.0.1:25575` on the host (published for ops and the benchmark). Residual risk: any local process that reads `compose/secrets/rcon.txt` gets the Paper console (op, give, stop). Control stays the random 32-character password in a gitignored file.

2. **Postgres and NATS exposure is wrong or vague.** `docs/threat-model.md:62` says Postgres is "`127.0.0.1` only, or compose network only"; `docs/threat-model.md:63` says NATS is `127.0.0.1` only. P0-06 publishes Postgres 5432 and NATS 4222 and 8222, all on `127.0.0.1`. Name the ports. State that 8222 is the unauthenticated NATS monitoring HTTP endpoint (connection and subscription listings) under the same loopback-only residual risk. Drop "or compose network only" for Postgres.

3. **Scope line puts host processes in the compose stack.** `docs/threat-model.md:9` lists Golem, Animus, the event sink and Glass inside "one `docker compose` stack". P0-06's compose file has only Paper, Velocity, Postgres and NATS, and Golem connects to `127.0.0.1:25565` from the host (P0-07). Reword: compose stack = Paper, Velocity, Postgres, NATS; Golem, Animus, the event sink, Glass and the local Thinker are host processes that reach the stack only through the published loopback ports. That is why those ports are published at all.

4. **Make the loopback rule checkable.** `docs/threat-model.md:13` and `:55` state the rule but not the form that satisfies it. In Docker a bare `ports: "5432:5432"` binds 0.0.0.0. Add one sentence: every compose `ports:` entry must carry the `127.0.0.1:` prefix, and a violation fails review/CI. Otherwise the rule is only intent.

5. **Rule 9 versus RCON test control.** `docs/threat-model.md:81` says operator tools do not act and RCON is only "whitelist, save, stop". P0-07 gives Golem an RCON client for tick rate, clearing the test area and benchmark setup. Add a carve-out: benchmark and test control run with no model attached and never give items to or move an agent outside a benchmark. Without it, rule 9 reads as violated by a planned packet.

6. (Minor) `docs/threat-model.md:93`: "Prompts mark in-world text as quoted observation" has no source in the spec (8.5 says this only for the Historian). Cite where Animus does it or word it as a default Animus should adopt, so it is not read as a built control.

No other contradictions with spec section 8 found. After fixes 1 to 5 this ships.
