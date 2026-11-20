# Creates the node 3 Hyper-V test VM (G3-04). An operator run only: CI never runs it, and the tests never run it against a host.
# Run it on node 3 (or over SSH from the operator machine that holds the node 3 key) with PowerShell 7+.
#
# Dry run is the default. Every Hyper-V action is printed as "[dry-run] ..." and nothing is changed; read-only queries
# (Get-VM, Get-VMSwitch, Get-VMHost, Get-CimInstance, Get-FileHash) run in both modes. -Apply performs the plan.
#
# The script throws before any change when:
#   - a VM named -VmName exists. With -Reuse it prints that it changes nothing and exits 0. It never removes or
#     recreates a VM, and no Remove-VM call exists in it;
#   - the switch -SwitchName does not exist on the host;
#   - the host's free physical memory is below -MemoryGB plus 4 GB, or -ProcessorCount is above the host's logical processors;
#   - a file the run would create already exists (the OS disk, data disks or seed ISO);
#   - -ImageSha512 is not 128 hex characters, or an image file that is present does not match it (checked before use);
#   - the SSH public key file is missing or is not one OpenSSH public key line (a private key is refused).
# The public key is injected into the cloud-init seed and is never printed.
#
# Image: the Debian `generic` cloud image (NOT `genericcloud`, which kernel-panicked on Hyper-V), a qcow2 file that
# qemu-img converts to VHDX. Give -ImageUrl (https) and the sha512 of that exact file (from the Debian SHA512SUMS file).
# The script does not pin either: the operator supplies both at run time.
#
# Example (documentation addresses only; the real values come from the environment definition at run time):
#   pwsh -NoProfile -File New-TestVm.ps1 -VmName Geldar-Test -Address 192.0.2.10 -Gateway 192.0.2.1 -Dns 192.0.2.53 `
#     -SshPublicKeyPath C:\keys\deploy.pub -ImageUrl <https URL of the generic qcow2> -ImageSha512 <128 hex characters>
# Add -Apply to create it. Destroying the VM is a separate manual step by the operator.
#
# Tools used on the host: qemu-img (image conversion), oscdimg or genisoimage (seed ISO). -Apply refuses without them.
# The host SSH fingerprint is printed after boot by polling ssh-keyscan (-FingerprintAttempts, 0 to skip).

[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z][A-Za-z0-9-]{1,30}$')][string]$VmName,
  [string]$SwitchName = 'Internet',
  [int]$MemoryGB = 24,
  [int]$ProcessorCount = 8,
  [int[]]$DataDiskGB = @(64),
  [Parameter(Mandatory)][string]$Address,
  [Parameter(Mandatory)][string]$Gateway,
  [Parameter(Mandatory)][string]$Dns,
  [int]$PrefixLength = 24,
  [Parameter(Mandatory)][string]$SshPublicKeyPath,
  [Parameter(Mandatory)][string]$ImageUrl,
  [Parameter(Mandatory)][string]$ImageSha512,
  [string]$ImagePath,
  [string]$VmPath,
  [int]$FingerprintAttempts = 20,
  [switch]$Apply,
  [switch]$Reuse
)

$ErrorActionPreference = 'Stop'
$dryRun = -not $Apply
$gib = [long]1GB
$templateDir = Join-Path $PSScriptRoot 'vm'

function Write-Plan([string]$Text) {
  $mode = if ($dryRun) { 'dry-run' } else { 'apply' }
  Write-Output "[$mode] $Text"
}

# Prints the action; runs it only with -Apply.
function Invoke-Change([string]$Text, [scriptblock]$Action) {
  Write-Plan $Text
  if (-not $dryRun) { & $Action }
}

function ConvertTo-Ipv4([string]$Name, [string]$Value) {
  $ip = $null
  if (-not [System.Net.IPAddress]::TryParse($Value, [ref]$ip) -or $ip.AddressFamily -ne 'InterNetwork') {
    throw "$Name is not an IPv4 address"
  }
  return $ip.ToString()
}

# One OpenSSH public key line. The text is returned for injection and is never written to the output.
function Read-PublicKey([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'the SSH public key file was not found' }
  $text = (Get-Content -LiteralPath $Path -Raw).Trim()
  $oneLine = '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( [^\r\n]*)?$'
  if ($text -match 'PRIVATE KEY' -or $text -notmatch $oneLine) {
    throw 'the SSH key file must hold exactly one OpenSSH public key line'
  }
  return $text
}

function Assert-ImageHash([string]$File, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $File -Algorithm SHA512).Hash
  if ($actual -ne $Expected.ToUpperInvariant()) { throw "image sha512 does not match -ImageSha512 for $File" }
}

# cloud-init NoCloud seed: a volume labelled cidata holding the three rendered files.
function New-SeedIso([string]$Dir, [string]$Iso) {
  if (Get-Command oscdimg -ErrorAction SilentlyContinue) {
    & oscdimg -j2 '-lcidata' $Dir $Iso
  } else {
    Push-Location -LiteralPath $Dir
    try { & genisoimage -output $Iso -volid cidata -joliet -rock 'user-data' 'meta-data' 'network-config' }
    finally { Pop-Location }
  }
  if (-not (Test-Path -LiteralPath $Iso -PathType Leaf)) { throw 'the seed ISO was not written' }
}

function Show-HostFingerprint([string]$Target, [int]$Attempts) {
  for ($i = 1; $i -le $Attempts; $i++) {
    $line = & ssh-keyscan -T 5 -t ed25519 $Target 2>$null
    if ($line) {
      $line | & ssh-keygen -lf -
      return
    }
    Start-Sleep -Seconds 15
  }
  throw "no SSH host key from $Target after $Attempts attempts"
}

# ---- validation (read-only; refusals happen here, before any change) ----
$addr = ConvertTo-Ipv4 'Address' $Address
$gw = ConvertTo-Ipv4 'Gateway' $Gateway
$dnsIp = ConvertTo-Ipv4 'Dns' $Dns
if ($ImageUrl -notmatch '^https://') { throw 'ImageUrl must be an https URL' }
if ($ImageSha512 -notmatch '^[0-9a-fA-F]{128}$') { throw 'ImageSha512 must be 128 hex characters (sha512)' }
$key = Read-PublicKey $SshPublicKeyPath
if ($ProcessorCount -lt 1) { throw 'ProcessorCount must be at least 1' }

$switch = Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue
if (-not $switch) { throw "switch '$SwitchName' does not exist on this host" }

$existing = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($existing) {
  if (-not $Reuse) { throw "VM '$VmName' already exists; refusing. Use -Reuse to keep it (this script never deletes or recreates a VM)" }
  Write-Plan "VM '$VmName' exists and -Reuse was given: no change"
  return
}

$vmHost = Get-VMHost
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$system = Get-CimInstance -ClassName Win32_ComputerSystem
Write-Output ('host totals: {0} logical processors, {1:N1} GB physical memory, {2:N1} GB free' -f $vmHost.LogicalProcessorCount, ([long]$system.TotalPhysicalMemory / $gib), ([long]$os.FreePhysicalMemory / 1MB))
if ($ProcessorCount -gt $vmHost.LogicalProcessorCount) { throw "ProcessorCount $ProcessorCount is above the host's $($vmHost.LogicalProcessorCount) logical processors" }
$memBytes = [long]$MemoryGB * $gib
$freeBytes = [long]$os.FreePhysicalMemory * 1KB
if ($freeBytes -lt ($memBytes + 4 * $gib)) { throw "free memory is below the requested $MemoryGB GB plus 4 GB" }

$vmDir = if ($VmPath) { $VmPath } else { $vmHost.VirtualMachinePath }
$osDisk = Join-Path $vmDir "$VmName-os.vhdx"
$seedIso = Join-Path $vmDir "$VmName-seed.iso"
$dataDisks = @(for ($i = 0; $i -lt $DataDiskGB.Count; $i++) { Join-Path $vmDir ('{0}-data{1}.vhdx' -f $VmName, ($i + 1)) })
foreach ($file in @($osDisk, $seedIso) + $dataDisks) {
  if (Test-Path -LiteralPath $file) { throw "$file already exists; refusing to overwrite it" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('geldar-test-vm-' + [guid]::NewGuid().ToString('N'))
$image = if ($ImagePath) { $ImagePath } else { Join-Path $work (Split-Path -Leaf ([Uri]$ImageUrl).AbsolutePath) }
if (Test-Path -LiteralPath $image -PathType Leaf) {
  Assert-ImageHash $image $ImageSha512
  Write-Plan "image $image matches -ImageSha512"
} else {
  Invoke-Change "download $ImageUrl to $image and check its sha512 before use" {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $image) | Out-Null
    Invoke-WebRequest -Uri $ImageUrl -OutFile $image
    Assert-ImageHash $image $ImageSha512
  }
}

foreach ($tool in 'qemu-img', 'oscdimg', 'genisoimage') {
  $found = [bool](Get-Command $tool -ErrorAction SilentlyContinue)
  Write-Output ("tool {0}: {1}" -f $tool, $(if ($found) { 'found' } else { 'not found' }))
}
if (-not $dryRun) {
  if (-not (Get-Command qemu-img -ErrorAction SilentlyContinue)) { throw 'qemu-img is required with -Apply' }
  if (-not ((Get-Command oscdimg -ErrorAction SilentlyContinue) -or (Get-Command genisoimage -ErrorAction SilentlyContinue))) {
    throw 'oscdimg or genisoimage is required with -Apply'
  }
}

# ---- plan (dry run) or apply ----
Invoke-Change "convert $image to VHDX at $osDisk" { & qemu-img convert -O vhdx $image $osDisk }
Invoke-Change "resize $osDisk to 20 GB" { Resize-VHD -Path $osDisk -SizeBytes 20GB }
Invoke-Change "create VM ${VmName}: Generation 2, $MemoryGB GB, switch $SwitchName, boot disk $osDisk" {
  New-VM -Name $VmName -Generation 2 -MemoryStartupBytes $memBytes -SwitchName $SwitchName -VHDPath $osDisk -Path $vmDir | Out-Null
}
Invoke-Change "set $ProcessorCount vCPUs and static memory on $VmName" {
  Set-VMProcessor -VMName $VmName -Count $ProcessorCount
  Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $false
}
Invoke-Change "set secure boot on, template MicrosoftUEFICertificateAuthority" {
  Set-VMFirmware -VMName $VmName -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority
}
for ($i = 0; $i -lt $dataDisks.Count; $i++) {
  $disk = $dataDisks[$i]
  $size = [long]$DataDiskGB[$i] * $gib
  Invoke-Change "create data disk $disk ($($DataDiskGB[$i]) GB, dynamic) and attach it" {
    New-VHD -Path $disk -SizeBytes $size -Dynamic | Out-Null
    Add-VMHardDiskDrive -VMName $VmName -Path $disk
  }
}
$seedDir = Join-Path $work 'seed'
Invoke-Change "render the cloud-init seed from deploy/genesis/vm (key injected, not printed) and build $seedIso" {
  New-Item -ItemType Directory -Force -Path $seedDir | Out-Null
  $values = @{
    '@@HOSTNAME@@' = $VmName
    '@@INSTANCE_ID@@' = "$VmName-$(Get-Date -Format 'yyyyMMddHHmmss')"
    '@@SSH_PUBLIC_KEY@@' = $key
    '@@ADDRESS@@' = $addr
    '@@PREFIX@@' = [string]$PrefixLength
    '@@GATEWAY@@' = $gw
    '@@DNS@@' = $dnsIp
  }
  foreach ($name in 'user-data', 'meta-data', 'network-config') {
    $text = Get-Content -LiteralPath (Join-Path $templateDir $name) -Raw
    foreach ($token in $values.Keys) { $text = $text.Replace($token, [string]$values[$token]) }
    [IO.File]::WriteAllText((Join-Path $seedDir $name), $text, [Text.UTF8Encoding]::new($false))
  }
  New-SeedIso $seedDir $seedIso
  Remove-Item -LiteralPath $seedDir -Recurse -Force
}
Invoke-Change "attach $seedIso to the VM's DVD drive" { Add-VMDvdDrive -VMName $VmName -Path $seedIso }
Invoke-Change "start $VmName" { Start-VM -Name $VmName }
if ($dryRun) {
  Write-Plan "wait for SSH on $addr and print its host key fingerprint ($FingerprintAttempts attempts)"
  Write-Output 'dry run: nothing was changed. Add -Apply to create the VM.'
} elseif ($FingerprintAttempts -gt 0) {
  Show-HostFingerprint $addr $FingerprintAttempts
}
