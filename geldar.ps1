#!/usr/bin/env pwsh
<#
.SYNOPSIS
Geldar task runner: local checks, shard lifecycle and the body benchmark.

.DESCRIPTION
The spec's runbook says `make shard SHARD=baseline up`; on this repo that is
`./geldar.ps1 shard up baseline`. Runs on PowerShell 7 on Windows and Linux.

  ./geldar.ps1 setup                 Install workspace dependencies (frozen lockfile)
  ./geldar.ps1 pnpm <args...>        Run pnpm with the pinned version on PATH, nested calls included
  ./geldar.ps1 check                 Every check CI runs, in CI's order
  ./geldar.ps1 shard up <name>       Create missing secrets, rebuild the repo images, start compose/<name>.yml and wait until healthy
  ./geldar.ps1 shard secrets <name>  Create missing files in compose/secrets/ (never overwrites)
  ./geldar.ps1 shard down <name>     Stop the shard (volumes are kept)
  ./geldar.ps1 shard status <name>   Show container health
  ./geldar.ps1 shard logs <name> [service]
  ./geldar.ps1 bench [args...]       Run the body benchmark (golem/), passing args through
  ./geldar.ps1 adam up [--model strong|fast]   Check the shard and the pinned models, then start Adam's host processes
  ./geldar.ps1 adam select --model strong|fast  Rewrite the life lines of the shard file (no checks, starts nothing)
  ./geldar.ps1 adam down|status     Stop them (the Body last) or show their state and the last thought's latency
  ./geldar.ps1 adam logs [service] [--follow]  Tail body, animus or lantern-local under .geldar/adam/
  ./geldar.ps1 adam models [--record]  List the pinned models, their presence in Ollama and digests; --record writes the digests
  ./geldar.ps1 players up|down|status|logs [--player <id>]  One Body process per sovereign ranger (status prints "down" when none runs)
  ./geldar.ps1 mcp up|down|status|logs|smoke  The MCP container (compose/mcp.yml) on 127.0.0.1:8788; smoke runs the stub client case
  ./geldar.ps1 glass up|down|status|logs  Glass (the Thought Stream) on 127.0.0.1:8787, detached; status probes the thoughts API
  ./geldar.ps1 adam-run <32b|8b|smoke> start|status|stop|report [args]  The Adam run protocol (tools/adam-run)
  ./geldar.ps1 mcp-tokens <command...>  Pass through to tools/mcp-tokens (init, owner, player, token)
  ./geldar.ps1 db migrate [--dry-run]   Pass through to tools/migrate (applies sql/NNNN_*.sql)
#>
# No param block, on purpose. A named parameter here makes PowerShell's binder read `--out` as an ambiguous prefix
# of the common parameters (-OutVariable, -OutBuffer), and `-v` as -Verbose. Every argument is read from $args:
# the first is the command, the rest are its arguments, passed on verbatim.
$Command = if ($args.Count -gt 0) { [string] $args[0] } else { 'help' }
$Rest = [string[]] @($args | Select-Object -Skip 1)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = $PSScriptRoot

# Use pnpm from PATH when present. Otherwise put a corepack shim for the version
# package.json pins on PATH for this run (nested `pnpm -r` calls need it too).
# `corepack enable` without a directory needs admin on Windows, so the shim goes
# under node_modules/, which is gitignored.
if (-not (Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue)) {
  $shimDir = Join-Path $Root 'node_modules/.corepack-bin'
  if (-not (Get-ChildItem -Path $shimDir -Filter 'pnpm*' -ErrorAction SilentlyContinue)) {
    New-Item -ItemType Directory -Force $shimDir | Out-Null
    corepack enable pnpm --install-directory $shimDir
    if ($LASTEXITCODE -ne 0) { throw "corepack could not create a pnpm shim in $shimDir" }
  }
  $env:PATH = $shimDir + [IO.Path]::PathSeparator + $env:PATH
}

function Invoke-Step([string] $Name, [scriptblock] $Block) {
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$Name failed (exit $LASTEXITCODE)" }
}

function Get-ComposeFile([string] $Shard) {
  if (-not $Shard) { throw 'Name a shard, for example: ./geldar.ps1 shard up phase0' }
  $file = Join-Path $Root "compose/$Shard.yml"
  if (-not (Test-Path $file)) { throw "compose/$Shard.yml does not exist yet." }
  return $file
}

function Invoke-Check {
  Push-Location $Root
  try {
    Invoke-Step 'lint (biome)' { pnpm lint }
    Invoke-Step 'typecheck' { pnpm typecheck }
    Invoke-Step 'test (vitest)' { pnpm test }
    Invoke-Step 'repo checks (line caps, line endings, control characters)' { pnpm check:repo }
    Invoke-Step 'generated code is up to date' { pnpm check:generated }
    foreach ($file in Get-ChildItem -Path compose -Filter *.yml -ErrorAction SilentlyContinue) {
      Invoke-Step "docker compose config ($($file.Name))" { docker compose -f $file.FullName config --quiet }
    }
    if (Test-Path plugin/build.gradle.kts) {
      $gradlew = if ($IsWindows) { './gradlew.bat' } else { './gradlew' }
      Push-Location plugin
      try { Invoke-Step 'plugin build (gradle)' { & $gradlew build --no-daemon } } finally { Pop-Location }
    }
    Write-Host 'All checks passed.' -ForegroundColor Green
  } finally { Pop-Location }
}

# Compose bind-mounts the plugin jars; Docker creates a missing bind source as a directory, and the server then
# boots without the plugin. Refuse to start unless every jar the compose file mounts is a real file.
function Assert-PluginJar([string] $Shard) {
  $file = Get-ComposeFile $Shard
  $jars = 'plugin/core/build/libs/geldar-core.jar', 'plugin/velocity-identity/build/libs/geldar-velocity-identity.jar'
  foreach ($rel in $jars) {
    if (-not (Select-String -Path $file -SimpleMatch (Split-Path -Leaf $rel) -Quiet)) { continue }
    $jar = Join-Path $Root $rel
    if (Test-Path -PathType Leaf $jar) { continue }
    $why = if (Test-Path -PathType Container $jar) {
      'it is a directory (a previous start without the jar made Docker create one); delete that directory'
    } else { 'it does not exist' }
    throw "$rel is not a file: $why, then run: cd plugin; ./gradlew build"
  }
}

# `up --wait` only proves the healthchecks passed. A plugin that failed to load must not go unnoticed (the Velocity
# gate would admit anyone), so each service's log must hold its plugin's enabled line.
function Assert-PluginsEnabled([string] $Shard, [string[]] $Compose) {
  $file = Get-ComposeFile $Shard
  $expected = [ordered]@{ paper = 'Geldar-Core enabled'; velocity = 'Geldar identity enabled' }
  foreach ($service in $expected.Keys) {
    if (-not (Select-String -Path $file -Pattern "^  ${service}:" -Quiet)) { continue }
    $log = (docker @Compose logs --no-color $service 2>&1) -join "`n"
    if (-not $log.Contains($expected[$service])) {
      throw "$service did not log '$($expected[$service])': the plugin did not load. Check: ./geldar.ps1 shard logs $Shard $service"
    }
  }
}

# Writes the shard's Docker secret files (spec 6.7) when they are missing. Each holds
# 32 random URL-safe characters with no newline. Existing files are never overwritten.
function Initialize-ShardSecrets([string] $Shard) {
  Get-ComposeFile $Shard | Out-Null
  $dir = Join-Path $Root 'compose/secrets'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  foreach ($name in 'postgres', 'rcon', 'velocity-forwarding') {
    $path = Join-Path $dir "$name.txt"
    if (Test-Path $path) {
      # An empty file is what a crash between create and write leaves behind; refuse to guess.
      if ((Get-Item $path).Length -eq 0) { throw "compose/secrets/$name.txt is empty; delete it and run again" }
      continue
    }
    # 64 symbols and 256 byte values: the modulo is unbiased.
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    # CreateNew is atomic: if another writer created the file first, this fails and nothing is overwritten.
    try {
      $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    } catch [IO.IOException] {
      # Only "file already exists" (ERROR_FILE_EXISTS) means another writer won; any other IO error is rethrown as is.
      $alreadyExists = $_.Exception.HResult -eq -2147024816
      if (-not $alreadyExists -or -not (Test-Path $path)) { throw }
      # The winner may not have written its secret yet: give it one short retry before calling the file empty.
      if ((Get-Item $path).Length -eq 0) { Start-Sleep -Milliseconds 500 }
      if ((Get-Item $path).Length -eq 0) { throw "compose/secrets/$name.txt is empty; delete it and run again" }
      continue
    }
    try {
      $data = [Text.Encoding]::ASCII.GetBytes($secret)
      $stream.Write($data, 0, $data.Length)
    } finally {
      $stream.Dispose()
    }
    Write-Host "created compose/secrets/$name.txt"
  }
}

function Invoke-Shard([string[]] $ShardArgs) {
  $action, $shard, $extra = $ShardArgs
  $file = Get-ComposeFile $shard
  $compose = @('compose', '-f', $file, '-p', "geldar-$shard")
  switch ($action) {
    'secrets' { Initialize-ShardSecrets $shard }
    'up' { Assert-PluginJar $shard; Initialize-ShardSecrets $shard; Invoke-Step "build the images of shard $shard (layer cache; a no-op when nothing changed)" { docker @compose build }; Invoke-Step "start shard $shard" { docker @compose up -d --wait }; Invoke-Step "check the plugins loaded on shard $shard" { Assert-PluginsEnabled $shard $compose } }
    'down' { Invoke-Step "stop shard $shard" { docker @compose down } }
    'status' { Invoke-Step "status of shard $shard" { docker @compose ps } }
    'logs' { Invoke-Step "logs of shard $shard" { docker @compose logs --tail 200 @extra } }
    default { throw "Unknown shard action '$action'. Use up, down, status, logs or secrets." }
  }
}

function Invoke-Bench([string[]] $BenchArgs) {
  if (-not (Test-Path (Join-Path $Root 'golem/package.json'))) {
    throw 'golem/package.json is missing: the body benchmark lives in golem/.'
  }
  Push-Location $Root
  try {
    # Not Invoke-Step: it throws on any non-zero exit, and a CLI exit 2 (bad usage) is not a stack trace.
    # --dir (not --filter) keeps the CLI's own exit code: a filtered run turns every failure into 1.
    pnpm --dir (Join-Path $Root 'golem') run bench @BenchArgs
    exit $LASTEXITCODE
  }
  finally { Pop-Location }
}

# The adam commands are thin: the logic (pins, digests, PID files, status) is in tools/adam-cli/ and
# unit-tested there. The exit code of the CLI is the exit code of this command.
function Invoke-Adam([string[]] $AdamArgs) {
  Push-Location $Root
  try {
    node (Join-Path $Root 'tools/adam-cli/src/cli.ts') @AdamArgs
    exit $LASTEXITCODE
  }
  finally { Pop-Location }
}

# players, mcp, mcp-tokens and db (WM-12) are thin: the logic is in tools/players-cli, threshold/mcp, tools/mcp-tokens
# and tools/migrate, and each CLI's exit code is this command's exit code.
$McpCompose = @('compose', '-f', (Join-Path $Root 'compose/phase0.yml'), '-f', (Join-Path $Root 'compose/mcp.yml'), '-p', 'geldar-phase0')

function Invoke-Node([string] $Script, [string[]] $ScriptArgs) {
  Push-Location $Root
  try {
    node (Join-Path $Root $Script) @ScriptArgs
    exit $LASTEXITCODE
  }
  finally { Pop-Location }
}

function Invoke-Mcp([string[]] $McpArgs) {
  $action, $extra = $McpArgs
  Push-Location $Root
  try {
    switch ($action) {
      # `mcp-tokens init` writes the MCP's secret files when they are missing and never overwrites them.
      'up' {
        # The role stays NOLOGIN until its password is set, so the first start needs this step (threshold/mcp/README.md).
        $secretDir = Join-Path $Root 'compose/secrets'
        $missing = @('postgres-mcp.txt', 'mcp-token-pepper.txt') | Where-Object { -not (Test-Path (Join-Path $secretDir $_)) }
        if ($missing) {
          Write-Host "precheck: missing $($missing -join ', ') in compose/secrets; mcp-tokens init creates them now."
          Write-Host 'precheck: on a first start, after the stack is up, run: ./geldar.ps1 db migrate --set-role-password geldar_mcp --password-file compose/secrets/postgres-mcp.txt'
          Write-Host 'precheck: until that runs the geldar_mcp role is NOLOGIN and the MCP fails on database auth.'
        }
        Invoke-Step 'create the MCP secret files (mcp-tokens init, never overwrites)' { node (Join-Path $Root 'tools/mcp-tokens/src/cli.ts') init }
        Invoke-Step 'build the MCP image' { docker @McpCompose build geldar-mcp }
        Invoke-Step 'start the MCP on loopback (127.0.0.1:8788)' { docker @McpCompose up -d --wait geldar-mcp }
      }
      'down' { Invoke-Step 'stop the MCP (its volumes and the shard are kept)' { docker @McpCompose stop geldar-mcp } }
      'status' {
        $running = docker @McpCompose ps --status running -q geldar-mcp
        if ($LASTEXITCODE -ne 0 -or -not $running) { Write-Host 'down' } else { docker @McpCompose ps geldar-mcp }
      }
      'logs' { Invoke-Step 'logs of the MCP' { docker @McpCompose logs --tail 200 geldar-mcp @extra } }
      # The stub client case (threshold/mcp/test/live) against 127.0.0.1:8788/p/ag-test-01 with the test token file.
      'smoke' {
        # Every variable this block sets is restored in finally, so a later check in the same shell runs its usual suites.
        $saved = @{ GELDAR_IT = $env:GELDAR_IT; GELDAR_MCP_LIVE = $env:GELDAR_MCP_LIVE }
        try {
          $env:GELDAR_IT = '1'
          $env:GELDAR_MCP_LIVE = '1'
          Invoke-Step 'MCP smoke (stub client, ag-test-01)' { pnpm --dir (Join-Path $Root 'threshold/mcp') exec vitest run test/live/stub-client.live.test.ts }
        }
        finally {
          foreach ($name in $saved.Keys) { Set-Item -Path "Env:$name" -Value $saved[$name] }
        }
      }
      default { throw "Unknown mcp action '$action'. Use up, down, status, logs or smoke." }
    }
  } finally { Pop-Location }
}

# Get-Help reads the comment block only when the script has a param block, which this script does not, so the usage
# is printed from here. The synopsis above lists the same commands; the static guard checks that this list covers
# every case of the dispatch switch.
function Show-Usage {
  Write-Output @'
Geldar task runner: local checks, shard lifecycle and the body benchmark.

Usage: ./geldar.ps1 <command> [args]

  ./geldar.ps1 setup                 Install workspace dependencies (frozen lockfile)
  ./geldar.ps1 pnpm <args...>        Run pnpm with the pinned version on PATH, nested calls included
  ./geldar.ps1 check                 Every check CI runs, in CI's order
  ./geldar.ps1 shard up <name>       Create missing secrets, rebuild the repo images, start compose/<name>.yml and wait until healthy
  ./geldar.ps1 shard secrets <name>  Create missing files in compose/secrets/ (never overwrites)
  ./geldar.ps1 shard down <name>     Stop the shard (volumes are kept)
  ./geldar.ps1 shard status <name>   Show container health
  ./geldar.ps1 shard logs <name> [service]
  ./geldar.ps1 bench [args...]       Run the body benchmark (golem/), passing args through
  ./geldar.ps1 adam up [--model strong|fast]   Check the shard and the pinned models, then start Adam's host processes
  ./geldar.ps1 adam select --model strong|fast  Rewrite the life lines of the shard file (no checks, starts nothing)
  ./geldar.ps1 adam down|status     Stop them (the Body last) or show their state and the last thought's latency
  ./geldar.ps1 adam logs [service] [--follow]  Tail body, animus or lantern-local under .geldar/adam/
  ./geldar.ps1 adam models [--record]  List the pinned models, their presence in Ollama and digests; --record writes the digests
  ./geldar.ps1 players up|down|status|logs [--player <id>]  One Body process per sovereign ranger (status prints "down" when none runs)
  ./geldar.ps1 mcp up|down|status|logs|smoke  The MCP container (compose/mcp.yml) on 127.0.0.1:8788; smoke runs the stub client case
  ./geldar.ps1 glass up|down|status|logs  Glass (the Thought Stream) on 127.0.0.1:8787, detached; status probes the thoughts API
  ./geldar.ps1 adam-run <32b|8b|smoke> start|status|stop|report [args]  The Adam run protocol (tools/adam-run)
  ./geldar.ps1 mcp-tokens <command...>  Pass through to tools/mcp-tokens (init, owner, player, token)
  ./geldar.ps1 db migrate [--dry-run]   Pass through to tools/migrate (applies sql/NNNN_*.sql)
  ./geldar.ps1 help                  Print this usage
'@
}
# glass and adam-run (W6-13). Both are thin: tools/glass-ctl holds the Glass logic, tools/adam-run/src/cli.ts the run protocol.
function Invoke-GlassCtl([string[]] $GlassArgs) {
  # Glass reads its password from the file this variable names; this script never opens it. Restored in finally.
  $saved = @{ GELDAR_GLASS_PG_PASSWORD_FILE = $env:GELDAR_GLASS_PG_PASSWORD_FILE }
  Push-Location $Root
  try {
    $env:GELDAR_GLASS_PG_PASSWORD_FILE = Join-Path $Root 'compose/secrets/postgres-glass.txt'
    node (Join-Path $Root 'tools/glass-ctl/src/cli.ts') @GlassArgs
    $code = $LASTEXITCODE
  }
  finally {
    foreach ($name in $saved.Keys) { Set-Item -Path "Env:$name" -Value $saved[$name] }
    Pop-Location
  }
  exit $code
}

function Invoke-AdamRun([string[]] $RunArgs) {
  Push-Location $Root
  try {
    node (Join-Path $Root 'tools/adam-run/src/cli.ts') @RunArgs
    $code = $LASTEXITCODE
  }
  finally { Pop-Location }
  exit $code
}

switch ($Command) {
  'help' { Show-Usage }
  '-h' { Show-Usage }
  '--help' { Show-Usage }
  'players' {
    # Presence and the skin CLI read NATS through GELDAR_NATS_URL; unset, it defaults to the loopback NATS of the shard.
    # The variable is restored in finally, so the command leaves the shell's environment as it found it.
    $savedNats = $env:GELDAR_NATS_URL
    try {
      if (-not $env:GELDAR_NATS_URL) { $env:GELDAR_NATS_URL = 'nats://127.0.0.1:4222' }
      Invoke-Node 'tools/players-cli/src/rangers-cli.ts' $Rest
    }
    finally { $env:GELDAR_NATS_URL = $savedNats }
  }
  'mcp-tokens' { Invoke-Node 'tools/mcp-tokens/src/cli.ts' $Rest }
  'db' {
    $action, $extra = $Rest
    if ($action -ne 'migrate') { throw "Unknown db action '$action'. Use: ./geldar.ps1 db migrate [args]" }
    Invoke-Node 'tools/migrate/src/cli.ts' $extra
  }
  'mcp' { Invoke-Mcp $Rest }
  'setup' { Push-Location $Root; try { Invoke-Step 'pnpm install' { pnpm install --frozen-lockfile } } finally { Pop-Location } }
  'pnpm' { Push-Location $Root; try { pnpm @Rest; exit $LASTEXITCODE } finally { Pop-Location } }
  'check' { Invoke-Check }
  'shard' { Invoke-Shard $Rest }
  'bench' { Invoke-Bench $Rest }
  'adam' { Invoke-Adam $Rest }
  'glass' { Invoke-GlassCtl $Rest }
  'adam-run' { Invoke-AdamRun $Rest }
  default {
    [Console]::Error.WriteLine("Unknown command '$Command'.")
    Show-Usage
    exit 2
  }
}
