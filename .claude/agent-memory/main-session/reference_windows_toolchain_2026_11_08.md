---
name: reference_windows_toolchain_2026_11_08
description: Toolchain facts verified on the Windows dev PC while setting up PR 1
---

Verified 2026-11-08 on the owner's Windows 11 PC (Node 22.23.2, PowerShell 7.6).

- **pnpm is not installed globally.** `corepack enable` fails with EPERM because Node lives in Program Files. Two working routes: `corepack enable pnpm --install-directory <a dir on PATH>` (no admin), or `corepack pnpm <args>`. `geldar.ps1` does the first automatically into `node_modules/.corepack-bin` when pnpm is missing, because nested `pnpm -r` calls in package scripts need a real `pnpm` on PATH; a PowerShell function alias is not enough.
- **Node 22.18+ runs `.ts` files directly** (type stripping, no flag). `node tools/repo-checks/src/cli.ts` works. It needs `.ts` import specifiers and erasable syntax only, which `tsconfig.base.json` enforces.
- **Biome 2.6 formats Markdown** when `files.includes` is `**`. `biome.json` limits it to code and JSON so it doesn't reformat the spec.
- **Long multi-file heredoc batches in Git Bash can fail to parse** ("unexpected EOF while looking for matching `'`") and write nothing; write files one at a time instead.
