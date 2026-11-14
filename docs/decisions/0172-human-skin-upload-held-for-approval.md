# 0172. Owners upload skins; every upload is held for operator approval before MineSkin signs it

- Status: Decided (owner ruling, 2026-11-13; replaces Q7 "deferred")
- Date: 2026-11-13
- Spec: 5.15 (self-registration); extends 0140 (which approved MineSkin only for the six ranger skins); related 0055, 0085, 0151, 0170
- Related: Q7 in `docs/analysis/phase1/packets/c7-user-management-packets.md`; cards C7-13a, C7-13b, C7-13c; `docs/runbooks/skins.md`

## Context

0140 lets the owner sign the six ranger skins through MineSkin. The owner now wants registered owners to upload a skin for their own agents, with an operator looking at each one first.

## Decision

1. **MineSkin may be called for owner uploads, only after approval.** This extends 0140 beyond the six ranger files. The MineSkin key stays on the operator side (the operator CLI on the node, `tools/players-cli`). The register service never holds it and never calls MineSkin.
2. **Upload.** An owner uploads one PNG per agent on the account page or the API. The server accepts only: a PNG signature, exactly 64x64 pixels, 8-bit RGB or RGBA, at most 32 KiB, no chunk other than IHDR, IDAT and IEND (no text, no profile, no animation, no palette), and an inflated size equal to the pixel data. Everything else is refused with a stable code. Limits: one pending upload per agent, 3 uploads per agent per day (admin owners exempt, 0170).
3. **Held.** An upload is stored in the database (never the repo, never a public path) as `pending`. Nothing is applied automatically. The skin in force stays the one the agent has.
4. **Operator moderation.** `players-cli skin uploads list|show|export|approve|reject` runs on the node. `export` writes the PNG to a local file so the operator can look at it. `approve` signs the PNG through MineSkin (unlisted), writes the signed texture to `geldar-skins` under the life id, and marks the upload `applied`. `reject` takes a reason code: `inappropriate`, `impersonation`, `not_a_skin`, `invalid_format`, `other`. The owner sees the status and the code, never the operator's note.
5. **Re-upload.** After a reject the owner may upload again once an hour has passed. Three rejects in 30 days lock that owner's uploads until the operator clears them. An approved skin can be replaced by a new upload, held the same way.
6. **The Velocity plugin applies the skin at the agent's next login**, as 0055 and 0140 say. Nothing changes in Paper or Geldar-Core.
7. **Audit and erasure.** Upload, approve, reject, apply and failure each write an audit row (0085). Deletion (0171) removes the upload rows, the PNG data and the KV key.
8. **Principle 1 holds.** A skin is cosmetic. It gives no human a way to act in the world.

## Why

- Human review before signing keeps abusive images off the shared map and out of Kino and BlueMap.
- Keeping the key and the KV write on the operator side means a web compromise cannot sign or apply anything.

## What it changes

- C7-13a to c implement it; `docs/runbooks/skins.md` gains the moderation steps.
- 0140 is extended, not superseded; its six-ranger scope note is lifted for owner uploads that pass this record.
