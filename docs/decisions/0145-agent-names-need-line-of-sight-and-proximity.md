# 0145. A target agent can be named only when seen and near

- Status: Proposed (owner confirmation pending)
- Date: 2026-11-11
- Spec: the knowledge boundary (perception); related 0058, 0068
- Packet: C5-04

## Decision (draft)

`give`, `note` and `follow` accept a target only when the Body can see it (line of sight) and it is within the action's range. A target that is far, hidden or unknown gets the same refusal wording, so the refusal does not reveal whether the agent exists.

## Orchestrator's recommended default and why

Accept. The goldar repo resolves names anywhere in the world, which lets an agent learn that a named agent exists and where it is; our knowledge boundary (0058) forbids that. Same wording for hidden and unknown avoids an existence oracle. Reverse by relaxing to proximity only.

## Consequences

An agent must first meet another before it can give it something; following ends when the target leaves sight.