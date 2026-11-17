# 0375. Human chat export on the human-directed NeoForge shard: a name mask

- Status: Proposed (owner direct, 2026-11-17, relayed by geldar-93; the owner accepts or edits this record)
- Date: 2026-11-17
- Spec: section 7 (monitoring), section 2 (Principle 1). Answers D-F, which 0387 item 8 left open. Builds on 0387 and 0374. Design: [nf-live-telemetry.md](../analysis/telemetry/nf-live-telemetry.md).

## Context

0387 item 8 said nothing human-written is exported until the owner answers D-F. Chat on the NeoForge shard can come from humans and agents. The ledger records a human without any id, so the question is what happens to the typed text.

## Decision

1. The owner decided, directly, on 2026-11-17: human chat is exported **with a name mask**. The text is verbatim, with human names masked inside it, and carries **no speaker id**.
2. Agent names (the life id shape) are an allow-list and are never masked, so agent chat stays readable.
3. The mask runs before any scrub, cap or record work, and before the text can reach an attribute or a log. It fails **closed**: if it throws or the name set cannot be built, the chat event is not emitted and a drop is counted.
4. The mask is tested with fake names. Its stated weaknesses are part of the decision: emails, phone numbers, coordinates, real names, nicknames, misspellings and look-alike variants of a name, names of humans not seen since server start, other-language transliterations, and anything else typed can still pass.
5. Chat export stays **off** on geldar-nf (`collector.chat.enabled`, default false) until the mask is built, tested and merged. The change that builds the switch and the mask is on branch `telemetry/nf-chat-switch`. A ledger jar built before it must not be deployed, because without the switch `collector.audit.enabled=true` exports chat.
6. Command text follows the same care: the audit command events export the command name and an argument count only, never the arguments (that change is on the same branch).

## Why

The owner chose a mask over a full ban so that chat stays useful for the operator, and accepted the stated weaknesses. Failing closed means a bug costs data, never a name.

## Consequences

- Until the switch is on, no chat text leaves the server.
- Humans who play there have their (masked) chat text recorded. The retention and the consent text for humans belong to a later owner decision.
- 0387 item 8 is answered for chat; sign and book text stay unexported (no NeoForge event is wired for them).

## Not settled by this record

- Retention of exported chat and the consent text shown to humans.
- The date the switch is turned on.
