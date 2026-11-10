# lantern-local

The local Thinker (spec Appendix H, decision 0050): a Node process that connects to the Mind's Thinker socket as a client, takes the model jobs the Mind sends, runs them on Ollama and returns the completions. It advertises only the models whose digest in Ollama equals the pin in `shards/phase0.yaml` (decision 0051); a mismatch or a placeholder digest stops it with a clear error.

## Running it

`./geldar.ps1 adam up` starts it with the Mind and Adam's Body; see [../animus/README.md](../animus/README.md) for the whole run (`adam models`, `adam up [--model strong|fast]`, `adam status`, `adam down`).

- **Ports.** It listens on nothing. It connects out to the Mind at `ws://127.0.0.1:7410/v1/thinker/stream` (`mind.thinker` in the shard file; override with `GELDAR_MIND_WS_URL`) and to Ollama at `http://127.0.0.1:11434` (`OLLAMA_URL`). Both must be loopback; the loader refuses anything else. It reconnects with backoff (250 ms, doubling to 5 s, with jitter), so it may start before the Mind.
- **Warm-up.** Before it dials, it loads with a one-token call the pinned models of the run tier (`mind.run_tier` in the shard file, set by `adam up --model`); with no run tier it loads every pin, the strong tier's model last. Each model may take `mind.thinker.warm_timeout_s` (180 s) to load. The warm-up runs once per process: a dial that fails does not load the models again. Before each dial it re-checks the pinned digests against Ollama, and it advertises only the warmed models that still match. Each `hello` advertises `max_tokens` 2048.
- **Needs.** Ollama running with the pinned model of the tier and a recorded digest in `model_pins` (`./geldar.ps1 adam models --record` writes them from Ollama). No database, no NATS, no secrets.
- **Logs.** `.geldar/adam/lantern-local.log` (gitignored): `./geldar.ps1 adam logs lantern-local [--follow]`. Prompt and completion text are not logged.
- **By hand.** `node src/main.ts` from `lantern-local/`, or `./geldar.ps1 pnpm --filter @geldar/lantern-local start`.
