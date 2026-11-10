# animus

The Mind: the part of an agent that thinks (spec 5.3, 5.4). It wakes on events from the Body, builds a prompt, asks a model through the Thinker hub, validates the answer and sends the Body a plan. In Phase 0 it runs as a Node process on the host with every address on loopback (decision 0050).

This package starts as a skeleton (P0-21): the ports (interfaces), the config loader, id generation and in-memory fakes. Later packets fill in the behaviour behind the ports. They build against these files and do not edit them; an interface that is wrong is an "interface request" in the packet report, applied by P0-32.

## Layout

```
animus/
  package.json            all runtime dependencies, installed once (P0-21)
  tsconfig.json
  src/
    config.ts             reads shards/<shard>.yaml and the environment; refuses non-loopback addresses
                          and the digest and personality-seed placeholders (unless allowPlaceholders)
    ids.ts                newId('th'|'in'|'ac'|'jb'): ULIDs matching common.schema.json
    ports/                the interfaces
      model.ts            ModelClient, ModelJob, ModelCompletion, ModelError
      body.ts             BodyLink, EventSource, EventPublisher, MindEvent
      memory.ts           MemoryStore, Journal, Embedder and the row types
      attention.ts        AttentionController, WakeDecision, MindWakeReason, SuppressionReason
      prompts.ts          PromptLibrary, OutputValidator and their variable and error types
      index.ts            re-exports
    fakes/                in-memory implementations for unit tests (*.fakes.ts)
    thinker/  link/       P0-25, P0-26 (later packets add these directories)
    attention/ memory/ prompts/ validate/ loop/ reflection/
    mind.ts  main.ts      P0-32
```

## Who owns which files

| Owner | Files |
|---|---|
| P0-21 | `package.json` (every dependency; nobody else changes the lockfile for animus), `tsconfig.json`, `src/config.ts`, `src/ids.ts`, `src/ports/*`, `src/fakes/*` |
| P0-25 | `src/thinker/` (the Thinker hub and the `ModelClient`), `golem/src/mind-link/{server,revision}.ts` |
| P0-26 | `src/link/` (the Body-Mind channel over NATS, both ends) |
| P0-27 | `src/attention/` |
| P0-28 | `src/memory/` (Postgres, pgvector, `nomic-embed-text`) |
| P0-29 | `src/prompts/`, `src/validate/`, `prompts/**` at the repository root |
| P0-30 | `src/loop/` (the thinking loop) |
| P0-31 | `src/reflection/` (sleep reflection) |
| P0-32 | interface requests against the P0-20 and P0-21 files (the only packet that may change them after they merge), `src/mind.ts`, `src/main.ts` |
| P0-33 | this README's run section |

## Rules for every file here

- Unit tests use the fakes only: no Ollama, NATS, Postgres or Minecraft in `./geldar.ps1 check`. Integration tests are `*.it.test.ts`, skipped unless `GELDAR_IT=1`.
- The thought prompt is budgeted in estimated tokens: `mind.prompt_budget_tokens` (default 2500, replacing the old character budget), one estimated token per three ASCII characters, fitted to `num_ctx` 8192 with a 2048 output reserve (`prompts/library.ts`). The sleep reflection uses prompt v2, which carries a commitments block; open commitments are capped at `mind.max_commitments`, most overdue first, and the rest stay in the store (decision record: overnight decisions 50 and 51).
- In-world text (speech, signs, player names) is untrusted. It reaches a prompt only as a JSON-escaped string in the quoted-world-text section of the user message; the output validator is the control.
- A model, embedding digest or personality seed that is still a placeholder in `shards/phase0.yaml` stops the Mind from starting. Tests pass `allowPlaceholders`.
- No new SQL migration (D-P0-11): a missing column is an interface request.

## Running the Mind

The Mind is one of three host processes of Adam's run (decision 0050). Start and stop them together with `./geldar.ps1 adam`; do not start them by hand unless you are debugging.

```
./geldar.ps1 shard up phase0          # Paper, Velocity, Postgres, NATS, eventsink (compose)
ollama serve                          # if it is not already running; it listens on 127.0.0.1:11434 only
./geldar.ps1 adam models              # the pinned models, whether Ollama has them, the digests found
./geldar.ps1 adam up [--model strong|fast]
./geldar.ps1 adam status              # `down` when nothing runs; else each process and the last thought's latency
./geldar.ps1 adam logs animus [--follow]
./geldar.ps1 adam down                # the Thinker, then the Mind, then the Body (last)
```

What the Mind needs, and what `adam up` checks before it starts anything:

- **The shard is healthy**: Postgres `127.0.0.1:5432` (password in `compose/secrets/postgres.txt`), NATS `127.0.0.1:4222`, and the Velocity ingress. The `thoughts`, `intents` and `agents` tables already exist (D-P0-11: no migration runner).
- **Ollama has the pinned models** with the recorded digests: the tier's chat model (`qwen3:32b` strong, `qwen3:8b` fast) and `nomic-embed-text`. `adam up` refuses the digest placeholder `sha256:RECORD_AT_DISPATCH` and the personality-seed placeholder `DRAFT_PENDING_OWNER_APPROVAL` and says what to do: run `ollama pull <tag>`, then `./geldar.ps1 adam models --record` (writes the digests it found over the placeholders in `shards/phase0.yaml`; it never overwrites a recorded digest and refuses when a model is missing), review the change and commit it; the owner approves the seed in `mind.agent.personality_seed`.
- **`--model strong|fast`** picks the life: `ag_adam_03` on `qwen3:32b`, or `ag_adam_04` on `qwen3:8b` (the `mind.lives` table in the shard file; decision 0064). `--model smoke` picks `ag_smoke_01`. The test life `ag_adam_02` is used by the golem live cases, not by any run. It rewrites `mind.agent.username`, `mind.agent.tier` and `mind.run_tier` to match. The model is fixed for a life (spec 5.3.3), so the fast run is a separate life and needs a fresh world volume (decision 0051).
- **`./geldar.ps1 adam select --model strong|fast`** does only that rewrite: it checks nothing, starts nothing and needs no Docker or Ollama. The checked-in shard file selects the strong life `ag_adam_03`; the Mind live cases (`golem/test/live/adam-*.live.test.ts`) run the 8B life and fail at once unless the file selects it, so run `./geldar.ps1 adam select --model fast` before them (and `select --model strong` after, if you want the file back on the strong life).

Ports (all loopback): the Thinker socket `127.0.0.1:7410` (`mind.thinker`; `lantern-local` connects to it, see [../lantern-local/README.md](../lantern-local/README.md)); nothing else is opened. The Mind connects out to NATS, Postgres and Ollama.

Logs and state: `.geldar/adam/animus.log` and `animus.pid` (gitignored), one JSON object per line with `life_id`, `thought_id` and `intent_id` where they apply. Prompt and completion text never reach the log; the full prompt and the raw output of every thought are in the `thoughts` table. Configuration comes from `shards/phase0.yaml` (`mind`, `model_pins`, `embedding`) and the environment keys in `.env.example`.

To run it by hand: `node src/main.ts` from `animus/` (Node 22 runs the TypeScript directly), with the same environment. It stops cleanly on SIGINT or SIGTERM. On Windows `adam down` ends the processes at once, so the Body resumes from its last checkpoint.
