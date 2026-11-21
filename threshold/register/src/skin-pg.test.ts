import { describe, expect, it } from 'vitest';
import { mountSkinRoutes } from './api/skins.ts';
import { skinRefusalCode, skinStoreOf } from './skin-pg.ts';

describe('mountSkinRoutes over the adapter', () => {
  it('mounts the two skin routes on the adapter and none on a store without the methods', () => {
    expect(mountSkinRoutes(skinStoreOf(fakeDb({ rows: [] })))).toHaveLength(2);
    expect(mountSkinRoutes({})).toHaveLength(0);
    expect(mountSkinRoutes({ submitSkin: async () => ({ ok: false, code: 'x' }) })).toHaveLength(0);
  });
});

const HASH = 'ab'.repeat(32);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SHA = Buffer.alloc(32, 1);

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function fakeDb(result: { rows: Record<string, unknown>[] } | Error) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('skinRefusalCode', () => {
  it('maps each 42501 refusal by its message', () => {
    expect(skinRefusalCode(pgError('42501', 'register_skin_submit: not an owner'))).toBe(
      'not_an_owner',
    );
    expect(skinRefusalCode(pgError('42501', 'register_skin_submit: not your agent'))).toBe(
      'not_your_agent',
    );
    expect(skinRefusalCode(pgError('42501', 'skin_upload_locked'))).toBe('skin_upload_locked');
  });

  it('maps the pending, wait and daily refusals by SQLSTATE and message', () => {
    expect(skinRefusalCode(pgError('23505', 'skin_upload_pending'))).toBe('skin_upload_pending');
    expect(skinRefusalCode(pgError('55000', 'skin_upload_wait'))).toBe('skin_upload_wait');
    expect(skinRefusalCode(pgError('53400', 'skin_upload_daily'))).toBe('skin_upload_daily');
  });

  it('returns null for a 42501 with an unknown message and for any other error', () => {
    expect(
      skinRefusalCode(pgError('42501', 'permission denied for table skin_uploads')),
    ).toBeNull();
    expect(skinRefusalCode(pgError('23505', 'duplicate key value'))).toBeNull();
    expect(skinRefusalCode(pgError('08006', 'connection lost'))).toBeNull();
    expect(skinRefusalCode(new Error('skin_upload_pending'))).toBeNull();
    expect(skinRefusalCode(null)).toBeNull();
  });
});

describe('skinStoreOf submitSkin', () => {
  it('passes the hex identity hash as bytes and returns the BIGINT id as a number', async () => {
    const db = fakeDb({ rows: [{ upload_id: '42' }] });
    const outcome = await skinStoreOf(db).submitSkin(HASH, 'player-1', PNG, SHA);
    expect(outcome).toEqual({ ok: true, uploadId: 42 });
    expect(db.calls[0]?.values[0]).toEqual(Buffer.from(HASH, 'hex'));
    expect(db.calls[0]?.values.slice(1)).toEqual(['player-1', PNG, SHA]);
  });

  it('returns the refusal code for a mapped error', async () => {
    const db = fakeDb(pgError('23505', 'skin_upload_pending'));
    expect(await skinStoreOf(db).submitSkin(HASH, 'p', PNG, SHA)).toEqual({
      ok: false,
      code: 'skin_upload_pending',
    });
  });

  it('rethrows an unknown error', async () => {
    const db = fakeDb(pgError('08006', 'connection lost'));
    await expect(skinStoreOf(db).submitSkin(HASH, 'p', PNG, SHA)).rejects.toThrow(
      'connection lost',
    );
  });

  it('fails closed when the function returns no id', async () => {
    const db = fakeDb({ rows: [{ upload_id: null }] });
    await expect(skinStoreOf(db).submitSkin(HASH, 'p', PNG, SHA)).rejects.toThrow('no id');
  });
});

describe('skinStoreOf skinStatus', () => {
  it('converts the newest row: id to number, timestamps to ISO, null decided kept', async () => {
    const created = new Date('2026-11-01T10:00:00.000Z');
    const db = fakeDb({
      rows: [
        {
          upload_id: '7',
          upload_status: 'pending',
          upload_reason: null,
          upload_created: created,
          upload_decided: null,
        },
      ],
    });
    expect(await skinStoreOf(db).skinStatus(HASH, 'p')).toEqual({
      ok: true,
      row: {
        uploadId: 7,
        status: 'pending',
        reason: null,
        createdAt: '2026-11-01T10:00:00.000Z',
        decidedAt: null,
      },
    });
  });

  it('converts a decided row with its reason and decided time', async () => {
    const db = fakeDb({
      rows: [
        {
          upload_id: '8',
          upload_status: 'rejected',
          upload_reason: 'not_a_skin',
          upload_created: new Date('2026-11-01T10:00:00.000Z'),
          upload_decided: new Date('2026-11-01T11:00:00.000Z'),
        },
      ],
    });
    const outcome = await skinStoreOf(db).skinStatus(HASH, 'p');
    expect(outcome).toEqual({
      ok: true,
      row: {
        uploadId: 8,
        status: 'rejected',
        reason: 'not_a_skin',
        createdAt: '2026-11-01T10:00:00.000Z',
        decidedAt: '2026-11-01T11:00:00.000Z',
      },
    });
  });

  it('returns a null row when the agent has no upload', async () => {
    const db = fakeDb({ rows: [] });
    expect(await skinStoreOf(db).skinStatus(HASH, 'p')).toEqual({ ok: true, row: null });
  });

  it('fails closed on a timestamp that is not a date', async () => {
    const db = fakeDb({
      rows: [
        {
          upload_id: '9',
          upload_status: 'pending',
          upload_reason: null,
          upload_created: '2026-11-01',
          upload_decided: null,
        },
      ],
    });
    await expect(skinStoreOf(db).skinStatus(HASH, 'p')).rejects.toThrow('not a date');
  });

  it('maps a refusal and rethrows an unknown error', async () => {
    const refused = fakeDb(pgError('42501', 'register_skin_status: not an owner'));
    expect(await skinStoreOf(refused).skinStatus(HASH, 'p')).toEqual({
      ok: false,
      code: 'not_an_owner',
    });
    const broken = fakeDb(pgError('08006', 'connection lost'));
    await expect(skinStoreOf(broken).skinStatus(HASH, 'p')).rejects.toThrow('connection lost');
  });
});
