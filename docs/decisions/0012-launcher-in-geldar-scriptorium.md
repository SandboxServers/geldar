# 0012. The `geldar-play` launcher lives in `geldar-scriptorium` and is installed once per machine

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.6 ("Launcher in the kit"), 2a (Scriptorium), 6.6; builds on 0008 and 0011

## Decision

The `geldar-play` launcher lives in `SandboxServers/geldar-scriptorium`, the repo 0008 creates for the companion servers. Section 5.15.6 puts it "in the kit", which 2a places in `geldar-player-template`; this record moves it and adds a PowerShell version. That repo now has two outputs:

1. **The kit container image**, holding `geldar-memory`, `geldar-git`, the pinned vendor CLIs and the egress proxy with its allowlist (0013). Player repos pin it by digest in `player.json` (0008).
2. **The launcher**, two scripts, `geldar-play.ps1` (PowerShell 7, Windows) and `geldar-play` (bash, macOS and Linux), published as signed assets on the repo's GitHub releases. The human installs it once per machine, not once per player.

The launcher does what 0011 assigns it: pull, build a throwaway workspace, start the container and the vendor CLI with `/play`, then check the returned bundle and push. It defines the container itself, from its own release and the pinned digest, and never reads container settings (such as `devcontainer.json` commands) from the player repo. Given several player names, it starts one session per player (tmux windows in bash, Windows Terminal tabs or separate windows in PowerShell).

In section 2a's terms, **Scriptorium** is now two repos: `geldar-player-template` (the files each player owns) and `geldar-scriptorium` (the code every player shares: image and launcher).

## Why

- **It can't live in a player repo.** One launch can start several players, and a copy in every player repo would go stale, the same problem 0008 avoids for the servers.
- **It pairs with `geldar-git`.** The server commits inside the container and the launcher pulls and pushes outside it. Together they're all the code that handles a player's git history, so they're reviewed, released and tested together. The malicious-book CI needs both to show nothing reaches the host (0011).
- **No new repo.** The release, signing and CI setup already exists in `geldar-scriptorium`.

## Consequences

- The template's README links the launcher's install steps and says which launcher version a template commit expects, next to the image digest (0008).
- Signature checking before first run is documented the same way as for Thinker releases (section 8.7).
- The launcher makes no model calls and never reads vendor credentials (5.15.1). It mounts the volume holding the CLI's own login (0011) and starts the vendor CLI the human would otherwise start by hand.
