import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root, three levels above this file (tools/mcp-tokens/src). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The directory of secret files; git ignores it (spec 6.7: secrets are files, never in git). */
export const SECRET_DIR = join(REPO_ROOT, 'compose', 'secrets');

/** HMAC key for token hashes. Losing it, or re-creating it, invalidates every token. */
export const PEPPER_FILE = 'mcp-token-pepper.txt';

/** The password of the geldar_mcp Postgres role, read by the MCP's database client. */
export const PASSWORD_FILE = 'postgres-mcp.txt';

/** The least pepper the tool accepts; a shorter file is refused, not used. */
export const MIN_PEPPER_BYTES = 32;

export type SecretAction = 'created' | 'kept' | 'replaced';

export interface SecretReport {
  file: string;
  action: SecretAction;
}

type RandomBytes = (size: number) => Buffer;

/** Runs `icacls` with these arguments. The default runs the real program. */
export type AclRunner = (args: readonly string[]) => Promise<void>;

/** Where the owner-only step looks: the platform, the account and the runner. Tests inject them. */
export interface AclOptions {
  platform?: NodeJS.Platform;
  user?: string | undefined;
  run?: AclRunner;
  warn?: (line: string) => void;
}

const runIcacls: AclRunner = (args) =>
  new Promise((done, failed) => {
    execFile('icacls', [...args], { windowsHide: true }, (error) =>
      error ? failed(error) : done(),
    );
  });

/**
 * On Windows the 0o600 mode is not enforced, so a secret file or directory gets the owner's access
 * only: inheritance off, the current account with full control. Best effort: a failure is warned
 * about, names the path and nothing from inside the file, and never fails the command.
 */
export async function restrictToOwner(path: string, options: AclOptions = {}): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') return;
  const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
  const user = options.user ?? process.env.USERNAME;
  if (user === undefined || user === '') {
    warn(`warning: USERNAME is not set; ${path} keeps its default permissions`);
    return;
  }
  try {
    await (options.run ?? runIcacls)([path, '/inheritance:r', '/grant:r', `${user}:F`]);
  } catch {
    warn(`warning: icacls could not restrict ${path}; check its permissions by hand`);
  }
}

/**
 * Writes a file only the current user can read. On Windows the mode is not enforced by the
 * filesystem, so the owner-only ACL is applied instead.
 */
export async function writeOwnerOnly(
  path: string,
  content: string,
  flag: 'w' | 'wx',
  acl?: AclOptions,
): Promise<void> {
  await writeFile(path, content, { mode: 0o600, flag });
  if (process.platform !== 'win32') await chmod(path, 0o600);
  await restrictToOwner(path, acl);
}

/**
 * Creates the pepper and the Postgres password files when they are missing. With `force`, both are
 * re-created; that invalidates every token, so the caller must also pass the explicit confirmation.
 */
export async function initSecretFiles(
  dir: string,
  options: { force: boolean; random?: RandomBytes; acl?: AclOptions },
): Promise<SecretReport[]> {
  const random = options.random ?? randomBytes;
  await mkdir(dir, { recursive: true });
  await restrictToOwner(dir, options.acl);
  const reports: SecretReport[] = [];
  for (const file of [PEPPER_FILE, PASSWORD_FILE]) {
    const path = join(dir, file);
    const exists = await pathExists(path);
    if (exists && !options.force) {
      reports.push({ file, action: 'kept' });
      continue;
    }
    await writeOwnerOnly(path, `${random(32).toString('hex')}\n`, 'w', options.acl);
    reports.push({ file, action: exists ? 'replaced' : 'created' });
  }
  return reports;
}

/** The pepper as text, without its trailing newline. Refuses a file too short to be a key. */
export async function readPepper(dir: string): Promise<string> {
  const text = (await readFile(join(dir, PEPPER_FILE), 'utf8')).replace(/\r?\n$/, '');
  if (Buffer.byteLength(text, 'utf8') < MIN_PEPPER_BYTES) {
    throw new Error(`${PEPPER_FILE} is missing or too short; run init first`);
  }
  return text;
}

/** True when `target` is `repoRoot` or lies beneath it, on any drive. */
export function isInsideRepo(target: string, repoRoot: string = REPO_ROOT): boolean {
  const rel = relative(resolve(repoRoot), resolve(target));
  return rel === '' || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
