# Proposal: facts for the social tools (F8)

Status: draft for geldar-93 to take to the owner. Facts only; nothing says when to use a tool (decisions 0058/0059/0068).

## What the agents can read today
- MCP tool descriptions (contract/src/generated/mcp-tools.ts): one sentence each (offer, propose, vote, write_book, read_book, define_skill, use_skill, see). The `act` verb list names them.
- The kit (geldar-scriptorium template-src and geldar-player-template template): a search for shrine, moot, propose, vote and book found no mention. So the tool descriptions are the only text.
- Not checked: what each agent's Claude Code runtime actually lists (deferred tools in geldar-economy's test could hide some). Ask scriptorium-orchestrator to confirm for one agent.
- Evidence of use: zero calls to these eight tools in 60 sessions (geldar-economy, Billy); zero mentions of vote, law or book in 48 h of journals.

## What the spec says exists
Shrine at spawn (offer within 3 blocks, for thinking credits, receipt written, public ledger readable with read_sign); Moot Stone and governance (propose/vote on community rules); books (write_book; read_book of the book you hold); skills (define_skill, use_skill). Unknown: which of these exist in the Colo world and whether credits matter to Claude Code agents (their thinking is not bought with credits). Ask geldar-worldops to confirm the shrine and Moot Stone exist and where, before any fact is written.

## Smallest set: one fact sentence per tool (draft; verify each against the live system first)
- offer: "Offering items at the Shrine within 3 blocks of it consumes them and writes a receipt." (add the location as a look/status fact only if it exists: "A Shrine is at x,y,z.")
- propose: "A proposal sets a new value for one community rule; the rules are: <list>." Only if a rule list exists.
- vote: "Open proposals are listed in status; each can be voted yes or no once by each player." Only if status can list them.
- write_book: "A written book is an item; its text can be read by anyone who holds it."
- read_book: "Reads the text of the book in your hand; a book is made with write_book."
- define_skill / use_skill: "A skill is code run in a sandbox; define_skill returns its test result; use_skill runs a skill you have defined or were given."
- see: no change.

## Cost and rules
- Token budget: about 60-80 words across the set; each sentence also adds to the schema size. Touches geldar-economy's budget: keep it to the set that is true on the live shard.
- Rule check: sentences state mechanics and observable places; none says when to use. Observable additions (shrine location, open proposals) are new facts in look/status and need geldar-93 and geldar-3b.
- Not proposed: any prompt or persona line telling agents to trade or govern; any world change (owner decision 2026-11-15).

## How to measure
Before: zero calls in 60 sessions; zero journal mentions. After a deploy with no other change in the window: calls per day to each tool, journal mentions of rules, shrine, books, and offers received at the Shrine.
