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
  ./geldar.ps1 shard up <name>       Create missing secrets, start compose/<name>.yml and wait until healthy
  ./geldar.ps1 shard secrets <name>  Create missing files in compose/secrets/ (never overwrites)
  ./geldar.ps1 shard down <name>     Stop the shard (volumes are kept)
  ./geldar.ps1 shard status <name>   Show container health
  ./geldar.ps1 shard logs <name> [service]
  ./geldar.ps1 bench [args...]       Run the body benchmark (golem/), passing args through
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Command = 'help',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest = @()
)

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
    Invoke-Step 'repo checks (line caps, LF)' { pnpm check:repo }
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

# Writes the shard's Docker secret files (spec 6.7) when they are missing. Each holds
# 32 random URL-safe characters with no newline. Existing files are never overwritten.
function Initialize-ShardSecrets([string] $Shard) {
  Get-ComposeFile $Shard | Out-Null
  $dir = Join-Path $Root 'compose/secrets'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  foreach ($name in 'postgres', 'rcon', 'velocity-forwarding') {
    $path = Join-Path $dir "$name.txt"
    if (Test-Path $path) { continue }
    # 64 symbols and 256 byte values: the modulo is unbiased.
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    [IO.File]::WriteAllText($path, $secret)
    Write-Host "created compose/secrets/$name.txt"
  }
}

function Invoke-Shard([string[]] $ShardArgs) {
  $action, $shard, $extra = $ShardArgs
  $file = Get-ComposeFile $shard
  $compose = @('compose', '-f', $file, '-p', "geldar-$shard")
  switch ($action) {
    'secrets' { Initialize-ShardSecrets $shard }
    'up' { Initialize-ShardSecrets $shard; Invoke-Step "start shard $shard" { docker @compose up -d --wait } }
    'down' { Invoke-Step "stop shard $shard" { docker @compose down } }
    'status' { Invoke-Step "status of shard $shard" { docker @compose ps } }
    'logs' { Invoke-Step "logs of shard $shard" { docker @compose logs --tail 200 @extra } }
    default { throw "Unknown shard action '$action'. Use up, down, status, logs or secrets." }
  }
}

function Invoke-Bench([string[]] $BenchArgs) {
  if (-not (Test-Path (Join-Path $Root 'golem/package.json'))) {
    throw 'The body benchmark lives in golem/, which does not exist yet.'
  }
  Push-Location $Root
  try { Invoke-Step 'body benchmark' { pnpm --filter '@geldar/golem' run bench -- @BenchArgs } }
  finally { Pop-Location }
}

switch ($Command) {
  'setup' { Push-Location $Root; try { Invoke-Step 'pnpm install' { pnpm install --frozen-lockfile } } finally { Pop-Location } }
  'pnpm' { Push-Location $Root; try { pnpm @Rest; exit $LASTEXITCODE } finally { Pop-Location } }
  'check' { Invoke-Check }
  'shard' { Invoke-Shard $Rest }
  'bench' { Invoke-Bench $Rest }
  default { Get-Help $PSCommandPath -Detailed | Out-Host }
}
