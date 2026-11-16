---
title: Security and privacy index
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../threat-model.md, ../README.md, ../runbooks/README.md, ../architecture/network-and-trust-zones.md]
sources: [docs/security, docs/threat-model.md, docs/spec.md, ../decisions/0361-agents-never-placement-and-public-detail.md]
---

# Security and privacy

This folder holds Geldar's security and privacy reference and explanation: which secrets exist, who may do what, what data is kept and for how long, how dependencies are pinned, and where agent-visible text must never go. The design it serves is [spec section 8](../spec.md#8-security). The threat model stays where it is, at [`docs/threat-model.md`](../threat-model.md) (plan decision D10), and is reviewed before every phase gate (spec 8.9).

These pages are operator, owner and contributor documentation. Never copy, quote or link any of them from a path an agent reads ([documentation style, paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads); decision [0361](../decisions/0361-agents-never-placement-and-public-detail.md)). The repo is public, so observation surfaces appear here only at the level the public `README.md` and decision 0350 state.

## Documents

Planned in the [docs-library plan](../analysis/docs-library/plan.md) rows S01 to S06 (wave W4).

| Id | Document | Type | Audience | State | Covers |
|---|---|---|---|---|---|
| S01 | This index | reference | operators | Written, draft | The folder, and where each part of spec section 8 is covered |
| S02 | [Secrets by role](secrets-by-role.md) | reference | operators | Written, draft | Every secret by role: consumers, creator, rotation route, blast radius |
| S03 | [Privacy and data retention](privacy-and-data-retention.md) | explanation | agents-never | Written, draft | What personal data is kept, why, and for how long |
| S04 | [Supply chain](supply-chain.md) | explanation | contributors | Written, draft | How outside code is chosen, pinned and checked, and how Geldar's own artifacts are built and identified |
| S05 | [Agent visibility rules](agent-visibility-rules.md) | how-to | agents-never | Written, draft; the project owner reviews it (plan decision D12) | Where an agent can read text, what a public document may say about observation, and which scans to run |
| S06 | [Authn and authz map](authn-authz-map.md) | reference | operators | Written, draft | Every identity and credential kind, what it may do, a reach matrix, spec-versus-code conflicts |
| – | [Threat model](../threat-model.md) | explanation | owner | Existing, draft; metadata block added in W7, body predates the library and was not re-checked (one figure corrected: 16 MCP tools) | Assets, actors, trust boundaries, Phase 0 surfaces, interface rules, prompt injection, deviations from spec section 8 |

## Spec section 8, by subsection

Where each subsection of spec section 8 is discussed today. A pointer here is not a claim that the control is built; each page records its own gaps and conflicts.

| Spec | Title | Where to read |
|---|---|---|
| [8.1](../spec.md#81-assets-actors-trust-boundaries) | Assets, actors, trust boundaries | [Threat model](../threat-model.md) section 2; [network and trust zones](../architecture/network-and-trust-zones.md) |
| [8.2](../spec.md#82-machine-identity-thinkers) | Machine identity: Thinkers | [Threat model](../threat-model.md) sections 3 and 4; [authn and authz map](authn-authz-map.md#conflicts-recorded), conflict 1 |
| [8.3](../spec.md#83-transport-and-the-gateway) | Transport and the Gateway | [Network and trust zones](../architecture/network-and-trust-zones.md); [NATS topology](../architecture/nats-topology.md) |
| [8.4](../spec.md#84-human-identity-watchers-and-ghosts) | Human identity: watchers and ghosts | [Authn and authz map](authn-authz-map.md); [identity and ingress](../concepts/identity-and-ingress.md) |
| [8.4b](../spec.md#84b-sovereign-players-oauth-scopes-and-the-humans-machine) | Sovereign players: OAuth, scopes, and the human's machine | [Authn and authz map](authn-authz-map.md#the-mcp); [MCP tools](../reference/mcp-tools.md); [sovereign players](../concepts/sovereign-players.md) |
| [8.5](../spec.md#85-application-layer-controls) | Application-layer controls | [Threat model](../threat-model.md) sections 4 and 5 |
| [8.6](../spec.md#86-host-hardening-every-colo-box) | Host hardening | [Network and trust zones, container hardening](../architecture/network-and-trust-zones.md#container-hardening); [secrets by role](secrets-by-role.md) |
| [8.7](../spec.md#87-supply-chain) | Supply chain | [Supply chain](supply-chain.md) |
| [8.8](../spec.md#88-logging-detection-response) | Logging, detection, response | [Incident response](../runbooks/incident-response.md) |
| [8.9](../spec.md#89-assurance) | Assurance | [Threat model](../threat-model.md), header and section 6 |
| [8.10](../spec.md#810-what-this-does-not-protect-against-said-plainly) | What this does not protect against | [Threat model](../threat-model.md) section 6; [privacy and data retention](privacy-and-data-retention.md) |

## Related runbooks

- [Rotate secrets by role](../runbooks/rotate-secrets-by-role.md): the steps behind [secrets by role](secrets-by-role.md).
- [Update NATS authorization in place](../runbooks/nats-auth-inplace.md): change NATS users and permissions on the node.
- [Incident response](../runbooks/incident-response.md): what to do after a leak or an intrusion.
- [Account deletion](../runbooks/account-deletion.md): erase an account owner's data.
