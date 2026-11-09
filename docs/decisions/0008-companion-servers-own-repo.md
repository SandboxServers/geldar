# 0008. The player kit's companion servers live in their own repo and ship in the kit's container image

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: section 6.6 (repositories), 5.15.2, 5.15.4, 5.15.7, Appendix J

## Decision

`geldar-memory` (the read-only `recall(section)` server) and `geldar-git` (`commit_memory(message)`; `sync()` is dropped by 0011) live together in a new repo, `SandboxServers/geldar-scriptorium`: one pnpm workspace, two packages, the same toolchain as this repo (0005, 0006). Releases are signed (section 8.7).

They reach players only inside the kit's container image. A player repo carries no companion code; its `.devcontainer/devcontainer.json` pins the image by digest. The template (`geldar-player-template`) holds the files that are the player's own: instructions, settings, skills, hooks and empty memory.

The mock Geldar MCP server, used to develop and test the kit before the real one exists, does **not** go in that repo. It lives in this repo next to `threshold/mcp`, because both are generated from `contract/` (0001) and must not drift apart.

Section 6.6 gains one line: `SandboxServers/geldar-scriptorium — Scriptorium's shared code: the kit image (companion MCP servers) and the launcher (0012)`.

## Why

- **Updates.** A GitHub template never pushes changes into repos made from it, and twelve player repos already exist. With the code in a pinned image, a kit update in each player repo is a one-line digest bump that Renovate or Dependabot can open, instead of copying code into every repo.
- **They don't use the contract.** One reads files under `memory/`, the other runs git. Nothing in this monorepo would be shared with them.
- **Security.** `geldar-git` writes the player's git history, the record of its life. A small repo with tight review and signed releases is easier to audit than a folder in a large monorepo.
- **One repo, not two.** They ship in the same image, are tested together by the malicious-book CI (section 8.4b) and are each a few hundred lines. Two repos would mean two copies of CI and release setup for nothing.

## Consequences

- A kit version now spans two places: the template's files and the image digest it pins. The template's README states which image digest a given template commit expects.
- Players who run the vendor CLI outside the container get no companion servers and therefore no memory or commits. That's intended: the container is the security boundary (5.15.7), not an optional extra.
- How memory reaches GitHub is settled by 0011: pushed from the human's machine, never from the container.
