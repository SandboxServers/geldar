// G3-04: deploy/genesis/New-TestVm.ps1 creates the node 3 test VM. These tests run it under pwsh against stub Hyper-V
// cmdlets defined in a wrapper that logs every mutating call. No host, image or network is touched: the image is a local
// fixture and the stubs replace every cmdlet that would change a machine.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { pwshCommand, pwshProbe, toolAvailable } from './tool-probe';

vi.setConfig({ testTimeout: 60_000 });
const DEPLOY = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(DEPLOY, 'genesis', 'New-TestVm.ps1');
const TEMPLATES = join(DEPLOY, 'genesis', 'vm');
const PWSH = pwshCommand();
const MARKER = 'AAAAC3NzaC1lZDI1NTE5AAAAIMARKERONLY';
const KEY_LINE = `ssh-ed25519 ${MARKER} operator@test`;
const IMAGE_SHA = createHash('sha512').update('fake-image-bytes').digest('hex');
const FREE_40GB_KB = String(40 * 1024 * 1024);
const FREE_27GB_KB = String(27 * 1024 * 1024);

// Read-only stubs answer from env; mutating stubs only log their name. Non-advanced functions take any argument list.
const STUBS = `$ErrorActionPreference = 'Stop'
function Log-Change([string]$Name) { Add-Content -LiteralPath $env:GTVM_LOG -Value $Name }
function Get-VM { [CmdletBinding()] param($Name) if ($env:GTVM_EXISTS -eq '1') { [pscustomobject]@{ Name = $Name } } }
function Get-VMSwitch { [CmdletBinding()] param($Name) if ($env:GTVM_SWITCH -eq '1') { [pscustomobject]@{ Name = $Name } } }
function Get-VMHost { [pscustomobject]@{ LogicalProcessorCount = 32; VirtualMachinePath = $env:GTVM_VMDIR } }
function Get-CimInstance { [CmdletBinding()] param($ClassName)
  if ($ClassName -eq 'Win32_OperatingSystem') { [pscustomobject]@{ FreePhysicalMemory = [long]$env:GTVM_FREE_KB } }
  else { [pscustomobject]@{ TotalPhysicalMemory = [long]549755813888 } } }
function New-VM { Log-Change 'New-VM' }
function Set-VM { Log-Change 'Set-VM' }
function Set-VMProcessor { Log-Change 'Set-VMProcessor' }
function Set-VMMemory { Log-Change 'Set-VMMemory' }
function Set-VMFirmware { Log-Change 'Set-VMFirmware' }
function Add-VMHardDiskDrive { Log-Change 'Add-VMHardDiskDrive' }
function Add-VMDvdDrive { Log-Change 'Add-VMDvdDrive' }
function Start-VM { Log-Change 'Start-VM' }
function Stop-VM { Log-Change 'Stop-VM' }
function Remove-VM { Log-Change 'Remove-VM' }
function New-VHD { Log-Change 'New-VHD' }
function Resize-VHD { Log-Change 'Resize-VHD' }
function Invoke-WebRequest { Log-Change 'Invoke-WebRequest' }
function qemu-img { Log-Change 'qemu-img' }
function genisoimage { Log-Change 'genisoimage' }
function oscdimg { Log-Change 'oscdimg'; Set-Content -LiteralPath $args[-1] -Value 'iso' }
`;

type Run = { status: number | null; text: string; calls: string[] };
const dirs: string[] = [];

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'geldar-genesis-vm-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'deploy.pub'), `${KEY_LINE}\n`);
  writeFileSync(join(dir, 'image.qcow2'), 'fake-image-bytes');
  return dir;
}

function baseArgs(dir: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    VmName: 'Geldar-Test',
    Address: '192.0.2.10',
    Gateway: '192.0.2.1',
    Dns: '192.0.2.53',
    SshPublicKeyPath: join(dir, 'deploy.pub'),
    ImageUrl: 'https://example.invalid/debian-generic.qcow2',
    ImageSha512: IMAGE_SHA,
    ImagePath: join(dir, 'image.qcow2'),
    VmPath: dir,
    FingerprintAttempts: 0,
    ...extra,
  };
}

function run(dir: string, args: Record<string, unknown>, env: Record<string, string> = {}): Run {
  const log = join(dir, 'calls.log');
  const wrapper = join(dir, 'wrapper.ps1');
  writeFileSync(
    wrapper,
    `${STUBS}$p = ConvertFrom-Json -InputObject $env:GTVM_ARGS -AsHashtable\n& '${SCRIPT}' @p\n`,
  );
  const result = spawnSync(PWSH, ['-NoProfile', '-File', wrapper], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GTVM_ARGS: JSON.stringify(args),
      GTVM_LOG: log,
      GTVM_VMDIR: dir,
      GTVM_EXISTS: '0',
      GTVM_SWITCH: '1',
      GTVM_FREE_KB: FREE_40GB_KB,
      ...env,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  return { status: result.status, text: `${result.stdout}${result.stderr}`, calls };
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!toolAvailable(pwshProbe()))(
  'New-TestVm.ps1 dry run and refusals (stubbed Hyper-V)',
  () => {
    it('dry run prints every action, calls no mutating cmdlet and never prints the key', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir));
      expect(r.status).toBe(0);
      expect(r.calls).toEqual([]);
      expect(r.text).toContain('[dry-run] create VM Geldar-Test');
      expect(r.text).toContain('[dry-run] start Geldar-Test');
      expect(r.text).toContain('nothing was changed');
      expect(r.text).not.toContain(MARKER);
    });

    it('refuses an existing VM name without -Reuse and changes nothing', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir), { GTVM_EXISTS: '1' });
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('already exists');
      expect(r.calls).toEqual([]);
    });

    it('with -Reuse an existing VM is kept: exit 0, no change, no removal', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir, { Reuse: true }), { GTVM_EXISTS: '1' });
      expect(r.status).toBe(0);
      expect(r.text).toContain('no change');
      expect(r.calls).toEqual([]);
    });

    it('refuses a missing switch, in dry run and with -Apply, before any change', () => {
      const dir = fixture();
      const dry = run(dir, baseArgs(dir), { GTVM_SWITCH: '0' });
      expect(dry.status).not.toBe(0);
      expect(dry.text).toContain("switch 'Internet' does not exist");
      expect(dry.calls).toEqual([]);
      const applied = run(dir, baseArgs(dir, { Apply: true }), { GTVM_SWITCH: '0' });
      expect(applied.status).not.toBe(0);
      expect(applied.calls).toEqual([]);
    });

    it('refuses when free memory is below the request plus 4 GB', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir), { GTVM_FREE_KB: FREE_27GB_KB });
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('below the requested 24 GB plus 4 GB');
      expect(r.calls).toEqual([]);
    });

    it('refuses an image whose sha512 does not match, before any use', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir, { ImageSha512: 'a'.repeat(128), Apply: true }));
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('does not match -ImageSha512');
      expect(r.calls).toEqual([]);
    });

    it('refuses a sha512 that is not 128 hex characters', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir, { ImageSha512: 'abc' }));
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('128 hex characters');
      expect(r.calls).toEqual([]);
    });

    it('accepts an image whose sha512 matches', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir));
      expect(r.status).toBe(0);
      expect(r.text).toContain('matches -ImageSha512');
    });

    it('refuses to overwrite an existing OS disk file', () => {
      const dir = fixture();
      writeFileSync(join(dir, 'Geldar-Test-os.vhdx'), 'existing');
      const r = run(dir, baseArgs(dir, { Apply: true }));
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('already exists; refusing to overwrite');
      expect(r.calls).toEqual([]);
    });

    it('refuses a private key file and never echoes its text', () => {
      const dir = fixture();
      // Built at run time so no committed file holds the contiguous private-key marker.
      const privateKeyText = ['-----BEGIN', 'OPENSSH', 'PRIVATE', 'KEY-----\n'].join(' ');
      writeFileSync(join(dir, 'deploy.pub'), privateKeyText);
      const r = run(dir, baseArgs(dir));
      expect(r.status).not.toBe(0);
      expect(r.text).toContain('exactly one OpenSSH public key line');
      expect(r.text).not.toContain('PRIVATE KEY-----\n');
      expect(r.calls).toEqual([]);
    });

    it('with -Apply runs the Hyper-V steps in order, never removes a VM and never prints the key', () => {
      const dir = fixture();
      const r = run(dir, baseArgs(dir, { Apply: true }));
      expect(r.status).toBe(0);
      const at = (name: string) => r.calls.indexOf(name);
      for (const name of ['qemu-img', 'New-VM', 'Set-VMFirmware', 'Start-VM'])
        expect(at(name)).toBeGreaterThanOrEqual(0);
      expect(at('qemu-img')).toBeLessThan(at('New-VM'));
      expect(at('New-VM')).toBeLessThan(at('Set-VMFirmware'));
      expect(at('Set-VMFirmware')).toBeLessThan(at('Start-VM'));
      expect(r.calls).not.toContain('Remove-VM');
      expect(r.text).not.toContain(MARKER);
    });
  },
);

describe('cloud-init templates', () => {
  const names = ['user-data', 'meta-data', 'network-config'];

  it('exist and carry placeholders the script fills', () => {
    const user = readFileSync(join(TEMPLATES, 'user-data'), 'utf8');
    expect(user).toContain('@@SSH_PUBLIC_KEY@@');
    expect(user).toContain('@@HOSTNAME@@');
    const net = readFileSync(join(TEMPLATES, 'network-config'), 'utf8');
    for (const token of ['@@ADDRESS@@', '@@PREFIX@@', '@@GATEWAY@@', '@@DNS@@'])
      expect(net).toContain(token);
    expect(readFileSync(join(TEMPLATES, 'meta-data'), 'utf8')).toContain('@@INSTANCE_ID@@');
  });

  it('hold no key material and no IPv4 address', () => {
    expect(readdirSync(TEMPLATES).sort()).toEqual([...names].sort());
    for (const name of names) {
      const text = readFileSync(join(TEMPLATES, name), 'utf8');
      expect(text, name).not.toMatch(/ssh-(ed25519|rsa|ecdsa)/);
      expect(text, name).not.toMatch(/PRIVATE KEY/);
      expect(text, name).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(text, name).not.toContain('\r');
    }
  });
});
