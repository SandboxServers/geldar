---
title: Guides
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 283d5d2d
companions: [../README.md, ../runbooks/README.md, ../reference/README.md, ../agents/documentation-style.md]
sources: [docs/guides/first-hour-contributor.md, docs/guides/first-shard-on-your-machine.md, docs/guides/trace-one-action.md, docs/guides/operator-first-day.md, docs/analysis/docs-library/plan.md, docs/agents/documentation-style.md]
---

# Guides

Tutorials: first walkthroughs that take a newcomer to a working result. Each one teaches by doing and links out to the reference and runbooks for detail. To reach a specific goal once you know the basics, use the [runbooks](../runbooks/README.md) **(a-n)**; to look something up, use the [reference](../reference/README.md).

Links and rows marked **(a-n)** are `agents-never` documents: never copy, quote or link them from a path an agent reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

Read the contributor guides in order: each assumes the one before.

| # | Guide | Audience | You end with | Tested? |
|---|---|---|---|---|
| G01 | [Your first hour as a contributor](first-hour-contributor.md) | contributors | A worktree, an installed workspace and a small change (or a practice edit you then undo) that passes the fast local checks; knowing what the full check and CI each cover | Read-only steps run 2026-11-16 at `db33805c` and again at `283d5d2d`; install, practice edit, full check and push not run |
| G02 | [Your first shard on your machine](first-shard-on-your-machine.md) | contributors | The Phase 0 shard up and healthy, its first events in Postgres, and taken down with its volumes kept | No: the freeze forbids starting the stack; only `docker compose config` and `bench --list` were run, at `db33805c` |
| G03 | [Trace one action](trace-one-action.md) **(a-n)** | agents-never | One `mine` action followed from a thought to a plan, the Body, the event stream, the database and the Glass, with the tests that pin each hop passing | Code read at `db33805c`; seven test files run 2026-11-16 at `283d5d2d` (95 tests passed); the live section not run |
| G04 | [Operator first day](operator-first-day.md) | operators | One safe, read-only look at the Colo stack's health and a handover note | No, by its own statement (written against `dc07e3fa`) |

G03 is labelled `agents-never` because it follows thoughts, the journal, the `thought` prompt and the Glass (style rule 1). The plan row said `contributors`; the page records that conflict. Contributors still read it.

The player guide, a tutorial for people who bring an agent, lives at [players/README.md](../players/README.md).

All four are `status: draft`: each has had one reviewer's pass and its fixes, and none has been run end to end ([doc verification](../agents/doc-verification.md)).
