import { readFileSync } from 'node:fs';
import Ajv2020Module from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { validateLakituAudit, validateLakituFeed } from '../src/generated/validators.js';

const Ajv2020 = Ajv2020Module.default;
const feedSchemaUrl = new URL('../schemas/lakitu-feed.schema.json', import.meta.url);
const auditSchemaUrl = new URL('../schemas/lakitu-audit.schema.json', import.meta.url);

const PANE_ID = 'pn_01HZX3V9Q4M2K8R7T6Y5W4E3D2';
const SESSION_ID = 'ls_01HZX3V9Q4M2K8R7T6Y5W4E3D1';
const LOGIN_HASH = 'a'.repeat(64);

/** 4096 palette indices, 2 bytes each: 8192 bytes, base64 is 10924 characters with one '='. */
const INDICES = Buffer.alloc(8192).toString('base64');

const section = {
  world: 'world',
  section_x: 0,
  section_y: 4,
  section_z: -1,
  palette: ['minecraft:air', 'minecraft:stone'],
  indices: INDICES,
  loaded: true,
};

const update = { tick: 1200, world: 'world', x: 3, y: 70, z: -9, state: 'minecraft:stone' };

const position = {
  agent_id: 'ag_kestrel_01',
  x: 10.5,
  y: 64,
  z: -2.25,
  yaw: 90,
  pitch: -15,
  on_ground: true,
};

const pane = {
  pane_id: PANE_ID,
  session_id: SESSION_ID,
  target_agent_id: 'ag_kestrel_01',
  mode: 'orbit',
  radius_chunks: 2,
};

/** A valid frame with one section, one update and one position. */
const frame = {
  feed_version: 1,
  feed_tick: 1200,
  pane,
  sections: [section],
  updates: [update],
  positions: [position],
};

const audit = {
  event: 'pane_opened',
  login_hash: LOGIN_HASH,
  agent_id: 'ag_kestrel_01',
  pane_id: PANE_ID,
  mode: 'follow',
  at: '2026-11-11T12:00:00Z',
};

describe('lakitu feed frame', () => {
  it('passes a valid frame with one section, one update and one position', () => {
    expect(validateLakituFeed(frame)).toBe(true);
  });

  it('passes an empty frame with no sections, updates or positions', () => {
    expect(validateLakituFeed({ ...frame, sections: [], updates: [], positions: [] })).toBe(true);
  });

  it.each(['token', 'player_name', 'ip'])('fails an extra top-level key %s', (key) => {
    expect(validateLakituFeed({ ...frame, [key]: 'x' })).toBe(false);
  });

  it.each(['token', 'player_name', 'ip'])('fails an extra pane key %s', (key) => {
    expect(validateLakituFeed({ ...frame, pane: { ...pane, [key]: 'x' } })).toBe(false);
  });

  it('fails a pane with mode fly', () => {
    expect(validateLakituFeed({ ...frame, pane: { ...pane, mode: 'fly' } })).toBe(false);
  });

  it('accepts each of the three pane modes', () => {
    for (const mode of ['follow', 'orbit', 'free']) {
      expect(validateLakituFeed({ ...frame, pane: { ...pane, mode } })).toBe(true);
    }
  });

  it('fails a radius above the proposed maximum of 4 chunks', () => {
    expect(validateLakituFeed({ ...frame, pane: { ...pane, radius_chunks: 5 } })).toBe(false);
  });

  it('fails a feed_version other than 1', () => {
    expect(validateLakituFeed({ ...frame, feed_version: 2 })).toBe(false);
  });

  it('fails a section that is not loaded', () => {
    expect(validateLakituFeed({ ...frame, sections: [{ ...section, loaded: false }] })).toBe(false);
  });

  it('fails a section whose indices are not exactly 8192 bytes of base64', () => {
    const short = Buffer.alloc(8190).toString('base64');
    expect(validateLakituFeed({ ...frame, sections: [{ ...section, indices: short }] })).toBe(
      false,
    );
  });

  it('fails a palette entry that is not a block state name', () => {
    expect(
      validateLakituFeed({ ...frame, sections: [{ ...section, palette: ['stone texture.png'] }] }),
    ).toBe(false);
  });

  it('fails a frame with more sections than the proposed cap of 256', () => {
    const sections = Array.from({ length: 257 }, () => section);
    expect(validateLakituFeed({ ...frame, sections })).toBe(false);
  });

  it('fails a frame with more updates than the proposed cap of 512', () => {
    const updates = Array.from({ length: 513 }, () => update);
    expect(validateLakituFeed({ ...frame, updates })).toBe(false);
  });

  it('fails a position with an extra key', () => {
    expect(validateLakituFeed({ ...frame, positions: [{ ...position, uuid: 'x' }] })).toBe(false);
  });

  it('fails a pane id that is not a pn_ ULID', () => {
    expect(validateLakituFeed({ ...frame, pane: { ...pane, pane_id: 'pane-1' } })).toBe(false);
  });

  it('keeps the error codes to the four named shapes', () => {
    const ajv = new Ajv2020({ strict: true });
    const feedSchema = JSON.parse(readFileSync(feedSchemaUrl, 'utf8'));
    ajv.addSchema(feedSchema);
    const check = ajv.getSchema(`${feedSchema.$id}#/$defs/LakituErrorCode`);
    expect(check).toBeDefined();
    for (const code of [
      'pane_cap_reached',
      'target_not_permitted',
      'feed_unavailable',
      'feed_overloaded',
    ]) {
      expect(check?.(code)).toBe(true);
    }
    expect(check?.('token_expired')).toBe(false);
  });
});

describe('lakitu audit event', () => {
  it('passes a valid pane_opened event', () => {
    expect(validateLakituAudit(audit)).toBe(true);
  });

  it('fails an audit event without login_hash', () => {
    const { login_hash: _dropped, ...rest } = audit;
    expect(validateLakituAudit(rest)).toBe(false);
  });

  it('fails an audit event with login_name', () => {
    expect(validateLakituAudit({ ...audit, login_name: 'someone' })).toBe(false);
  });

  it('fails an audit event with a token, secret, address or account name', () => {
    for (const key of ['token', 'secret', 'address', 'ip', 'account_name']) {
      expect(validateLakituAudit({ ...audit, [key]: 'x' })).toBe(false);
    }
  });

  it('fails a login_hash that is not 64 lowercase hex characters', () => {
    expect(validateLakituAudit({ ...audit, login_hash: 'A'.repeat(64) })).toBe(false);
    expect(validateLakituAudit({ ...audit, login_hash: 'a'.repeat(63) })).toBe(false);
  });

  it('fails an unknown event name', () => {
    expect(validateLakituAudit({ ...audit, event: 'pane_flown' })).toBe(false);
  });

  it('fails a mode that is not follow, orbit or free', () => {
    expect(validateLakituAudit({ ...audit, mode: 'fly' })).toBe(false);
  });

  it('passes pane_closed with stopped_at', () => {
    expect(
      validateLakituAudit({ ...audit, event: 'pane_closed', stopped_at: '2026-11-11T12:05:00Z' }),
    ).toBe(true);
  });

  it('fails stopped_at on any event other than pane_closed', () => {
    expect(validateLakituAudit({ ...audit, stopped_at: '2026-11-11T12:05:00Z' })).toBe(false);
    expect(
      validateLakituAudit({
        ...audit,
        event: 'pane_targeted',
        stopped_at: '2026-11-11T12:05:00Z',
      }),
    ).toBe(false);
  });

  it('fails a timestamp that is not RFC 3339', () => {
    expect(validateLakituAudit({ ...audit, at: 'yesterday' })).toBe(false);
  });

  it('declares no field for a token, secret, address or account name in the schema', () => {
    const schema = JSON.parse(readFileSync(auditSchemaUrl, 'utf8'));
    const names = Object.keys(schema.properties);
    for (const forbidden of ['token', 'secret', 'address', 'ip', 'login_name', 'account_name']) {
      expect(names).not.toContain(forbidden);
    }
    expect(schema.additionalProperties).toBe(false);
  });
});
