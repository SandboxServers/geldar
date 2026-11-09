import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { repoRoot } from '../config.ts';
import { stackVersions } from '../versions.ts';
import { sleep as wallSleep } from '../world-clock.ts';

/** What a result file records about the run, apart from the cells. */
export interface RunMeta {
  /** UTC date, `YYYY-MM-DD`. */
  date: string;
  /** UTC time stamp used in the file name, `YYYYMMDDTHHmmssZ`. */
  stamp: string;
  /** Short commit, with `+dirty` when the tree has changes. */
  commit: string;
  minecraft: string;
  paperBuild: string;
  mineflayer: string;
  pathfinder: string;
  host: {
    platform: string;
    release: string;
    cpu: string;
    cores: number;
    totalMem: number;
    node: string;
  };
}

/** Injectable parts of `collectMeta`. */
export interface MetaDeps {
  /** Runs `git <args>` in the repository root and returns stdout. */
  git?: (args: string[]) => string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

const VERSION_PATTERN = /Paper version ([0-9.]+)-([0-9]+)/;
/** The server answers `version` with a placeholder first; the real line arrives a moment later. */
const VERSION_TRIES = 4;

/** Minecraft version and Paper build from a `version` reply, or `unknown` for both. */
export function parseVersionReply(reply: string): { minecraft: string; paperBuild: string } {
  const match = VERSION_PATTERN.exec(reply);
  if (!match) return { minecraft: 'unknown', paperBuild: 'unknown' };
  return { minecraft: match[1] as string, paperBuild: match[2] as string };
}

/** `YYYYMMDDTHHmmssZ` for a date, without colons (NTFS rejects them). */
export function timeStamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d+Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** The short commit, with `+dirty` when `git status --porcelain` is not empty. */
export function commitLabel(git: (args: string[]) => string): string {
  const commit = git(['rev-parse', '--short', 'HEAD']).trim();
  const dirty = git(['status', '--porcelain']).trim() !== '';
  return dirty ? `${commit}+dirty` : commit;
}

/** True when the working tree has uncommitted changes. */
export function isDirty(git: (args: string[]) => string): boolean {
  return git(['status', '--porcelain']).trim() !== '';
}

/** Runs git in the repository root. */
export function runGit(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot(), encoding: 'utf8' });
}

/** Collects the run meta from git, the server's `version` reply, the stack versions and the host. */
export async function collectMeta(
  ctl: { version(): Promise<string> },
  deps: MetaDeps = {},
): Promise<RunMeta> {
  const git = deps.git ?? runGit;
  const sleep = deps.sleep ?? wallSleep;
  const when = (deps.now ?? (() => new Date()))();
  let reply = '';
  for (let i = 0; i < VERSION_TRIES; i++) {
    reply = await ctl.version();
    if (VERSION_PATTERN.test(reply)) break;
    await sleep(500);
  }
  const server = parseVersionReply(reply);
  const versions = stackVersions();
  return {
    date: when.toISOString().slice(0, 10),
    stamp: timeStamp(when),
    commit: commitLabel(git),
    ...server,
    mineflayer: versions.mineflayer,
    pathfinder: versions.mineflayerPathfinder,
    host: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? 'unknown',
      cores: os.cpus().length,
      totalMem: os.totalmem(),
      node: process.version,
    },
  };
}
