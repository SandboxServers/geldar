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
- In-world text (speech, signs, player names) is untrusted. It reaches a prompt only as a JSON-escaped string in the quoted-world-text section of the user message; the output validator is the control.
- A model, embedding digest or personality seed that is still a placeholder in `shards/phase0.yaml` stops the Mind from starting. Tests pass `allowPlaceholders`.
- No new SQL migration (D-P0-11): a missing column is an interface request.
