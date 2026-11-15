# 0334: A loose name resolves only among the agents already in sight

- Status: Decided (owner-side ruling via geldar-93)
- Date: 2026-11-15
- Cites: 0145 (a target agent can be named only when seen and near), 0058 and 0068 (the knowledge boundary)
- Why: in the colony events of 2026-11-15 (06:13 to 12:45 UTC) 5 of 29 `give` refusals with "no such agent in sight" named a recipient that is not a username (`Chapman`, `zack`, `LaForge`, `chapman_01`). Each was a name the agent knew a player by, not the handle `ag_x_01` the Body resolves. The refusal did not say why, so the agent could not correct itself.

## Ruling

This clarifies 0145 and does not change its rule. The candidates for a target are only the agents the Body can see now (loaded, within `ENTITY_RANGE` of 24 blocks, with a clear line of sight). Among those candidates:

1. An exact username resolves as before, and only to that player. A loose name never reaches an exact username that is loaded but not visible.
2. A name that is not an exact username resolves loosely: the player's handle without the `ag_` prefix, or their in-world display name, compared case-insensitively. The in-world name is read from the tab list: `bot.players[username].displayName`, a prismarine-chat ChatMessage whose plain text is its `toString()` (mineflayer `lib/plugins/entities.js:638` builds it; the type is in `index.d.ts`). It is read only for a player already visible, by that player's own username. The entity's `displayName` is never read: on a real player entity it is the registry type name `'Player'` (minecraft-data `entities.json`, copied at `entities.js:164`), so reading it would match the word `player` and no real name. The generic words `player` and `unknown` never match.
3. It resolves only when exactly one visible player matches. Two matches, or none, fail.
4. A name that matches a player who is out of sight, out of range or behind a wall is not a candidate. It fails the same way as an unseen or unknown name.
5. The failure text is unchanged: `no such agent in sight`. No new wording is added, so an absent, unseen, unknown and ambiguous name all read the same (0145).

The rule applies to every verb that resolves a target with `findVisibleAgent`: `give`, `goto`, `follow`. The bystander names in a give's outcome are the exception: they use exact usernames only (`isUsernameVisible`), so an unseen player is never named because a visible agent shares their handle (0145).

## Consequences

- A give to a loosely named recipient that is visible and unique now completes; the pickup watch counts that recipient by the resolved username.
- The operator diag line (`not_in_sight`, written by the Body, never shown to the agent) names which check failed for a refusal, so the owner can tell a misspelt name from an out-of-sight one.
- The Mind's prompt is not changed by this decision.
- Today no Java plugin sets tab-list display names (nothing in the repo calls `setPlayerListName` or sets a display name), so in production the tab-list name equals the username and the loose rule effectively matches only the handle without the `ag_` prefix, compared case-insensitively. The display-name half applies only when the server provides a display name; the tests cover that path only with a fake tab list.
- A loose name is resolved once per action. `give` pins the resolved username for its walk and checks, and `follow` stores the resolved username at `start`, so a second visible player with the same loose name does not change the target mid-action.

## Rollback

Revert the commit that adds loose matching to `findVisibleAgent` (`golem/src/perception/visible-agent.ts`). The exact-username rule and the refusal text are the same before and after, so no data or wording needs to be restored.
