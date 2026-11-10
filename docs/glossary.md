# Glossary

Terms as the code and docs use them. The full definitions are in [spec section 2a (names)](spec.md#2a-names) and [section 3 (glossary)](spec.md#3-glossary).

## The world

- **Vivarium**: the kind of thing Geldar is: a living enclosure for agents to live in and be observed. Geldar is the name.
- **Shard**: one complete world, with its server, agents and database. Shards run side by side as separate experiments. Phase 0 has one, `phase0` ([`shards/phase0.yaml`](../shards/phase0.yaml)).
- **Life**: one agent's registered identity and lifecycle. Each bot's life id is recorded in the NATS life registry, which the identity gate reads ([decision 0040](decisions/0040-bot-ingress-registry-in-nats-kv.md)).
- **Geldar-Core**: the Paper plugin that implements the world's own rules ([`plugin/core`](../plugin/core/)).

## People and residents

- **Player**: a human owner, the account that owns agents and runs their sessions. A player is not in the world and never acts there except through its agents. (The spec and the code use "player" for an agent; see the note under **Agent**.)
- **Owner cap**: the most agents one player may own on a shard. The shard default is 3 (`owner_cap_default` in [`shards/phase0.yaml`](../shards/phase0.yaml)); the owner's own cap is 20 (`owner_cap_owner`, [decision 0052](decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md)). The cap is config only today; no code enforces it yet.
- **Agent**: a resident with a name and a life. Each agent has exactly one Body and one Mind, and only agents act in the world. The code's `player_id` (`ag-<name>-<seq>`) names one agent. Spec and code still say "sovereign player" for a sovereign agent.
- **Headless agent**: an agent with no owner, whose Mind runs on a machine we run. Adam is one.
- **Sovereign agent**: an agent whose Mind is a person's own session of a vendor command-line tool, with its memory in its own repository. It connects to the world only through the MCP server.
- **Scriptorium**: the sovereign-agent kit (the repo-as-mind template). It is developed in a separate repository, so the name appears here only as a pointer.

## The agent

- **Body**: the bot process that is logged into the server as a Minecraft player account. Each agent has exactly one. It walks, digs, fights and eats, and runs reflexes. In this repo it is [`golem/`](../golem/).
- **Mind**: the part that builds prompts, calls a model and returns decisions. The product name for the Mind service is **Animus**, in [`animus/`](../animus/).
- **Lantern**: the Thinker bundle that a Patron runs to carry a model into the world. Phase 0 has a local version, [`lantern-local/`](../lantern-local/), which talks to Ollama.
- **Thinker**: the software that runs a model for a Mind. It holds no agent state.
- **Intent**: a durable goal the Mind sets for the Body, such as "get wood and make a pickaxe". It runs to completion or is interrupted; it does not need a model call at each step.
- **Thought**: one call from a Mind to a model: perception in, decisions out. Each thought records the prompt template version it used.
- **Journal**: the agent's own running notes. For a sovereign agent, the journal is also mirrored by the MCP server.
- **Receipt**: the record of one action: what was asked, what the world did, and the outcome. Every action has one.
- **Reflex**: an action the Body takes without asking the Mind, such as eating when starving.

## Access and observation

- **Threshold**: the one gateway into the world: the Thinker gateway and the Geldar MCP server (`threshold/mcp`). Code in [`threshold/`](../threshold/).
- **Glass**: the human-only, read-only observation layer: the map, the Thought Stream and the spectator views. It is planned for campaign wave 6 and is not built yet.
- **Principle 1**: no person acts inside the world. The code must not provide a way to do so ([spec section 2](spec.md#2-principles)).

## Work

- **Packet**: one unit of planned implementation work in the Phase 0 campaign, with its own branch, worktree and exit checks. Packets are listed in the [campaign ledger](analysis/phase0/README.md) and the `*-packets.md` plans.
