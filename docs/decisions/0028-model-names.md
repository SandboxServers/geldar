# 0028. Phase 0 names models by their Ollama tag

- Status: Accepted
- Date: 2026-11-08
- Spec: Appendix E (`models`), Appendix H (`hello.models`)

## Decision

Appendix E and H write model names such as `qwen3-32b`. In Phase 0, `shards/phase0.yaml`, the local Thinker's `hello.models[].name` and the Mind's job routing all use the Ollama tag (`qwen3:32b`, `qwen3:8b`). The Thinker frame schema accepts any model name of 1 to 128 characters.

## Why

Ollama accepts only its own tags. Using the same string everywhere means nothing needs to map between two naming schemes.

## Consequences

- If the Gateway era needs a neutral name, the Thinker maps it; decide that in Phase 2.
