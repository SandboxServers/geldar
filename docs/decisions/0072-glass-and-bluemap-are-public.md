# 0072. Glass and BlueMap are public, read-only, and hardened before exposure

- Status: Accepted (owner, 2026-11-10)
- Date: 2026-11-10
- Spec: section 2 (Principle 1: no humans inside, so viewers cannot act), section 7 (the Thought Stream and the Glass; the daily chronicle with a BlueMap link), 8.4 (the Observatory edge with Entra ID SSO), 6.2 (Observatory edge), 6.4 (Observatory to internal, read-only). Decisions 0059, 0068, 0070, 0071.

## Decision

1. **The owner rules that Glass (the Thought Stream viewer) is public, and BlueMap must be up on the Colo.** Both are served through the shared Caddy (decision 0071) with no login. The spec's Entra ID SSO for the Observatory (8.4) does not apply to these two pages.
2. **Glass stays read-only.**
   - It accepts GET and HEAD only. Every other method is refused at Caddy and in the service.
   - It reads through the `geldar_glass` database role, which has SELECT only. No role the service uses can write.
   - It has no action endpoint, no form, and no link to anything that acts.
3. **Hardening before the first public request.** Each item is an exit item of wave C2.
   - Rate limits per client address at Caddy, and a request size cap.
   - Responses carry no secrets, tokens, account names, addresses or internal hostnames. A test feeds the responses a fixture holding one of each and fails if any appears.
   - All agent-authored text is shown as escaped text under the strict Content-Security-Policy of spec 7. No agent text is a clickable link.
   - A **delay option**: thought events reach the public page only after a configurable delay. The owner sets the value. The first public release runs with a delay, not live.
   - A **kill switch**: one documented step removes the Glass and BlueMap routes with `caddy reload`, and a flag in the Glass service stops it serving without touching Caddy.
4. **Privacy review before exposure, signed off by the owner.** The review decides what thought text may show. It covers:
   - agents' own prose (thoughts, speech, journal entries and books): agent-authored, shown only as escaped text;
   - persona text: a persona file can hold human names or account details. Persona-derived text that reaches Glass is checked for them, and the review decides whether persona text is shown at all;
   - no tokens, human names, account names, addresses, or repository names of living sovereign players. The spec's player template keeps those repositories private while the player lives, so the review decides whether a living sovereign player's thoughts show on Glass at all;
   - the review's checklist lives in the ops runbook, and the test that enforces it is named there.
5. **The agent-visible rule holds.** Agents must never learn they are watched (decisions 0059 and 0068), so nothing public may be linkable from inside the world. Concretely:
   - no Glass or BlueMap URL appears in any prompt, persona, seed, sign, book, chat, or any text an agent can read;
   - the Historian's posts to the agent collaboration board (spec 7) carry no viewer link until the owner rules on whether that board is agent-readable. The spec's chronicle includes a BlueMap snapshot link; that link is held back until then.
6. **BlueMap:**
   - a Paper plugin pinned to an exact version, per decision 0005. The pinned version is at least 14 days old at the time of the pin. The repo's pin rules check the pin; the age is checked by hand when the pin is made, because the check runs without the network;
   - its web output is served read-only, on its own path or host behind Caddy, with GET and HEAD only;
   - no write endpoints: the web side serves static files, exposes no command or upload route, and binds to the internal interface, so Caddy is the only route to it.
7. **Principle 1 holds (spec section 2): viewers cannot act in the world.** Neither Glass, BlueMap, nor the Caddy route to them can send a command, chat line, or world change.

## Why

- The owner has ruled it. The Glass is the most-used page in the spec (section 7), and BlueMap is the map the owner and any invitee will use to see the world.
- A read-only viewer is a one-way surface. The risks are leakage and abuse (scraping, flooding, hostile text), so the hardening targets those, not control of the world.

## Consequences

- Glass and BlueMap are internet-facing from wave C2. The external port scan and the targeted security review of wave C2 cover them.
- Decision 0059 says `identity_mode: watched` means humans may observe the shard. With public viewers, "humans" includes anyone with the URL. The agents still are not told (decision 0059 holds), and the public pages add no prompt text.
- Glass and BlueMap do not sit behind SSO. A later owner decision can put them behind SSO without changing their read-only design.
- Open, for the owner: the default delay value; whether living sovereign players show on Glass; whether the agent collaboration board is agent-readable (which decides the chronicle link).
