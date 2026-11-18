import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { hasPwsh, parseEntries, type Rendered, renderGenerator } from './nats-auth-fixtures.ts';

// The human NATS user of the nf set (velocity-human, compose/nf-live-human.yml; deploy/nats-auth-nf.ps1 `human`), read from the
// generator's output in a temp checkout (--live --local, never the live checkout). Its grant is velocity's registry and skins
// watch, read only, with its flow control scoped to the two buckets. The skins are read because IdentityPlugin starts a skin
// client whenever GELDAR_NATS_URL is set, in either lane (plugin/velocity-identity IdentityPlugin.java:139-142).
// Its inbox is its own prefix (GELDAR_NATS_INBOX_PREFIX), never the shared _INBOX.>: a compromised proxy must not read or forge
// another user's deliveries.
const REGISTRY = 'KV_geldar-life-registry';
const SKINS = 'KV_geldar-skins';
const INBOX = '_INBOX.human.>';
const OVERLAY = join(import.meta.dirname, '..', '..', '..', 'compose', 'nf-live-human.yml');
const watch = (b: string) => [
  `$JS.API.STREAM.INFO.${b}`,
  `$JS.API.CONSUMER.CREATE.${b}`,
  `$JS.API.CONSUMER.CREATE.${b}.>`,
  `$JS.API.CONSUMER.INFO.${b}.>`,
  `$JS.API.CONSUMER.DELETE.${b}.>`,
];
const HUMAN_PUB = [
  ...watch(REGISTRY),
  ...watch(SKINS),
  `$JS.FC.${REGISTRY}.>`,
  `$JS.FC.${SKINS}.>`,
  INBOX,
];
// Every publish the human user may make, as a pattern: the two buckets' watch calls, their flow control, and its inbox.
const ALLOWED =
  /^(\$JS\.API\.STREAM\.INFO\.KV_geldar-(life-registry|skins)|\$JS\.API\.CONSUMER\.(CREATE|INFO|DELETE)\.KV_geldar-(life-registry|skins)(\.>)?|\$JS\.FC\.KV_geldar-(life-registry|skins)\.>|_INBOX\.human\.>)$/;
const OTHER_USERS = ['neoforge', 'sink', 'deploy', 'seed', 'body'];

describe.skipIf(!hasPwsh)('NF NATS grants: the human user (velocity-human)', () => {
  let r: Rendered;
  const entries = () =>
    parseEntries(readFileSync(join(r.dir, 'compose', 'secrets-nf', 'nats-auth.conf'), 'utf8'));
  const entryOf = (user: string) => {
    const e = entries().find((x) => x.user === user);
    if (!e) throw new Error(`no ${user} entry in nats-auth.conf`);
    return e;
  };
  beforeAll(() => {
    r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
  }, 30_000);
  afterAll(() => {
    if (r) rmSync(r.dir, { recursive: true, force: true });
  });

  it('has exactly the registry and skins watch, its flow control, and its own inbox to publish; its own inbox to subscribe', () => {
    const h = entryOf('human');
    expect(h.pub).toEqual(HUMAN_PUB);
    expect(h.sub).toEqual([INBOX]);
  }, 30_000);

  it('is granted no shared inbox: no _INBOX.> in its publish or its subscribe', () => {
    const h = entryOf('human');
    expect(h.pub).not.toContain('_INBOX.>');
    expect(h.sub).not.toContain('_INBOX.>');
    expect([...h.pub, ...h.sub].filter((s) => s.startsWith('_INBOX.') && s !== INBOX)).toEqual([]);
  }, 30_000);

  it('publishes no $KV subject, no $JS.API wildcard, no write to either stream, and no direct get', () => {
    const h = entryOf('human');
    expect(h.pub.filter((s) => s.startsWith('$KV'))).toEqual([]);
    expect(h.pub.filter((s) => /^(\$JS\.API\.>|>)$/.test(s))).toEqual([]);
    expect(
      h.pub.filter(
        (s) => /\.(CREATE|UPDATE|PURGE|DELETE)\.KV_/.test(s) && !s.includes('CONSUMER.'),
      ),
    ).toEqual([]);
    expect(h.pub.filter((s) => s.includes('MSG.GET') || s.includes('CONSUMER.MSG.NEXT'))).toEqual(
      [],
    );
  }, 30_000);

  it('publishes only the two buckets watch calls, their flow control, and its inbox (no other stream, bucket or consumer)', () => {
    const h = entryOf('human');
    expect(h.pub.filter((s) => !ALLOWED.test(s))).toEqual([]);
    expect(h.pub.some((s) => s.includes('GELDAR_EVENTS') || s.includes('geldar.nf'))).toBe(false);
  }, 30_000);

  it('subscribes to its own inbox only', () => {
    const h = entryOf('human');
    expect(h.sub.filter((s) => s !== INBOX)).toEqual([]);
  }, 30_000);

  it('shares with neoforge, sink, deploy, seed and body only the STREAM.INFO reads pinned by the velocity test (the inbox is not shared)', () => {
    const h = entryOf('human');
    const mine = new Set([...h.pub, ...h.sub].filter((s) => !s.startsWith('_INBOX.')));
    // Pinned: seed (it creates both buckets) and body (the probe) hold the registry's STREAM.INFO, seed the skins' too. No other
    // overlap: no consumer, flow-control or delete grant is shared with any other user.
    const pinned: Record<string, string[]> = {
      neoforge: [],
      sink: [],
      deploy: [],
      seed: [`$JS.API.STREAM.INFO.${REGISTRY}`, `$JS.API.STREAM.INFO.${SKINS}`],
      body: [`$JS.API.STREAM.INFO.${REGISTRY}`],
    };
    for (const user of OTHER_USERS) {
      const e = entryOf(user);
      const shared = [...e.pub, ...e.sub].filter((s) => mine.has(s) && !s.startsWith('_INBOX.'));
      expect([...new Set(shared)].sort(), user).toEqual([...(pinned[user] ?? [])].sort());
    }
  }, 30_000);

  it('leaves the velocity grant as it was: the same watch, $JS.FC.> and the shared inbox', () => {
    const v = entryOf('velocity');
    expect(v.pub).toEqual([...watch(REGISTRY), ...watch(SKINS), '$JS.FC.>', '_INBOX.>']);
    expect(v.sub).toEqual(['_INBOX.>']);
  }, 30_000);

  it('grants the same inbox prefix the overlay sets as GELDAR_NATS_INBOX_PREFIX (one value, two files)', () => {
    const set = prefixesIn(OVERLAY);
    expect(set).toEqual([['velocity-human', '_INBOX.human.']]);
    const h = entryOf('human');
    expect(h.sub).toEqual(set.map(([, p]) => `${p}>`));
    for (const [, p] of set) expect(h.pub).toContain(`${p}>`);
  }, 30_000);

  it('sets the prefix on the human proxy only: the agent velocity service in nf-live.yml has none', () => {
    expect(prefixesIn(NF_LIVE)).toEqual([]);
  }, 30_000);
});

// The compose files are parsed, not searched: each service's environment map is read for the prefix setting.
const NF_LIVE = join(import.meta.dirname, '..', '..', '..', 'compose', 'nf-live.yml');
function prefixesIn(file: string): [string, string][] {
  const services = (
    parse(readFileSync(file, 'utf8')) as {
      services: Record<string, { environment?: Record<string, unknown> }>;
    }
  ).services;
  return Object.entries(services).flatMap(([name, svc]) =>
    svc.environment && 'GELDAR_NATS_INBOX_PREFIX' in svc.environment
      ? [[name, String(svc.environment.GELDAR_NATS_INBOX_PREFIX)] as [string, string]]
      : [],
  );
}

// The deployed conf check (deploy/nf-human-lib.sh check_human_conf), run on one conf text in a temp dir. Names only in its stderr.
const LIB = join(import.meta.dirname, '..', '..', '..', 'deploy', 'nf-human-lib.sh');
const posix = (p: string) => p.replace(/\\/g, '/');
function checkConf(conf: string): { status: number | null; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nf-humanconf-'));
  try {
    const file = join(dir, 'nats-auth.conf');
    writeFileSync(file, conf);
    const res = spawnSync(
      'sh',
      [
        '-c',
        'die() { echo "$1" >&2; exit 2; }; . "$1"; check_human_conf "$2"',
        'sh',
        posix(LIB),
        posix(file),
      ],
      { encoding: 'utf8' },
    );
    return { status: res.status, stderr: res.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// The generator writes one line per user: the human line is the one that names it. One substitution is made on that line only.
const onHumanLine = (conf: string, from: string, to: string) =>
  conf
    .split('\n')
    .map((l) => (l.includes('user: "human"') ? l.split(from).join(to) : l))
    .join('\n');

describe.skipIf(!hasPwsh)(
  'NF NATS grants: a deployed conf that still has the broad inbox grant is refused',
  () => {
    let generated = '';
    let r: Rendered;
    beforeAll(() => {
      r = renderGenerator('nf', { flags: ['--live', '--local'], checkout: true });
      generated = readFileSync(join(r.dir, 'compose', 'secrets-nf', 'nats-auth.conf'), 'utf8');
    }, 30_000);
    afterAll(() => {
      if (r) rmSync(r.dir, { recursive: true, force: true });
    });

    it('admits the conf the generator writes now: the human user holds its own inbox only', () => {
      expect(checkConf(generated).status).toBe(0);
    }, 30_000);

    it('refuses the H5-era conf whose human user still holds the shared _INBOX.> in publish and subscribe', () => {
      const res = checkConf(onHumanLine(generated, '"_INBOX.human.>"', '"_INBOX.>"'));
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('still has the broad inbox grant for the human user');
      expect(res.stderr).not.toMatch(/_INBOX|password/);
    }, 30_000);

    it('refuses a conf whose human user holds the shared _INBOX.> in its subscribe alone', () => {
      const res = checkConf(
        onHumanLine(
          generated,
          'subscribe: { allow: ["_INBOX.human.>"]',
          'subscribe: { allow: ["_INBOX.>"]',
        ),
      );
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('still has the broad inbox grant for the human user');
    }, 30_000);

    it('refuses a conf whose human user does not hold its own inbox', () => {
      const res = checkConf(onHumanLine(generated, '"_INBOX.human.>"', '"_INBOX.other.>"'));
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('does not give the human user its own inbox');
    }, 30_000);

    it('refuses a conf with no human user', () => {
      const res = checkConf(
        generated
          .split('\n')
          .filter((l) => !l.includes('user: "human"'))
          .join('\n'),
      );
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('has no human user');
    }, 30_000);
  },
);
