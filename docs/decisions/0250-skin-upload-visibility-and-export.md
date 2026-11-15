# 0250. Skin uploads are unlisted by default, and a signed skin can be exported as JSON

Status: Accepted. Extends 0140 (agent skins) and 0172 (held uploads); the owner's approval of unlisted uploads stands.

## Decision

- `players-cli skin set` sends MineSkin's `visibility` form field on every upload, with the value `unlisted` by default. Until now the field was not sent, so the listing depended on MineSkin's default.
- `--visibility public` makes a public listing, and it also needs `--confirm-public` in the same command. Any other value is refused before the key file is read and before any network call.
- `--export-json <path>` writes the signed record after a successful upload, in the `ranger-skins.json` format of `skin import` (`{"<player-id>": {"mineskin_uuid", "value", "signature", "model"}}`), to a new file outside the repo. The file is never overwritten and is created with mode 0600 where the platform honours it. The command prints only the path and the byte count.
- `--no-store` skips the write to the `geldar-skins` bucket, so no NATS connection is needed. It requires `--export-json`, so the signed skin is never lost. The JSON then goes to the node and is stored there by `skin import`.

## Why

- Unlisted is the owner's rule (0140, 0172). A default that MineSkin chooses is not a rule the code can keep, so the code sends the value every time.
- A public listing needs two explicit flags, so it cannot happen by accident.
- A signed record kept as a file lets the node store it without a second MineSkin generation, which is rate limited.

## Not verified

- The field name `visibility` and the value `unlisted` follow the MineSkin v2 generate API as the code and its tests describe it. No live upload was run for this change. The first live upload should show `unlisted` in the reply's `skin.visibility`.
