import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasPwsh, parseEntries, type Rendered, renderGenerator } from './nats-auth-fixtures.ts';

// The velocity NATS user of the nf set, read from the generator's output in a temp checkout (--live --local, never the live
// checkout). The velocity service (compose/nf-live.yml) has this user; velocity-human has its own, human (nats-human-grants-nf.test.ts).
// Registry client (plugin/velocity-identity/src/main/java/dev/geldar/identity/RegistryClient.java): nc.keyValue(bucket) binds
// the bucket (line 88, STREAM.INFO on KV_<bucket>), and kv.watchAll (line 183) is a push watch: the consumer is created and
// deleted under the KV_ stream, its flow control runs on $JS.FC, and its messages arrive on the inbox. Those are the subjects
// WATCH_SUBJECTS lists. The client does not read through CONSUMER.MSG.NEXT, so that subject is not granted.
const REGISTRY = 'KV_geldar-life-registry';
const SKINS = 'KV_geldar-skins';
const WATCH_SUBJECTS = [
  `$JS.API.STREAM.INFO.${REGISTRY}`,
  `$JS.API.CONSUMER.CREATE.${REGISTRY}`,
  `$JS.API.CONSUMER.CREATE.${REGISTRY}.>`,
  `$JS.API.CONSUMER.INFO.${REGISTRY}.>`,
  `$JS.API.CONSUMER.DELETE.${REGISTRY}.>`,
  '$JS.FC.>',
  '_INBOX.>',
];
// The skins read the human lane inherits (the velocity user reads both buckets today). Pinned so a change is deliberate.
const SKIN_SUBJECTS = [
  `$JS.API.STREAM.INFO.${SKINS}`,
  `$JS.API.CONSUMER.CREATE.${SKINS}`,
  `$JS.API.CONSUMER.CREATE.${SKINS}.>`,
  `$JS.API.CONSUMER.INFO.${SKINS}.>`,
  `$JS.API.CONSUMER.DELETE.${SKINS}.>`,
];
const OTHER_USERS = ['neoforge', 'sink', 'deploy', 'seed', 'body'];

describe.skipIf(!hasPwsh)(
  'NF NATS grants: the velocity user (and the human lane that shares it)',
  () => {
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

    it('gives velocity the registry watch, and only that: the bucket subjects it publishes are exactly the watch set', () => {
      const v = entryOf('velocity');
      expect(v.pub).toEqual(expect.arrayContaining(WATCH_SUBJECTS));
      expect(v.sub).toEqual(['_INBOX.>']);
      expect(v.pub.filter((s) => s.includes(REGISTRY))).toEqual(
        WATCH_SUBJECTS.filter((s) => s.includes(REGISTRY)),
      );
    }, 30_000);

    it('gives velocity no publish to any $KV subject (no key write, no key delete, on any bucket)', () => {
      const v = entryOf('velocity');
      expect(v.pub.filter((s) => s.startsWith('$KV'))).toEqual([]);
    }, 30_000);

    it('gives velocity no $JS.API wildcard and no write to the registry stream (no create, update or purge)', () => {
      const v = entryOf('velocity');
      expect(v.pub).not.toContain('$JS.API.>');
      expect(v.pub.filter((s) => /^(\$JS\.API\.>|>)$/.test(s))).toEqual([]);
      expect(v.pub).not.toContain(`$JS.API.STREAM.CREATE.${REGISTRY}`);
      expect(v.pub).not.toContain(`$JS.API.STREAM.UPDATE.${REGISTRY}`);
      expect(v.pub.some((s) => s.startsWith(`$JS.API.STREAM.PURGE.${REGISTRY}`))).toBe(false);
    }, 30_000);

    it('reads the skins bucket too, with exactly the five skin subjects (a change to this is deliberate)', () => {
      const v = entryOf('velocity');
      expect(v.pub.filter((s) => s.includes(SKINS))).toEqual(SKIN_SUBJECTS);
    }, 30_000);

    it('shares no registry watch grant with neoforge, sink, deploy, seed or body (the inbox is common to all, by design)', () => {
      for (const user of OTHER_USERS) {
        const e = entryOf(user);
        const shared = [...e.pub, ...e.sub].filter(
          (s) => WATCH_SUBJECTS.includes(s) && s !== '_INBOX.>',
        );
        // Finding, pinned: seed (which creates the buckets) and body (the probe) both hold the registry's STREAM.INFO too.
        // Neither holds a consumer, flow-control or delete grant on the registry. A new overlap fails this test.
        const pinned =
          user === 'seed' || user === 'body' ? [`$JS.API.STREAM.INFO.${REGISTRY}`] : [];
        expect(shared, user).toEqual(pinned);
      }
    }, 30_000);
  },
);
