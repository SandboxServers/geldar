import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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
const NF_USERS = [
  'neoforge',
  'sink',
  'deploy',
  'velocity',
  'seed',
  'body',
  'human',
  'mcp',
  'ranger',
];
/** The fifteen files the generator writes: the conf, the nine NATS passwords, postgres.txt, velocity-forwarding.txt, rcon.txt,
 * postgres-mcp.txt and mcp-token-pepper.txt. */
const NF_FILES = [
  'nats-auth.conf',
  ...NF_USERS.map((u) => `nats-${u}.txt`),
  'postgres.txt',
  'velocity-forwarding.txt',
  'rcon.txt',
  'postgres-mcp.txt',
  'mcp-token-pepper.txt',
].sort();
const NF_PROBE = readFileSync(join(ROOT, 'compose', 'nf-live-probe.yml'), 'utf8');
const NF_RANGERS = readFileSync(join(ROOT, 'compose', 'nf-live-rangers.yml'), 'utf8');
const NF_HUMAN = readFileSync(join(ROOT, 'compose', 'nf-live-human.yml'), 'utf8');
/** The two-way difference of two name lists: names only in `a`, and names only in `b`. */
function setDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  return { onlyA: a.filter((f) => !b.includes(f)), onlyB: b.filter((f) => !a.includes(f)) };
}
/** The SECRET_FILES list of deploy/nf-deploy.sh (the files the operator script requires before any start). */
function deploySecretFiles(): string[] {
  const m = /^SECRET_FILES="([^"]+)"/m.exec(
    readFileSync(join(ROOT, 'deploy', 'nf-deploy.sh'), 'utf8'),
  );
  return (m?.[1] ?? '').split(' ').filter((f) => f !== '');
}
const STREAMS = ['GELDAR_EVENTS', 'GELDAR_EVENTS_NF'];
const BUCKETS = ['geldar-life-registry', 'geldar-skins'];
/** Every KV bucket a nf user may name: the two identity buckets, and the ones the rangers' Bodies and the MCP's presence use. */
const KV_NAMES = [
  ...BUCKETS,
  'geldar-presence',
  'geldar-checkpoints',
  'geldar-body-generation',
  'geldar-plans',
  'geldar-seen',
];
const NF_LIVE = readFileSync(join(ROOT, 'compose', 'nf-live.yml'), 'utf8');

const streamApi = (s: string): string[] => [
  `$JS.API.STREAM.INFO.${s}`,
  `$JS.API.STREAM.CREATE.${s}`,
];
const sinkApi = (s: string): string[] => [
  ...streamApi(s),
  `$JS.API.CONSUMER.CREATE.${s}.eventsink`,
  `$JS.API.CONSUMER.CREATE.${s}.eventsink.>`,
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
    deny: ['geldar.nf.maintenance', 'geldar.nf.dlq'],
    sub: ['geldar.nf.maintenance', '_INBOX.>'],
  },
  sink: {
    pub: [
      'geldar.nf.dlq',
      'geldar.nf.state.>',
      '$JS.API.INFO',
      ...STREAMS.flatMap(sinkApi),
      '_INBOX.>',
    ],
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
  // The probe's body: its one key of the life registry bucket (KV put, get and delete), and the JetStream calls its bound bucket makes.
  body: {
    pub: [
      '$KV.geldar-life-registry.ag_nfprobe_01',
      '$JS.API.INFO',
      '$JS.API.STREAM.INFO.KV_geldar-life-registry',
      '$JS.API.STREAM.MSG.GET.KV_geldar-life-registry',
      '_INBOX.>',
    ],
    deny: [],
    sub: ['_INBOX.>'],
  },
  // The human lane (velocity-human): velocity's watch on the registry and the skins, read only, with its flow control scoped to
  // those two buckets. No $KV, no $JS.API wildcard, no event subject (tests/nats-human-grants-nf.test.ts pins it in full).
  human: {
    pub: [
      ...BUCKETS.flatMap(velocityApi),
      ...BUCKETS.map((b) => `$JS.FC.KV_${b}.>`),
      '_INBOX.human.>',
    ],
    deny: [],
    sub: ['_INBOX.human.>'],
  },
  mcp: {
    pub: [
      'geldar.nf.sovereign_call',
      'geldar.nf.body.>',
      '$KV.geldar-presence.>',
      '$JS.API.>',
      '$JS.ACK.>',
      '_INBOX.>',
    ],
    deny: ['geldar.nf.body.*.hearing'],
    sub: ['_INBOX.>'],
  },
  ranger: {
    pub: [
      'geldar.nf.>',
      '$JS.API.>',
      '$JS.ACK.>',
      '_INBOX.>',
      ...[
        'geldar-life-registry',
        'geldar-checkpoints',
        'geldar-body-generation',
        'geldar-skins',
        'geldar-plans',
        'geldar-seen',
      ].map((b) => `$KV.${b}.>`),
    ],
    deny: [
      'geldar.nf.kino.>',
      'geldar.nf.blockowner.changed',
      'geldar.nf.ctl.body.>',
      'geldar.nf.helper.body.>',
      'geldar.nf.state.*.level',
      'geldar.nf.body.*.hearing',
      'geldar.nf.provenance.>',
      'geldar.nf.life.>',
    ],
    sub: [
      'geldar.nf.body.>',
      'geldar.nf.blockowner.changed',
      'geldar.nf.state.*.level',
      'geldar.nf.provenance.>',
      '_INBOX.>',
    ],
  },
};

/** Whether a subject is one this shard's NATS may carry: geldar.nf.*, the inbox, $JS.FC, $JS.API.INFO, or a JetStream
 * API or ack subject whose tokens include exactly one of this shard's stream or bucket names. */
function inScope(subject: string): boolean {
  if (subject.startsWith('geldar.nf.')) return true;
  if (['_INBOX.>', '_INBOX.human.>', '$JS.FC.>', '$JS.API.INFO'].includes(subject)) return true;
  if (/^\$JS\.FC\.KV_geldar-(life-registry|skins)\.>$/.test(subject)) return true;
  // The rangers' MCP and body sets (the colo sets with s=nf) also name the presence and checkpoint buckets, and the JetStream wildcards.
  if (['$JS.API.>', '$JS.ACK.>'].includes(subject)) return true;
  if (subject.startsWith('$KV.')) return KV_NAMES.some((b) => subject.startsWith(`$KV.${b}.`));
  if (subject.startsWith('$JS.API.') || subject.startsWith('$JS.ACK.')) {
    const tokens = subject.split('.');
    const names = [...STREAMS, ...BUCKETS.map((b) => `KV_${b}`)];
    return names.some((n) => tokens.includes(n));
  }
  return false;
}

/** NATS subject matching: `*` matches one token, `>` matches one or more tokens and must be the last token. */
function natsMatch(pattern: string, subject: string): boolean {
  const p = pattern.split('.');
  const s = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return i === p.length - 1 && s.length > i;
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}

/** Whether a user's publish allow list admits a subject and its publish deny list does not. */
function publishAllowed(
  entry: { pub: string[]; deny: string[] } | undefined,
  subject: string,
): boolean {
  if (!entry) return false;
  return (
    entry.pub.some((p) => natsMatch(p, subject)) && !entry.deny.some((d) => natsMatch(d, subject))
  );
}

/**
 * The subjects the sink's client sends (@nats-io/jetstream 3.4.0, read from its lib/): jetstreamManager's INFO
 * (jsclient.js:148), STREAM.INFO and STREAM.CREATE (jsmstream_api.js:388, :356), the consumer create with its filter
 * (jsmconsumer_api.js:101; consumers.update sends the same subject), CONSUMER.INFO (jsmconsumer_api.js:158), the pull
 * request (consumer.js:551) and an ack reply (jsmsg.js:41). Written here from the client, not from the generator's list.
 */
function sinkClientSubjects(st: string): string[] {
  return [
    '$JS.API.INFO',
    `$JS.API.STREAM.INFO.${st}`,
    `$JS.API.STREAM.CREATE.${st}`,
    `$JS.API.CONSUMER.CREATE.${st}.eventsink.geldar.*.*`,
    `$JS.API.CONSUMER.INFO.${st}.eventsink`,
    `$JS.API.CONSUMER.MSG.NEXT.${st}.eventsink`,
    `$JS.ACK.${st}.eventsink.1.1.1.1700000000000000000.0`,
  ];
}

function runGenerator(dir: string, flags: string[] = ['--live', '--local']) {
  return spawnSync(
    'pwsh',
    ['-NoProfile', '-File', join(dir, 'geldar.ps1'), 'shard', 'nats-auth', 'nf', ...flags],
    {
      encoding: 'utf8',
      cwd: dir,
    },
  );
}

describe('NATS subject matching (the test helper)', () => {
  it.each([
    ['a.>', 'a', false],
    ['a.>', 'a.b', true],
    ['a.>', 'a.b.c', true],
    ['a.*', 'a.b', true],
    ['a.*', 'a.b.c', false],
    ['a.*.c', 'a.b.c', true],
    ['a.b', 'a.b.c', false],
  ])('%s matches %s: %s', (pattern, subject, want) => {
    expect(natsMatch(pattern, subject)).toBe(want);
  });
});

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
    ['--LIVE in capitals (case-sensitive)', ['--LIVE'], false, /unknown flag/],
  ];
  it.each(cases)(
    'refuses %s and writes nothing',
    (_name, flags, checkout, message) => {
      const r = renderGenerator('nf', { flags, checkout });
      made.push(r.dir);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(message);
      expect(existsSync(join(r.dir, 'compose', 'secrets-nf'))).toBe(false);
      expect(existsSync(join(r.dir, 'compose', 'secrets'))).toBe(false);
    },
    30_000,
  );
});

describe.skipIf(!hasPwsh)('NF NATS auth set: password files that would break the config', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  /** A temp copy of the generator with one password file already written (no --live, so nothing is generated). */
  function seeded(name: string, text: string): string {
    const { dir } = renderGenerator('nf', { flags: ['--local'], checkout: false });
    dirs.push(dir);
    mkdirSync(join(dir, 'compose', 'secrets-nf'), { recursive: true });
    writeFileSync(join(dir, 'compose', 'secrets-nf', name), text);
    return dir;
  }
  it('names an empty password file and writes no config', () => {
    const dir = seeded('nats-seed.txt', '');
    const r = runGenerator(dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/nats-seed\.txt is empty/);
    expect(existsSync(join(dir, 'compose', 'secrets-nf', 'nats-auth.conf'))).toBe(false);
  }, 60_000);
  it.each([
    ['a double quote', 'ab"cd'],
    ['a line break', 'ab\ncd'],
  ])(
    'refuses a password with %s and writes no config',
    (_name, text) => {
      const dir = seeded('nats-sink.txt', text);
      const r = runGenerator(dir);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/double quote or a line break/);
      expect(existsSync(join(dir, 'compose', 'secrets-nf', 'nats-auth.conf'))).toBe(false);
    },
    60_000,
  );
});

describe.skipIf(!hasPwsh)(
  'NF NATS auth set: the generator in a temp checkout (--live --local)',
  () => {
    let r: Rendered;
    const dirOf = () => join(r.dir, 'compose', 'secrets-nf');
    const conf = () => readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8');
    const entry = (user: string) => parseEntries(conf()).find((e) => e.user === user);
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

    // POSIX only: Windows keeps no mode bits, so this is skipped there (the ACL is checked by hand on the node).
    it.skipIf(process.platform === 'win32')('writes the directory 0700 and every file 0600', () => {
      const modeOf = (p: string) => statSync(p).mode & 0o777;
      expect(modeOf(dirOf())).toBe(0o700);
      for (const f of NF_FILES) expect(modeOf(join(dirOf(), f)), f).toBe(0o600);
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

    it('gives the NeoForge mod no publish on maintenance or the dead letter, and no wider subject than geldar.nf.*', () => {
      const mod = entry('neoforge');
      expect(mod?.deny).toEqual(['geldar.nf.maintenance', 'geldar.nf.dlq']);
      expect(mod?.pub.filter((s) => s.startsWith('geldar.'))).toEqual(['geldar.nf.*']);
    });

    it('lets the sink send every JetStream subject its client builds (computed, not restated)', () => {
      for (const st of STREAMS) {
        for (const subject of [...sinkClientSubjects(st), 'geldar.nf.dlq', '_INBOX.abc123']) {
          expect(publishAllowed(entry('sink'), subject), subject).toBe(true);
        }
      }
    });

    it('lets the mod send its stream calls and its events, and not maintenance or the dead letter', () => {
      for (const st of STREAMS) {
        for (const subject of [
          `$JS.API.STREAM.INFO.${st}`,
          `$JS.API.STREAM.CREATE.${st}`,
          'geldar.nf.player-joined',
          '_INBOX.abc123',
        ]) {
          expect(publishAllowed(entry('neoforge'), subject), subject).toBe(true);
        }
      }
      for (const subject of ['geldar.nf.maintenance', 'geldar.nf.dlq']) {
        expect(publishAllowed(entry('neoforge'), subject), subject).toBe(false);
      }
    });

    it('makes the generator output equal the secrets of nf-live.yml and the SECRET_FILES of nf-deploy.sh', () => {
      const generated = readdirSync(dirOf()).sort();
      // The declared set is nf-live.yml's plus the probe overlay's (nats-body.txt, which only the probe mounts), the human
      // overlay's (nats-human.txt, which only the human lane mounts) and the rangers overlay's (the four ranger files).
      const names = [
        ...`${NF_LIVE}\n${NF_PROBE}\n${NF_HUMAN}\n${NF_RANGERS}`.matchAll(
          /\$\{NF_SECRETS_DIR:-\.\/secrets-nf\}\/([\w.-]+)/g,
        ),
      ].map((m) => m[1] ?? '');
      const declared = [...new Set(names)].sort();
      const deploy = deploySecretFiles().sort();
      expect(deploy.length, 'SECRET_FILES parsed').toBeGreaterThan(0);
      expect(setDiff(generated, declared), 'generator vs nf-live.yml secrets').toEqual({
        onlyA: [],
        onlyB: [],
      });
      // nats-human.txt is required by nf-deploy.sh only with NF_HUMAN=on (deploy/nf-human-lib.sh), so the base SECRET_FILES omit it.
      expect(
        setDiff(
          generated.filter((f) => f !== 'nats-human.txt'),
          deploy,
        ),
        'generator vs nf-deploy.sh SECRET_FILES',
      ).toEqual({
        onlyA: [],
        onlyB: [],
      });
      expect(generated).toEqual(NF_FILES);
    });

    it('writes postgres.txt, velocity-forwarding.txt and rcon.txt as 32 symbols of [A-Za-z0-9_-] with no newline', () => {
      for (const f of ['postgres.txt', 'velocity-forwarding.txt', 'rcon.txt']) {
        expect(readFileSync(join(dirOf(), f), 'utf8'), f).toMatch(/^[A-Za-z0-9_-]{32}$/);
      }
    });

    it('limits the body user to the probe key of the life registry bucket: every publish subject names that key or is a generic API subject', () => {
      const conf = readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8');
      const line = conf.split('\n').find((l) => l.includes('user: "body"')) ?? '';
      const pub = /publish: \{ allow: \[([^\]]*)\]/.exec(line)?.[1] ?? '';
      const subjects = [...pub.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
      expect(subjects).toContain('$KV.geldar-life-registry.ag_nfprobe_01');
      for (const s of subjects) {
        expect(s, s).toMatch(
          /^(\$KV\.geldar-life-registry\.ag_nfprobe_01|\$JS\.API\.INFO|\$JS\.API\.(STREAM\.INFO|STREAM\.MSG\.GET)\.KV_geldar-life-registry|_INBOX\.>)$/,
        );
      }
      expect(line, 'no event stream, no shard subject, no other bucket').not.toMatch(
        /geldar\.nf|GELDAR_EVENTS|geldar-skins/,
      );
    });

    it('never prints a secret value: a fresh run echoes no file content', () => {
      const fresh = renderGenerator('nf', { flags: ['--local'], checkout: false });
      try {
        const run = runGenerator(fresh.dir);
        expect(run.status, run.stderr).toBe(0);
        const out = `${run.stdout}${run.stderr}`;
        for (const f of NF_FILES.filter((x) => x !== 'nats-auth.conf')) {
          const value = readFileSync(join(fresh.dir, 'compose', 'secrets-nf', f), 'utf8');
          expect(value.length, f).toBe(f === 'mcp-token-pepper.txt' ? 64 : 32);
          expect(out, f).not.toContain(value);
        }
      } finally {
        rmSync(fresh.dir, { recursive: true, force: true });
      }
    }, 60_000);

    it('gives identity-seed the seed user and its own password file, never deploy', () => {
      const start = NF_LIVE.indexOf('\n  identity-seed:');
      const rest = NF_LIVE.slice(start + 1);
      const block = rest.slice(0, rest.search(/\n {2}[a-z][\w-]*:\n/));
      expect(block).toMatch(/GELDAR_NATS_USER: seed$/m);
      expect(block).toMatch(/\/run\/secrets\/nats-seed\.txt/);
      expect(block).toMatch(/secrets: \[nats-seed\.txt\]/);
      expect(block).not.toMatch(/GELDAR_NATS_USER: deploy/);
    });

    it('reuses existing files and never overwrites the config', () => {
      const passwords = NF_FILES.filter((f) => f !== 'nats-auth.conf');
      const before = passwords.map((f) => readFileSync(join(dirOf(), f), 'utf8'));
      const marker = '# hand edit: a re-run must not rewrite this config\n';
      appendFileSync(join(dirOf(), 'nats-auth.conf'), marker);
      const again = runGenerator(r.dir);
      expect(again.status, again.stderr).toBe(0);
      expect(conf().endsWith(marker)).toBe(true);
      expect(passwords.map((f) => readFileSync(join(dirOf(), f), 'utf8'))).toEqual(before);
    }, 60_000);

    // POSIX only: the mode is the check. A file left at 0644 by an older run is restricted again by a re-run, not kept as it is.
    it.skipIf(process.platform === 'win32')(
      'restricts a pre-existing 0644 secret file to 0600 on a re-run',
      () => {
        const path = join(dirOf(), 'postgres.txt');
        chmodSync(path, 0o644);
        expect(statSync(path).mode & 0o777).toBe(0o644);
        const again = runGenerator(r.dir);
        expect(again.status, again.stderr).toBe(0);
        expect(statSync(path).mode & 0o777).toBe(0o600);
      },
      60_000,
    );

    // An empty file is what a crash between create and write leaves: the run refuses it by name, for both files.
    it('refuses an existing empty postgres.txt or velocity-forwarding.txt, names it, and exits non-zero', () => {
      for (const f of ['postgres.txt', 'velocity-forwarding.txt']) {
        const path = join(dirOf(), f);
        const kept = readFileSync(path, 'utf8');
        writeFileSync(path, '');
        const again = runGenerator(r.dir);
        expect(again.status, f).not.toBe(0);
        expect(again.stderr, f).toContain(`${f} is empty`);
        writeFileSync(path, kept);
      }
    }, 60_000);

    it('refuses a config with a missing password file and writes nothing', () => {
      const before = readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8');
      rmSync(join(dirOf(), 'nats-seed.txt'));
      const again = runGenerator(r.dir);
      expect(again.status).not.toBe(0);
      expect(again.stderr).toMatch(/nats-seed\.txt is missing/);
      expect(existsSync(join(dirOf(), 'nats-seed.txt'))).toBe(false);
      expect(readFileSync(join(dirOf(), 'nats-auth.conf'), 'utf8')).toBe(before);
    }, 60_000);
  },
);
