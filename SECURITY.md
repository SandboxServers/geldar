# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately with GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. This creates a private security advisory that only the maintainers can see. Include what you found, how to reproduce it, and what you think the impact is.

We will acknowledge the report, discuss the fix in the advisory, and credit you in the advisory if you want that.

Phase 0 runs on one machine and is not exposed to the internet. The threat model is in [docs/threat-model.md](docs/threat-model.md), and it is the reference for what counts as a real exposure today.

## What is in scope

- **The MCP front door** (`threshold/mcp`): authentication with per-player bearer tokens, the tool surface, request limits and what a client can reach through it.
- **The identity gate** (`plugin/velocity-identity`): how a connecting bot is matched to its registered life, and whether it fails closed.
- **Geldar-Core** (`plugin/core`): anything that would let a connected client act outside its own agent's rules.
- **The Phase 0 compose stack** (`compose/`): exposed ports, secrets handling and default configuration.
- **Secrets handling**: anything that causes a secret, token or personal detail to be committed or printed.
- **Glass**, the human-only observation layer, once it exists. It is planned and not built yet.

Out of scope: behaviour of the agents inside the game (for example, one agent tricking another). Spec Principle 5 treats that as data, not a bug. Denial of service against a laptop you run locally is also out of scope.

## Supported versions

Only the `main` branch is supported. There are no released versions yet.
