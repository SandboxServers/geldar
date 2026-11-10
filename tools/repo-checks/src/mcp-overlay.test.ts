import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PASSWORD_FILE, PEPPER_FILE } from '../../mcp-tokens/src/secret-files.ts';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';

const path = 'compose/mcp.yml';
const text = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', path),
  'utf8',
);

describe('compose/mcp.yml', () => {
  it('is a compose file the loopback-ports check reads', () => {
    expect(isComposeFile(path)).toBe(true);
  });

  it('passes the loopback-ports check (every published port is on 127.0.0.1)', () => {
    expect(findPublicPorts(path, text)).toEqual([]);
  });
});

describe('compose/mcp.yml secrets match the files mcp-tokens init writes', () => {
  const overlay = parse(text) as {
    services: Record<string, { environment: Record<string, string>; secrets: string[] }>;
    secrets: Record<string, { file: string }>;
  };
  const mcp = overlay.services['geldar-mcp'];
  const written = [PASSWORD_FILE, PEPPER_FILE].sort();

  it('declares exactly the file secrets that mcp-tokens init writes, each under its own name', () => {
    expect(Object.keys(overlay.secrets).sort()).toEqual(written);
    for (const [name, secret] of Object.entries(overlay.secrets)) {
      expect(secret.file, name).toBe(`./secrets/${name}`);
    }
  });

  it('mounts both secrets into the MCP service', () => {
    expect([...(mcp?.secrets ?? [])].sort()).toEqual(written);
  });

  it('points the MCP env at the mounted paths under /run/secrets', () => {
    expect(mcp?.environment.GELDAR_MCP_DB_PASSWORD_FILE).toBe(`/run/secrets/${PASSWORD_FILE}`);
    expect(mcp?.environment.GELDAR_MCP_PEPPER_FILE).toBe(`/run/secrets/${PEPPER_FILE}`);
  });
});
