# 0145. A target agent can be named only when seen and near

- Status: Accepted (owner, 2026-11-12)
- Date: 2026-11-11
- Spec: the knowledge boundary (perception); related 0058, 0068
- Packet: C5-04

## Decision (draft)

`give`, `note` and `follow` accept a target only when the Body can see it (line of sight) and it is within the action's range. A target that is far, hidden or unknown gets the same refusal wording, so the refusal does not reveal whether the agent exists.

## Ruling

The owner accepted the draft on 2026-11-12. The code already follows it: give, note and follow resolve the target with `findVisibleAgent` (line of sight within entity range), and an unseen agent and an unknown name get identical wording.

## Consequences

An agent must first meet another before it can give it something; following ends when the target leaves sight.