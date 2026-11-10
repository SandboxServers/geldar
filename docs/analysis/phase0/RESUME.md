# Phase 0 — resume card

Read this, then [README.md](README.md) (the ledger), [overnight-decisions.md](overnight-decisions.md) and the retros in [retro/](retro/) before acting. Rewrite at every wave boundary; 40 lines at most.

**State (Wave M closing, 2026-11-10):** the Wave M code is complete on `wave-m-main`: WM-01 to WM-13 are merged. Three review rounds ran; every finding is fixed or recorded. `./geldar.ps1 check` is green. The integration cases are green against the dev Postgres (MCP: 30 passed; non-MCP: 4 passed, 1 skipped by design). The MCP image builds (86 MB).

**Next:** (1) the Wave M PR to `main`, merged when CI is green. (2) Wave 6: `glass/` Thought Stream, the Adam runs, the campaign review and the full campaign retro. The Wave M retro and `WM-process` follow the PR; `WM-process` waits for the retro actions.

**Live steps still owed (nothing run against the live stack yet):**
- Start the MCP container against the live stack: `./geldar.ps1 mcp up`, after the runbook steps.
- Rangers connect and play: `./geldar.ps1 players up`.
- Tunnel: set `sovereign.mcp.trusted_proxies` to the tunnel's address first (see the threat model); without it all tunnel traffic shares one bucket.
- MineSkin upload: needs the owner's explicit yes. The key and the PNGs are present locally; nothing has been uploaded.
- A real NATS run of the gateway.

**Owner items still open:** decision 0060 verification (maximal personas against `num_ctx` 8192); the WM-10b NATS user; sleep cursor semantics; the outcome-unknown contract code; the spec edit for observer disclosure (0059); the BC-10 v3 line; the uuid override; cleanup of the Wave M worktree directories.

**Owner rulings in force:** reviews and live tests once per wave at its end (up to 5 rounds with fix rounds); `W<N>-process` after the retro; plan packets to fan out early; merge a green PR that meets its exit criteria and keep going; a full campaign retro at the end; the benchmark gate is 20 TPS at 100% (10 and 5 TPS rows informational). No time dilation (0047); recipes are discovered (0048); identity mode is about human observation, never agent belief (0059); persona files are not artificially limited (0060).

**Side track:** the Scriptorium corpus (SC-61a to d) is done; the mock image digest was sent to the Scriptorium orchestrator. Next free decision number: 0061.

**Worktrees:** packet worktrees remain under `.claude/worktrees/`, one per packet (copy useful `.claude/reports/` to `worknotes/` first; never `git worktree prune`; do not touch `scriptorium-decisions`). Create worktrees from the repo root, not a subdirectory.

**Process rules that mattered:** coders edit only inside their worktree and commit per item; reviewers return findings inline and the orchestrator records them in `worknotes/wave<N>-review-<r>.md`; only the orchestrator runs live tests (in the background); live cases print state in failure messages; always `</dev/null` on scripted git.

**Machine:** about 20 GB free after closing Firefox and ChatGPT; at most about six agents at once.
