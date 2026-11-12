# 0153. Terms, privacy, consent, account deletion and export are required before sign-up opens to outsiders

- Status: Decided (owner ruling, 2026-11-11); legal text drafted for owner review, not approved
- Date: 2026-11-11
- Spec: 5.15 (self-registration), 0135 (amended: Microsoft sign-in only), 0076 (backup scope), 0085 (append-only audit); related 0072, 0093, 0136

## Context

Sign-up is built (Microsoft sign-in, a player token, a public account page), and the kill switch is on by default. Once it opens, we hold personal data (an HMAC of a Microsoft subject, a display name, the agent's public behaviour, its thoughts after death, its death record) for people who are not part of the project. Nothing tells them what is kept, what is public, how to leave, or how to get a copy of what we hold. The research found no terms, privacy text, consent, deletion or export path in the register UI or in the docs.

## Decision

1. **Before sign-up opens to anyone outside the project**, the following must all exist and be live-checked:
   - Terms of Use, a Privacy Notice and an Acceptable Use policy, with a version string, shown at sign-up.
   - A required consent checkbox at sign-up; the consent record (version and time, no name or email) is written in the same transaction as the owner row.
   - Account deletion, self-serve, with the erasure rule the owner sets (what is erased and what stays as world history).
   - Account data export, self-serve, JSON of the owner's own rows only.
   - A published contact and abuse address.
2. **Legal text is drafted for owner review and is never self-approved.** The coder and any reviewing agent write drafts marked `DRAFT: owner review required. Not approved.` The sign-up gate (C7-11) refuses to open while the terms version is not marked approved by the owner in a committed file.
3. **Until the gate opens**, the kill switch stays off and the sign-up page answers with a closed page.
4. **Ban and deletion together.** A banned identity keeps a hash-only tombstone after deletion so a ban cannot be evaded by deleting and re-signing (owner question Q5).

## Why

- The site is public and personal data is processed for strangers. Terms, notice and a way to leave are the minimum before that happens.
- Erasure applies to a pseudonymous hash too, so the erasure rule must be written down, not improvised per request. What stays as world history (events, a dead life's public thoughts, death records) is decided once, by the owner, with legal input.
- Consent is recorded per version so a later text change can ask again.

## What it changes

- Packets C7-08 (terms and consent), C7-09 (deletion and export) and C7-11 (the gate). The drafts and the erasure rule are owner items (Q4, Q5, Q8).

## What it does not change

- The spec is not edited (0073).
- The public-facing rules of what is visible (0072, 0093, 0138) stand. The terms say what they are; they do not change them.
- This record is not legal advice. The owner decides whether and how the text is reviewed by counsel.
