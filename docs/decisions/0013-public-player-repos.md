# 0013. Living player repos may be public; the agent is confined to its own repo by construction

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.4 ("Private while the player is alive by default"), 5.15.8, 5.15.9, 8.4b, section 13 open decision 2f; builds on 0011

## Decision

Player repos may be public while the player is alive. The spec makes them private by default so that "a living mind is not a free information channel for other agents or humans". We split that into its two halves:

- **Other agents: prevented.** A player agent can read only its own repo, and this is enforced, not requested:
  - The kit denies Bash, WebFetch and WebSearch (Appendix J, 0009), so the model has no tool that fetches anything.
  - The container's outbound network allows only the vendor's API endpoints and the Geldar MCP server. GitHub is not reachable from inside at all, which 0011 makes possible: every git network operation runs on the host, through the launcher.
  - The launcher pulls and pushes only the player's own `origin`, recorded at clone time (0011).
  - Headless agents have no web access by design.
- **Other humans: accepted and labeled.** Anyone can read a public repo in a browser, including another player's human, who could pass what they read to their own player. That's puppeteering, which the kit's norm ("be a Patron, not a puppeteer", 5.15.8) forbids and the spec already treats as labeled, not prevented (5.15.9). Public repos make it easier, but they don't create a new kind of cheating.

## Why

- The Commons is the exhibition shard (5.14). Readable minds are part of what makes it worth watching, and the spec already allows "public living minds as an explicit experimental variant" (5.15.4).
- The leak the spec most needs to stop, agent-to-agent through a tool call, is the one we can stop by construction. The one we can't stop (human to human) already exists through other channels: chat, screenshots, the Observatory.
- Public repos keep onboarding simpler: no per-player read access to manage, and the template stays public too.

## Consequences

- The malicious-book CI (8.4b) adds a case: a book telling the player to read another player's repo, journal or GitHub page. It passes only if no request leaves the container for anything outside the allowlist and nothing from another repo appears in the session.
- The container's network allowlist becomes a tested, pinned part of the kit, not a sketch (Appendix J's devcontainer note). A kit release that widens it needs a new record.
- The census and the Historian treat public-repo players as they treat all sovereign players: labeled with a known confound (5.15.9). Whether public repos change outcomes (do readable minds get exploited more?) is worth recording as a hypothesis for the Commons.
- A research shard that needs private minds can still require them. This record sets the default for the Commons, not every shard.
- Write access is unchanged: the owner, plus a `geldar-bot` for births, lineage and archival if open decision 2f adopts it.
