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
  ./geldar.ps1 shard up <name>       Create missing secrets, rebuild the repo images, start compose/<name>.yml and wait until healthy (--rcon-host publishes RCON to the host)
  ./geldar.ps1 shard secrets <name>  Create missing files in compose/secrets/ (never overwrites)
  ./geldar.ps1 shard nats-auth <name>  Create the opt-in NATS users, server config and Thinker token in compose/secrets/ (decision 0067; untested live)
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
  ./geldar.ps1 adam-run <32b|8b|smoke> start|status|stop|report|prepare-volume [args]  The Adam run protocol (tools/adam-run)
  ./geldar.ps1 mcp-tokens <command...>  Pass through to tools/mcp-tokens (init, owner, player, persona, token)
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

# The colo shard's flat config (shards/colo.yaml), read by `check` and by `shard up colo`. The keys are the ones
# contract/schemas/shard-config.schema.json declares. Unknown keys are refused by name. The host port must be the
# literal 25567 that compose/colo.yml publishes (decision 0082): 25565 (the game server) and 25566 (reserved) are
# refused, and so is any other value. A bind address other than loopback is refused.
function Read-ColoConfig([string] $Path = (Join-Path $Root 'shards/colo.yaml')) {
  if (-not (Test-Path -PathType Leaf $Path)) { throw "$Path does not exist" }
  $known = 'cpu_limit', 'memory_limit', 'minecraft_port', 'bind_address'
  $values = @{}
  $lineNo = 0
  foreach ($raw in Get-Content -Path $Path) {
    $lineNo++
    $line = ($raw -replace '\s+#.*$', '').Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    if ($line -notmatch '^([a-z_]+):\s*(\S+)$') { throw "${Path} line ${lineNo} is not a 'key: value' pair: $raw" }
    $key = $Matches[1]
    if ($key -notin $known) { throw "${Path} line ${lineNo}: unknown key '$key' (the colo shard reads: $($known -join ', '))" }
    if ($values.ContainsKey($key)) { throw "${Path}: key '$key' is set twice" }
    $values[$key] = $Matches[2]
  }
  foreach ($key in 'cpu_limit', 'memory_limit', 'minecraft_port') {
    if (-not $values.ContainsKey($key)) { throw "${Path}: $key is missing; the colo shard needs it" }
  }
  $cpu = $values.cpu_limit
  if ($cpu -notmatch '^[0-9]+(\.[0-9]+)?$' -or [double] $cpu -le 0 -or [double] $cpu -gt 64) {
    throw "${Path}: cpu_limit '$cpu' must be a number above 0 and at most 64"
  }
  $memory = $values.memory_limit
  if ($memory -notmatch '^[1-9][0-9]{1,4}[mg]$') {
    throw "${Path}: memory_limit '$memory' must be a whole number of m or g, from 10m to 99999g"
  }
  # The total is the least the shard may have. The per-service budgets are literal defaults in compose/colo.yml
  # (${GELDAR_COLO_<SERVICE>_CPUS:-x} and _MEM:-y); their sums are the floor. Paper's heap (MEMORY: 6G in compose,
  # a test keeps the two equal) plus 1 GiB is the floor for the memory total.
  $paperHeapMiB = 6144
  $toMiB = { param([string] $size) if ($size -match '^([0-9]+)g$') { [double] $Matches[1] * 1024 } else { [double] ($size -replace 'm$', '') } }
  $budgetCpu = 0.0
  $budgetMiB = 0.0
  # Each budget variable appears more than once per service (memory and memswap_limit both read _MEM), so each
  # service's CPUS and MEM is counted once, at its first reference.
  $services = @{}
  $cpuSeen = @{}
  $memSeen = @{}
  foreach ($match in [regex]::Matches((Get-Content -Raw (Join-Path $Root 'compose/colo.yml')), 'GELDAR_COLO_([A-Z_]+)_(CPUS|MEM):-([0-9.]+[mg]?)\}')) {
    $service = $match.Groups[1].Value
    $services[$service] = $true
    if ($match.Groups[2].Value -eq 'CPUS') {
      if (-not $cpuSeen.ContainsKey($service)) { $cpuSeen[$service] = $true; $budgetCpu += [double] $match.Groups[3].Value }
    }
    elseif (-not $memSeen.ContainsKey($service)) { $memSeen[$service] = $true; $budgetMiB += & $toMiB $match.Groups[3].Value }
  }
  if ($services.Count -eq 0) { throw "compose/colo.yml has no per-service GELDAR_COLO_<SERVICE>_CPUS/_MEM budgets to check the total against" }
  if ([double] $cpu -lt $budgetCpu) {
    throw "${Path}: cpu_limit $cpu is below the sum of the per-service CPU budgets in compose/colo.yml ($budgetCpu)"
  }
  if ((& $toMiB $memory) -lt ($paperHeapMiB + 1024)) {
    throw "${Path}: memory_limit $memory is below Paper's heap (6G) plus 1 GiB (7168m)"
  }
  if ((& $toMiB $memory) -lt $budgetMiB) {
    throw "${Path}: memory_limit $memory is below the sum of the per-service memory budgets in compose/colo.yml ($($budgetMiB)m)"
  }
  $port = $values.minecraft_port
  if ($port -in '25565', '25566') {
    throw "${Path}: minecraft_port $port is refused (25565 is the game server, 25566 is reserved)"
  }
  if ($port -ne '25567') {
    throw "${Path}: minecraft_port $port must be 25567, the host port compose/colo.yml publishes (decision 0082)"
  }
  $bind = if ($values.ContainsKey('bind_address')) { $values.bind_address } else { '127.0.0.1' }
  if ($bind -ne '127.0.0.1') {
    throw "${Path}: bind_address $bind is refused; the colo stack binds loopback only (127.0.0.1)"
  }
  return @{ cpu_limit = $cpu; memory_limit = $memory; minecraft_port = $port; bind_address = $bind }
}

function Invoke-Check {
  Push-Location $Root
  try {
    Write-Host '==> colo shard config (shards/colo.yaml)' -ForegroundColor Cyan
    $null = Read-ColoConfig
    Invoke-Step 'lint (biome)' { pnpm lint }
    Invoke-Step 'typecheck' { pnpm typecheck }
    Invoke-Step 'test (vitest)' { pnpm test }
    Invoke-Step 'repo checks (line caps, line endings, control characters)' { pnpm check:repo }
    Invoke-Step 'generated code is up to date' { pnpm check:generated }
    # Overlays (rcon-host.yml, nats-auth.yml, nats-auth-mcp.yml) only add to a base file, so each is checked merged with its base.
    foreach ($file in Get-ChildItem -Path compose -Filter *.yml -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @('rcon-host.yml', 'nats-auth.yml', 'nats-auth-mcp.yml', 'colo-public.yml', 'colo-kino.yml', 'colo-kino-session.yml') }) {
      Invoke-Step "docker compose config ($($file.Name))" { docker compose -f $file.FullName config --quiet }
    }
    Invoke-Step 'docker compose config (colo.yml with nats-auth.yml, the merge `shard up colo` starts)' { docker compose -f (Join-Path $Root 'compose/colo.yml') -f (Join-Path $Root 'compose/nats-auth.yml') config --quiet }
    # The public overlay needs GELDAR_MC_BIND and GELDAR_MC_PORT (no values in the repo): dummy values for this check only.
    Invoke-Step 'docker compose config (colo.yml + nats-auth.yml + colo-public.yml, dummy bind and port)' {
      $env:GELDAR_MC_BIND = '127.0.0.1'; $env:GELDAR_MC_PORT = '2'
      try { docker compose -f (Join-Path $Root 'compose/colo.yml') -f (Join-Path $Root 'compose/nats-auth.yml') -f (Join-Path $Root 'compose/colo-public.yml') config --quiet } finally { Remove-Item Env:GELDAR_MC_BIND, Env:GELDAR_MC_PORT -ErrorAction SilentlyContinue }
    }
    Invoke-Step 'docker compose config (colo.yml with colo-kino.yml, dummy Kino NATS user)' {
        $env:GELDAR_KINO_NATS_USER = 'kino'
        $env:GELDAR_KINO_PUBLIC_ORIGIN = 'https://glass.example.test'
        try { docker compose -f (Join-Path $Root 'compose/colo.yml') -f (Join-Path $Root 'compose/colo-kino.yml') config --quiet } finally { Remove-Item Env:GELDAR_KINO_NATS_USER, Env:GELDAR_KINO_PUBLIC_ORIGIN -ErrorAction SilentlyContinue }
    }
    Invoke-Step 'docker compose config (colo.yml with colo-kino.yml and colo-kino-session.yml, dummy origin)' {
        $env:GELDAR_KINO_PUBLIC_ORIGIN = 'https://glass.example.test'
        try { docker compose -f (Join-Path $Root 'compose/colo.yml') -f (Join-Path $Root 'compose/colo-kino.yml') -f (Join-Path $Root 'compose/colo-kino-session.yml') config --quiet } finally { Remove-Item Env:GELDAR_KINO_PUBLIC_ORIGIN -ErrorAction SilentlyContinue }
    }
    Invoke-Step 'docker compose config (phase0.yml with rcon-host.yml)'{ docker compose -f (Join-Path $Root 'compose/phase0.yml') -f (Join-Path $Root 'compose/rcon-host.yml') config --quiet }
    $natsBase = Join-Path $Root 'compose/phase0.yml'
    $natsMcp = Join-Path $Root 'compose/mcp.yml'
    Invoke-Step 'docker compose config (phase0.yml + mcp.yml + nats-auth.yml + nats-auth-mcp.yml)' { docker compose -f $natsBase -f $natsMcp -f (Join-Path $Root 'compose/nats-auth.yml') -f (Join-Path $Root 'compose/nats-auth-mcp.yml') config --quiet }
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

# Off Windows, throws unless $Path has exactly the mode $Octal ('600' for a file, '700' for a directory).
# chmod can report success on a filesystem that keeps no mode bits, so the mode is read back. Windows: no-op.
function Assert-OwnerOnlyMode([string] $Path, [string] $Octal) {
  if ($IsWindows) { return }
  $got = [int][IO.File]::GetUnixFileMode($Path) -band 511
  if ($got -ne [Convert]::ToInt32($Octal, 8)) {
    throw "$Path has mode $([Convert]::ToString($got, 8)), not ${Octal}: set it by hand (chmod $Octal) and run again"
  }
}

# The owner-only step of tools/mcp-tokens/src/secret-files.ts (restrictToOwner): inheritance off, and the
# current account gets full control. On Windows the file mode is not enforced, so this is the real guard.
# Windows: best effort, a failure is warned about, names the path and never fails the command.
# Linux and macOS: mode 600 through Restrict-OwnerOnly, read back. A failure throws: a secret must never stay readable.
function Set-OwnerOnlyAcl([string] $Path) {
  if (-not $IsWindows) {
    Restrict-OwnerOnly $Path
    Assert-OwnerOnlyMode $Path '600'
    return
  }
  $user = $env:USERNAME
  if (-not $user) { Write-Warning "USERNAME is not set; $Path keeps its default permissions"; return }
  & icacls $Path /inheritance:r /grant:r "${user}:F" *> $null
  if ($LASTEXITCODE -ne 0) { Write-Warning "icacls could not restrict $Path; check its permissions by hand" }
}

# Writes the shard's Docker secret files (spec 6.7) when they are missing. Each holds
# 32 random URL-safe characters with no newline. Existing files are never overwritten.
# Each file gets the owner-only ACL (Set-OwnerOnlyAcl) before its secret is written.
function Initialize-ShardSecrets([string] $Shard) {
  Get-ComposeFile $Shard | Out-Null
  $dir = Join-Path $Root 'compose/secrets'
  New-Item -ItemType Directory -Force $dir | Out-Null
  if (-not $IsWindows) {
    # The directory is owner-only too (700): its listing is no more public than the files it holds.
    & chmod 700 $dir
    if ($LASTEXITCODE -ne 0) { throw "chmod could not restrict $dir to its owner" }
    Assert-OwnerOnlyMode $dir '700'
  }
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  foreach ($name in 'postgres', 'rcon', 'velocity-forwarding') {
    $path = Join-Path $dir "$name.txt"
    if (Test-Path $path) {
      # An empty file is what a crash between create and write leaves behind; refuse to guess.
      if ((Get-Item $path).Length -eq 0) { throw "compose/secrets/$name.txt is empty; delete it and run again" }
      Set-OwnerOnlyAcl $path
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
      Set-OwnerOnlyAcl $path
      continue
    }
    try {
      # The file is empty until the Write below, so its owner-only mode is set before the secret goes in.
      Set-OwnerOnlyAcl $path
      $data = [Text.Encoding]::ASCII.GetBytes($secret)
      $stream.Write($data, 0, $data.Length)
    } finally {
      $stream.Dispose()
    }
    Assert-OwnerOnlyMode $path '600'
    Write-Host "created compose/secrets/$name.txt"
  }
}

# `up colo` merges compose/nats-auth.yml (NATS auth on by default), and compose/colo.yml declares nats-body and nats-mind.
# Their password files and the server config nats-auth.conf are the secrets `up` fails in docker without. Initialize-ShardSecrets
# does not write them (only `shard nats-auth` does), so `up colo` checks first and names what is missing. It never generates
# a partial set here. A test keeps this list equal to what colo.yml and nats-auth.yml declare.
function Assert-ColoNatsSecrets {
  $dir = Join-Path $Root 'compose/secrets'
  $missing = foreach ($name in 'nats-body.txt', 'nats-mind.txt', 'nats-mcp.txt', 'nats-paper.txt', 'nats-velocity.txt', 'nats-eventsink.txt', 'nats-auth.conf') {
    $path = Join-Path $dir $name
    if (-not (Test-Path -PathType Leaf $path) -or (Get-Item $path).Length -eq 0) { "compose/secrets/$name" }
  }
  if ($missing) {
    throw "$($missing -join ', ') is missing or empty, and compose/colo.yml with compose/nats-auth.yml needs them. Create them with: ./geldar.ps1 shard nats-auth colo"
  }
}

# Writes the opt-in NATS auth files (decision 0067) when they are missing: one password per
# component user in compose/secrets/nats-<user>.txt and the server config nats-auth.conf that
# names the GELDAR account and each user's publish and subscribe allow lists. Both are git-ignored,
# owner-only by ACL, and never overwritten. The lists are untested against a live server.
function Initialize-NatsAuth([string] $Shard) {
  Get-ComposeFile $Shard | Out-Null
  $dir = Join-Path $Root 'compose/secrets'
  New-Item -ItemType Directory -Force $dir | Out-Null
  $conf = Join-Path $dir 'nats-auth.conf'
  $users = Get-NatsUsers $Shard
  $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  foreach ($user in $users.Keys) {
    $path = Join-Path $dir "nats-$user.txt"
    if (Test-Path $path) { continue }
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    [IO.File]::WriteAllText($path, $secret, [Text.Encoding]::ASCII)
    Restrict-OwnerOnly $path
    Write-Host "created compose/secrets/nats-$user.txt"
  }
  # The Thinker hub's shared secret (threat model section 3). Unset GELDAR_THINKER_TOKEN_FILE keeps the hub open.
  $thinkerToken = Join-Path $dir 'thinker-token.txt'
  if (-not (Test-Path $thinkerToken)) {
    $bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    $secret = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    [IO.File]::WriteAllText($thinkerToken, $secret, [Text.Encoding]::ASCII)
    Restrict-OwnerOnly $thinkerToken
    Write-Host 'created compose/secrets/thinker-token.txt (set GELDAR_THINKER_TOKEN_FILE to its path to require it)'
  }
  if (Test-Path $conf) { return }
  $lines = @('# Generated by ./geldar.ps1 shard nats-auth. Git-ignored. Untested against a live server.',
    'port: 4222', 'http: "127.0.0.1:8222"', 'jetstream: enabled', 'accounts {', '  GELDAR {', '    jetstream: enabled', '    users = [')
  $entries = foreach ($user in $users.Keys) {
    $pass = (Get-Content (Join-Path $dir "nats-$user.txt") -Raw).Trim()
    $pub = ($users[$user].Pub | ForEach-Object { "`"$_`"" }) -join ', '
    $sub = ($users[$user].Sub | ForEach-Object { "`"$_`"" }) -join ', '
    # A deny list takes precedence over the allow list in nats-server, which is how a broad allow stays off the Kino subjects.
    $deny = ''
    if ($users[$user].ContainsKey('PubDeny')) {
      $denyQuoted = ($users[$user].PubDeny | ForEach-Object { "`"$_`"" }) -join ', '
      $deny = ", deny: [$denyQuoted]"
    }
    # allow_responses belongs inside permissions: nats-server 2.15 rejects it on the user block.
    "      { user: `"$user`", password: `"$pass`", permissions: { publish: { allow: [$pub]$deny }, subscribe: { allow: [$sub] }, allow_responses: true } }"
  }
  $lines += ($entries -join ",`n")
  $lines += @('    ]', '  }', '}')
  [IO.File]::WriteAllText($conf, (($lines -join "`n") + "`n"), [Text.Encoding]::ASCII)
  Restrict-OwnerOnly $conf
  Write-Host 'created compose/secrets/nats-auth.conf'
}

# The per-user allow lists of decision 0087, the table the live test proves (threshold/mcp/test/nats-auth.it.test.ts).
# Every subject starts with the shard, or is a KV bucket, a JetStream API subject or an inbox. No role is scoped to one
# life: a life is not known when the file is written, so the application checks its own life's subjects.
function Get-NatsUsers([string] $Shard) {
  $s = $Shard
  $js = @('$JS.API.>', '$JS.ACK.>', '_INBOX.>')
  $kv = { param($b) "`$KV.$b.>" }
  $mindTypes = @('wake', 'intent', 'action', 'plan_result', 'reflex_fired', 'speech', 'damage', 'death', 'sleep')
  return [ordered]@{
    body = @{ Pub = @("geldar.$s.>") + $js + @((& $kv 'geldar-life-registry'), (& $kv 'geldar-checkpoints'), (& $kv 'geldar-body-generation'));
      # Kino (decision 0075, review fix A): the body never publishes, and so never forges, the Kino feed or control subjects.
      PubDeny = @("geldar.$s.kino.>");
      Sub = @("geldar.$s.body.>", '_INBOX.>') }
    mind = @{ Pub = @($mindTypes | ForEach-Object { "geldar.$s.$_" }) + $js + @("geldar.$s.body.>");
      Sub = @('_INBOX.>') }
    eventsink = @{ Pub = @("geldar.$s.dlq") + $js; Sub = @('_INBOX.>') }
    mcp = @{ Pub = @("geldar.$s.sovereign_call", "geldar.$s.body.>", (& $kv 'geldar-presence')) + $js; Sub = @('_INBOX.>') }
    # Read-only (0137 item 3, 0087 correction): a KV watch and get on two buckets; no $KV publish, no $JS.API.>.
    velocity = @{ Pub = @(foreach ($b in 'geldar-life-registry', 'geldar-skins') { "`$JS.API.STREAM.INFO.KV_$b"; "`$JS.API.CONSUMER.CREATE.KV_$b"; "`$JS.API.CONSUMER.CREATE.KV_$b.>"; "`$JS.API.CONSUMER.INFO.KV_$b.>"; "`$JS.API.CONSUMER.DELETE.KV_$b.>" }) + @('$JS.FC.>', '_INBOX.>'); Sub = @('_INBOX.>') }
    # Kino: the plugin publishes the feed and reads the control subject, and cannot publish control (so it cannot forge a start).
    paper = @{ Pub = @("geldar.$s.>") + $js; PubDeny = @("geldar.$s.kino.control"); Sub = @("geldar.$s.kino.control", '_INBOX.>') }
    # Kino: Glass reads the feed and publishes control, and nothing else. Created with the others; mounted only by compose/colo-kino.yml.
    kino = @{ Pub = @("geldar.$s.kino.control"); Sub = @("geldar.$s.kino.*.feed", '_INBOX.>') }
  }
}

# Owner-only access, and a failure throws. On Windows: drop inherited ACL rules and grant the current user read and
# write alone. Elsewhere (Linux, macOS): mode 0600. icacls exists only on Windows, so the POSIX branch must not call it.
function Restrict-OwnerOnly([string] $Path) {
  if (-not $IsWindows) {
    & chmod 600 $Path
    if ($LASTEXITCODE -ne 0) { throw "chmod could not restrict $Path to its owner" }
    return
  }
  & icacls $Path /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "icacls could not restrict $Path to its owner" }
}

function Invoke-Shard([string[]] $ShardArgs) {
  $action, $shard, $extra = $ShardArgs
  $file = Get-ComposeFile $shard
  # --rcon-host adds compose/rcon-host.yml, which publishes RCON to the host loopback for the host-run tools.
  $rconHost = @($extra) -contains '--rcon-host'
  if ($rconHost -and $action -eq 'up' -and $shard -eq 'colo') {
    throw "shard up colo: --rcon-host is refused. compose/rcon-host.yml publishes Paper's RCON to the host loopback and bypasses the colo rules (decision 0082). The colo stack keeps RCON on the colo network only."
  }
  $files = @('-f', $file)
  if ($rconHost) { $files += @('-f', (Join-Path $Root 'compose/rcon-host.yml')) }
  # Colo runs NATS with auth by default: `up` merges the overlay, and Assert-ColoNatsSecrets has checked its secret files.
  if ($shard -eq 'colo' -and $action -eq 'up') { $files += @('-f', (Join-Path $Root 'compose/nats-auth.yml')) }
  $compose = @('compose') + $files + @('-p', "geldar-$shard")
  switch ($action) {
    'secrets' { Initialize-ShardSecrets $shard }
    'nats-auth' { Initialize-NatsAuth $shard }
    'up' {
      if ($shard -eq 'colo') { Assert-ColoNatsSecrets }
      Assert-PluginJar $shard
      if ($shard -eq 'colo') {
        # Refuses a bad shards/colo.yaml before anything starts. The per-service limits are literals in compose/colo.yml.
        $null = Read-ColoConfig
      }
      Initialize-ShardSecrets $shard
      Invoke-Step "build the images of shard $shard (layer cache; a no-op when nothing changed)" { docker @compose build }
      Invoke-Step "start shard $shard" { docker @compose up -d --wait }
      Invoke-Step "check the plugins loaded on shard $shard" { Assert-PluginsEnabled $shard $compose }
      if (-not $rconHost -and $shard -ne 'colo') { Write-Host "hint: RCON 25575 is not published to the host. Host tools that use it (golem players and bench, the removal of adam-cli, mcp-tokens and players-cli) need: ./geldar.ps1 shard up $shard --rcon-host" }
    }
    'down' { Invoke-Step "stop shard $shard" { docker @compose down } }
    'status' { Invoke-Step "status of shard $shard" { docker @compose ps } }
    'logs' { Invoke-Step "logs of shard $shard" { docker @compose logs --tail 200 @($extra | Where-Object { $_ -ne '--rcon-host' }) } }
    default { throw "Unknown shard action '$action'. Use up, down, status, logs, secrets or nats-auth." }
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

# The database commands connect as the shard's geldar login (compose/phase0.yml) with the password from the secret file.
# The password is never printed. The PG* variables are restored in finally, so the shell keeps its environment.
function Invoke-PgNode([string] $Script, [string[]] $ScriptArgs) {
  $pgNames = 'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGPASSWORD'
  $saved = @{}
  foreach ($name in $pgNames) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
  try {
    if (-not $env:PGHOST) { $env:PGHOST = '127.0.0.1' }
    if (-not $env:PGPORT) { $env:PGPORT = '5432' }
    if (-not $env:PGUSER) { $env:PGUSER = 'geldar' }
    if (-not $env:PGDATABASE) { $env:PGDATABASE = 'geldar' }
    # Without the file (init runs before any secret exists) the password stays unset.
    $passwordFile = Join-Path $Root 'compose/secrets/postgres.txt'
    if (Test-Path $passwordFile) { $env:PGPASSWORD = (Get-Content -Raw -Path $passwordFile).Trim() }
    Invoke-Node $Script $ScriptArgs
  }
  finally {
    foreach ($name in $pgNames) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
  }
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
  ./geldar.ps1 shard up <name>       Create missing secrets, rebuild the repo images, start compose/<name>.yml and wait until healthy (--rcon-host publishes RCON to the host)
  ./geldar.ps1 shard secrets <name>  Create missing files in compose/secrets/ (never overwrites)
  ./geldar.ps1 shard nats-auth <name>  Create the opt-in NATS users, server config and Thinker token in compose/secrets/ (decision 0067; untested live)
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
  ./geldar.ps1 adam-run <32b|8b|smoke> start|status|stop|report|prepare-volume [args]  The Adam run protocol (tools/adam-run)
  ./geldar.ps1 mcp-tokens <command...>  Pass through to tools/mcp-tokens (init, owner, player, persona, token)
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
  'mcp-tokens' {
    Invoke-PgNode 'tools/mcp-tokens/src/cli.ts' $Rest
  }
  'db' {
    $action, $extra = $Rest
    if ($action -ne 'migrate') { throw "Unknown db action '$action'. Use: ./geldar.ps1 db migrate [args]" }
    Invoke-PgNode 'tools/migrate/src/cli.ts' $extra
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
