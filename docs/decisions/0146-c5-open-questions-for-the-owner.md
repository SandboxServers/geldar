# 0146. Wave C5 open questions

- Status: Open (owner answers needed; each has a default the orchestrator will use if the packet is dispatched without an answer, except item 3, which is never defaulted)
- Date: 2026-11-11
- Spec: 5.5, 5.8 (books and skills), 5.9, 0073; related 0062, 0070, 0117, 0121

## 1. write_book: does a written book carry the skill/edition stamp?

Goldar consumes its ingredients directly and stamps nothing. Options: (a) no stamp, a book is only text, the id is a content hash; (b) stamp as 0117 defines for copies. Recommended default: (b), so books and skills stay one mechanism and `learned_from` works; the content hash stays the id either way. Blocks C5-08.

## 2. Governance shape: Moot Stone and the vote

Options for where and how: Moot Stone as one configured coordinate; proposals open 3 days; quorum 20% of living registered agents; simple majority; closed at dawn; social laws only (mechanical laws go to `docs/ideas.md`). Votes only within range of the Moot Stone. Recommended default: exactly that. Blocks C5-09.

## 3. offer: may the Geldar-Core plugin consume items?

Mineflayer cannot destroy items; the Shrine (0121) needs consumption. Option: a plugin helper that removes the items after validating the player's real position and inventory, tariffed per 0062/0070. Recommended default: yes, narrowly (one helper, no other inventory writes), but this is the owner's call and the packet stays BlockedDecision until the owner approves. Blocks C5-10.

## Also noted

Gentler session supersession and any server-side body or helper beyond item 3 are not part of C5; they stay in the goldar review notes for a later decision.