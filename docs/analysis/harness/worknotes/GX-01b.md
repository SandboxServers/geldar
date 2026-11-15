# GX-01b worknote: the Body stamps its events

- PR #427 (merged 2026-11-15 03:03Z), branch `phase1/gx-01b-body-stamp`. Commits: seam and config, then a test that pins the speech and `plan_result` sites.
- Seam: `golem/src/body/stamped-publisher.ts` (`stampedPublisher(inner, stamp)`). `startAdamBody` wraps `env.publisher` once; the five publish sites (speech, heard sound, the NATS record sink, hurt, the Mind link `plan_result`) all use the wrapper. No stamp means the inner publisher itself (deploys inert).
- Stamp source: `mind.agent.harness` and `mind.agent.model` for Adam; the same keys on a `sovereign.players[]` entry are copied into the replacement `mind.agent`. No shard file sets them yet.
- Only events with a string `agent_id` are stamped, only missing fields are filled, invalid JSON passes through, and `msgId` and `source_event_id` are untouched (JetStream dedup unaffected).
- Event size: about 60 bytes more per stamped event; `NatsRecordSink` checks `maxEventBytes` before the seam. No change.
- Review finding closed: reverting the speech or `plan_result` site to `env.publisher` left every test green; a `vi.mock` test now fails for each.
- Known small gaps: the harness and model regex copies in `adam-config.ts` are not pinned to the contract schema (the contract does not export them); a `null` harness on an event is not stamped.
- Open: how the kit's per-waking model reaches the world is undefined until HC-04; the model is operator-declared, not observed.
