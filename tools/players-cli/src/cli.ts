#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type FetchFn,
  type SignedTexture,
  SigningError,
  uploadSkin,
  type Visibility,
  validateTexture,
} from './mineskin.ts';
import { MAX_SKIN_BYTES, SkinFileError, validateSkinPng } from './png.ts';
import { checkSkinPath, findPlayer, RosterError } from './roster.ts';
import { buildRoster, encodeRoster, writeRosterExport } from './roster-export.ts';
import { checkExportTarget, ExportError, writeSkinExport } from './skin-export.ts';
import { writeHeads } from './skin-heads.ts';
import { describeSkin, openSkinBucket, putSkin, type SkinKv } from './skin-store.ts';

/** GELDAR_SHARD_FILE when set (the Colo admin image sets it to the Colo roster), else the phase0 shard config. */
export function shardFilePath(env: NodeJS.ProcessEnv): string {
  const set = env.GELDAR_SHARD_FILE?.trim();
  return set ? set : join(REPO_ROOT, 'shards', 'phase0.yaml');
}

/** The repo root, three levels above this file (tools/players-cli/src). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The shard config that names the sovereign players and their life ids. */
export const SHARD_FILE = shardFilePath(process.env);
/** The MineSkin API key: a git-ignored secret file, read here and never printed. */
export const KEY_FILE = join(REPO_ROOT, 'compose', 'secrets', 'mineskin.txt');

export const USAGE = `usage: players-cli skin set <player-id> <png> [--model classic|slim] [--check-only]
                             [--visibility unlisted|public] [--confirm-public]
                             [--export-json <path>] [--no-store]

  skin set    validate the PNG (64x64 or 64x32, no extra chunks), sign it with MineSkin and store the
              signed texture in the geldar-skins bucket under the player's life id (needs GELDAR_NATS_URL)
  skin show   print the stored skin of a player (variant, texture host, signature length; never the value)
  skin heads  skin heads --skins-dir <dir> --out-dir <dir> [--map overworld]: write BlueMap player head
              PNGs (maps/<map>/assets/playerheads/<offline uuid>.png) from <agent_id>.png skin files
  skin import <player-id> <json>: store the signed texture from a ranger-skins.json file (no upload)
  --check-only       validate the PNG and print the result; nothing is uploaded and no network call runs
  --model            classic (default) or slim (the thin arms)
  --visibility       unlisted (default) or public; the owner approves unlisted uploads only
  --confirm-public   required with --visibility public, so a public listing is never by accident
  --export-json      also write the signed record as ranger-skins.json (mode 0600) to a new file outside the repo
  --no-store         do not write the bucket; needs --export-json, then \`skin import\` on the node stores it
  roster export --out <path>: write every sovereign player as a flat {"<name>": "<life_id>"} JSON object (mode 0600,
              at most 16 KiB) to a new file outside the repo. Operator-only: no agent or Body reads the file.
`;

/** `skin heads --skins-dir <dir> --out-dir <dir> [--map overworld]`: BlueMap player heads from skin files. */
function runHeads(args: readonly string[], deps: CliDeps): number {
  const opt = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const skinsDir = opt('--skins-dir');
  const outDir = opt('--out-dir');
  if (skinsDir === undefined || outDir === undefined) {
    deps.out(USAGE);
    return 2;
  }
  try {
    for (const line of writeHeads(skinsDir, outDir, opt('--map') ?? 'overworld')) deps.out(line);
    return 0;
  } catch (error) {
    deps.out(`error: ${error instanceof Error ? error.message : 'could not write the heads'}`);
    return 1;
  }
}

/** `roster export --out <path>`: the operator's flat name-to-life roster, written atomically to a new file. */
async function runRosterExport(args: readonly string[], deps: CliDeps): Promise<number> {
  const out = args.length === 2 && args[0] === '--out' ? args[1] : undefined;
  if (out === undefined) {
    deps.out(USAGE);
    return 2;
  }
  try {
    const target = await checkExportTarget(out, deps.repoRoot);
    const roster = buildRoster(await deps.readShard());
    const body = encodeRoster(roster);
    await writeRosterExport(target, body);
    deps.out(
      `ok: exported ${Object.keys(roster).length} sovereign players to ${target} (${Buffer.byteLength(body)} bytes)`,
    );
    return 0;
  } catch (error) {
    deps.out(`error: ${error instanceof Error ? error.message : 'could not export the roster'}`);
    return 1;
  }
}

/** Everything the command touches, so a test can pass fakes for each. */
export interface CliDeps {
  readShard: () => Promise<string>;
  readSkin: (path: string) => Promise<Buffer>;
  /** Reads a ranger-skins.json file (keyed by player id). Optional so older fakes still type-check. */
  readJson?: ((path: string) => Promise<string>) | undefined;
  readKey: () => Promise<string>;
  upload: (
    png: Buffer,
    model: 'classic' | 'slim',
    apiKey: string,
    visibility: Visibility,
  ) => ReturnType<typeof uploadSkin>;
  openBucket: (natsUrl: string) => Promise<{ kv: SkinKv; close: () => Promise<void> }>;
  natsUrl: () => string | undefined;
  now: () => Date;
  repoRoot: string;
  out: (line: string) => void;
}

/** Runs one command and returns the exit code. Output lines never include a key, a request or a texture value. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [group, verb, player, file, ...rest] = argv;
  if (group === 'skin' && verb === 'heads') return runHeads(argv.slice(2), deps);
  if (group === 'roster' && verb === 'export') return runRosterExport(argv.slice(2), deps);
  if (
    group === 'skin' &&
    verb === 'import' &&
    player !== undefined &&
    file !== undefined &&
    rest.length === 0
  ) {
    return runImport(player, file, deps);
  }
  if (group === 'skin' && verb === 'show' && player !== undefined && file === undefined) {
    return runShow(player, deps);
  }
  if (group !== 'skin' || verb !== 'set' || player === undefined || file === undefined) {
    deps.out(USAGE);
    return 2;
  }
  return runSet(player, file, rest, deps);
}

/**
 * `skin set`: checks the flags and the export target before anything is read, validates the PNG, signs it (not with
 * --check-only), stores it unless --no-store, and writes the JSON export when asked. Nothing is spent on a refusal.
 */
async function runSet(
  player: string,
  file: string,
  rest: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const flags = parseFlags(rest);
  if (flags === null) {
    deps.out(USAGE);
    return 2;
  }
  try {
    const visibility = checkFlags(flags);
    const exportPath =
      flags.exportJson === undefined
        ? undefined
        : await checkExportTarget(flags.exportJson, deps.repoRoot);
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
    let texture: SignedTexture;
    if (flags.noStore) {
      texture = await deps.upload(png, flags.model, await deps.readKey(), visibility);
    } else {
      // NATS first: an unset URL or an unopenable bucket must not spend a MineSkin generation.
      const url = deps.natsUrl();
      if (url === undefined || url.trim() === '') {
        throw new RosterError('GELDAR_NATS_URL is not set; nothing was uploaded or stored');
      }
      const { kv, close } = await deps.openBucket(url);
      try {
        texture = await deps.upload(png, flags.model, await deps.readKey(), visibility);
        await putSkin(kv, roster.lifeId, texture, deps.now());
      } finally {
        await close();
      }
    }
    if (exportPath !== undefined) {
      const bytes = await writeSkinExport(exportPath, roster.playerId, texture);
      deps.out(
        `exported the signed skin record for ${roster.playerId} to ${exportPath} (${bytes} bytes)`,
      );
    }
    deps.out(
      flags.noStore
        ? `signed the ${texture.model} skin for ${roster.playerId} (life ${roster.lifeId}); not stored (--no-store)`
        : `stored the ${texture.model} skin for ${roster.playerId} (life ${roster.lifeId}) in geldar-skins`,
    );
    return 0;
  } catch (error) {
    deps.out(`error: ${errorMessage(error)}`);
    return 1;
  }
}

/**
 * Stores signed textures from a ranger-skins.json file (player id to {value, signature, model}) under the player's
 * life id. The file lives outside the repo; every texture is re-validated, and nothing is uploaded.
 */
async function runImport(player: string, file: string, deps: CliDeps): Promise<number> {
  try {
    const roster = findPlayer(await deps.readShard(), player);
    if (deps.readJson === undefined) {
      throw new RosterError('this build cannot read a skins file');
    }
    const all = JSON.parse(await deps.readJson(file)) as Record<
      string,
      { value?: unknown; signature?: unknown; model?: unknown } | undefined
    >;
    const entry = all[roster.playerId];
    if (typeof entry?.value !== 'string' || typeof entry.signature !== 'string') {
      throw new RosterError(`the skins file has no signed texture for ${roster.playerId}`);
    }
    const model = entry.model === 'slim' ? 'slim' : 'classic';
    const texture = validateTexture(entry.value, entry.signature, model);
    const url = deps.natsUrl();
    if (url === undefined || url.trim() === '') {
      throw new RosterError('GELDAR_NATS_URL is not set; nothing was stored');
    }
    const { kv, close } = await deps.openBucket(url);
    try {
      await putSkin(kv, roster.lifeId, texture, deps.now());
    } finally {
      await close();
    }
    deps.out(
      `imported the ${model} skin for ${roster.playerId} (life ${roster.lifeId}) into geldar-skins`,
    );
    return 0;
  } catch (error) {
    deps.out(
      error instanceof SyntaxError
        ? 'error: the skins file is not JSON'
        : `error: ${errorMessage(error)}`,
    );
    return 1;
  }
}

/** Prints what the bucket holds for a player's life: variant, texture host, signature length. Never the value. */
async function runShow(player: string, deps: CliDeps): Promise<number> {
  try {
    const roster = findPlayer(await deps.readShard(), player);
    const url = deps.natsUrl();
    if (url === undefined || url.trim() === '') {
      throw new RosterError('GELDAR_NATS_URL is not set');
    }
    const { kv, close } = await deps.openBucket(url);
    try {
      deps.out(await describeSkin(kv, roster.lifeId));
    } finally {
      await close();
    }
    return 0;
  } catch (error) {
    deps.out(`error: ${errorMessage(error)}`);
    return 1;
  }
}

/** The `skin set` flags as typed; checkFlags decides which combinations and values are allowed. */
interface SetFlags {
  model: 'classic' | 'slim';
  checkOnly: boolean;
  visibility: string;
  confirmPublic: boolean;
  exportJson: string | undefined;
  noStore: boolean;
}

/** Parses the `skin set` flags; null for an unknown flag or a flag missing its value. Values are checked later. */
function parseFlags(args: readonly string[]): SetFlags | null {
  const flags: SetFlags = {
    model: 'classic',
    checkOnly: false,
    visibility: 'unlisted',
    confirmPublic: false,
    exportJson: undefined,
    noStore: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--check-only') {
      flags.checkOnly = true;
    } else if (arg === '--confirm-public') {
      flags.confirmPublic = true;
    } else if (arg === '--no-store') {
      flags.noStore = true;
    } else if (arg === '--model' && (value === 'classic' || value === 'slim')) {
      flags.model = value;
      i++;
    } else if (arg === '--visibility' && value !== undefined) {
      flags.visibility = value;
      i++;
    } else if (arg === '--export-json' && value !== undefined) {
      flags.exportJson = value;
      i++;
    } else {
      return null;
    }
  }
  return flags;
}

/**
 * The flag rules, before any read or network call: the visibility is unlisted or public; public needs
 * --confirm-public (and --confirm-public needs public); --no-store needs --export-json, or the signed skin is lost.
 */
function checkFlags(flags: SetFlags): Visibility {
  const { visibility } = flags;
  if (visibility !== 'unlisted' && visibility !== 'public') {
    throw new FlagError('--visibility must be unlisted or public; nothing was uploaded');
  }
  if (visibility === 'public' && !flags.confirmPublic) {
    throw new FlagError('--visibility public needs --confirm-public; nothing was uploaded');
  }
  if (flags.confirmPublic && visibility !== 'public') {
    throw new FlagError(
      '--confirm-public only goes with --visibility public; nothing was uploaded',
    );
  }
  if (flags.noStore && flags.exportJson === undefined) {
    throw new FlagError(
      '--no-store needs --export-json, or the signed skin would be lost; nothing was uploaded',
    );
  }
  return visibility;
}

/** A flag combination this tool refuses on purpose. */
class FlagError extends Error {}

/** Only the errors this tool raises on purpose carry a message; anything else gets a fixed one. */
function errorMessage(error: unknown): string {
  if (
    error instanceof SkinFileError ||
    error instanceof SigningError ||
    error instanceof RosterError ||
    error instanceof FlagError ||
    error instanceof ExportError
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
    readJson: (path) => readFile(path, 'utf8'),
    readKey: async () => {
      const key = (await readFile(KEY_FILE, 'utf8').catch(() => '')).trim();
      if (key === '') {
        throw new RosterError(
          'compose/secrets/mineskin.txt is missing or empty (the MineSkin key, git-ignored)',
        );
      }
      return key;
    },
    upload: (png, model, apiKey, visibility) =>
      uploadSkin({ png, model, apiKey, visibility, fetchFn }),
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
