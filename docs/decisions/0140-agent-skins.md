# 0140. Agent skins: MineSkin-signed textures in geldar-skins, applied by the Velocity identity plugin

Status: accepted (orchestrator, owner request 2026-11-11: the ranger skins show in BlueMap and Kino). Follows 0055 (skins live in `geldar-skins`, the Velocity plugin applies them) and 0139.

## Decision

- The mechanism of 0055 stays. `tools/players-cli` signs a skin through MineSkin (`skin set`), or stores an already signed texture (`skin import`, new, no upload). Records go in the `geldar-skins` KV bucket under the life id. The Velocity identity plugin keeps an in-memory copy and sets the `textures` profile property at login. Nothing new is added to Paper or Geldar-Core.
- The signed data (texture value and signature) is public Mojang-signed data but is still kept out of the repo: the owner holds `ranger-skins.json` (player id to `{mineskin_uuid, value, signature, model}`) outside the repo, and the PNGs are in the git-ignored `skins/` directory or the owner's private files.
- The six ranger skins were uploaded once, `unlisted`, with the owner's own MineSkin key and the owner's explicit approval. This lifts the "MineSkin upload is not yet approved" note in 0055 for those six files only.
- Kino skin images (a later packet, see `docs/runbooks/skins.md`) are served from a read-only node mount, never from the repo.

## Why

The mechanism already exists and is tested; the smallest change is a way to load the signed data without a second MineSkin generation (the generation count is rate limited).