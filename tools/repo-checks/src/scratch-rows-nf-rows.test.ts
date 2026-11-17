// deploy/scratch/telemetry-rows-nf.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH. Modelled on scratch-rows.test.ts (the Paper driver). The fakes are in scratch-rows-nf-fakes.ts.
import { describe, expect, it, vi } from 'vitest';
import { SH } from './scratch-harness.js';
import {
  AGENT_CMD,
  ev,
  GOOD_RES,
  gauge,
  histo,
  iattr,
  join1,
  many,
  PROBE,
  quit1,
  runRows,
  sattr,
  ULID_A,
  ULID_B,
  withRes,
  wrap,
} from './scratch-rows-nf-fakes.js';

if (!SH)
  console.warn(
    'scratch-rows-nf.test.ts: sh is not on PATH, the NeoForge row driver tests are skipped',
  );

vi.setConfig({ maxConcurrency: 64 });

describe.skipIf(!SH)(
  'telemetry-rows-nf.sh: rows on synthetic journals',
  { timeout: 900_000 },
  () => {
    it.concurrent('NF0 passes with the agent flag in pid 1 and reports which way; scans /proc when pid 1 has none', async () => {
      const ok = await runRows(['--only', 'NF0']);
      expect(ok.out).toMatch(
        /^ROW NF0 PASS got=export_lines=1 agent=yes via=pid1 user_jvm_args_flag=yes agent_log_lines=1 java_flags=Xmx cmdline ledger_copy=present copy_is_mounted_file=yes mount_ro=yes mount_is_profile=yes mod_jar=present ledger_log_lines=1 /m,
      );
      expect(ok.log).not.toContain('hunter2'); // the rest of the command line stays out of the log
      const scan = await runRows(['--only', 'NF0'], {
        env: { FAKE_CMDLINE: 'sh /entry.sh', FAKE_PROCS: AGENT_CMD },
      });
      expect(scan.out).toMatch(/^ROW NF0 PASS got=\S+ agent=yes via=proc-scan /m);
      const none = await runRows(['--only', 'NF0'], {
        env: { FAKE_CMDLINE: 'java -Xmx9G -jar x.jar' },
      });
      expect(none.out).toMatch(/^ROW NF0 FAIL got=\S+ agent=no /m);
      const rw = await runRows(['--only', 'NF0'], { env: { FAKE_RW: 'true' } });
      expect(rw.out).toMatch(/^ROW NF0 FAIL got=.* mount_ro=no /m);
      expect((await runRows(['--only', 'NF0'], { env: { FAKE_LOGS: '' } })).out).toMatch(
        /^ROW NF0 FAIL /m,
      );
      expect(
        (await runRows(['--only', 'NF0'], { env: { FAKE_LOGS: 'Geldar Ledger loaded' } })).out,
      ).toMatch(/^ROW NF0 FAIL .*agent_log_lines=0 /m); // no agent banner
      expect((await runRows(['--only', 'NF0'], { env: { FAKE_JVM_ARGS: '-Xmx9G' } })).out).toMatch(
        /^ROW NF0 FAIL .*user_jvm_args_flag=no /m,
      );
      expect((await runRows(['--only', 'NF0'], { env: { FAKE_NO_JAR: '1' } })).out).toMatch(
        /^ROW NF0 FAIL .*mod_jar=missing /m,
      );
      expect((await runRows(['--only', 'NF0'], { env: { FAKE_NO_PROPS: '1' } })).out).toMatch(
        /^ROW NF0 FAIL /m,
      );
      const empty = await runRows(['--only', 'NF0'], { initial: [] });
      expect(empty.out).toMatch(/^ROW NF0 FAIL got=export_lines=0 /m);
    });

    it.concurrent('NF1 passes on the minimal resource and fails on a host, process, os, container, address or uuid attribute', async () => {
      const good = await runRows(['--only', 'NF1'], { initial: [withRes(GOOD_RES)] });
      expect(good.out).toMatch(
        /^ROW NF1 PASS got=service\.name=geldar-neoforge geldar\.shard=nf forbidden_keys=none /m,
      );
      const bad = async (extra: string, first = false) =>
        runRows(['--only', 'NF1'], {
          initial: first
            ? [withRes(`${GOOD_RES},${extra}`)]
            : [withRes(GOOD_RES), withRes(`${GOOD_RES},${extra}`)],
        });
      for (const k of ['host.name', 'process.pid', 'os.type', 'container.id'])
        expect((await bad(sattr(k, 'x'))).out, k).toMatch(
          /^ROW NF1 FAIL .*forbidden_keys=\S*"key":"/m,
        );
      expect((await bad(sattr('geldar.note', '192.0.2.10'), true)).out).toMatch(
        /^ROW NF1 FAIL .*address_or_uuid_blocks=1/m,
      );
      expect(
        (await bad(sattr('geldar.note', '123e4567-e89b-12d3-a456-426614174000'), true)).out,
      ).toMatch(/^ROW NF1 FAIL /m);
      expect(
        (await bad(sattr('geldar.note', '2001:db8:85a3:0:0:8a2e:370:7334'), true)).out,
      ).toMatch(/^ROW NF1 FAIL /m);
      const wrong = await runRows(['--only', 'NF1'], {
        initial: [withRes(sattr('service.name', 'other'))],
      });
      expect(wrong.out).toMatch(/^ROW NF1 FAIL got=service\.name=other geldar\.shard=none /m);
      expect((await runRows(['--only', 'NF1'])).out).toMatch(
        /^ROW NF1 FAIL got=no-resource-attributes/m,
      );
    });

    it.concurrent('NF3 checks players against list, mods_loaded >= 2 and the snapshot keys', async () => {
      const snap = (extra: string[] = []) =>
        ev(
          'geldar.server.config_snapshot',
          iattr('view_distance', 10),
          sattr('jvm_xmx', '9G'),
          ...extra,
        );
      const base = (mods: number) => [
        gauge('geldar_players_online', 0),
        gauge('geldar_mods_loaded', mods),
        gauge('geldar_operators_count', 0),
      ];
      const pass = await runRows(['--only', 'NF3'], { initial: [snap()], pending: base(3) });
      expect(pass.out).toMatch(
        /^ROW NF3 PASS got=list=0 online=0 mods=3 ops=0 snapshot_keys=jvm_xmx,view_distance forbidden=0/m,
      );
      expect(
        (await runRows(['--only', 'NF3'], { initial: [snap()], pending: base(1) })).out,
      ).toMatch(/^ROW NF3 FAIL /m);
      const leak = await runRows(['--only', 'NF3'], {
        initial: [snap([sattr('rcon.password', 'x')])],
        pending: base(3),
      });
      expect(leak.out).toMatch(/^ROW NF3 FAIL .*forbidden=1/m);
      expect((await runRows(['--only', 'NF3'], { pending: base(3) })).out).toMatch(
        /^ROW NF3 FAIL /m,
      );
      const mismatch = await runRows(['--only', 'NF3'], {
        initial: [snap()],
        pending: base(3),
        env: { FAKE_ONLINE: '2' },
      });
      expect(mismatch.out).toMatch(/^ROW NF3 FAIL got=list=2 online=0 /m);
    });

    it.concurrent('NF4 reports both counts and fails on a missing gauge or more players than the list', async () => {
      const w = 'minecraft:overworld';
      const g = (pl: number) => [
        gauge('geldar_world_loaded_chunks', 441, w),
        gauge('geldar_world_entities', 12, w),
        gauge('geldar_world_players', pl, w),
      ];
      const ok = await runRows(['--only', 'NF4'], { pending: g(0) });
      expect(ok.out).toMatch(
        /^ROW NF4 PASS got=overworld chunks=441 entities=12 players=0 list=0 server_chunk_count=unavailable /m,
      );
      expect(ok.log).toContain('NF4 server reply (neoforge tps)');
      expect((await runRows(['--only', 'NF4'], { pending: g(1) })).out).toMatch(/^ROW NF4 FAIL /m);
      expect((await runRows(['--only', 'NF4'])).out).toMatch(/^ROW NF4 FAIL /m);
    });

    const stallRec = (flag: number, ms: number) =>
      ev('geldar.server.stall', iattr('geldar.flag', flag), iattr('geldar.duration_ms', ms));
    const T = [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)];
    it.concurrent('NF5 pauses the server only and expects flag 1 at 2000-2500 ms then flag 0 at 4000 ms +-10%', async () => {
      const run = async (recs: string[], stalls = 1) =>
        runRows(['--only', 'NF2,NF5'], {
          pending: T,
          pendingAt: { 4: [gauge('geldar_tick_stalls_total', stalls), ...recs] },
        });
      const ok = await run([stallRec(1, 2100), stallRec(0, 4000)]);
      expect(ok.out).toMatch(/^ROW NF5 PASS got=stalls=0->1 flags=1 0 durations=2100 4000 /m);
      expect(ok.docker.filter((c) => /^(un)?pause /.test(c))).toEqual([
        'pause fake-paper',
        'unpause fake-paper',
      ]);
      expect((await run([stallRec(1, 2100)])).out).toMatch(
        /^ROW NF5 FAIL got=stalls=0->1 flags=1 /m,
      );
      expect((await run([stallRec(1, 2600), stallRec(0, 4000)])).out).toMatch(/^ROW NF5 FAIL /m);
      expect((await run([stallRec(1, 2100), stallRec(0, 4500)])).out).toMatch(/^ROW NF5 FAIL /m);
      expect((await run([stallRec(1, 2100), stallRec(0, 4000)], 2)).out).toMatch(
        /^ROW NF5 FAIL got=stalls=0->2 /m,
      );
    });

    it.concurrent('NF6 passes with a join and a quit of one ULID session; fails on two sessions, a bad session or no duration', async () => {
      const run = async (recs: string[]) =>
        runRows(['--only', 'NF6'], { env: PROBE, pending: recs });
      const ok = await run([join1(ULID_A), quit1(ULID_A)]);
      expect(ok.out).toMatch(
        /^ROW NF6 PASS got=join=1 quit=1 life_id=yes session_ulid=1 same_session=yes duration_ms=61000 /m,
      );
      expect(ok.log).toContain('p0 join ok name=ag_nfprobe_01');
      expect((await run([join1(ULID_A), quit1(ULID_B)])).out).toMatch(
        /^ROW NF6 FAIL .*same_session=no/m,
      );
      expect((await run([join1('not-a-ulid'), quit1('not-a-ulid')])).out).toMatch(
        /^ROW NF6 FAIL .*session_ulid=0/m,
      );
      const noDur = ev('geldar.player.quit', sattr('geldar.mc_session', ULID_A));
      expect((await run([join1(ULID_A), noDur])).out).toMatch(/^ROW NF6 FAIL .*duration_ms=none/m);
      expect((await run([quit1(ULID_A)])).out).toMatch(/^ROW NF6 FAIL got=join=0 /m);
      const skip = await runRows(['--only', 'NF6']);
      expect(skip.out).toMatch(/^ROW NF6 SKIP reason=no-probe-driver /m);
      expect(skip.status).toBe(0);
    });

    it.concurrent('NF7 is skipped as not drivable, fails when a snapshot carries another session', async () => {
      const snap = (s: string) =>
        ev(
          'geldar.player.snapshot',
          sattr('geldar.life_id', 'ag_nfprobe_01'),
          sattr('geldar.mc_session', s),
        );
      const ok = await runRows(['--only', 'NF6,NF7'], {
        env: PROBE,
        pending: [join1(ULID_A), snap(ULID_A), quit1(ULID_A)],
      });
      expect(ok.out).toMatch(
        /^ROW NF7 SKIP reason=no-respawn-driver got=snapshots=1 snapshot_sessions_not_the_join_session=0 respawn=not-driven /m,
      );
      const bad = await runRows(['--only', 'NF6,NF7'], {
        env: PROBE,
        pending: [join1(ULID_A), snap(ULID_B), quit1(ULID_A)],
      });
      expect(bad.out).toMatch(
        /^ROW NF7 FAIL got=snapshots=1 snapshot_sessions_not_the_join_session=1 /m,
      );
      expect((await runRows(['--only', 'NF7'])).out).toMatch(
        /^ROW NF7 SKIP reason=dep-not-run-or-unmet:NF6 /m,
      );
    });

    it.concurrent('NF8 finds IPv4, IPv6 and UUID-shaped strings anywhere; versions and 0.0.0.0 are not addresses; an empty sink skips', async () => {
      const rec = (v: string) => ev('geldar.x', sattr('geldar.note', v));
      const body = (v: string) =>
        `{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"body":{"stringValue":"${v}"},"eventName":"geldar.x"}]}]}]}`;
      const [clean, allowed, quad, bodyQuad, v6, uuid, empty] = await many([
        [['--only', 'NF8']],
        [
          ['--only', 'NF8'],
          {
            initial: [
              rec('bind 0.0.0.0'),
              rec('v 26.1.2.126x'),
              ev('geldar.server.config_snapshot', sattr('server_version', '1.2.3.4')),
              ev(
                'x',
                sattr('telemetry.sdk.version', '5.6.7.8'),
                sattr('process.runtime.version', '9.10.11.12'),
              ),
            ],
          },
        ],
        [['--only', 'NF8'], { initial: [rec('at 192.0.2.20')] }],
        [['--only', 'NF8'], { initial: [body('connect from 192.0.2.21')] }],
        [['--only', 'NF8'], { initial: [rec('fe80::1')] }],
        [['--only', 'NF8'], { initial: [rec('123e4567-e89b-12d3-a456-426614174000')] }],
        [['--only', 'NF8'], { initial: [] }],
      ]);
      expect(clean?.out).toMatch(/^ROW NF8 PASS got=ipv4_hits=0 ipv6_lines=0 uuid_lines=0 /m);
      expect(allowed?.out).toMatch(/^ROW NF8 PASS got=ipv4_hits=0 /m);
      expect(quad?.out).toMatch(/^ROW NF8 FAIL got=ipv4_hits=1 /m); // a bare quad in a non-version attribute
      expect(bodyQuad?.out).toMatch(/^ROW NF8 FAIL got=ipv4_hits=1 /m); // and in an event body
      expect(v6?.out).toMatch(/^ROW NF8 FAIL .*ipv6_lines=1/m);
      expect(uuid?.out).toMatch(/^ROW NF8 FAIL .*uuid_lines=1/m);
      expect(empty?.out).toMatch(/^ROW NF8 SKIP reason=empty-sink /m);
    });

    const cmdRec = (name: string, amount: number) =>
      ev('geldar.rcon.command', sattr('geldar.command', name), iattr('geldar.amount', amount));
    const NAME_ONLY = [cmdRec('say', 1), cmdRec('msg', 2), cmdRec('unknown', 2)];

    it.concurrent('NF9A fails on a chat export line in either log or any geldar.chat record, skips with chat on in the profile', async () => {
      const ok = await runRows(['--only', 'NF9A']);
      expect(ok.out).toMatch(
        /^ROW NF9A PASS got=container_log_hits=0 latest_log_hits=0 chat_records=0 /m,
      );
      const inContainer = await runRows(['--only', 'NF9A'], {
        env: { FAKE_LOGS: 'x\nledger chat export on\ny' },
      });
      expect(inContainer.out).toMatch(/^ROW NF9A FAIL got=container_log_hits=1 /m);
      const inFile = await runRows(['--only', 'NF9A'], { env: { FAKE_LATEST_COUNT: '2' } });
      expect(inFile.out).toMatch(/^ROW NF9A FAIL got=container_log_hits=0 latest_log_hits=2 /m);
      const rec = await runRows(['--only', 'NF9A'], {
        initial: [ev('geldar.chat', sattr('geldar.text', 'hi'))],
      });
      expect(rec.out).toMatch(/^ROW NF9A FAIL .*chat_records=present/m);
      const unreadable = await runRows(['--only', 'NF9A'], { env: { FAKE_LATEST_COUNT: 'x' } });
      expect(unreadable.out).toMatch(/^ROW NF9A PASS got=.*latest_log_hits=unreadable /m);
      const on = await runRows(['--only', 'NF9A'], {
        profileText: 'collector.chat.enabled=true\ncollector.audit.enabled=true\n',
      });
      expect(on.out).toMatch(/^ROW NF9A SKIP reason=chat-enabled-in-profile /m);
    });

    it.concurrent('NF9B passes with name-only command records and fails when an argument leaks anywhere', async () => {
      const ok = await runRows(['--only', 'NF9B'], { pending: NAME_ONLY });
      expect(ok.out).toMatch(
        /^ROW NF9B PASS got=say_amount=1 msg_amount=2 unknown_records=1 leaked_argument_strings=0 /m,
      );
      const sent = ok.docker.filter((c) => c.includes('rcon-cli') && !c.includes('tick query'));
      expect(sent).toEqual([
        'exec fake-paper rcon-cli say marker-argument-xyz',
        'exec fake-paper rcon-cli msg ag_nfprobe_01 secret-arg-abc',
        'exec fake-paper rcon-cli rcon hunter2 x',
      ]);
      for (const leak of ['marker-argument-xyz', 'secret-arg-abc', 'hunter2']) {
        const body = await runRows(['--only', 'NF9B'], {
          pending: [
            ...NAME_ONLY,
            ev('geldar.rcon.command', sattr('geldar.command', `say ${leak}`)),
          ],
        });
        expect(body.out, leak).toMatch(/^ROW NF9B FAIL .*leaked_argument_strings=1/m);
        const old = await runRows(['--only', 'NF9B'], {
          pending: NAME_ONLY,
          initial: [wrap(`{"name":"x","description":"${leak}"}`)],
        });
        expect(old.out, leak).toMatch(/^ROW NF9B FAIL .*leaked_argument_strings=1/m); // anywhere in the journal
      }
      expect(
        (
          await runRows(['--only', 'NF9B'], {
            pending: [cmdRec('say', 2), cmdRec('msg', 2), cmdRec('unknown', 1)],
          })
        ).out,
      ).toMatch(/^ROW NF9B FAIL got=say_amount=2 /m);
      expect(
        (await runRows(['--only', 'NF9B'], { pending: [cmdRec('say', 1), cmdRec('msg', 2)] })).out,
      ).toMatch(/^ROW NF9B FAIL got=.* unknown_records=0 /m);
      const off = await runRows(['--only', 'NF9B'], {
        profileText: 'collector.audit.enabled=false\n',
      });
      expect(off.out).toMatch(/^ROW NF9B SKIP reason=audit-not-true-in-profile /m);
    });

    it.concurrent('NF9C is skipped as no-driver without an online agent; with one it expects operator flags 1, 0 and a death by life id', async () => {
      const none = await runRows(['--only', 'NF9C']);
      expect(none.out).toMatch(/^ROW NF9C SKIP reason=no-driver got=no-agent-online /m);
      const opRec = (f: number) => ev('geldar.operator.change', iattr('geldar.flag', f));
      const death = (id: string) => ev('geldar.combat.player_death', sattr('geldar.life_id', id));
      const env = { FAKE_ONLINE: '1', FAKE_NAMES: 'ag_nfprobe_01' };
      const ok = await runRows(['--only', 'NF9C'], {
        env,
        pending: [opRec(1), opRec(0), death('ag_nfprobe_01')],
      });
      expect(ok.out).toMatch(/^ROW NF9C PASS got=operator_flags=1 0 player_death_with_life_id=1/m);
      expect(
        ok.docker
          .filter((c) => /rcon-cli (op|deop|kill) /.test(c))
          .map((c) => c.split('rcon-cli ')[1]),
      ).toEqual(['op ag_nfprobe_01', 'deop ag_nfprobe_01', 'kill ag_nfprobe_01']);
      expect(
        (await runRows(['--only', 'NF9C'], { env, pending: [opRec(1), opRec(0)] })).out,
      ).toMatch(/^ROW NF9C FAIL .*player_death_with_life_id=0/m);
      expect(
        (
          await runRows(['--only', 'NF9C'], {
            env,
            pending: [opRec(0), opRec(1), death('ag_nfprobe_01')],
          })
        ).out,
      ).toMatch(/^ROW NF9C FAIL got=operator_flags=0 1 /m);
      const human = await runRows(['--only', 'NF9C'], {
        env: { FAKE_ONLINE: '1', FAKE_NAMES: 'Steve' },
      });
      expect(human.out).toMatch(/^ROW NF9C SKIP reason=no-driver /m); // a human name is never driven
      expect(human.docker.some((c) => c.includes('Steve'))).toBe(false);
    });

    it.concurrent('the summary reports the idle chat name mask (NF9d)', async () => {
      expect((await runRows(['--only', 'NF8'])).out).toContain('chat_name_mask=idle');
    });
  },
);
