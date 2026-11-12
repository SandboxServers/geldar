// Agent skin images for the Kino viewer (decision 0140). The PNGs are not in the repo: they sit in a read-only node
// mount named by GELDAR_KINO_SKIN_DIR, one `<agent_id>.png` per agent. A request resolves only for a path of the exact
// form /kino/skins/<agent_id>.png, and (in wiring) only for an agent the viewer may watch.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The agent id as a file stem: lower case letters, digits, `_` and `-`; no dots, no separators. */
const AGENT_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const SKIN_PATH = /^\/kino\/skins\/([^/]+)\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A real skin is a few KB; anything larger is refused rather than served. */
export const MAX_SKIN_BYTES = 64 * 1024;

/** The agent id a /kino/skins/ path names, or undefined for any other path (traversal, encoding, a subpath). */
export function skinAgentId(path: string): string | undefined {
  const id = SKIN_PATH.exec(path)?.[1];
  return id !== undefined && AGENT_ID.test(id) ? id : undefined;
}

/** Reads `<dir>/<agent_id>.png`; undefined when the id is invalid, the file is missing, too big or not a PNG. */
export function readSkinPng(dir: string, agentId: string): Buffer | undefined {
  if (!AGENT_ID.test(agentId)) return undefined;
  try {
    const file = join(dir, `${agentId}.png`);
    const info = statSync(file);
    if (!info.isFile() || info.size > MAX_SKIN_BYTES) return undefined;
    const body = readFileSync(file);
    return body.subarray(0, 8).equals(PNG_SIGNATURE) ? body : undefined;
  } catch {
    return undefined;
  }
}
