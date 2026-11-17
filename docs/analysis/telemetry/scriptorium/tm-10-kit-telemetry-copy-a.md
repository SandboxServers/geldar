# TM-10: kit telemetry package, part A (allow-list, capText, content) (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-01 merged in geldar (copy its commit). Unblocks: TM-11. Colo / Mind redeploy: none (library, unused until TM-12). `colo-images` path: n/a (other repository).

## Why a copy

`@geldar/telemetry` is a private workspace package of the geldar repository; the kit cannot depend on it. Decision pending for the owner (README gap G-3): vendor (this card) or publish. Until the owner says otherwise, vendor. The copy must stay byte-identical to the geldar files except the header comment, so a drift test (TM-11) can prove it.

## Files (exactly these)

- `packages/telemetry/package.json` (new): name `@geldar/scriptorium-telemetry`, `private: true`, `type: module`, `exports` `{ ".": "./src/index.ts" }`, scripts `typecheck` (`tsc -p . --noEmit`), dependencies copied EXACT from geldar `telemetry/package.json` (the ten `@opentelemetry/*` packages with the same exact versions: api 1.10.0, context-async-hooks 3.0.0, core 3.0.0, exporter-logs-otlp-proto 0.300.0, exporter-metrics-otlp-proto 0.300.0, exporter-trace-otlp-proto 0.300.0, resources 3.0.0, sdk-logs 3.0.0, sdk-metrics 3.0.0, sdk-trace 3.0.0). Do not run `pnpm add`; TM-11 installs once, with both parts present.
- `packages/telemetry/tsconfig.json` (new): copy `packages/supervisor/tsconfig.json` and adjust `include`.
- `packages/telemetry/src/attributes.ts` (new, copy)
- `packages/telemetry/src/cap-text.ts` (new, copy)
- `packages/telemetry/src/content.ts` (new, copy)

## Steps

1. In the geldar repository at the TM-01 merge commit (call it `<sha>`), read `telemetry/src/{attributes,cap-text,content}.ts` and `telemetry/package.json`. The brief gives the path of that checkout.
2. Copy the three source files byte for byte, LF endings, then prepend one first line to each: `// Vendored from geldar telemetry/src/<name>.ts at <sha>. Edit it in geldar first; packages/telemetry/test/drift.test.ts checks it.` (The drift test strips exactly this first line.)
3. Write `package.json` and `tsconfig.json` as above. Do not add the package to any other package's dependencies yet.
4. Check the root `pnpm-workspace.yaml` globs include `packages/*` (they should); if not, stop and report.
5. Do not run `pnpm install` (TM-11 does). Run `pnpm typecheck` only if the root script tolerates a package without `node_modules`; otherwise report "typecheck deferred to TM-11".
6. Test: none new in this card (the copy is covered by TM-11's drift test and TM-12 onwards). State in the report that the revert check is TM-11's.

## Checks

```powershell
pnpm lint
pnpm check:repo
git diff --check
```

## Commit

`TM-10: vendor telemetry allow-list, capText and content helpers into the kit (telemetry)` plus the two trailers.

## Do NOT

- Do not change a single line of the copied code, not even formatting; run Biome on the new files only if the repo's lint demands it, and if it rewrites anything, tell TM-11 (the drift test then compares after Biome) in the report.
- Do not add `nats-trace.ts` or `logger.ts` (the kit has no NATS and the supervisor keeps its own log writer).
- Do not widen the allow-list in the copy.
