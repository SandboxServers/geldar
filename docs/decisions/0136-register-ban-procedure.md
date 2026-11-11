# 0136. Banning a registered identity

Status: accepted. Follows the register service decision (0135) and rulings R34 to R36.

## Procedure

Who bans: the operator, on the colo host, with the `mcp-tokens` CLI. The register service never bans.

How the identity id is found: an abuse report names a provider account, so the operator runs

    mcp-tokens identity ban --provider github --user-id <provider user id> --pepper-file <register pepper file>

The CLI derives the id with the register service's own `identityHash` (HMAC-SHA256 of
`provider:user id`, keyed by the register pepper), the same code and the same pepper, and bans it.
`identity ban <64 hex>` still works for an id the operator already holds. A pepper file is read from
`--pepper-file` or `REGISTER_PEPPER_FILE`; it is never printed.

## What a ban does

- `mcp_identities.banned_at` is set; the owner's players stay `active` and nothing is retired.
- Every live token of the owner is revoked in the same transaction (this fires the MCP's revocation
  NOTIFY, so cached sessions end at once).
- The MCP refuses any token of a banned owner (`owner_banned` in the token lookup), even one minted
  later by some other path.
- The register functions `register_mint_token`, `register_create_player` and `register_retire_player`
  refuse a banned identity. Mint and create lock the identity row, so a mint racing a ban either
  commits first and is revoked by the ban, or waits and is refused.

## Unban

`identity unban` (same flags) clears `banned_at` only. Revoked tokens stay revoked; the owner signs
in and mints new ones.