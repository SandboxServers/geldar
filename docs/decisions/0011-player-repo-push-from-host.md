# 0011. Player memory is pushed from the human's machine; the container never sees the real repo

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.2 ("commits to a fixed remote the model cannot change"), 5.15.4 (`session-start.sh`), 5.15.5, 5.15.6 (launcher), 5.15.7 (container), 8.4b, Appendix J (`Read(**)`, `sync`)

## Decision

The human's clone of the player repo stays on their machine and is never mounted into a container. The `geldar-play` launcher (0012) runs each session in three steps, using the git login the human already cloned with:

1. **Before.**
   - The host clone must be clean. The launcher runs `git pull --ff-only` and stops with a reason if that fails; it never merges or forces.
   - It records the starting commit (`START`) in its own state folder, outside anything a container can write.
   - It builds two folders from `START`:
     - a read-only **kit export** of the committed tree, never the working tree, so local edits and ignored files don't leak in;
     - a throwaway **workspace**: a copy-based clone that shares no object files with the host, with no remote and fixed line endings.
2. **During.** The session container mounts the workspace with only `memory/` and `skills/` writable, and the kit files over it from the export. `geldar-git` commits with a fixed identity, `player-<name> <player-<name>@users.noreply.github.com>`.
3. **After.**
   - A second, network-less container, started once the session container has stopped, bundles the workspace's branch into one file.
   - The host treats that bundle as hostile input. It never runs git inside the workspace. It verifies the bundle and fetches it into a private ref with object checking forced on.
   - It accepts the result only if all of these hold:
     - the result is a fast-forward from `START`;
     - it has no merge commits;
     - every changed path is a plain file under `memory/` or `skills/` that matches the kit's path rule.
   - Then it fast-forwards the host branch and pushes to `origin`.
   - The workspace and bundle are deleted only after a successful push. Any failure (a rejected check, or a remote that moved during the session) leaves the host branch untouched, keeps both for inspection, and tells the human why.

The exact commands and rules are a checklist in the Scriptorium campaign. Each item has a hostile-session test in the malicious-book CI, and a kit release ships only when all of them pass.

`session-start.sh` loses its "git pull" (now step 1) and keeps the identity card and the rules reminder. `geldar-git`'s `sync()` tool is dropped: with one controlling session per player (5.15.3), nothing changes the remote mid-session. Appendix J's allowlist loses `mcp__geldar_git__sync`.

**CLI state and credentials.** The container's CLI home is a launcher-owned volume **per player and vendor**, so players never share settings, transcripts or memory (5.15.6). It holds the vendor login and the Geldar OAuth tokens the CLI stores (5.15.5 step 3). Those are the only credentials in the container; there are no git or cloud credentials. Appendix J's `Read(**)` becomes reads scoped to the workspace, plus explicit deny rules for the CLI's credential and config paths, and a CI case checks that a hostile session can't read them.

The launcher ships for PowerShell 7 (Windows) and bash (macOS and Linux). The spec's tmux version becomes one mode of the bash launcher.

## Why

- **Least setup for the human.** No token to create, store, renew or rotate. Whatever let them clone lets them push.
- **Nothing the container writes is ever run by host git.** An earlier draft mounted the real repo with `.git/config` and `.git/hooks` read-only. Two reviews found that host git reads much more of a repo than that: attributes that trigger filter drivers, `alternates`, refs, `pushurl` and `insteadOf`. They also found that a plain local clone shares object files the container could rewrite in place. Under this design only a bundle comes back, and the host checks it as data.
- **The remote can't be redirected or read.** `origin` exists only in the host clone's `.git/config`, which no container sees.
- **Rejected options:**
  - *Environment variable with a GitHub token:* the token sits inside the container next to a model that reads other agents' text, and every player needs one made by hand.
  - *Per-repo deploy key:* scoped to one repo, but still inside the container.
  - *VS Code's built-in sharing of the host's git login with the container:* zero setup, but it reaches every repo the human can access.

## Consequences

- **The launcher is the only supported way to run a player.** The template ships no `.devcontainer/` (0008), because a dev container would mount the real repo and the host's git login. Hooks exit at once unless they find the kit container's marker. Running the vendor CLI on the host directly gets no companion servers, so no memory and no commits.
- Pushes happen once per session, not live. If the machine dies mid-session, the launcher offers to bundle the surviving workspace at the next start, against the `START` it stored. The coordinated checkpoint (6.8) records whatever SHA the remote has.
- Commits carry the player's noreply identity, and the workspace holds no host paths, so public repos (0013) don't expose the human's name, email or username.
- Launcher messages strip control characters from anything that came from the bundle (commit subjects, paths) before printing.
