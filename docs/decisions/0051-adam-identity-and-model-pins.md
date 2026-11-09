# 0051. Adam's identity and the Phase 0 model pins

- Status: Accepted (owner, 2026-11-09, wave 5 planning questions Q3 and Q14); the personality seed is drafted by the orchestrator and needs the owner's approval before the first run
- Date: 2026-11-09
- Spec: 5.3.3 (model fixed for life), 5.9 (life ids), Appendix D, Appendix E; decisions 0002, 0040, 0050

## Decision

1. **Identity.** Adam's game account username is the life id `ag_adam_01` (so plugin `sleep`, `damage` and `death` events carry `agent_id`, decision 0040 item 4); the display name in prompts and in addressed-speech detection is "Adam" (both names count). The model is fixed for a life, so the 8B run is a separate life `ag_adam_02` on a fresh world volume with the same personality seed.
2. **Personality seed.** A 3 to 5 trait seed plus one quirk, drafted by the orchestrator, recorded in `shards/phase0.yaml` under `mind.agent.personality_seed`, and approved by the owner before the first run.
3. **Model pins.** `qwen3:32b` (strong) and `qwen3:8b` (fast) at Ollama's default Q4_K_M quantisation, `num_ctx` 8192, `keep_alive` 30m, one job at a time per model, `nomic-embed-text` (768 dimensions, decision D-P0-12) on the CPU (`num_gpu: 0`) so it does not compete for the 24 GB card. The digests are recorded from `ollama list` at dispatch into `model_pins` in `shards/phase0.yaml`; a model whose digest differs is not advertised.

## Consequences

- P0-20 adds the `mind.agent` and `model_pins` blocks; P0-22's `lantern-local` refuses a digest mismatch; P0-28 pins the embedding model.
- The first Adam run waits for the owner's approval of the personality seed.
