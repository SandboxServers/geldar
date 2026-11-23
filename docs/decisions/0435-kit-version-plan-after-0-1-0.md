# 0435. Kit version plan after 0.1.0

- Status: Proposed (owner)
- Date: 2026-11-23
- Spec: no spec section; decision-only. Related: 0393 (first stable release)

## Decision

- `kit-v0.1.0`: MCP route plus explore, farm and patrol.
- `kit-v0.2.0`: building verbs (BLD-25) and anything else merged after 0.1.0.
- `kit-v0.3.0`: sheets and roles.
- The local harness ships in the first minor after HC-08c and HC-09 merge.
- rc tags are for canaries only. Rangers upgrade once per minor.

## Why

Each ranger restart is a cost and a gap in its day. One upgrade per minor keeps the restarts few, and a plan lets the owner say what each minor holds.

## Consequences

- A patch tag (for example kit-v0.1.1) is for a fix to the minor already shipped. This plan does not forbid it.
- Release notes name the version plan row they ship.
