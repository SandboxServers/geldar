#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type FetchFn, SigningError, uploadSkin } from './mineskin.ts';
import { MAX_SKIN_BYTES, SkinFileError, validateSkinPng } from './png.ts';
import { checkSkinPath, findPlayer, RosterError } from './roster.ts';
import { openSkinBucket, putSkin, type SkinKv } from './skin-store.ts';

/** The repo root, three levels above this file (tools/players-cli/src). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The shard config that names the sovereign players and their life ids. */
export const SHARD_FILE = join(REPO_ROOT, 'shards', 'phase0.yaml');
/** The MineSkin API key: a git-ignored secret file, read here and never printed. */
export const KEY_FILE = join(REPO_ROOT, 'compose', 'secrets', 'mineskin.txt');

export const USAGE = `usage: players-cli skin set <player-id> <png> [--model classic|slim] [--check-only]

  skin set    validate the PNG (64x64 or 64x32, no extra chunks), sign it with MineSkin and store the
              signed texture in the geldar-skins bucket under the player's life id (needs GELDAR_NATS_URL)
  --check-only  validate the PNG and print the result; nothing is uploaded and no network call runs
  --model       classic (default) or slim (the thin arms)
`;

/** Everything the command touches, so a test can pass fakes for each. */
export interface CliDeps {
  readShard: () => Promise<string>;
  readSkin: (path: string) => Promise<Buffer>;
  readKey: () => Promise<string>;
  upload: (png: Buffer, model: 'classic' | 'slim', apiKey: string) => ReturnType<typeof uploadSkin>;
  openBucket: (natsUrl: string) => Promise<{ kv: SkinKv; close: () => Promise<void> }>;
  natsUrl: () => string | undefined;
  now: () => Date;
  repoRoot: string;
  out: (line: string) => void;
}

/** Runs one command and returns the exit code. Output lines never include a key, a request or a texture value. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [group, verb, player, file, ...rest] = argv;
  if (group !== 'skin' || verb !== 'set' || player === undefined || file === undefined) {
    deps.out(USAGE);
    return 2;
  }
  const flags = parseFlags(rest);
  if (flags === null) {
    deps.out(USAGE);
    return 2;
  }
  try {
    const roster = findPlayer(await deps.readShard(), player);
    const path = checkSkinPath(file, deps.repoRoot);
    const png = await deps.readSkin(path);
    const dims = validateSkinPng(png);
    if (flags.checkOnly) {
      deps.out(
        `ok: ${dims.width}x${dims.height} skin for ${roster.playerId} (life ${roster.lifeId}); not uploaded`,
      );
      return 0;
    }
    const texture = await deps.upload(png, flags.model, await deps.readKey());
    const url = deps.natsUrl();
    if (url === undefined || url.trim() === '') {
      throw new RosterError('GELDAR_NATS_URL is not set; the skin was signed but not stored');
    }
    const { kv, close } = await deps.openBucket(url);
    try {
      await putSkin(kv, roster.lifeId, texture, deps.now());
    } finally {
      await close();
    }
    deps.out(
      `stored the ${texture.model} skin for ${roster.playerId} (life ${roster.lifeId}) in geldar-skins`,
    );
    return 0;
  } catch (error) {
    deps.out(`error: ${errorMessage(error)}`);
    return 1;
  }
}

/** Parses `--model` and `--check-only`; null for anything else. */
function parseFlags(
  args: readonly string[],
): { model: 'classic' | 'slim'; checkOnly: boolean } | null {
  let model: 'classic' | 'slim' = 'classic';
  let checkOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check-only') {
      checkOnly = true;
    } else if (arg === '--model' && (args[i + 1] === 'classic' || args[i + 1] === 'slim')) {
      model = args[i + 1] as 'classic' | 'slim';
      i++;
    } else {
      return null;
    }
  }
  return { model, checkOnly };
}

/** Only the errors this tool raises on purpose carry a message; anything else gets a fixed one. */
function errorMessage(error: unknown): string {
  if (
    error instanceof SkinFileError ||
    error instanceof SigningError ||
    error instanceof RosterError
  ) {
    return error.message;
  }
  return 'the command failed; see the README for the steps';
}

/** Reads a skin file after a size check, so a huge file is refused without being read. */
async function readSkinFile(path: string): Promise<Buffer> {
  const info = await stat(path).catch(() => null);
  if (info === null || !info.isFile()) {
    throw new SkinFileError('the skin file does not exist');
  }
  if (info.size > MAX_SKIN_BYTES) {
    throw new SkinFileError(`the skin file is larger than ${MAX_SKIN_BYTES} bytes`);
  }
  return readFile(path);
}

/** The production wiring: real files, the real signing service (through `fetchFn`), real NATS. */
export function productionDeps(fetchFn?: FetchFn): CliDeps {
  return {
    readShard: () => readFile(SHARD_FILE, 'utf8'),
    readSkin: readSkinFile,
    readKey: async () => {
      const key = (await readFile(KEY_FILE, 'utf8').catch(() => '')).trim();
      if (key === '') {
        throw new RosterError(
          'compose/secrets/mineskin.txt is missing or empty (the MineSkin key, git-ignored)',
        );
      }
      return key;
    },
    upload: (png, model, apiKey) => uploadSkin({ png, model, apiKey, fetchFn }),
    openBucket: openSkinBucket,
    natsUrl: () => process.env.GELDAR_NATS_URL,
    now: () => new Date(),
    repoRoot: REPO_ROOT,
    out: (line) => console.log(line),
  };
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli(process.argv.slice(2), productionDeps()).then((code) => {
    process.exitCode = code;
  });
}
