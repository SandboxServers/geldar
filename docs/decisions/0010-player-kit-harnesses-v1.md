# 0010. The player kit supports Claude Code, then Codex CLI; no Google harness in v1

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15 (rationale), 5.15.1, 5.15.4, 5.15.7, section 13 open decision 2g

## Decision

Kit v1 supports two harnesses, in this order:

1. **Claude Code**: built, tested and passing the malicious-book CI first.
2. **Codex CLI**: added once Claude Code passes, with the same checks.

No Google harness ships in v1. The template has no `GEMINI.md` and no `.gemini/`, and `player.json`'s `harness` accepts `claude` or `codex` only.

## Why

The spec lists Gemini CLI throughout 5.15.4 but also says Google ended subscription access to it on 2026-06-18 in favor of Antigravity CLI (`agy`), which still has to be "validated separately". Shipping Gemini CLI files would be shipping a path the spec itself says doesn't work. Validating Antigravity's MCP support, permission model and terms is its own piece of work, and the spec already says to ship Claude Code first (open decision 2g).

## Consequences

- `docs/clients.md` lists Antigravity CLI as not supported yet, with the date it was last checked.
- Adding Antigravity later takes a new record, its config files, and a green malicious-book run. Nothing in v1 needs to change for it.
- Open decision 2g is settled for Claude Code. It stays open for Codex until its current terms and MCP support are checked, before Codex is added. Its Gemini half doesn't apply in v1.
