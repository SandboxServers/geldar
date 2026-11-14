# 0221: wait returns unchanged recipe and notable-block lists once per session

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: the `wait` result shape in `threshold/mcp/src/tools/wait.ts` and the play view schemas in `contract/schemas` (`snapshot.schema.json` UnchangedFact, `mcp-common.schema.json` PlayNotableBlockList)

## Context

`wait` returns the whole play-view snapshot on every call. Two sections are the largest and change least: `self.unlocked_recipes` (about 435 tokens per result, the same as the previous result in about 94% of consecutive waits) and `surroundings.notable_blocks` (about 564 tokens, the same in about 44%). Their text is re-read in each later turn of the session.

## Decision

1. A `wait` result replaces `self.unlocked_recipes` with `{"unchanged": true, "count": n}` and `surroundings.notable_blocks` with the same fact, only when all of these hold:
   - the request carries the cursor this life was last given in this MCP session;
   - the section's canonical JSON equals the one last sent in full to this session;
   - for notable blocks, the position equals the one in the last result;
   - the wait is not the first of the session and not a 10th, 20th, ... wait of it;
   - the section was not cut by the result size limit.
   Otherwise the full section is sent, as before.
2. The session is an id made when the MCP session object is created (`crypto.randomUUID()` in `world-session.ts`). It carries no token, life id or secret and is not logged. A new `claude -p` session is a new MCP session, so it gets full sections first.
3. The feature is on only for the lives in `GELDAR_WAIT_DELTA_LIVES` (a comma list of life ids, or `all`). Unset or empty means off, which is today's behaviour. The variable is read once at startup (`threshold/mcp/src/main.ts`) and set in `compose/colo.yml`.
4. The tool description of `wait` (`contract/schemas/mcp-play.schema.json`) states what the fact means: the section is the same as in the previous `wait` result, and `look` returns everything. `look` and `status` are unchanged.
5. The Mind's snapshot never receives the fact. The Mind-side renderer renders only an array.

## Consequences

- About 650 tokens less per wait in the measured sessions; the recipe list alone is about 410.
- A lost full result (context compaction, a dropped response) is recovered within 10 waits, and a lost response never matches because the cursor differs.
- The schema `snapshot.schema.json` accepts the fact in `SnapshotSelf.unlocked_recipes`, since the play view reuses that definition. The Mind never gets it, so the widening is only a contract-level looseness.

## Revisit

Measure the per-wait token count and the crafting failures ("unknown recipe") for the flagged lives against a control. Revert by unsetting `GELDAR_WAIT_DELTA_LIVES`.
