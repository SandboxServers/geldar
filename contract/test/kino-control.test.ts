import { describe, expect, it } from 'vitest';
import { validateKinoControl } from '../src/generated/validators.js';

const start = { control_version: 1, type: 'start', target_agent_id: 'kestrel_01' };

describe('kino-control.schema.json', () => {
  it.each(['start', 'resync', 'refresh', 'stop'])('accepts %s', (type) => {
    expect(validateKinoControl({ ...start, type })).toBe(true);
  });

  it.each([
    ['an unknown type', { ...start, type: 'kill' }],
    ['a wrong version', { ...start, control_version: 2 }],
    ['a missing agent', { control_version: 1, type: 'start' }],
    ['an agent that is not one subject token', { ...start, target_agent_id: 'a.b' }],
    ['an upper-case agent', { ...start, target_agent_id: 'Kestrel' }],
    ['an extra key (no world input, no coordinates)', { ...start, x: 1 }],
    ['an extra command key', { ...start, command: 'say hi' }],
  ])('rejects %s', (_name, msg) => {
    expect(validateKinoControl(msg)).toBe(false);
  });
});
