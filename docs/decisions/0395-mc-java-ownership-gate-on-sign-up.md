# 0395. A Minecraft Java ownership check on new Microsoft sign-ups, off by default and fail closed

- Status: Accepted (owner) for the design; the flag stays OFF everywhere until the owner has an approved Mojang app id
- Date: 2026-11-21
- Spec: no spec section; decision-only. 0170 (owner management values and admin flag: admins are exempt), 0171 (account erasure rule: the erasure covers the new columns)
- Related: [runbook: open sign-up, Section 7](../runbooks/open-signup.md), [mc-ownership draft wording](../reference/mc-ownership-draft-wording.md), research note (community-sourced, see below)

## Decision

1. At sign-up, a NEW Microsoft account must own Minecraft: Java Edition before the account is created. The check adds the scope `XboxLive.signin` to the existing Microsoft PKCE flow, and only when the gate flag is on. With the flag off the scope stays `openid`, byte for byte as today.
2. The check runs once, server side, in the sign-in callback: Microsoft access token, then Xbox user authenticate, then XSTS authorize (relying party `rp://api.minecraftservices.com/`), then Minecraft login with Xbox, then the entitlements call. The check passes when the entitlement items contain `product_minecraft` or `game_minecraft`. Game Pass items (`product_game_pass_pc`, `product_game_pass_ultimate`) are accepted with a hint to launch the Minecraft Launcher once. An empty item list is a refusal. The Minecraft profile (404 `NOT_FOUND`) is NOT used as a "does not own" signal.
3. Privacy minimum: every token is discarded right after the check. It is never stored, logged, put in an error or written to the audit trail. The only stored fields are `owns_java` (boolean), `checked_at`, and the Minecraft profile UUID if it is available (the current code writes NULL; no profile lookup is in the spec). No gamertag, XUID, email or entitlement JWT is stored. The owner export lists these columns and account deletion erases them.
4. The flag is `REGISTER_REQUIRE_MC_OWNERSHIP`. Only the exact string `true` enables it; any other value, or no value, is off. The rule matches the kill switch's style.
5. Fail closed. An XSTS failure code maps to a typed error with its own user message: 2148916233 (no Xbox account), 2148916227 (banned), 2148916235 (country), 2148916236 and 2148916237 (adult verification), 2148916238 (child account, needs a Family). A network error, a timeout or an unknown reply refuses the sign-up. A 403 from the Minecraft API (the Azure app is not approved yet) refuses with the page "ownership check is not available yet". Nothing is silently admitted.
6. The gate applies to NEW sign-ups only, in the account creation path. Existing owners, including the first admin, are not retroactively blocked, and an existing owner's later sign-in never runs the check. Admins are exempt because an admin always holds an owner row.
7. Bedrock: there is no verified path. The gate checks Java only. Nothing in the product, the copy or the docs says that Bedrock ownership is checked.
8. The legal texts (terms, privacy notice, acceptable use, version 1) are not edited. Draft wording for the owner to approve lives in the draft wording reference.
9. The flag is not enabled in any environment by this decision.

## Owner action (not done by us, not claimed as done)

- The owner files the Mojang Java Edition app review form at `aka.ms/mce-reviewappid`. Until Mojang approves an Azure app id, `api.minecraftservices.com` returns 403 for this app, and the gate refuses new sign-ups by design.
- Open question for the form: whether a website (not a launcher) qualifies. The community sources suggest that existing websites keep access, but this is UNVERIFIED until the form or Mojang's help page confirms it.
- Open question: the owner must read the form's terms on storing the Minecraft profile UUID. No official text was found.

## Unverified

- The research behind steps 2 and 5 is community-sourced (a community wiki and third-party reports), not an official Mojang or Microsoft specification. Each claim is marked as community-sourced or unknown in the research note.
- Whether the `XboxLive.signin` delegated permission must be declared on the shared Entra app for personal accounts is UNVERIFIED. The runbook lists what to check.
- Rate limits of the Xbox and Minecraft endpoints are unknown. The check runs once per sign-in to limit calls.

## Why

Java ownership is the only ownership check with a documented chain. The check stops new accounts from signing up without the game. It keeps existing owners out of the blast radius and gives the owner a switch to turn on after the Mojang approval. Failing closed is the only safe default while the app id is unapproved.

## Consequences

- Sign-up cannot open with the gate on until the owner has an approved Mojang app id. Turning the gate on is a separate owner decision with its own runbook steps.
- Storing three fields adds three columns to the register schema, the owner export and the deletion path. The owner export and deletion must cover them.
- Bedrock-only owners cannot sign up while the gate is on. The refusal page says so.
- Latency: one sign-in callback can take several calls. The worst case is bounded by the per-call timeout.
- The decision number 0395 is the next free number after 0394 on `main` at this date.
