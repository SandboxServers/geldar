# BLD-18 worknotes: seen storage, death retention, inheritance

- Store: `golem/src/building/seen/store.ts`. One KV key per section: `<life_id>.<sx>.<sy>.<sz>`. Value is deflate, base64 of JSON cells `[local, name, tick, inherited]`. A value over 64 KiB is refused, counted failed, and stays dirty.
- Flush: `start()` runs `flush()` every 30 s (`FLUSH_INTERVAL_MS`). Only dirty sections are written. Concurrent flushes share one run. A failed write stays dirty for the next flush.
- Memory: clean sections beyond 256 are evicted, least recently seen first. Dirty sections are never evicted. A recorded section that was evicted is reloaded from KV first, so its stored cells are kept.
- Death: nothing is erased. `eraseLife(kv, lifeId)` is the erasure primitive only.
- Inheritance: `inherit()` reads the predecessor from the life registry through the `predecessor` callback. It merges that life's sections under this life's id, keeps the predecessor's last-seen tick, and marks each cell `inherited`. A predecessor of another agent is never read.
- Corrupt section: dropped (counted in `dropped`), not fatal. It is overwritten when the cell is seen again.

## Open for the orchestrator

- MANUAL: NATS role and bucket seed (as BLD-05). The bucket name is not set in code.
- Not wired: the account-erasure path (`tools/players-cli/src/erase-owner.ts`) does not yet call `eraseLife`. That file is outside this packet's list.
- Not wired: `recorder.ts` writes to `SeenMap` (section.ts), not to `SeenStore`. The store's `record` is async and has no caller yet.
- Not wired: `survey.ts` (BLD-20) is still the stub.
- BLD-29 measurement: `flushes` counts flush runs. Bytes per section are the length of the stored value. Measure both on a live run.
