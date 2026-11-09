# 0002. Phase 0 runs on the owner's Windows PC with Ollama, Qwen3 32B and 8B

- Status: Accepted
- Date: 2026-11-08
- Spec: section 10 (Phase 0), section 13 open decision 7 (for Phase 0 only)

## Decision

Phase 0 runs on one machine: the owner's Windows 11 PC with the RTX 4090, using Docker Desktop for the compose stack. Ollama runs natively on the host, outside compose, so it can use the GPU; containers reach it at `host.docker.internal:11434`. Adam runs first on Qwen3 32B (the "strong" tier) and then on Qwen3 8B (the "fast" tier and the candidate model floor), both through Ollama.

## Why

The spec asks for "one weekend, one machine" and "whatever is easiest". Ollama on Windows needs no WSL2 GPU passthrough, and both models fit the 4090. vLLM, which the spec names for later tiers, wants Linux or WSL2; that choice (open decision 7) is still open for Phase 1.

## Consequences

- The local Thinker (`lantern-local/`) talks to Ollama's API. Its protocol to the Mind is still Appendix H, so swapping Ollama for vLLM later changes only the Thinker.
- Exact model tags (quantization included) are pinned in `shards/phase0.yaml` and recorded with every thought, per spec Appendix D `model_config`.
- Benchmarks and Adam runs compete with whatever else the PC is doing; results record that they ran on a shared desktop.
