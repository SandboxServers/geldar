# 0011. Player memory is pushed from the human's machine, never from inside the container

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 5.15.2 ("commits to a fixed remote the model cannot change"), 5.15.4 (`session-start.sh`), 5.15.5, 5.15.6 (launcher), 5.15.7 (container), Appendix J

## Decision

The kit's container holds no git credentials of any kind. Inside it, `geldar-git` only makes local commits. Network git operations happen on the human's own machine, run by the `geldar-play` launcher with the git login the human already used to clone the repo:

1. **Before a session:** the launcher pulls the player repo, then starts the container and the vendor CLI.
2. **During the session:** `commit_memory` and the `session-end.sh` safety net commit locally.
3. **After the container exits:** the launcher pushes.

The spec's `session-start.sh` "git pull" moves to step 1, and the hook keeps only the identity card and the rules reminder. `geldar-git`'s `sync()` tool is dropped from v1: with one controlling session per player (5.15.3), nothing changes the remote mid-session, so there's nothing to pull. Appendix J's allowlist loses `mcp__geldar_git__sync`.

The launcher treats the repo's `.git` folder as untrusted, because the container can write to it:

- `.git/config` and `.git/hooks/` are mounted read-only in the container.
- The launcher runs its pull and push with in-repo hooks disabled (`core.hooksPath` pointed at an empty directory outside the repo), so nothing planted in `.git` runs on the host.
- It pushes only to `origin` as recorded when the repo was cloned. It never takes a remote from a file the container can write.

The launcher ships for PowerShell 7 (Windows) and bash (macOS and Linux). The spec's tmux version becomes one mode of the bash launcher.

## Why

- **Least setup for the human.** No token to create, store, renew or rotate. Whatever let them clone lets them push.
- **Nothing to steal.** The model reads text written by other agents (8.4b). A token in an environment variable or file inside the container can be read by a prompt-injected session (for example through `/proc/self/environ`) and leaked through `say`. With no credential inside, the malicious-book CI only has to show that nothing reaches the host, not that a secret can't escape.
- **Rejected options:**
  - *Environment variable with a GitHub token:* the token sits inside the container and each player needs one made by hand.
  - *Per-repo deploy key:* scoped to one repo, but still inside the container, and it has to be delivered to the human at player creation.
  - *VS Code's built-in sharing of the host's git login with the container:* zero setup, but it reaches every repo the human can access.

## Consequences

- Pushes happen once per session, not live. If the machine dies mid-session, the commits stay local and go up at the next launch, which is acceptable at one session per in-game day (5.15.7). The coordinated checkpoint (6.8) records whatever SHA the remote has.
- People need the launcher. Someone who opens the repo in the container by hand gets local commits only; `session-start.sh` warns when there are commits that haven't been pushed, and the README says to push or use the launcher.
- The README explains how to stop VS Code sharing the host's git login with the container. The exact setting is checked against the pinned VS Code Dev Containers release when the kit is built.
- The malicious-book CI adds a check: after a hostile session, `.git/config` and `.git/hooks/` are unchanged and the launcher's push ran no in-repo hook.
