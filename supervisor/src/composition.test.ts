import { describe, expect, it } from 'vitest';
import { buildSupervisorDeps } from './composition.ts';
import type { AuditLostInfo, BodyRuntimePort } from './ports.ts';

const runtime: BodyRuntimePort = {
  inspect: async () => null,
  start: async () => undefined,
  stop: async () => undefined,
};

describe('composition root', () => {
  it('sets onAuditLost, and forwards a lost audit to the injected log with the fixed fields only', () => {
    const lost: AuditLostInfo[] = [];
    const deps = buildSupervisorDeps({
      query: async () => ({ rows: [] }),
      runtime,
      log: (info) => lost.push(info),
    });
    expect(deps.onAuditLost).toBeTypeOf('function');
    deps.onAuditLost?.({ action: 'body_start', code: 'audit_lost' });
    expect(lost).toEqual([{ action: 'body_start', code: 'audit_lost' }]);
  });

  it('wires the runtime it was given and a clock', () => {
    const deps = buildSupervisorDeps({
      query: async () => ({ rows: [] }),
      runtime,
      log: () => undefined,
    });
    expect(deps.runtime).toBe(runtime);
    expect(deps.now()).toBeInstanceOf(Date);
  });
});
