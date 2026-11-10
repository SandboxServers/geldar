# 0055. The Phase 0 sovereign MCP serves the frozen 14-tool vocabulary; six tools are not available and the action list is atomic

- Status: Accepted (owner standing instruction: decisions recorded, owner may revise)
- Date: 2026-11-10
- Spec: 5.15 (sovereign tools); Appendix K (the result shape); decisions 0033, 0034, 0052; Wave M packets WM-04 to WM-07

## Context

The real MCP keeps the mock's contract exactly: the same 14 tools from `@geldar/contract`, the same validation and trimming. It replaces the mock's simulated world with the Body channel. This record fixes what each tool does for a real Body in Phase 0.

## Decision

1. **Vocabulary frozen.** The 14 tool names, schemas and result shapes are those in `@geldar/contract`. Six of them answer `not_available` (`threshold/mcp/src/tools/unavailable.ts`), with a neutral message and no mock wording.
2. **`act` is atomic.** One bad item rejects the whole action list. The bad item carries its code and the others carry `batch_rejected` (`threshold/mcp/src/tools/act.ts`). Each accepted item costs `CREDITS_PER_ITEM` = 1, reserved before dispatch and refunded on refusal.
3. **`wait` cursor is the acknowledgement.** The cursor is the `GELDAR_EVENTS` stream sequence number, so a restart resumes from it.
4. **`wait`, `look`, `read_book` and `status` are free.** `say` and each intent cost one credit.
5. **Body down.** A call that needs the Body answers `body_unavailable` and sets `PresenceStore.wantBody`, so the Body starts on the next call.
6. **Reading a carried book** goes through the Body's `book` subject (WM-07). Its text is wrapped as untrusted world text.
7. **Hibernation** stops the Body but does not seal the life; the next call brings it back.

## Consequences

- A ranger never receives a tool that the Phase 0 world cannot honour; the six answer `not_available` from the start.
- Costs are per accepted item, so a rejected batch costs nothing.

## Open

- **The `no_plan` and `death` mappings** are named in the packet, but the code search found no literal `'no_plan'` or `'death'` outside the tests. Confirm the mapping in code or in a test before citing it.
- **NATS user for the MCP (WM-10b)** is deferred. The MCP reaches NATS as any local process does until a least-privilege user lands.
- **Player skins (WM-13)** are outside this vocabulary. Signed textures go to `geldar-skins` and the Velocity plugin applies them. MineSkin upload is not yet approved, and nothing is uploaded.
