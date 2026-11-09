# P0-00 report

Created docs/threat-model.md (121 lines). All spec and decision links resolve (anchors checked against spec headings). LF endings, no IPs but 127.0.0.1, no tests (docs only).

Deviations from or extensions of spec section 8 (also listed in section 7 of the file):
- Velocity bot ingress exists in Phase 0 (decision 0021), contrary to spec section 10 text.
- Loopback-only rule replaces the spec's exposed-ports table for Phase 0.
- The local Thinker is treated as an untrusted boundary.
- Operator tooling (Thought Stream, journal viewers) added as an injection target.
- Rejected input is recorded as evidence (explicit reading of Principle 4).
Assumptions: Postgres/NATS bind 127.0.0.1 or compose network only; Ollama at 127.0.0.1:11434; P0-13 identity plugin per decision 0021.
