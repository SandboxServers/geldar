# 0006. pnpm, TypeScript 7, Biome and Vitest

- Status: Accepted
- Date: 2026-11-08
- Spec: section 5.2 (Node 22), section 13 open decision 12 (TypeScript for Body and Mind)

## Decision

- **pnpm workspace** at the root (`pnpm-workspace.yaml`); each TypeScript component is a package named `@geldar/<dir>`.
- **Node 22** (`.nvmrc`). Since Node 22.18, Node runs `.ts` files directly by stripping types, so scripts and tools run without a build step. `tsconfig.base.json` sets `erasableSyntaxOnly` (no enums, namespaces or parameter properties) and `rewriteRelativeImportExtensions`, so imports name `.ts` files and the same code also compiles to JavaScript when a package needs a build.
- **TypeScript 7** (the native compiler) for type checking only: `tsc --noEmit` per package.
- **Biome** for lint and format, one tool and one config (`biome.json`), covering TypeScript, JavaScript and JSON.
- **Vitest**, one run for the whole workspace from the root (`vitest.config.ts`).

## Why

Fewest moving parts for a small repo: no bundler or transpile step in development, one linter-formatter instead of ESLint plus Prettier, one test command. Language choice (open decision 12) is confirmed for the Body and Mind; the Allocator's language is decided when Phase 2 builds it.

## Consequences

- No TypeScript enums or namespaces; use string-literal unions and plain objects.
- Biome does not format Markdown; docs are formatted by hand.
- Locally, `geldar.ps1` provides pnpm through corepack when it is not on PATH.
