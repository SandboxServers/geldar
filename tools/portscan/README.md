# @geldar/portscan

An external TCP port scan for the public endpoint (0071, 0072). The scan passes only when the set of open ports is
exactly the expected list: an extra open port fails, and so does a missing expected port.

## Use

```
node src/cli.ts --target <host> --expected <file> [--range 1-65535] [--concurrency 64] [--per-second 200] [--attempts 2] [--timeout-ms 1000]
```

- `--target` is required. There is no default host.
- `--expected` is a file holding the expected ports: a JSON array (`[25565, 25566]`, or `[]` for no open ports), or
  numbers separated by whitespace or commas. Duplicates and an empty file are refused.
- The real expected list is in the ops runbook. This repo holds no real port and no real host.

The output is a JSON report on stdout: `target`, `startedAt`, `range`, `expected`, `open`, `missing`, `extra` and
`verdict` (`pass` or `fail`). It has no banner and no service data. Exit codes: 0 pass, 1 fail, 2 usage or I/O error.

## Rate cap (defaults)

| Setting | Default | Meaning |
|---|---|---|
| `--concurrency` | 64 | connects in flight at once |
| `--per-second` | 200 | connect starts per second, across all workers |
| `--attempts` | 2 | connect attempts per port |
| `--timeout-ms` | 1000 | how long one attempt waits before it times out |

A port that times out is retried until the last attempt. A timeout on the last attempt is reported as closed. A refusal
or any other socket error is closed at once and is not retried.

## Tests

`pnpm --filter @geldar/portscan test` (or `./geldar.ps1 pnpm exec vitest run tools/portscan`). The tests use an
injected fake connector and a fake clock. No test opens a socket, and the scanner is never run against a real host by
this package's tests.
