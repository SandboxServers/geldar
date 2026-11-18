/**
 * The one human-lane exception in the loopback rule (loopback-ports.ts, HUMAN_OVERLAY_PORT). The exception is exact:
 * the velocity-human service in compose/nf-live-human.yml, with exactly NF_HUMAN_BIND and NF_HUMAN_PORT and their loopback
 * defaults. Every near miss below must still be rejected. No container is started; the texts are inline.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findPublicPorts, HUMAN_OVERLAY_PATH } from './loopback-ports.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REAL = readFileSync(`${ROOT}${HUMAN_OVERLAY_PATH}`, 'utf8');

/** A minimal overlay with one velocity-human publish set to `entry`. */
function humanFile(entry: string, service = 'velocity-human'): string {
  return `services:\n  ${service}:\n    ports:\n      - ${entry}\n`;
}

describe('the human-lane exception is exactly one publish', () => {
  it('passes the real overlay file', () => {
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, REAL)).toEqual([]);
  });

  it('passes the exact exception string on velocity-human', () => {
    const entry = '${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(`"${entry}"`))).toEqual([]);
  });

  it('rejects the same publish on another service in the human file', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565"';
    const found = findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry, 'velocity'));
    expect(found.map((f) => f.service)).toEqual(['velocity']);
  });

  it('rejects the same publish in the live file (no exception outside its path)', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565"';
    const found = findPublicPorts('compose/nf-live.yml', humanFile(entry));
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects the same publish in any other compose file', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565"';
    expect(
      findPublicPorts('compose/nf-live-telemetry.yml', humanFile(entry)).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a literal 0.0.0.0 publish on velocity-human', () => {
    const found = findPublicPorts(HUMAN_OVERLAY_PATH, humanFile('"0.0.0.0:46566:25565"'));
    expect(found.length).toBeGreaterThan(0);
  });

  it('rejects a wildcard default of 0.0.0.0 on the bind variable', () => {
    const entry = '"${NF_HUMAN_BIND:-0.0.0.0}:${NF_HUMAN_PORT:-46566}:25565"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });

  it('rejects an empty default that would bind every interface', () => {
    const entry = '"${NF_HUMAN_BIND:-}:${NF_HUMAN_PORT:-46566}:25565"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });

  it('rejects a different variable name for the bind', () => {
    const entry = '"${GELDAR_MC_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });

  it('rejects a different variable name for the port', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT_X:-46566}:25565"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });

  it('rejects a changed default port (25565 is never allowed)', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-25565}:25565"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });

  it('rejects the exception with a suffix added', () => {
    const entry = '"${NF_HUMAN_BIND:-127.0.0.1}:${NF_HUMAN_PORT:-46566}:25565/tcp"';
    expect(findPublicPorts(HUMAN_OVERLAY_PATH, humanFile(entry)).length).toBeGreaterThan(0);
  });
});
