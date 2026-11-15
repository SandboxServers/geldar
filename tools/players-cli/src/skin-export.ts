import { stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { SignedTexture } from './mineskin.ts';

/** A refused export path or a failed write. The message is fixed; it never names the value or the signature. */
export class ExportError extends Error {}

/**
 * Checks the export target before any upload is spent: the path must sit outside the repo root and must not exist
 * yet. Returns the resolved absolute path.
 */
export async function checkExportTarget(file: string, repoRoot: string): Promise<string> {
  const absolute = resolve(file);
  const rel = relative(repoRoot, absolute);
  const outsideRepo = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (!outsideRepo) {
    throw new ExportError('the export file must be outside the repo; nothing was uploaded');
  }
  const exists = await stat(absolute).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new ExportError(
      'the export file already exists; choose a new path; nothing was uploaded',
    );
  }
  return absolute;
}

/** The signed record in the runbook's ranger-skins.json format: {"<player-id>": {mineskin_uuid, value, signature, model}}. */
export function skinExportJson(playerId: string, texture: SignedTexture): string {
  const record = {
    [playerId]: {
      mineskin_uuid: texture.mineskinUuid ?? '',
      value: texture.value,
      signature: texture.signature,
      model: texture.model,
    },
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * Writes the record to a new file (flag wx: an existing file is never overwritten), mode 0600 where the platform
 * honours the mode. Returns the byte count; the record itself is never returned or printed by the caller.
 */
export async function writeSkinExport(
  absolutePath: string,
  playerId: string,
  texture: SignedTexture,
): Promise<number> {
  const body = skinExportJson(playerId, texture);
  try {
    await writeFile(absolutePath, body, { flag: 'wx', mode: 0o600 });
  } catch {
    throw new ExportError(
      'the export file could not be written; it may have appeared since the check',
    );
  }
  return Buffer.byteLength(body);
}
