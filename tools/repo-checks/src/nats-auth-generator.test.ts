/**
 * The rendered output of the NATS auth generator (`./geldar.ps1 shard nats-auth`, decisions 0067, 0080 and 0087). The
 * generator runs once for the phase0 shard, in a temp copy of its inputs; each test reads the config and secrets it wrote.
 * It skips when pwsh is not on PATH. The compose overlays and the static wiring are in nats-auth.test.ts.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  expectedTable,
  GENERATOR_TIMEOUT_MS,
  hasPwsh,
  PHASE0_USERS,
  parseEntries,
  type Rendered,
  ROLES,
  renderGenerator,
  SHARD,
  subjectMatches,
} from './nats-auth-fixtures.ts';

describe.skipIf(!hasPwsh)('geldar.ps1 NATS auth generator: rendered output', () => {
  let rendered: Rendered | undefined;
  // The colo shard renders the eleven roles only: the scratch seed is in the phase0 table alone.
  let colo: Rendered | undefined;

  beforeAll(() => {
    rendered = renderGenerator();
    colo = renderGenerator('colo');
  }, GENERATOR_TIMEOUT_MS * 2);

  afterAll(() => {
    if (rendered) rmSync(rendered.dir, { recursive: true, force: true });
    if (colo) rmSync(colo.dir, { recursive: true, force: true });
  });

  it('runs the generator without error', () => {
    // The message carries the exit code and stderr, so a CI failure says why. No secret is printed: see Rendered.
    expect(rendered?.status, `exit ${rendered?.status}: ${rendered?.stderr}`).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'makes each NATS secret file and the server config owner-only (mode 0600)',
    () => {
      // Off Windows the owner-only step is chmod 600; on Windows the ACL is checked by the icacls step, not here.
      const dir = join(rendered?.dir ?? '', 'compose', 'secrets');
      const names = [
        ...PHASE0_USERS.map((user) => `nats-${user}.txt`),
        'thinker-token.txt',
        'nats-auth.conf',
      ];
      const modes = names.map((name) => statSync(join(dir, name)).mode & 0o777);
      expect(modes).toEqual(names.map(() => 0o600));
    },
  );

  it('puts allow_responses inside each user permissions, never on the user block', () => {
    // Booleans, not toMatch: a failing matcher would print the config, and the config holds generated passwords.
    const entries = parseEntries(rendered?.conf ?? '');
    expect(entries.length).toBeGreaterThan(0);
    expect(/password: "[^"]*", allow_responses/.test(rendered?.conf ?? '')).toBe(false);
    const inPermissions = entries.map((e) =>
      /permissions: \{.*allow_responses: true \} \},?$/.test(e.raw),
    );
    expect(inPermissions).toEqual(entries.map(() => true));
  });

  it('lets body publish the audit subjects (AN-07), and mcp and mind cannot', () => {
    // roll, decision, sheet_adopted and chunk_visited ride body's geldar.<shard>.> allow; no ACL line is added.
    // Booleans only: the rendered config holds generated passwords.
    const entries = parseEntries(rendered?.conf ?? '');
    // Publishable only when an allow pattern matches and no deny pattern does (nats-server takes deny first).
    const publishAllowed = (user: string, subject: string) => {
      const entry = entries.find((e) => e.user === user);
      return (
        (entry?.pub ?? []).some((p) => subjectMatches(p, subject)) &&
        !(entry?.deny ?? []).some((p) => subjectMatches(p, subject))
      );
    };
    for (const type of ['roll', 'decision', 'sheet_adopted', 'chunk_visited']) {
      const subject = `geldar.${SHARD}.${type}`;
      expect(publishAllowed('body', subject)).toBe(true);
      expect(publishAllowed('mcp', subject)).toBe(false);
      expect(publishAllowed('mind', subject)).toBe(false);
    }
  });

  it('gives the deploy role the maintenance subject to publish and nothing else', () => {
    // CD-1d: the deploy user publishes geldar.<shard>.maintenance only; no JetStream API, no Kino, no bucket.
    const deploy = parseEntries(rendered?.conf ?? '').find((e) => e.user === 'deploy');
    expect(deploy).toBeDefined();
    expect(deploy?.pub).toEqual([`geldar.${SHARD}.maintenance`]);
    expect(deploy?.sub).toEqual(['_INBOX.>']);
    expect(deploy?.raw.includes('$JS')).toBe(false);
    expect(deploy?.raw.includes('kino')).toBe(false);
  });

  it('writes one password file per phase0 user, the scratch seed included, and the config carries the same password', () => {
    const dir = join(rendered?.dir ?? '', 'compose', 'secrets');
    const entries = parseEntries(rendered?.conf ?? '');
    const files = PHASE0_USERS.map((user) => ({
      user,
      // A value check, not a print: the test reports booleans only.
      text: readFileSync(join(dir, `nats-${user}.txt`), 'utf8'),
    }));
    expect(files.map((f) => /^[A-Za-z0-9_-]{32}$/.test(f.text))).toEqual(
      PHASE0_USERS.map(() => true),
    );
    const same = entries.map((e) => e.password === files.find((f) => f.user === e.user)?.text);
    expect(same).toEqual(entries.map(() => true));
  });

  it('writes exactly the phase0 users: the eleven roles (deploy included) and the scratch seed, with no ops user', () => {
    const names = parseEntries(rendered?.conf ?? '').map((e) => e.user);
    expect(names).toEqual(PHASE0_USERS);
  });

  it('writes the colo users as the eleven roles only: no scratch seed user and no seed password file', () => {
    expect(colo?.status, `exit ${colo?.status}: ${colo?.stderr}`).toBe(0);
    const names = parseEntries(colo?.conf ?? '').map((e) => e.user);
    expect(names).toEqual(ROLES);
    // A seed leak into colo would add the user to the config, and its password file to the secrets dir.
    expect(names.includes('seed')).toBe(false);
    expect(existsSync(join(colo?.dir ?? '', 'compose', 'secrets', 'nats-seed.txt'))).toBe(false);
  });

  it('emits the scoped subject table of decision 0087 for each role, with no bare * token', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const want = expectedTable(SHARD);
    // Subject lists only: the entries carry passwords, and a failing expect prints its value.
    const actual = entries
      .filter((e) => PHASE0_USERS.includes(e.user))
      .map((e) => ({
        user: e.user,
        pub: [...e.pub].sort(),
        sub: [...e.sub].sort(),
      }));
    const expected = PHASE0_USERS.map((user) => ({
      user,
      pub: [...(want[user]?.pub ?? [])].sort(),
      sub: [...(want[user]?.sub ?? [])].sort(),
    }));
    expect(actual).toEqual(expected);
    // The one wildcard token is the agent id in Glass's feed subscription: geldar.<shard>.kino.*.feed.
    const bare = entries.some((e) =>
      [...e.pub, ...e.sub].some(
        // AN-12b: one life's level push (body) and one life's proficiency request (eventsink) are the two exact one-token grants
        // of the state subtree; the table above pins each of them. GX-NATS: the eventsink's one life sheet subject is the third.
        (s) =>
          s.split('.').includes('*') &&
          s !== `geldar.${SHARD}.kino.*.feed` &&
          s !== `geldar.${SHARD}.state.*.level` &&
          s !== `geldar.${SHARD}.state.*.proficiency` &&
          s !== `geldar.${SHARD}.life.*.sheet`,
      ),
    );
    expect(bare).toBe(false);
  });

  it('keeps the Kino subjects to the plugin and to Glass: only paper publishes the feed, only kino publishes control', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const by = (u: string) => entries.find((e) => e.user === u);
    const feed = `geldar.${SHARD}.kino.ag_x.feed`;
    const control = `geldar.${SHARD}.kino.control`;
    // body may publish geldar.<s>.> but its deny list takes the whole kino tree off it; paper is denied control only.
    expect(by('body')?.deny).toEqual([
      `geldar.${SHARD}.kino.>`,
      `geldar.${SHARD}.blockowner.changed`,
      `geldar.${SHARD}.ctl.body.>`,
      `geldar.${SHARD}.helper.body.>`,
      `geldar.${SHARD}.state.*.level`,
      `geldar.${SHARD}.body.*.hearing`,
      `geldar.${SHARD}.provenance.>`,
      `geldar.${SHARD}.life.>`,
    ]);
    expect(by('paper')?.deny).toEqual([
      control,
      `geldar.${SHARD}.blockowner.query`,
      `geldar.${SHARD}.ctl.body.>`,
      `geldar.${SHARD}.helper.body.>`,
      `geldar.${SHARD}.state.*.level`,
      `geldar.${SHARD}.life.>`,
    ]);
    expect(by('kino')?.deny).toEqual([]);
    const reach = (subject: string, list: string[]) =>
      list.some((p) => subject === p || (p.endsWith('.>') && subject.startsWith(p.slice(0, -1))));
    const pubs = entries
      .filter((e) => reach(control, e.pub) && !reach(control, e.deny))
      .map((e) => e.user);
    const feedPubs = entries
      .filter((e) => reach(feed, e.pub) && !reach(feed, e.deny))
      .map((e) => e.user);
    const subsControl = entries.filter((e) => reach(control, e.sub)).map((e) => e.user);
    expect(pubs).toEqual(['kino']);
    expect(feedPubs).toEqual(['paper']);
    expect(subsControl).toEqual(['paper']);
    const subsFeed = entries
      .filter((e) => e.sub.includes(`geldar.${SHARD}.kino.*.feed`))
      .map((e) => e.user);
    expect(subsFeed).toEqual(['kino']);
  });

  it('routes block ownership: the plugin answers the query and publishes changed, the body queries and hears changed, no one else', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const by = (u: string) => entries.find((e) => e.user === u);
    const query = `geldar.${SHARD}.blockowner.query`;
    const changed = `geldar.${SHARD}.blockowner.changed`;
    const reach = (subject: string, list: string[]) =>
      list.some((p) => subject === p || (p.endsWith('.>') && subject.startsWith(p.slice(0, -1))));
    const canPub = (subject: string) =>
      entries.filter((e) => reach(subject, e.pub) && !reach(subject, e.deny)).map((e) => e.user);
    const canSub = (subject: string) =>
      entries.filter((e) => reach(subject, e.sub)).map((e) => e.user);
    expect(canPub(query)).toEqual(['body']);
    expect(canSub(query)).toEqual(['paper']);
    expect(canPub(changed)).toEqual(['paper']);
    expect(canSub(changed)).toEqual(['body']);
    // Replies travel on the request's inbox: the plugin and the body both may publish there.
    expect(canPub('_INBOX.abc.1')).toEqual(expect.arrayContaining(['body', 'paper']));
    // The body is denied publishing changed and the whole kino tree; the plugin is denied publishing the query.
    expect(by('body')?.deny).toContain(changed);
    expect(canPub(`geldar.${SHARD}.kino.ag_x.feed`)).not.toContain('body');
    expect(canSub(`geldar.${SHARD}.kino.ag_x.feed`)).not.toContain('body');
    expect(by('paper')?.deny).toContain(query);
    expect(canPub(query)).not.toContain('kino');
    expect(canSub(changed)).not.toContain('kino');
  });

  // 0280 (the ACL follow-up): a Body may not forge a level push. The body and paper roles hold a broad publish on
  // geldar.<s>.>, so the state push is denied to them by name; the request (state.<life>.proficiency) stays theirs and
  // the eventsink publishes the push. NATS matching: `*` is one token, `>` is the rest of the subject.
  it('denies the body and paper roles a level push, keeps their proficiency request, and lets the eventsink publish the push', () => {
    const entries = parseEntries(rendered?.conf ?? '');
    const by = (u: string) => entries.find((e) => e.user === u);
    const matches = (pattern: string, subject: string) => {
      const p = pattern.split('.');
      const t = subject.split('.');
      for (let i = 0; i < p.length; i++) {
        if (p[i] === '>') return i < t.length;
        if (i >= t.length || (p[i] !== '*' && p[i] !== t[i])) return false;
      }
      return p.length === t.length;
    };
    const canPub = (subject: string) =>
      entries
        .filter(
          (e) => e.pub.some((p) => matches(p, subject)) && !e.deny.some((p) => matches(p, subject)),
        )
        .map((e) => e.user);
    const level = `geldar.${SHARD}.state.life_1.level`;
    const request = `geldar.${SHARD}.state.life_1.proficiency`;
    expect(by('body')?.deny).toContain(`geldar.${SHARD}.state.*.level`);
    expect(by('paper')?.deny).toContain(`geldar.${SHARD}.state.*.level`);
    expect(canPub(level)).toEqual(['eventsink']);
    expect(canPub(request)).toContain('body');
  });
});
