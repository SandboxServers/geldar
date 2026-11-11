/**
 * Live test of the opt-in NATS accounts overlay (compose/nats-auth.yml, decision 0067; cutover gate
 * in decision 0080; live rules and subject table in decision 0087). It starts a throwaway
 * nats-server from the digest the overlay uses, on a random loopback port, with a generated config
 * and generated passwords, then speaks the NATS wire protocol over TCP. Every role connects, is
 * refused outside its subjects, a revoked user is refused after a reload, and one shard cannot
 * publish or subscribe on another shard's subjects. Skipped unless GELDAR_IT=1. The container and
 * the temporary directory are removed in afterAll.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const enabled = process.env.GELDAR_IT === '1';

// The digest the overlay's base file (compose/phase0.yml) uses for nats.
const IMAGE = 'nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde';
const SHARDS = ['alpha', 'bravo'] as const;
const ROLES = ['body', 'mind', 'eventsink', 'mcp', 'velocity', 'paper'] as const;
type Role = (typeof ROLES)[number];
type Allow = { pub: string[]; sub: string[] };

const JS = ['$JS.API.>', '$JS.ACK.>', '_INBOX.>'];
const kv = (bucket: string) => `$KV.${bucket}.>`;
const MIND_TYPES = ['wake', 'intent', 'action', 'plan_result', 'reflex_fired', 'speech', 'damage', 'death', 'sleep'];

/** The per-role allow lists for one shard (decision 0087). Every subject starts with the shard, or is a KV bucket or inbox. */
function roleAllows(shard: string): Record<Role, Allow> {
  const s = shard;
  return {
    body: { pub: [`geldar.${s}.>`, ...JS, kv('geldar-life-registry'), kv('geldar-checkpoints'), kv('geldar-body-generation')],
      sub: [`geldar.${s}.body.>`, '_INBOX.>'] },
    mind: { pub: [...MIND_TYPES.map((t) => `geldar.${s}.${t}`), ...JS, `geldar.${s}.body.>`], sub: ['_INBOX.>'] },
    eventsink: { pub: [`geldar.${s}.dlq`, ...JS], sub: ['_INBOX.>'] },
    mcp: { pub: [`geldar.${s}.sovereign_call`, `geldar.${s}.body.>`, kv('geldar-presence'), ...JS], sub: ['_INBOX.>'] },
    velocity: { pub: [kv('geldar-life-registry'), kv('geldar-skins'), ...JS], sub: ['_INBOX.>'] },
    paper: { pub: [`geldar.${s}.>`, ...JS], sub: ['_INBOX.>'] },
  };
}

interface User { name: string; password: string; allow: Allow }

/** Renders the server config the overlay mounts at /etc/nats/nats-auth.conf (one account, JetStream on). */
function renderConfig(users: User[]): string {
  const entries = users.map((u) => {
    const pub = u.allow.pub.map((p) => `"${p}"`).join(', ');
    const sub = u.allow.sub.map((p) => `"${p}"`).join(', ');
    // allow_responses belongs inside permissions: nats-server 2.15 rejects it on the user block.
    return `      { user: "${u.name}", password: "${u.password}", permissions: { publish: { allow: [${pub}] }, subscribe: { allow: [${sub}] }, allow_responses: true } }`;
  });
  return ['port: 4222', 'jetstream { store_dir: "/data" }', 'accounts {', '  GELDAR {', '    jetstream: enabled', '    users = [',
    entries.join(',\n'), '    ]', '  }', '}', ''].join('\n');
}

/** Every user of both test shards, named `<shard>-<role>`, with a fresh random password. */
function makeUsers(): User[] {
  return SHARDS.flatMap((shard) => {
    const allows = roleAllows(shard);
    return ROLES.map((role) => ({ name: `${shard}-${role}`, password: randomBytes(24).toString('base64url'), allow: allows[role] }));
  });
}

/** Replaces each wildcard token with a concrete sample token, so an allowed pattern can be tested. */
function concrete(subject: string): string {
  return subject.split('.').map((t) => (t === '>' ? 'x' : t)).join('.');
}

/** Opens a NATS connection as `user`, sends `ops`, then PING. Returns the reply to each line, in order. */
function converse(port: number, user: string, pass: string, ops: string[]): Promise<{ connected: boolean; replies: string[] }> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    const replies: string[] = [];
    let buf = '';
    let sentOps = false;
    sock.setTimeout(5000, () => sock.destroy());
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i = buf.indexOf('\r\n');
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (line.startsWith('INFO') && !sentOps) {
          sentOps = true;
          const connectLine = JSON.stringify({ verbose: true, pedantic: false, protocol: 1, user, pass });
          sock.write(`CONNECT ${connectLine}\r\n${ops.join('')}PING\r\n`);
        } else if (line === 'PONG') {
          sock.destroy();
          return resolve({ connected: replies[0] === '+OK', replies: replies.slice() });
        } else if (line.startsWith('+OK') || line.startsWith('-ERR')) {
          replies.push(line);
        }
        i = buf.indexOf('\r\n');
      }
    });
    sock.on('error', () => undefined);
    sock.on('close', () => resolve({ connected: replies[0] === '+OK', replies }));
  });
}

const pub = (subject: string) => `PUB ${subject} 0\r\n\r\n`;
const sub = (subject: string) => `SUB ${subject} 1\r\n`;

describe.skipIf(!enabled)('the NATS accounts overlay against a live nats-server', () => {
  const name = `geldar-nats-auth-${randomBytes(4).toString('hex')}`;
  let dir = '';
  let port = 0;
  let users: User[] = [];

  const userOf = (n: string) => {
    const u = users.find((x) => x.name === n);
    if (!u) throw new Error(`no test user ${n}`);
    return u;
  };
  const as = (n: string, ops: string[]) => {
    const u = userOf(n);
    return converse(port, u.name, u.password, ops);
  };

  async function writeConfig(list: User[]) {
    await writeFile(join(dir, 'nats-auth.conf'), renderConfig(list), { encoding: 'utf8', mode: 0o600 });
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'geldar-nats-auth-'));
    users = makeUsers();
    await writeConfig(users);
    await run('docker', ['run', '-d', '--name', name, '-p', '127.0.0.1::4222', '-v', `${dir}:/etc/geldar-nats:ro`,
      IMAGE, '-c', '/etc/geldar-nats/nats-auth.conf']);
    const { stdout } = await run('docker', ['port', name, '4222']);
    port = Number(/:(\d+)\s*$/m.exec(stdout)?.[1]);
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await as('alpha-velocity', [])).connected) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('nats-server did not accept a connection');
  }, 90_000);

  afterAll(async () => {
    await run('docker', ['rm', '-f', name]).catch(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('one role connects with its password file and is refused a wrong password', async () => {
    const ok = await as('alpha-body', []);
    expect(ok.connected).toBe(true);
    const bad = await converse(port, 'alpha-body', 'not-the-password', []);
    expect(bad.connected).toBe(false);
  }, 30_000);

  it('every role connects, is allowed its subjects, and is refused outside them', async () => {
    for (const role of ROLES) {
      const n = `alpha-${role}`;
      const allows = userOf(n).allow;
      const ops = [...allows.pub.map((p) => pub(concrete(p))), ...allows.sub.map((p) => sub(concrete(p))),
        pub('refused.alpha.not.allowed'), sub('refused.alpha.not.allowed')];
      const { connected, replies } = await as(n, ops);
      expect(connected, n).toBe(true);
      const allowedReplies = replies.slice(1, 1 + allows.pub.length + allows.sub.length);
      expect(allowedReplies.every((r) => r === '+OK'), `${n} allowed subjects`).toBe(true);
      expect(replies[replies.length - 2], `${n} publish outside`).toContain('Permissions Violation for Publish');
      expect(replies[replies.length - 1], `${n} subscribe outside`).toContain('Permissions Violation for Subscription');
    }
  }, 30_000);

  it('shard isolation: a shard A user cannot publish or subscribe on shard B subjects', async () => {
    const other = 'geldar.bravo.body.ag_test_01.snapshot';
    const { replies } = await as('alpha-body', [pub(other), sub(other)]);
    // replies[0] is the CONNECT reply; the publish and the subscribe follow it.
    expect(replies[1]).toContain('Permissions Violation for Publish');
    expect(replies[2]).toContain('Permissions Violation for Subscription');
    const control = await as('bravo-body', [pub(other)]);
    expect(control.replies[1]).toBe('+OK');
  }, 30_000);

  it('revoked user refused after reload; the other users still connect', async () => {
    const revoked = userOf('alpha-mind');
    await writeConfig(users.filter((u) => u.name !== revoked.name));
    await run('docker', ['kill', '-s', 'HUP', name]);
    let refused = false;
    for (let attempt = 0; attempt < 50 && !refused; attempt++) {
      refused = !(await converse(port, revoked.name, revoked.password, [])).connected;
      if (!refused) await new Promise((r) => setTimeout(r, 200));
    }
    expect(refused, 'revoked alpha-mind is refused on its next connection').toBe(true);
    expect((await as('alpha-velocity', [])).connected).toBe(true);
  }, 30_000);
});

describe('the generated subject table', () => {
  it('no bare wildcard subject: no token of any allow list is a single-token "*"', () => {
    const bare = SHARDS.flatMap((shard) => Object.values(roleAllows(shard)).flatMap((a) => [...a.pub, ...a.sub]))
      .filter((s) => s.split('.').includes('*'));
    expect(bare).toEqual([]);
  });

  it('the rendered config quotes no subject with a bare "*" token', () => {
    const text = renderConfig(makeUsers());
    expect(text).not.toMatch(/"(?:[^"\s]*\.)?\*(?:\.[^"\s]*)?"/);
  });
});
