import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// The server's reader (the container-ports readSecret), its pepper rule and its digest.
import { containerPorts } from '../../../threshold/mcp/src/cli.ts';
import { tokenDigest } from '../../../threshold/mcp/src/http/auth.ts';
import { pepperBytes } from '../../../threshold/mcp/src/main.ts';
import { hashToken, mintToken } from '../../../threshold/mcp/src/store/token-hash.ts';
import { initSecretFiles, PEPPER_FILE, readPepper, writeOwnerOnly } from './secret-files.ts';

const KEY = '0123456789abcdef0123456789abcdef'; // exactly 32 bytes
const ACL = { platform: 'linux' as const };

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/**
 * A secrets directory whose pepper file the CLI wrote: the init path when `text` is null, else the
 * CLI's owner-only writer with `text` as the file's exact bytes.
 */
async function secretsWith(text: string | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-tokens-cross-'));
  dirs.push(dir);
  if (text === null) await initSecretFiles(dir, { force: false, acl: ACL });
  else await writeOwnerOnly(join(dir, PEPPER_FILE), text, 'w', ACL);
  return dir;
}

/** The server's key: the pepper file read through the container-ports reader, then pepperBytes. */
async function serverPepper(dir: string): Promise<Buffer> {
  return pepperBytes(await containerPorts('phase0').readSecret(join(dir, PEPPER_FILE)));
}

// Cross-implementation: the CLI mints and hashes, the server verifies, over the same file bytes.
// The pepper rule lives in two places (readPepper, pepperBytes); these tests hold them to one rule.
describe('a pepper the CLI wrote, digested by the CLI and checked by the server', () => {
  it.each([
    ['the init file', null],
    ['CRLF endings', `${KEY}\r\n`],
    ['a trailing space', `${KEY} \n`],
  ])('agrees on the digest of a minted token for %s', async (_label, text) => {
    const dir = await secretsWith(text);
    const token = mintToken();
    const cli = hashToken(await readPepper(dir), token);
    const server = tokenDigest(await serverPepper(dir), token);
    expect(server.equals(cli)).toBe(true);
  });

  it('strips one CRLF to the same key as a plain file', async () => {
    const dir = await secretsWith(`${KEY}\r\n`);
    const token = mintToken();
    expect(tokenDigest(await serverPepper(dir), token).equals(hashToken(KEY, token))).toBe(true);
  });

  it('keeps a trailing space in the key in both implementations', async () => {
    const dir = await secretsWith(`${KEY} \n`);
    const token = mintToken();
    expect(await readPepper(dir)).toBe(`${KEY} `);
    expect((await serverPepper(dir)).toString('utf8')).toBe(`${KEY} `);
    expect(tokenDigest(await serverPepper(dir), token).equals(hashToken(`${KEY} `, token))).toBe(
      true,
    );
  });

  it('refuses a 31-byte pepper in both implementations', async () => {
    const dir = await secretsWith(`${KEY.slice(0, 31)}\n`);
    await expect(readPepper(dir)).rejects.toThrow('too short');
    await expect(serverPepper(dir)).rejects.toThrow('shorter than 32 bytes');
  });

  it('refuses a byte-order mark in both implementations', async () => {
    const dir = await secretsWith(`﻿${KEY}\n`);
    await expect(readPepper(dir)).rejects.toThrow('byte-order mark');
    await expect(serverPepper(dir)).rejects.toThrow('byte-order mark');
  });
});
