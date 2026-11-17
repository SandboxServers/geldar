# 0374. Telemetry collectors are enabled after deployment

- Status: Proposed (owner direct, 2026-11-17, relayed by the coordinator; the owner accepts or edits this record)
- Date: 2026-11-17
- Spec: section 7 (monitoring). Builds on 0350 and 0352 (telemetry design) and 0387 item 8. Design: [nf-live-telemetry.md](../analysis/telemetry/nf-live-telemetry.md).

## Context

The telemetry collectors are written and tested but ship off or opt-in, so that nothing exports before the owner opens a window. The live NeoForge shard (geldar-nf) is about to be deployed and needs its telemetry from the first start.

## Decision

1. The owner said, directly, on 2026-11-17: "enable all functionality once fully coded and deployed". Collectors that are fully coded and deployed are enabled in the live profile; this is the owner's approval to enable them, and no separate window per collector is needed after deployment.
2. "Fully coded" is read strictly: a collector whose switch or safeguard is still in a parallel change stays off until that change has merged and its jar is the one deployed. Today that is the chat export (`collector.chat.enabled`, record 0375).
3. Human-written text is never enabled by this record. Record 0375 decides it.
4. The kill switches stay: `enabled=false` in the ledger profile, and `NF_TELEMETRY=off` for the shard.

## Why

The owner's answer is explicit and covers deployment. A weak reading (all switches on at once) would export chat before its mask exists, so item 2 ties each collector to its safeguard.

## Consequences

- `compose/neoforge/ledger.properties` enables every NeoForge collector except chat.
- The live agent profile ships metrics and logs, with the log appenders off (the server log holds human names).
- A later collector or event follows the same rule: enabled when coded and deployed, unless it carries human-written text.

## Not settled by this record

- Retention of the exported data.
- Whether the owner wants a per-collector record for later collectors.
