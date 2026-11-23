# 0445. A PR into main needs a human approval in Discord

- Status: Accepted
- Date: 2026-11-23
- Spec: section 2 (principles); extends decision 0436, which the spec does not cover

## Decision

1. A PR into `main` is merged only after a rostered reviewer has approved its
   current head. The approval is that reviewer's reaction on the bot's review
   request in the developer channel, matched by account and emoji against the
   private roster. The owner may waive it for a named PR. A campaign packet
   merging into its wave branch is exempt; the wave PR is not.
2. A developer's request to ship a PR authorizes their session to post one
   review request for each head of that PR, once CI is green on that head and
   the agent review says `ship`. It authorizes no other post.
3. The session waits for the approval with the bridge's read-only command,
   `tools/discord-bridge/wait-approval.mjs`, and records the approval on the PR
   in a comment.

## Why

Decision 0436 gave developer sessions a way to read and post in the shared
channel, and the team already approves PR heads there by reaction. Without a
rule, a session stopped after CI and waited to be told to ask, then waited again
to be told to look. The reviewer's act stays a single reaction, with no second
approval in GitHub.

The wait stays inside the limit 0436 set. A developer session starts it on its
own review request. It consumes one fact, whether a rostered account reacted
with its own emoji while the PR was still at the cited head, and never the text
of a message. Discord does not start or steer a turn, so event-driven agent
turns remain outside this decision as they are outside 0436.

## Consequences

- The `ship-pr` skill carries the rule (§ 5 and § 6). Nothing in GitHub enforces
  it: `ci gate` is still the only required check, and the approval comment is
  written by the session that merges. The roster and the channel history are
  the record of who approved.
- A new head needs a new review request and a new approval.
- A session without the bridge, the token or the roster cannot ship a PR into
  `main` on its own. It asks the owner to waive the approval or to ask for it.
- Reversing this means deleting the subsection in `ship-pr` § 5 and the clause in
  § 6. No state is created.
