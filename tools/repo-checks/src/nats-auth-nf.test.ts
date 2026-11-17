import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  hasPwsh,
  parseEntries,
  type Rendered,
  ROOT,
  renderGenerator,
} from './nats-auth-fixtures.ts';

/** The users and files the nf set must have, in the generator's order (geldar.ps1 is not involved: deploy/nats-auth-nf.ps1). */
const NF_USERS = ['neoforge', 'sink', 'deploy', 'velocity', 'seed'];
const NF_FILES = ['nats-auth.conf', ...NF_USERS.map((u) => `nats-${u}.txt`)].sort();
/** Declared by nf-live.yml and not written by this generator: postgres (a later packet) and the forwarding secret. */
const NOT_NATS_SECRETS = ['postgres.txt', 'velocity-forwarding.txt'];
const STREAMS = ['GELDAR_EVENTS', 'GELDAR_EVENTS_NF'];
const BUCKETS = ['geldar-life-registry', 'geldar-skins'];
const NF_LIVE = readFileSync(join(ROOT, 'compose', 'nf-live.yml'), 'utf8');

const streamApi = (s: string): string[] => [
  `$JS.API.STREAM.INFO.${s}`,
  `$JS.API.STREAM.CREATE.${s}`,
];
const sinkApi = (s: string): string[] => [
  ...streamApi(s),
  `$JS.API.CONSUMER.CREATE.${s}.eventsink`,
  `$JS.API.CONSUMER.DURABLE.CREATE.${s}.eventsink`,
  `$JS.API.CONSUMER.INFO.${s}.eventsink`,
  `$JS.API.CONSUMER.MSG.NEXT.${s}.eventsink`,
  `$JS.ACK.${s}.eventsink.>`,
];
const velocityApi = (b: string): string[] => [
  `$JS.API.STREAM.INFO.KV_${b}`,
  `$JS.API.CONSUMER.CREATE.KV_${b}`,
  `$JS.API.CONSUMER.CREATE.KV_${b}.>`,
  `$JS.API.CONSUMER.INFO.KV_${b}.>`,
  `$JS.API.CONSUMER.DELETE.KV_${b}.>`,
];
const seedApi = (b: string): string[] => [
  `$JS.API.STREAM.CREATE.KV_${b}`,
  `$JS.API.STREAM.INFO.KV_${b}`,
  `$JS.API.STREAM.UPDATE.KV_${b}`,
];

/** The exact allow and deny lists, restated here so a changed generator fails. */
const EXPECTED: Record<string, { pub: string[]; deny: string[]; sub: string[] }> = {
  neoforge: {
    pub: ['geldar.nf.*', ...STREAMS.flatMap(streamApi), '_INBOX.>'],
    deny: ['geldar.nf.maintenance'],
    sub: ['geldar.nf.maintenance', '_INBOX.>'],
  },
  sink: {
    pub: ['geldar.nf.dlq', 'geldar.nf.state.>', ...STREAMS.flatMap(sinkApi), '_INBOX.>'],
    deny: [],
    sub: ['geldar.nf.state.*.proficiency', '_INBOX.>'],
  },
  deploy: { pub: ['geldar.nf.maintenance'], deny: [], sub: ['_INBOX.>'] },
  velocity: {
    pub: [...BUCKETS.flatMap(velocityApi), '$JS.FC.>', '_INBOX.>'],
    deny: [],
    sub: ['_INBOX.>'],
  },
  seed: {
    pub: ['$JS.API.INFO', ...BUCKETS.flatMap(seedApi), '_INBOX.>'],
    deny: [],
    sub: ['_INBOX.>'],
  },
};

/** Whether a subject is one this shard's NATS may carry (geldar.nf.*, its two streams, its two buckets, the inbox). */
function inScope(subject: string): boolean {
  if (subject.startsWith('geldar.nf.')) return true;
  if (subject === '_INBOX.>' || subject === '$JS.FC.>' || subject === '$JS.API.INFO') return true;
  if (subject.startsWith('$JS.API.') || subject.startsWith('$JS.ACK.')) {
    const names = [...STREAMS, ...BUCKETS.map((b) => `KV_${b}`)];
    return names.some((n) => subject.includes(`.${n}`));
  }
  return false;
}

describe.skipIf(!hasPwsh)('NF NATS auth set: refusals write nothing', () => {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  const cases: [string, string[], boolean, RegExp][] = [
    ['no flag', [], false, /--live/],
    ['--local without --live', ['--local'], false, /--live/],
    ['a git checkout without --local', ['--live'], true, /git checkout/],
    ['an unknown flag', ['--live', '--force'], false, /unknown flag/],
  ];
  it.each(cases)('refuses %s and writes nothing', (_name, flags, checkout, message) => {
    const r = renderGenerator('nf', { flags, checkout });
    made.push(r.dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(message);
    expect(existsSync(join(r.dir, 'compose', 'secrets-nf'))).toBe(false);
    expect(existsSync(join(r.dir, 'compose', 'secrets'))).toBe(false);
  });
});

describe.skipIf(!hasPwsh)(
  'NF NATS auth set: the generator in a temp checkout (--live --local)',
  () => {
    let r: Rendered;
    const dirOf = () => join(r.dir, 'compose', 'secrets-nf');
    const conf = () => readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8');
    beforeAll(() => {
      r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
    }, 120_000);
    afterAll(() => {
      if (r) rmSync(r.dir, { recursive: true, force: true });
    });

    it('runs and writes exactly the nf files', () => {
      expect(r.status, r.stderr).toBe(0);
      expect(readdirSync(dirOf()).sort()).toEqual(NF_FILES);
    });

    it('writes exactly the expected users, in order, with the expected allow and deny lists', () => {
      const entries = parseEntries(conf());
      expect(entries.map((e) => e.user)).toEqual(NF_USERS);
      for (const e of entries) {
        expect(e.pub, `${e.user} publish`).toEqual(EXPECTED[e.user]?.pub);
        expect(e.deny, `${e.user} deny`).toEqual(EXPECTED[e.user]?.deny);
        expect(e.sub, `${e.user} subscribe`).toEqual(EXPECTED[e.user]?.sub);
      }
    });

    it('scopes every subject to this shard, its two streams, its two buckets or the inbox', () => {
      for (const e of parseEntries(conf())) {
        for (const subject of [...e.pub, ...e.sub, ...e.deny]) {
          expect(inScope(subject), `${e.user}: ${subject}`).toBe(true);
          expect(subject, e.user).not.toBe('>');
          expect(subject, e.user).not.toMatch(/^geldar\.(\*|>)/);
          expect(subject, e.user).not.toMatch(/colo|phase0/);
        }
      }
    });

    it('gives the NeoForge mod no publish on maintenance and no wider subject than geldar.nf.*', () => {
      const mod = parseEntries(conf()).find((e) => e.user === 'neoforge');
      expect(mod?.deny).toEqual(['geldar.nf.maintenance']);
      expect(mod?.pub.filter((s) => s.startsWith('geldar.'))).toEqual(['geldar.nf.*']);
    });

    it('declares in nf-live.yml exactly the generated files, plus the two non-NATS secrets', () => {
      const names = [...NF_LIVE.matchAll(/\$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/([\w.-]+)/g)].map(
        (m) => m[1] ?? '',
      );
      const declared = [...new Set(names)];
      for (const name of NOT_NATS_SECRETS) expect(declared, name).toContain(name);
      expect(declared.filter((n) => !NOT_NATS_SECRETS.includes(n)).sort()).toEqual(NF_FILES);
    });

    it('gives identity-seed the seed user and its own password file, never deploy', () => {
      const start = NF_LIVE.indexOf('\n  identity-seed:');
      const rest = NF_LIVE.slice(start + 1);
      const block = rest.slice(0, rest.search(/\n {2}[a-z][\w-]*:\n/));
      expect(block).toMatch(/GELDAR_NATS_USER: seed$/m);
      expect(block).toMatch(/\/run\/secrets\/nats-seed\.txt/);
      expect(block).toMatch(/secrets: \[nats-seed\.txt\]/);
      expect(block).not.toMatch(/GELDAR_NATS_USER: deploy/);
    });

    it('reuses existing files and never overwrites them', () => {
      const before = NF_FILES.map((f) => readFileSync(join(dirOf(), f), 'utf8'));
      const again = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          join(r.dir, 'geldar.ps1'),
          'shard',
          'nats-auth',
          'nf',
          '--live',
          '--local',
        ],
        { encoding: 'utf8', cwd: r.dir },
      );
      expect(again.status, again.stderr).toBe(0);
      expect(NF_FILES.map((f) => readFileSync(join(dirOf(), f), 'utf8'))).toEqual(before);
    }, 60_000);

    it('refuses a config with a missing password file and writes nothing', () => {
      const before = readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8');
      rmSync(join(dirOf(), 'nats-seed.txt'));
      const again = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          join(r.dir, 'geldar.ps1'),
          'shard',
          'nats-auth',
          'nf',
          '--live',
          '--local',
        ],
        { encoding: 'utf8', cwd: r.dir },
      );
      expect(again.status).not.toBe(0);
      expect(again.stderr).toMatch(/nats-seed\.txt is missing/);
      expect(existsSync(join(dirOf(), 'nats-seed.txt'))).toBe(false);
      expect(readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8')).toBe(before);
    }, 60_000);
  },
);
