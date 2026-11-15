#Requires -Version 7
<#
.SYNOPSIS
Starts or stops the MH-8a cost bench stack: a throwaway, loopback-only shard, project geldar-mh8a.

.DESCRIPTION
  ./bench/mh8a/run.ps1 up     refuses to start below 10 GB free RAM or 20 GB free on C:, then starts the stack.
  ./bench/mh8a/run.ps1 down   stops the stack and deletes its volumes (the bench world is throwaway).

Both print free RAM and free C: first. Every compose call uses project geldar-mh8a and the three files
compose/phase0.yml, compose/rcon-host.yml and bench/mh8a/phase0-bench.yml, and sets GELDAR_WORLD_VOLUME to
geldar-mh8a_paper-data, so the bench never reads or deletes the phase0 world (geldar-phase0_paper-data).
Nothing here removes containers by name pattern or prunes: compose acts only on project geldar-mh8a.

Bench ports (loopback only): Minecraft 26565, NATS 14222, RCON 26575. The bench is a test-harness target
only; never use it for a real shard.
#>
param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('up', 'down')]
  [string] $Action
)

$ErrorActionPreference = 'Stop'
$Project = 'geldar-mh8a'
$WorldVolume = 'geldar-mh8a_paper-data'
$MinFreeRamGb = 10
$MinFreeDiskGb = 20
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFiles = @('-f', 'compose/phase0.yml', '-f', 'compose/rcon-host.yml', '-f', 'bench/mh8a/phase0-bench.yml')
$PluginConfig = '/data/plugins/GeldarCore/config.yml'

function Get-FreeRamGb {
  # FreePhysicalMemory is in KiB; 1 GiB is 1048576 KiB.
  [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1048576, 1)
}

function Get-FreeDiskGb {
  [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1)
}

function Write-Resources([string] $Label) {
  Write-Host "$Label free RAM: $(Get-FreeRamGb) GB; free C: $(Get-FreeDiskGb) GB"
}

function Invoke-BenchCompose([string[]] $ComposeArgs) {
  # The volume name is set for every call, so `down -v` cannot resolve to the phase0 world volume.
  # The caller's value is put back afterwards (removed again when it was unset).
  $previousVolume = $env:GELDAR_WORLD_VOLUME
  $env:GELDAR_WORLD_VOLUME = $WorldVolume
  Push-Location $Root
  try {
    & docker compose -p $Project @ComposeFiles @ComposeArgs
    if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') exited $LASTEXITCODE" }
  } finally {
    Pop-Location
    if ($null -eq $previousVolume) {
      Remove-Item Env:GELDAR_WORLD_VOLUME -ErrorAction SilentlyContinue
    } else {
      $env:GELDAR_WORLD_VOLUME = $previousVolume
    }
  }
}

function Enable-BenchLog {
  # The plugin writes its config.yml on first start. Wait for it, turn on chat.muffle.bench_log, restart paper.
  $found = $false
  for ($try = 1; $try -le 60 -and -not $found; $try++) {
    try {
      Invoke-BenchCompose @('exec', '-T', 'paper', 'test', '-f', $PluginConfig)
      $found = $true
    } catch {
      Start-Sleep -Seconds 5
    }
  }
  if (-not $found) { throw "plugin config $PluginConfig did not appear in the paper container" }
  Invoke-BenchCompose @('exec', '-T', 'paper', 'sed', '-i', 's/^\(\s*\)bench_log:.*/\1bench_log: true/', $PluginConfig)
  Invoke-BenchCompose @('restart', 'paper')
  Invoke-BenchCompose @('exec', '-T', 'paper', 'grep', '-q', 'bench_log: true', $PluginConfig)
  Write-Host "bench log check: bench_log: true is set in $PluginConfig (paper restarted)"
}

function Wait-PaperHealthy {
  # Paper's compose healthcheck passes once the server is up and Geldar-Core is enabled. Bounded: 60 polls, 5 s apart.
  $health = ''
  for ($try = 1; $try -le 60; $try++) {
    $health = (Invoke-BenchCompose @('ps', '--format', '{{.Health}}', 'paper') | Out-String).Trim()
    if ($health -eq 'healthy') {
      Write-Host "paper is healthy (project $Project)"
      return
    }
    Start-Sleep -Seconds 5
  }
  throw "paper did not become healthy within 300 s (last health: '$health', project $Project)"
}

Write-Resources 'before'

if ($Action -eq 'up') {
  $ram = Get-FreeRamGb
  $disk = Get-FreeDiskGb
  if ($ram -lt $MinFreeRamGb) {
    throw "refusing to start: free RAM $ram GB is under $MinFreeRamGb GB"
  }
  if ($disk -lt $MinFreeDiskGb) {
    throw "refusing to start: free C: $disk GB is under $MinFreeDiskGb GB"
  }
  Write-Host 'precondition: the GeldarCore plugin jar must be built from branch phase1/mh3-effective-distance.'
  if (-not (Test-Path (Join-Path $Root 'compose/secrets'))) {
    Write-Warning 'compose/secrets/ is missing: run ./geldar.ps1 shard secrets phase0 first.'
  }
  Invoke-BenchCompose @('up', '-d')
  Enable-BenchLog
  Wait-PaperHealthy
  Write-Host "bench up: Minecraft 127.0.0.1:26565, NATS 127.0.0.1:14222, RCON 127.0.0.1:26575"
} else {
  Invoke-BenchCompose @('down', '-v')
  Write-Resources 'after'
}
