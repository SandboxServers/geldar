/**
 * Helpers for the Wave M live cases (WM-12). Nothing here runs unless a case's gate is on (gate.ts).
 * Tokens are read from files outside the repo and never printed. Operator steps (RCON, the chatter bot)
 * are commands the operator puts in env, so no host or secret lives in the repo.
 */
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const TEST_PLAYER = 'ag-test-01';
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** The MCP base URL from GELDAR_MCP_URL (loopback by default). */
export function mcpBase(): string {
  return process.env.GELDAR_MCP_URL ?? 'http://127.0.0.1:8788';
}

/** Reads a token file named by env. The value is returned to the caller and never logged. */
export function readTokenFile(envName: string): string {
  const file = process.env[envName];
  if (file === undefined || file.trim() === '') {
    throw new Error(`${envName} is not set: point it at a token file outside the repo`);
  }
  return readFileSync(file, 'utf8').trim();
}

/** Connects an MCP client to one player's endpoint with that player's bearer token. */
export async function connectAs(playerId: string, token: string): Promise<Client> {
  const client = new Client({ name: 'geldar-live-case', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpBase()}/p/${playerId}`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

/** Runs `./geldar.ps1 <args>` from the repo root and returns stdout. Throws on a non-zero exit. */
export function geldar(...args: string[]): string {
  return execFileSync('pwsh', ['-NoProfile', '-File', join(REPO_ROOT, 'geldar.ps1'), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

/** Runs the operator command held in env (RCON, the chatter step). Throws when the env is unset. */
export function operatorStep(envName: string): void {
  const command = process.env[envName];
  if (command === undefined || command.trim() === '') {
    throw new Error(`${envName} is not set: give the operator command for this step`);
  }
  execSync(command, { stdio: 'ignore' });
}

/** A run id that is unique per run, for names the case creates and removes at its end. */
export function runId(): string {
  return `${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 36 ** 2).toString(36)}`;
}

/** The text a tool returned as structured content, or an empty object. */
export function structuredOf(result: unknown): Record<string, unknown> {
  const structured = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
  return structured ?? {};
}
