# 0155. Terms of Use, Privacy Notice and Acceptable Use version 1 are approved by the owner; the abuse contact is published

- Status: Decided (owner approval, 2026-11-11)
- Date: 2026-11-11
- Spec: 5.15 (self-registration); amends the draft status in 0153, which stays as the record of the drafting rule
- Related: C7-08 (terms and consent), C7-11 (sign-up gate), Q8 in `docs/analysis/phase1/packets/c7-user-management-packets.md`

## Context

0153 required the terms, privacy notice and acceptable use text to be drafted for owner review and never self-approved, with a published contact and abuse address. The drafts were written under C7-08 and marked DRAFT with `<CONTACT ADDRESS>` placeholders.

## Decision

1. **The owner approved the legal text** (`docs/legal/terms.md`, `docs/legal/privacy.md`, `docs/legal/acceptable-use.md`) as version 1, effective 2026-11-11. Each file carries the line `Version 1, effective 2026-11-11, approved by the owner.`
2. **The contact address is published:** `abuse@sandboxservers.games`. This is a role mailbox the owner deliberately publishes. It is the one address that may appear in the repository for this purpose. It appears in the three legal texts, in the register footer and on the terms page.
3. **Consent is versioned.** The register records the terms version `v1` in `register_consents` for each owner who ticks the box at sign-up. Consent rows written under the earlier draft version `draft-1` are not changed.
4. **Changing the text.** Any change to a legal text bumps its version (the next number, with a new effective date), is approved by the owner in a committed file, changes `TERMS_VERSION` in the register, and asks owners to consent again to the new version. The repository check refuses a legal text with no version line or no contact address.
5. **Open placeholders.** The owner's approval covers the text as written. Several angle-bracket placeholders remain unfilled in version 1 and are not invented here: `<OPERATOR NAME>`, `<MINIMUM AGE>`, `<LIABILITY LIMIT>`, `<GOVERNING LAW AND FORUM>`, `<RIGHTS UNDER APPLICABLE LAW>`, `<AUDIT RETENTION>`, `<HOSTING AND SUB-PROCESSORS>`, `<RETENTION PERIODS>`, `<APPEALS PROCESS>`. Each needs the owner's (or counsel's) value, and filling it is a text change under rule 4.
6. **Not covered by this record.** The erasure rule (Q4) and the ban tombstone (Q5) are not decided here. C7-09 stays blocked on them, and so does the sign-up gate (C7-11).

## Why

- 0153 cannot be met for sign-up until the text is approved and the contact is published. The owner has now done both.
- A public contact is needed before outsiders can register, so people can report abuse and ask about their data.

## What it changes

- `docs/legal/` has no DRAFT marker. The repository check (`tools/repo-checks/src/legal-drafts.test.ts`) enforces the version line and the contact address on each file.
- The register terms page, sign-up consent label and footer show the version 1 stamp and the contact address.

## What it does not change

- The spec is not edited (0073).
- The public-facing rules of what is visible (0072, 0093, 0138) stand.
- This record is not legal advice. The owner decides whether counsel reviews the text.

## Owner answers on the open placeholders (2026-11-11)

Added after the approval as an amendment. Item 5 above stays as written. The owner answered the placeholders and asked for the defaults.

- `<OPERATOR NAME>` is `SandboxServers` (privacy notice, section 1).
- `<MINIMUM AGE>` is 16. Terms section 2 says you must be at least 16 years old to register.
- `<APPEALS PROCESS>`: write to abuse@sandboxservers.games within 30 days of a suspension or ban; the owner replies within 7 days (acceptable use, section 5).
- The other placeholders have no owner value yet. Each is filled with a neutral statement that does not invent a legal term, for the owner or counsel to review:
  - `<LIABILITY LIMIT>`: terms section 7 keeps "Geldar is provided as it is." and states no limit.
  - `<GOVERNING LAW AND FORUM>`: terms section 8 is removed. No jurisdiction is named.
  - `<RIGHTS UNDER APPLICABLE LAW>`: privacy section 7 only asks for requests at the contact address.
  - `<AUDIT RETENTION>` and `<RETENTION PERIODS>`: audit records are kept 90 days and then removed; agent play recorded in the world journal is kept (privacy sections 4 and 8).
  - `<HOSTING AND SUB-PROCESSORS>`: Geldar runs on the operator's own server (privacy section 5).
- Open for the owner: these fills change the text of version 1. The version line and `TERMS_VERSION` `v1` are kept as the owner asked. Rule 4 says a text change bumps the version and asks owners to consent again. Whether these fills need version 2 is the owner's decision and is not made here.
- `tools/repo-checks/src/legal-drafts.test.ts` now fails any file under `docs/legal` that still has an angle-bracket placeholder.
