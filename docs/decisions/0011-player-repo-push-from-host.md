# 0011. Player memory is pushed from the human's machine; the container never sees the real repo

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.2 ("commits to a fixed remote the model cannot change"), 5.15.4 (`session-start.sh`), 5.15.5, 5.15.6 (launcher), 5.15.7 (container), 8.4b, Appendix J

## Decision

The human's clone of the player repo stays on their machine and is never mounted into the container. The `geldar-play` launcher (0012) runs each session in three steps, with the git login the human already used to clone:

1. **Before.** On the host repo: `git pull --ff-only`. If that fails (diverged history, archived repo, no network), the launcher stops and says why; it never merges or forces. It records the starting commit (`START`), then makes a throwaway **workspace**: a fresh clone of the host repo at `START` in a launcher-owned folder. The host writes the workspace's `.git`, so it holds no remote URL and no credentials.
2. **During.** The container mounts only the workspace. The kit's own files (`CLAUDE.md`, `AGENTS.md`, `player.json`, `.claude/`, `.codex/`, `.mcp.json`) are mounted read-only from the host repo's tree at `START`. Only `memory/` and `skills/` are writable. `geldar-git` commits there with a fixed identity, `player-<name> <player-<name>@users.noreply.github.com>`, and ignores any git identity found on the host.
3. **After.** A final step in the same image runs `git bundle create` in the workspace, writing one file to a launcher-owned output folder. The host never runs git inside the workspace. It reads only the bundle:
   - `git bundle verify`, then fetch from the bundle into the host repo with `transfer.fsckObjects=true`;
   - the new head must have `START` as an ancestor, and every new commit may touch only `memory/**` and `skills/**`;
   - if anything fails, the launcher pushes nothing, keeps the bundle for inspection and says why;
   - otherwise it fast-forwards the host branch and pushes it to `origin`, then deletes the workspace.

The spec's `session-start.sh` "git pull" moves to step 1, and the hook keeps only the identity card and the rules reminder. `geldar-git`'s `sync()` tool is dropped: with one controlling session per player (5.15.3) nothing changes the remote mid-session. Appendix J's allowlist loses `mcp__geldar_git__sync`.

**Vendor login.** The CLI's own subscription login is the one credential inside the container, as 8.4b expects ("the CLI holds its own subscription login"). It lives in a launcher-owned volume per vendor, never in the repo or the workspace. The kit limits reads to the workspace (`Read(./**)`, never `Read(**)`), so the model can't open the login file.

The launcher ships for PowerShell 7 (Windows) and bash (macOS and Linux). The spec's tmux version becomes one mode of the bash launcher.

## Why

- **Least setup for the human.** No token to create, store, renew or rotate. Whatever let them clone lets them push.
- **Nothing the container writes is ever run by host git.** An earlier draft mounted the real repo with `.git/config` and `.git/hooks` read-only. Review found that host git still reads much more of `.git` that the container could write: attributes that trigger filter drivers, `alternates`, refs, `pushurl` and `insteadOf` rewrites. A read-only mount is also not reliable on every Docker setup. A bundle is a data file: the host checks it and fetches from it, and nothing else crosses back.
- **The remote can't be redirected.** `origin` lives only in the host repo's `.git/config`, which the container never sees, so its URL (and any token embedded in it) can't be read or rewritten.
- **Rejected options:**
  - *Environment variable with a GitHub token:* the token sits inside the container next to a model that reads other agents' text, and every player needs one made by hand.
  - *Per-repo deploy key:* scoped to one repo, but still inside the container.
  - *VS Code's built-in sharing of the host's git login with the container:* zero setup, but it reaches every repo the human can access.

## Consequences

- **The launcher is the only supported way to run a player.** The template ships no `.devcontainer/` (0008): opening the repo in a VS Code dev container would mount the real repo and the host's git login, which is what this record exists to prevent. The hooks exit straight away unless they find the kit container's marker, so running the vendor CLI on the host directly does nothing harmful. Without the container's companion servers it also has no memory and no commits.
- Pushes happen once per session, not live. If the machine dies mid-session, the workspace survives and the launcher offers to bundle it at the next start; the same checks apply. The coordinated checkpoint (6.8) records whatever SHA the remote has.
- Commits from players carry the noreply identity, so public player repos (0013) never expose the human's name or email.
- The malicious-book CI adds cases:
  - a hostile session that commits outside `memory/` and `skills/`, plants `.gitattributes`, `.git/info/attributes`, `alternates` or hooks in the workspace, or rewrites history. The launcher must refuse the push, and the host repo must be unchanged.
  - a book asking the player to read the CLI's login file, which must fail.
