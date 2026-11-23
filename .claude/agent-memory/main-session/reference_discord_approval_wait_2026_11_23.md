# Waiting for a Discord PR approval

- Date: 2026-11-23
- Source: `tools/discord-bridge/wait-approval.mjs`, `approval.mjs` and their test; `.github/workflows/ci.yml`

`node tools/discord-bridge/wait-approval.mjs <message ID>` waits for a rostered
reviewer's reaction on the bot's own review request and exits 0 approved, 2 still
waiting, 3 head changed, 4 closed or merged, 1 on an error. It reads the roster
from `discord-review.json` in the shared git directory, so it works from any
worktree. Run it as a background task after posting the request (ship-pr § 5).

Discord lists who reacted per emoji and per reaction type. An ordinary reaction
is type 0 and a super reaction is type 1; the default listing returns type 0 only,
so a super reaction is missed unless type 1 is requested as well.

CI runs the root `pnpm test`, which is Vitest with `**/test/**/*.test.ts`. The
bridge's `test/*.test.mjs` files use `node --test` and run only through
`pnpm --filter @geldar/discord-bridge test`. A bridge test that must gate a merge
goes in a `.test.ts` file.
