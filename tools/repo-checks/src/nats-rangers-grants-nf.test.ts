import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasPwsh, parseEntries, renderGenerator } from './nats-auth-fixtures.ts';

// The rangers' NATS grants on geldar-nf (deploy/nats-auth-nf.ps1: the mcp and ranger users), read from a generated conf and
// judged subject by subject. The ranger Bodies are the colo body set with s=nf: a ranger may never publish a kino, control,
// life, level, provenance or hearing subject. The MCP may publish the sovereign call and the body requests, not the hearing subject.

/** Whether a user's publish allow list admits a subject and its publish deny list does not (NATS wildcards: * and a final >). */
function publishAllowed(entry: { pub: string[]; deny: string[] } | undefined, subject: string) {
  if (!entry) return false;
  const match = (pattern: string) => {
    const p = pattern.split('.');
    const s = subject.split('.');
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '>') return i === p.length - 1 && s.length > i;
      if (i >= s.length) return false;
      if (p[i] !== '*' && p[i] !== s[i]) return false;
    }
    return p.length === s.length;
  };
  return entry.pub.some(match) && !entry.deny.some(match);
}

describe.skipIf(!hasPwsh)('NF NATS grants for the rangers and the MCP', () => {
  const users: Record<string, { user: string; pub: string[]; deny: string[]; sub: string[] }> = {};
  it('generates the two users from the nf generator', () => {
    const r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
    try {
      expect(r.status, r.stderr).toBe(0);
      const conf = readFileSync(join(r.dir, 'compose', 'secrets-nf', 'nats-auth.conf'), 'utf8');
      for (const e of parseEntries(conf)) users[e.user] = e;
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
    expect(Object.keys(users)).toEqual(expect.arrayContaining(['mcp', 'ranger']));
  }, 120_000);

  it('lets the MCP send the sovereign call, the body requests and the presence record, and denies the hearing subject', () => {
    expect(publishAllowed(users.mcp, 'geldar.nf.sovereign_call')).toBe(true);
    expect(publishAllowed(users.mcp, 'geldar.nf.body.ag_turbogreen_01.act')).toBe(true);
    expect(publishAllowed(users.mcp, '$KV.geldar-presence.ag_turbogreen_01')).toBe(true);
    expect(publishAllowed(users.mcp, 'geldar.nf.body.ag_turbogreen_01.hearing')).toBe(false);
    expect(publishAllowed(users.mcp, 'geldar.nf.life.ag_turbogreen_01.sheet')).toBe(false);
  });

  it('denies each ranger the kino, control, block-owner, helper, level, hearing, provenance and life subjects', () => {
    const forbidden = [
      'geldar.nf.kino.control',
      'geldar.nf.blockowner.changed',
      'geldar.nf.ctl.body.start',
      'geldar.nf.helper.body.start',
      'geldar.nf.state.ag_turbogreen_01.level',
      'geldar.nf.body.ag_turbogreen_01.hearing',
      'geldar.nf.provenance.ag_turbogreen_01',
      'geldar.nf.life.ag_turbogreen_01.sheet',
    ];
    for (const subject of forbidden) {
      expect(publishAllowed(users.ranger, subject), subject).toBe(false);
    }
  });

  it('lets each ranger write its skins and registry keys, not the presence record, and hear the body requests only', () => {
    expect(publishAllowed(users.ranger, '$KV.geldar-skins.ag_turbogreen_01')).toBe(true);
    expect(publishAllowed(users.ranger, '$KV.geldar-life-registry.ag_turbogreen_01')).toBe(true);
    expect(publishAllowed(users.ranger, '$KV.geldar-presence.ag_turbogreen_01')).toBe(false);
    expect(users.ranger?.sub).toContain('geldar.nf.body.>');
    expect(users.ranger?.sub).not.toContain('geldar.nf.>');
  });
});
