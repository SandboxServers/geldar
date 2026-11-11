import { describe, expect, it } from 'vitest';
import { signKinoSession } from '../test/kino-fixture.ts';
import { KINO_COOKIE } from './kino-cookie.ts';
import type { SqlClient } from './query.ts';
import { resolveViewer } from './session.ts';

const KEY = 'k'.repeat(40);
const HASH = 'ab'.repeat(32);
const NOW = 1_000_000;

function db(admins: string[], cams: string[]): SqlClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push(text);
      if (text.includes('public_camera')) return { rows: cams.map((agent_id) => ({ agent_id })) };
      return { rows: admins.includes(String(values[0])) ? [{ ok: 1 }] : [] };
    },
  };
}
const cookie = (v: string) => `other=1; ${KINO_COOKIE}=${v}`;
const good = signKinoSession(KEY, { identityHash: HASH, expiresAt: NOW + 1000 });

describe('resolveViewer', () => {
  it('resolves identity and the admin flag from a valid cookie', async () => {
    expect(await resolveViewer(db([HASH], ['ag-a']), KEY, cookie(good), NOW)).toEqual({
      signedIn: true,
      admin: true,
      publicCameras: ['ag-a'],
    });
    expect(await resolveViewer(db([], []), KEY, cookie(good), NOW)).toEqual({
      signedIn: true,
      admin: false,
      publicCameras: [],
    });
  });

  it('treats a missing, forged, wrong-key, malformed or expired cookie as signed out and never asks about admins', async () => {
    const bad = [
      undefined,
      cookie('garbage'),
      cookie(`${good}x`),
      cookie(signKinoSession('z'.repeat(40), { identityHash: HASH, expiresAt: NOW + 1000 })),
      cookie(signKinoSession(KEY, { identityHash: HASH, expiresAt: NOW })),
    ];
    for (const header of bad) {
      const d = db([HASH], ['ag-a']);
      expect(await resolveViewer(d, KEY, header, NOW)).toEqual({
        signedIn: false,
        admin: false,
        publicCameras: ['ag-a'],
      });
      expect(d.calls.some((t) => t.includes('kino_admins'))).toBe(false);
    }
  });

  it('is signed out for everyone when no key is configured', async () => {
    expect((await resolveViewer(db([HASH], []), undefined, cookie(good), NOW)).signedIn).toBe(
      false,
    );
  });
});
