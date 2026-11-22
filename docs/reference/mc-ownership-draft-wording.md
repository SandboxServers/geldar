# Minecraft Java ownership check: DRAFT wording for owner approval

Status: DRAFT. Not approved, not live. The approved legal texts (terms, privacy notice and acceptable use, version 1) are unchanged. This note holds proposed wording only, for the owner to approve or change.

The check is off by default (REGISTER_REQUIRE_MC_OWNERSHIP). Nothing here applies to any deployment until the owner enables it. The check also needs a Microsoft Azure app id approved by Mojang; until that approval exists, new sign-ups stay paused when the check is on (fail closed). Existing accounts are never affected.

## Proposed privacy notice paragraph (for the owner to approve)

When you sign up, we check once whether your Microsoft account owns Minecraft: Java Edition. The check runs on our server, through Microsoft and Mojang services, and the access token used for it is discarded straight after the check. We do not store the token, your gamertag, your Xbox account number, your email address or the entitlement data. We store three things only: whether your account owns Minecraft: Java Edition (only a yes is stored: a refused sign-up stores nothing), the date and time of the check, and, where available, your Minecraft profile identifier. You can see these three fields in your data export, and deleting your account erases them. The check is not repeated at later sign-ins, and existing accounts are not checked again. Before the flag is enabled, a live check must confirm that a sign-in with the scope XboxLive.signin still succeeds for an existing owner whose account has no Xbox profile, because the scope is sent on every sign-in while the flag is on.

## Proposed refusal wording (shown on the sign-up page)

- Bedrock-only account: "This Microsoft account does not own Minecraft: Java Edition. Bedrock-only accounts cannot register here."
- Check not available: "The ownership check is not available yet, so new sign-ups are paused. Existing accounts are not affected. Please try again later."

## Proposed wording shown after sign-up (not a refusal)

- Game Pass account, admitted: "Game Pass counts for this check. Launch the Minecraft Launcher once with this account before you play." It is shown on a "Signed in" page with a link to the account page, once, after the sign-up that created the owner. Existing owners do not see it again.

## Points for the owner to decide

1. Whether a Game Pass account (no Java purchase) is admitted. The code admits it and shows the launcher hint after sign-up (see above). The owner may choose to refuse Game Pass instead.
2. Whether the three stored fields are the right minimum. The code stores only a yes (a refused sign-up stores nothing), the check time and no profile identifier yet (no profile lookup exists).
3. Whether the paragraph above goes into the live privacy notice as a new version. A new version needs a new terms version bump; this draft does not do that.
4. Bedrock accounts are not verified by this check. The register does not claim to check Bedrock.
