import { describe, expect, it } from 'vitest';
import { CTL_BODY_OPS, ctlBodySubject, ctlBodyWildcard } from '../src/subjects.ts';

describe('ctl.body subjects', () => {
  it('build the five-token control subject for each op', () => {
    expect(ctlBodySubject('phase0', 'status')).toBe('geldar.phase0.ctl.body.status');
    for (const op of CTL_BODY_OPS) {
      expect(ctlBodySubject('phase0', op)).toBe(`geldar.phase0.ctl.body.${op}`);
      expect(ctlBodySubject('phase0', op).split('.')).toHaveLength(5);
    }
  });

  it('lists exactly the five control ops', () => {
    expect([...CTL_BODY_OPS]).toEqual(['start', 'stop', 'restart', 'status', 'logtail']);
  });

  it('throws on a shard with a dot, a wildcard, a space or an empty name', () => {
    for (const shard of ['ph.ase0', '*', '>', 'phase 0', '']) {
      expect(() => ctlBodySubject(shard, 'start')).toThrow();
      expect(() => ctlBodyWildcard(shard)).toThrow();
    }
  });

  it('throws on an op outside the list: ctl, the wildcard, a dotted op, a case change, empty', () => {
    for (const op of ['ctl', '>', '*', 'start.x', 'START', '']) {
      expect(() => ctlBodySubject('phase0', op)).toThrow();
    }
  });

  it('builds the supervisor wildcard that covers every op', () => {
    expect(ctlBodyWildcard('phase0')).toBe('geldar.phase0.ctl.body.>');
  });
});
