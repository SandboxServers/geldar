#Requires -Version 7
<#
.SYNOPSIS
Starts or stops the MH-8a cost bench stack: a throwaway, loopback-only shard, project geldar-mh8a.

.DESCRIPTION
  ./bench/mh8a/run.ps1 up [-MinFreeRamGb <n>] [-AbortBelowRamGb <n>]
                              refuses to start below -MinFreeRamGb GB free RAM (default 10; lowering it is allowed
                              only when the orchestrator geldar-93 sets a lower gate) or below 20 GB free on C:
                              (fixed, not overridable), then starts the stack. -AbortBelowRamGb (default 0 = off)
                              aborts the Paper health wait if free RAM drops under that value.
  ./bench/mh8a/run.ps1 down   stops the stack and deletes its volumes (the bench world is throwaway).
  ./bench/mh8a/run.ps1 ram [-AbortBelowRamGb <n>]
                              starts nothing: prints free RAM and free C:, exits 1 if free RAM is under
                              -AbortBelowRamGb (default 0 = off).

Up and down print free RAM and free C: first. Every compose call uses project geldar-mh8a and the three files
compose/phase0.yml, compose/rcon-host.yml and bench/mh8a/phase0-bench.yml, and sets GELDAR_WORLD_VOLUME to
geldar-mh8a_paper-data, so the bench never reads or deletes the phase0 world (geldar-phase0_paper-data).
Nothing here removes containers by name pattern or prunes: compose acts only on project geldar-mh8a.

  ./bench/mh8a/run.ps1 up|down|ram ... -ExtraComposeFile <path>
                              optional run-time overlay (for example a network subnet override) appended as a
                              fourth `-f <path>` after the three files below, on every compose call (up, down, ps,
                              restart, exec), so teardown uses the same overlay. The file must exist and must be
                              outside the repo worktree; a path inside the worktree is refused. The overlay is a
                              run-time scratchpad file that must never be committed: keep it outside the repo.

Bench ports (loopback only): Minecraft 26565, NATS 14222, RCON 26575. The bench is a test-harness target
only; never use it for a real shard.
#>
param(
  [Parameter(Mandatory, Position = 0)]
  [ValidateSet('up', 'down', 'ram')]
  [string] $Action,
  [ValidateRange(0, 1000)]
  [double] $MinFreeRamGb = 10,
  [ValidateRange(0, 1000)]
  [double] $AbortBelowRamGb = 0,
  [string] $ExtraComposeFile = ''
)

$ErrorActionPreference = 'Stop'
$Project = 'geldar-mh8a'
$WorldVolume = 'geldar-mh8a_paper-data'
$MinFreeDiskGb = 20
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFiles = @('-f', 'compose/phase0.yml', '-f', 'compose/rcon-host.yml', '-f', 'bench/mh8a/phase0-bench.yml')
$PluginConfig = '/data/plugins/GeldarCore/config.yml'
$ExtraComposeFull = ''

function Resolve-ExtraComposeFile {
  # Sets $ExtraComposeFull to the absolute path of -ExtraComposeFile. Refuses a missing file and any file under the
  # worktree root (the overlay must never be committed). Runs before any action, so `ram` also refuses.
  if ([string]::IsNullOrEmpty($ExtraComposeFile)) { return }
  if (-not (Test-Path -LiteralPath $ExtraComposeFile -PathType Leaf)) {
    throw "refusing: -ExtraComposeFile '$ExtraComposeFile' does not exist or is not a file"
  }
  $full = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ExtraComposeFile).Path)
  $rootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  if ($full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "refusing: -ExtraComposeFile '$full' is inside the repo worktree; put the overlay outside the repo (it must never be committed)"
  }
  $script:ExtraComposeFull = $full
}

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

function Test-BenchRam([double] $FloorGb) {
  # Prints free RAM and free C:, starts nothing. Returns $false when FloorGb is above 0 and free RAM is under it.
  $ram = Get-FreeRamGb
  Write-Host "free RAM: $ram GB; free C: $(Get-FreeDiskGb) GB"
  if ($FloorGb -gt 0 -and $ram -lt $FloorGb) {
    Write-Host "free RAM $ram GB is under the $FloorGb GB floor (-AbortBelowRamGb)"
    return $false
  }
  return $true
}

function Invoke-BenchCompose([string[]] $ComposeArgs) {
  # The volume name is set for every call, so `down -v` cannot resolve to the phase0 world volume.
  # The caller's value is put back afterwards (removed again when it was unset).
  $previousVolume = $env:GELDAR_WORLD_VOLUME
  $env:GELDAR_WORLD_VOLUME = $WorldVolume
  # The optional overlay (-ExtraComposeFile) goes after the three files, on every call, so teardown uses it too.
  $files = @($ComposeFiles)
  if ($ExtraComposeFull) { $files += @('-f', $ExtraComposeFull) }
  Push-Location $Root
  try {
    & docker compose -p $Project @files @ComposeArgs
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
    if ($AbortBelowRamGb -gt 0 -and (Get-FreeRamGb) -lt $AbortBelowRamGb) {
      throw "aborting paper wait: free RAM is under $AbortBelowRamGb GB (project $Project)"
    }
    $health = (Invoke-BenchCompose @('ps', '--format', '{{.Health}}', 'paper') | Out-String).Trim()
    if ($health -eq 'healthy') {
      Write-Host "paper is healthy (project $Project)"
      return
    }
    Start-Sleep -Seconds 5
  }
  throw "paper did not become healthy within 300 s (last health: '$health', project $Project)"
}

Resolve-ExtraComposeFile

if ($Action -eq 'ram') {
  if (Test-BenchRam $AbortBelowRamGb) { exit 0 }
  exit 1
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
