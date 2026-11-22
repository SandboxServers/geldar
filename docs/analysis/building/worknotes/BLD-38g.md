# BLD-38g: survey reaches the production Body, seen map and restart

Flag `body_actions.building` only. Off: no new code runs (the survey is absent from the link, and the
seen KV is not passed to the Body).

## Done

- `golem/src/adam/adam-config.ts`: `body_actions.building` read into `AdamConfig.building` (off when left out).
  Before this, nothing in the adam path read the flag, so production never built the seen wiring.
- `golem/src/adam/adam-body.ts`: the restart gets `building` and `agentId: config.lifeId`. The Mind-link server
  gets `survey` from `surveyFrom(restarted.body.seen, tick)` only when the Body has a seen wiring.
- `golem/src/building/survey-reply.ts`: `surveyFrom(seen, now)`, the server's `survey` option.
- `golem/src/body/restart.ts`: `RestartBodyOptions.agentId`; `createBody` gets
  `seen: { kv: kv.seen, agentId }`; `kv.seen` is now a `SeenKv` (new `natsSeenKv` adapter over the NATS KV
  bucket: put, get, delete, and `list(prefix)` through `kv.keys("prefix>")`).
- `golem/src/adam/adam-body.test.ts`: survey served from the Body's map with the flag on, and no survey
  with it off. Two stale expectations from BLD-38e (the link serves four Body subjects now, not three; the
  unserve list gains the survey subject) are updated.

## Not done

- Predecessor: no source. `restartBody` only ever runs for the same life (`lifeId` is the account, and
  `lifeId` is passed unchanged to the restart), so the restart has no previous life id. A predecessor
  exists only for a newborn life after a death; the only mention is the comment on `SeenStore.predecessor`
  ("Finds the predecessor life in the life registry"), and no life registry exists in golem. It would
  have to be written at birth (a registry key per agent holding the previous life id) and read by the
  Body's creation path. Until then `seen` has no `predecessor`, so nothing is inherited.
- A same-life restart does not reload its own stored sections into the map. The map starts empty, so the
  survey after a restart sees only cells recorded since. Loading the life's own sections is a separate
  change (`loadSection` exists; `inheritInto` skips the same life).
- No test for the `restartBody` seen wiring (kv and agent reach `createBody`).
