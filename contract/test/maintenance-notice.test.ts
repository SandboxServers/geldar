import { describe, expect, it } from 'vitest';
import { validateMaintenanceNotice } from '../src/generated/validators.js';
import { maintenanceSubject } from '../src/subjects.ts';

const pause = { id: 'deploy-0001', kind: 'pause', scope: 'bodies', seconds: 60, reason: 'update' };

describe('maintenance-notice.schema.json', () => {
  it.each(['pause', 'restart', 'back'])('accepts kind %s', (kind) => {
    expect(validateMaintenanceNotice({ ...pause, kind })).toBe(true);
  });

  it.each(['bodies', 'world', 'mcp'])('accepts scope %s', (scope) => {
    expect(validateMaintenanceNotice({ ...pause, scope })).toBe(true);
  });

  it('accepts a notice with no countdown and no reason', () => {
    expect(validateMaintenanceNotice({ id: 'd-2', kind: 'back', scope: 'mcp' })).toBe(true);
  });

  it.each([0, 600])('accepts the countdown bound %i', (seconds) => {
    expect(validateMaintenanceNotice({ ...pause, seconds })).toBe(true);
  });

  it.each([
    ['a countdown above 600', { ...pause, seconds: 601 }],
    ['a negative countdown', { ...pause, seconds: -1 }],
    ['a fractional countdown', { ...pause, seconds: 1.5 }],
    ['an unknown kind', { ...pause, kind: 'kill' }],
    ['an unknown scope', { ...pause, scope: 'everything' }],
    ['an unknown reason', { ...pause, reason: 'because I said so' }],
    ['free text in an extra field', { ...pause, message: 'deploying now' }],
    ['a missing id', { kind: 'pause', scope: 'bodies' }],
    ['an id with a space', { ...pause, id: 'deploy 1' }],
  ])('refuses %s', (_name, value) => {
    expect(validateMaintenanceNotice(value)).toBe(false);
  });
});

describe('maintenanceSubject', () => {
  it('is geldar.<shard>.maintenance', () => {
    expect(maintenanceSubject('colo-main')).toBe('geldar.colo-main.maintenance');
  });

  it.each(['', 'a.b', 'a*', 'a>', 'A', 'x y'])('refuses the shard %j', (shard) => {
    expect(() => maintenanceSubject(shard)).toThrow();
  });
});
