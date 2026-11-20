import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCK = 'compose/neoforge/otel-agent.lock';
const OVERLAY = 'compose/nf-live-telemetry.yml';
const SHA_KEY = 'GELDAR_NF_OTEL_AGENT_SHA256';
const LOCK_KEYS = ['sha256', 'url', 'version'];

// The lock: key=value lines; '#' lines are comments. Only the first '=' splits a line.
const lockEntries = readFileSync(`${ROOT}${LOCK}`, 'utf8')
  .split('\n')
  .filter((line) => line !== '' && !line.startsWith('#'))
  .map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1)] as const;
  });
const lock = new Map(lockEntries);

// The compose overlay: the sha256 constant is an env value on the service that mounts the agent; the version is
// stated in the comment on the line above it ("The OpenTelemetry Java agent 2.33.1 pin").
const overlayText = readFileSync(`${ROOT}${OVERLAY}`, 'utf8');
const overlay = parse(overlayText) as {
  services: Record<string, { environment?: Record<string, string> }>;
};
const composeSha = Object.values(overlay.services)
  .map((svc) => svc.environment?.[SHA_KEY])
  .find((value) => value !== undefined);
const composeVersion = overlayText.match(/OpenTelemetry Java agent (\d+\.\d+\.\d+) pin/)?.[1];

describe('OTel agent lock (no docker needed)', () => {
  it('has exactly the three keys version, sha256 and url, each once', () => {
    expect(lockEntries.map(([key]) => key).sort()).toEqual(LOCK_KEYS);
    expect(lock.size).toBe(3);
  });

  it('has a 64-digit lowercase hex sha256', () => {
    expect(lock.get('sha256')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has the exact upstream GitHub release asset url for its version', () => {
    expect(lock.get('url')).toBe(
      `https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${lock.get('version')}/opentelemetry-javaagent.jar`,
    );
  });

  it('has a version in the form x.y.z', () => {
    expect(lock.get('version')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('equals the compose constant sha256 (GELDAR_NF_OTEL_AGENT_SHA256)', () => {
    expect(composeSha).toBeDefined();
    expect(lock.get('sha256')).toBe(composeSha);
  });

  it('equals the version stated in the compose overlay', () => {
    expect(composeVersion).toBeDefined();
    expect(lock.get('version')).toBe(composeVersion);
  });
});
