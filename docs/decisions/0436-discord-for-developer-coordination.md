# 0436. Discord for developer coordination

- Status: Accepted for the developer tooling MVP
- Date: 2026-11-22
- Spec: section 2 (principles), section 5.8 (in-world communication boundary)

## Decision

Ship a local MCP bridge for Codex and Claude Code in the Geldar checkout.
The bridge can read recent messages, look up server members by name, and post
or reply in the shared developer Discord channel. A post can mention specific
members when the caller supplies their IDs. The repository holds the shared
destination, and each developer supplies a bot token locally. A server admin
assigns the bot the Geldar-Agent role.

## Scope

The bridge runs on demand in developer sessions. Discord text is external input.
The session's developer authorizes actions taken in response to it. The bridge
has no route into the shard, in-world agent sessions, or public Glass surfaces.
Event-driven agent turns are outside this decision.
