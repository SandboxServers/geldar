// deploy/scratch/telemetry-rows-nf.sh under sh with a fake docker, a fake rcon-cli, a fake sleep and a synthetic otlp.jsonl.
// Skips (and says so) where sh is not on PATH. Modelled on scratch-rows.test.ts (the Paper driver). The fakes are in scratch-rows-nf-fakes.ts.
import { describe, expect, it } from 'vitest';
import { SH } from './scratch-harness.js';
import {
  AGENT_CMD,
  compose,
  ev,
  GOOD_RES,
  gauge,
  histo,
  iattr,
  join1,
  PROBE,
  PROFILE_TEXT,
  quit1,
  runRows,
  sattr,
  shaLine,
  ULID_A,
  ULID_B,
  withRes,
  wrap,
} from './scratch-rows-nf-fakes.js';

if (!SH)
  console.warn(
    'scratch-rows-nf.test.ts: sh is not on PATH, the NeoForge row driver tests are skipped',
  );

describe.skipIf(!SH)('telemetry-rows-nf.sh', { timeout: 900_000 }, () => {
  it('--list prints every row with its dependencies, NF11 before NF10', () => {
    const r = runRows(['--list']);
    expect(r.status).toBe(0);
    const lines = r.out.trim().split('\n');
    expect(lines.map((l) => l.split(' ')[0])).toEqual(
      'NF0 NF1 NF2 NF3 NF4 NF5 NF6 NF7 NF9A NF9B NF9C NF8 NF11 NF10'.split(' '),
    );
    expect(lines).toContain('NF5 deps=NF2');
    expect(lines).toContain('NF7 deps=NF6');
    expect(lines).toContain('NF10 deps=NF0');
    expect(runRows(['--only', 'T1']).status).toBe(2);
  });

  it('NF11 has the contract format and the summary is complete', () => {
    const r = runRows(['--only', 'NF11']);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(
      /^ROW NF11 PASS got=memory_current=1000->1000 limit=10000 nr_throttled=3->3 java_rss_kb=123456 want=\S.*$/m,
    );
    const sums = shaLine(r.out);
    expect(sums?.[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(sums?.[2]).toBe(sums?.[1]);
    expect(r.out).toContain('SUMMARY');
    expect(r.out).toMatch(/memory_current_bytes=1000 cgroup=\S+ limit=10000/);
    expect(r.out).toContain('nr_throttled=3');
    expect(r.out).toContain('tick_query: Average time per tick');
    expect(r.out).toMatch(/node_clock_utc start=\S+Z end=\S+Z/);
    expect(r.out).toContain('shutdown_flush=not-a-row');
    expect(runRows(['--only', 'NF11'], { env: { FAKE_NO_RSS: '1' } }).out).toMatch(
      /^ROW NF11 FAIL /m,
    );
  });

  it('NF2 passes at 20 histogram counts per second and fails at 21.7', () => {
    const pass = runRows(['--only', 'NF2'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)],
    });
    expect(pass.out).toMatch(/^ROW NF2 PASS got=delta=1250 elapsed=62\.5s rate=20\.00\/s want=/m);
    const fail = runRows(['--only', 'NF2'], {
      pending: [histo('1700000000000000000', 1000), histo('1700000060000000000', 2300)],
    });
    expect(fail.out).toMatch(/^ROW NF2 FAIL got=delta=1300 elapsed=60\.0s rate=21\.67\/s/m);
    expect(fail.status).toBe(1);
  });

  it('skips only the dependents of a failed row; an independent row still runs', () => {
    const r = runRows(['--only', 'NF2,NF5,NF8']);
    expect(r.out).toMatch(/^ROW NF2 FAIL /m);
    expect(r.out).toMatch(/^ROW NF5 SKIP reason=dep-failed:NF2 got=none want=dependency-met$/m);
    expect(r.out).toMatch(/^ROW NF8 PASS /m);
    expect(r.status).toBe(1);
    const env0 = runRows(['--only', 'NF0,NF1'], { env: { FAKE_CMDLINE: 'java -jar x.jar' } });
    expect(env0.out).toMatch(/^ROW NF0 FAIL /m);
    expect(env0.out).toMatch(/^ROW NF1 SKIP reason=dep-failed:NF0 /m); // a failed environment row blocks the rest
    expect(runRows(['--only', 'NF5']).out).toMatch(
      /^ROW NF5 SKIP reason=dep-not-run-or-unmet:NF2 /m,
    );
  });

  it('aborts above 90% of the cgroup memory.max, not at it; 14 GiB when there is no numeric limit', () => {
    const over = runRows(['--only', 'NF8'], { memory: 901, limit: '1000' });
    expect(over.status).toBe(3);
    expect(over.out).toMatch(/^ABORT reason=neoforge-memory-current-above-90pct-of-limit:901$/m);
    expect(over.out).not.toMatch(/^ROW /m);
    expect(over.out).toContain('SUMMARY');
    expect(runRows(['--only', 'NF8'], { memory: 900, limit: '1000' }).status).toBe(0);
    expect(runRows(['--only', 'NF8'], { memory: 2_000_000_000, limit: 'max' }).status).toBe(0);
    expect(runRows(['--only', 'NF8'], { memory: 15_032_385_537, limit: 'max' }).status).toBe(3);
  });

  it('aborts on low MemAvailable, a restarted non-scratch container, a vanished cgroup file', () => {
    const a = runRows(['--only', 'NF8'], { avail: 31_457_279 });
    expect(a.status).toBe(3);
    expect(a.out).toMatch(/^ABORT reason=node-MemAvailable-below-30GiB:31457279kB$/m);
    const b = runRows(['--only', 'NF8'], { restartAfter: 1 });
    expect(b.status).toBe(3);
    expect(b.out).toMatch(/^ABORT reason=non-scratch-container-restarted$/m);
    expect(b.out).not.toMatch(/^ROW /m);
    const c = runRows(['--only', 'NF2'], { vanish: true });
    expect(c.status).toBe(3);
    expect(c.out).toMatch(/^ABORT reason=neoforge-memory-current-unreadable$/m);
    const none = runRows(['--only', 'NF8'], { tree: true });
    expect(none.status).toBe(2);
    expect(none.out).toMatch(/^ABORT reason=no-cgroup-memory-current$/m);
  });

  it('a non-scratch container that appears or disappears does not abort; other tenants stay out of the log', () => {
    for (const list of ['live-nats other-new', '']) {
      const r = runRows(['--only', 'NF8'], { env: { FAKE_NS_AFTER_N: '2', FAKE_NS_AFTER: list } });
      expect(r.status).toBe(0);
      expect(r.out).not.toMatch(/^ABORT/m);
    }
    const r = runRows(['--only', 'NF8']);
    expect(r.log).toContain('non-scratch count=1');
    expect(r.log).not.toContain('live-nats');
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(false);
  });

  it('writes the profile back byte for byte when NF10 is aborted mid-row', () => {
    const r = runRows(['--only', 'NF10'], { restartAfter: 2 });
    expect(r.status).toBe(3);
    expect(r.files).toContain('enabled=false'); // it really was changed while the row ran
    expect(r.profile).toBe(PROFILE_TEXT);
    const sums = shaLine(r.out);
    expect(sums?.[2]).toBe(sums?.[1]);
  });

  it('keeps the saved profile and exits 4 when the restore cannot be verified', () => {
    const r = runRows(['--only', 'NF8'], { fakeSha: true });
    expect(r.status).toBe(4);
    expect(r.out).toMatch(/^ABORT reason=profile-sha256-differs-after-restore saved_profile=\S+$/m);
    expect(r.outFiles.some((f) => f.startsWith('ledger.properties.orig'))).toBe(true);
  });
});

describe.skipIf(!SH)(
  'telemetry-rows-nf.sh: rows on synthetic journals',
  { timeout: 900_000 },
  () => {
    it('NF0 passes with the agent flag in pid 1 and reports which way; scans /proc when pid 1 has none', () => {
      const ok = runRows(['--only', 'NF0']);
      expect(ok.out).toMatch(
        /^ROW NF0 PASS got=export_lines=1 agent=yes via=pid1 user_jvm_args_flag=yes agent_log_lines=1 java_flags=Xmx cmdline ledger_copy=present copy_is_mounted_file=yes mount_ro=yes mount_is_profile=yes mod_jar=present ledger_log_lines=1 /m,
      );
      expect(ok.log).not.toContain('hunter2'); // the rest of the command line stays out of the log
      const scan = runRows(['--only', 'NF0'], {
        env: { FAKE_CMDLINE: 'sh /entry.sh', FAKE_PROCS: AGENT_CMD },
      });
      expect(scan.out).toMatch(/^ROW NF0 PASS got=\S+ agent=yes via=proc-scan /m);
      const none = runRows(['--only', 'NF0'], { env: { FAKE_CMDLINE: 'java -Xmx9G -jar x.jar' } });
      expect(none.out).toMatch(/^ROW NF0 FAIL got=\S+ agent=no /m);
      const rw = runRows(['--only', 'NF0'], { env: { FAKE_RW: 'true' } });
      expect(rw.out).toMatch(/^ROW NF0 FAIL got=.* mount_ro=no /m);
      expect(runRows(['--only', 'NF0'], { env: { FAKE_LOGS: '' } }).out).toMatch(/^ROW NF0 FAIL /m);
      expect(
        runRows(['--only', 'NF0'], { env: { FAKE_LOGS: 'Geldar Ledger loaded' } }).out,
      ).toMatch(/^ROW NF0 FAIL .*agent_log_lines=0 /m); // no agent banner
      expect(runRows(['--only', 'NF0'], { env: { FAKE_JVM_ARGS: '-Xmx9G' } }).out).toMatch(
        /^ROW NF0 FAIL .*user_jvm_args_flag=no /m,
      );
      expect(runRows(['--only', 'NF0'], { env: { FAKE_NO_JAR: '1' } }).out).toMatch(
        /^ROW NF0 FAIL .*mod_jar=missing /m,
      );
      expect(runRows(['--only', 'NF0'], { env: { FAKE_NO_PROPS: '1' } }).out).toMatch(
        /^ROW NF0 FAIL /m,
      );
      const empty = runRows(['--only', 'NF0'], { initial: [] });
      expect(empty.out).toMatch(/^ROW NF0 FAIL got=export_lines=0 /m);
    });

    it('NF1 passes on the minimal resource and fails on a host, process, os, container, address or uuid attribute', () => {
      const good = runRows(['--only', 'NF1'], { initial: [withRes(GOOD_RES)] });
      expect(good.out).toMatch(
        /^ROW NF1 PASS got=service\.name=geldar-neoforge geldar\.shard=nf forbidden_keys=none /m,
      );
      const bad = (extra: string, first = false) =>
        runRows(['--only', 'NF1'], {
          initial: first
            ? [withRes(`${GOOD_RES},${extra}`)]
            : [withRes(GOOD_RES), withRes(`${GOOD_RES},${extra}`)],
        });
      for (const k of ['host.name', 'process.pid', 'os.type', 'container.id'])
        expect(bad(sattr(k, 'x')).out, k).toMatch(/^ROW NF1 FAIL .*forbidden_keys=\S*"key":"/m);
      expect(bad(sattr('geldar.note', '10.1.2.3'), true).out).toMatch(
        /^ROW NF1 FAIL .*address_or_uuid_blocks=1/m,
      );
      expect(bad(sattr('geldar.note', '123e4567-e89b-12d3-a456-426614174000'), true).out).toMatch(
        /^ROW NF1 FAIL /m,
      );
      expect(bad(sattr('geldar.note', '2001:db8:85a3:0:0:8a2e:370:7334'), true).out).toMatch(
        /^ROW NF1 FAIL /m,
      );
      const wrong = runRows(['--only', 'NF1'], {
        initial: [withRes(sattr('service.name', 'other'))],
      });
      expect(wrong.out).toMatch(/^ROW NF1 FAIL got=service\.name=other geldar\.shard=none /m);
      expect(runRows(['--only', 'NF1']).out).toMatch(/^ROW NF1 FAIL got=no-resource-attributes/m);
    });

    it('NF3 checks players against list, mods_loaded >= 2 and the snapshot keys', () => {
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
      const pass = runRows(['--only', 'NF3'], { initial: [snap()], pending: base(3) });
      expect(pass.out).toMatch(
        /^ROW NF3 PASS got=list=0 online=0 mods=3 ops=0 snapshot_keys=jvm_xmx,view_distance forbidden=0/m,
      );
      expect(runRows(['--only', 'NF3'], { initial: [snap()], pending: base(1) }).out).toMatch(
        /^ROW NF3 FAIL /m,
      );
      const leak = runRows(['--only', 'NF3'], {
        initial: [snap([sattr('rcon.password', 'x')])],
        pending: base(3),
      });
      expect(leak.out).toMatch(/^ROW NF3 FAIL .*forbidden=1/m);
      expect(runRows(['--only', 'NF3'], { pending: base(3) }).out).toMatch(/^ROW NF3 FAIL /m);
      const mismatch = runRows(['--only', 'NF3'], {
        initial: [snap()],
        pending: base(3),
        env: { FAKE_ONLINE: '2' },
      });
      expect(mismatch.out).toMatch(/^ROW NF3 FAIL got=list=2 online=0 /m);
    });

    it('NF4 reports both counts and fails on a missing gauge or more players than the list', () => {
      const w = 'minecraft:overworld';
      const g = (pl: number) => [
        gauge('geldar_world_loaded_chunks', 441, w),
        gauge('geldar_world_entities', 12, w),
        gauge('geldar_world_players', pl, w),
      ];
      const ok = runRows(['--only', 'NF4'], { pending: g(0) });
      expect(ok.out).toMatch(
        /^ROW NF4 PASS got=overworld chunks=441 entities=12 players=0 list=0 server_chunk_count=unavailable /m,
      );
      expect(ok.log).toContain('NF4 server reply (neoforge tps)');
      expect(runRows(['--only', 'NF4'], { pending: g(1) }).out).toMatch(/^ROW NF4 FAIL /m);
      expect(runRows(['--only', 'NF4']).out).toMatch(/^ROW NF4 FAIL /m);
    });

    const stallRec = (flag: number, ms: number) =>
      ev('geldar.server.stall', iattr('geldar.flag', flag), iattr('geldar.duration_ms', ms));
    const T = [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)];
    it('NF5 pauses the server only and expects flag 1 at 2000-2500 ms then flag 0 at 4000 ms +-10%', () => {
      const run = (recs: string[], stalls = 1) =>
        runRows(['--only', 'NF2,NF5'], {
          pending: T,
          pendingAt: { 4: [gauge('geldar_tick_stalls_total', stalls), ...recs] },
        });
      const ok = run([stallRec(1, 2100), stallRec(0, 4000)]);
      expect(ok.out).toMatch(/^ROW NF5 PASS got=stalls=0->1 flags=1 0 durations=2100 4000 /m);
      expect(ok.docker.filter((c) => /^(un)?pause /.test(c))).toEqual([
        'pause fake-paper',
        'unpause fake-paper',
      ]);
      expect(run([stallRec(1, 2100)]).out).toMatch(/^ROW NF5 FAIL got=stalls=0->1 flags=1 /m);
      expect(run([stallRec(1, 2600), stallRec(0, 4000)]).out).toMatch(/^ROW NF5 FAIL /m);
      expect(run([stallRec(1, 2100), stallRec(0, 4500)]).out).toMatch(/^ROW NF5 FAIL /m);
      expect(run([stallRec(1, 2100), stallRec(0, 4000)], 2).out).toMatch(
        /^ROW NF5 FAIL got=stalls=0->2 /m,
      );
    });

    it('NF6 passes with a join and a quit of one ULID session; fails on two sessions, a bad session or no duration', () => {
      const run = (recs: string[]) => runRows(['--only', 'NF6'], { env: PROBE, pending: recs });
      const ok = run([join1(ULID_A), quit1(ULID_A)]);
      expect(ok.out).toMatch(
        /^ROW NF6 PASS got=join=1 quit=1 life_id=yes session_ulid=1 same_session=yes duration_ms=61000 /m,
      );
      expect(ok.log).toContain('p0 join ok name=ag_nfprobe_01');
      expect(run([join1(ULID_A), quit1(ULID_B)]).out).toMatch(/^ROW NF6 FAIL .*same_session=no/m);
      expect(run([join1('not-a-ulid'), quit1('not-a-ulid')]).out).toMatch(
        /^ROW NF6 FAIL .*session_ulid=0/m,
      );
      const noDur = ev('geldar.player.quit', sattr('geldar.mc_session', ULID_A));
      expect(run([join1(ULID_A), noDur]).out).toMatch(/^ROW NF6 FAIL .*duration_ms=none/m);
      expect(run([quit1(ULID_A)]).out).toMatch(/^ROW NF6 FAIL got=join=0 /m);
      const skip = runRows(['--only', 'NF6']);
      expect(skip.out).toMatch(/^ROW NF6 SKIP reason=no-probe-driver /m);
      expect(skip.status).toBe(0);
    });

    it('NF7 is skipped as not drivable, fails when a snapshot carries another session', () => {
      const snap = (s: string) =>
        ev(
          'geldar.player.snapshot',
          sattr('geldar.life_id', 'ag_nfprobe_01'),
          sattr('geldar.mc_session', s),
        );
      const ok = runRows(['--only', 'NF6,NF7'], {
        env: PROBE,
        pending: [join1(ULID_A), snap(ULID_A), quit1(ULID_A)],
      });
      expect(ok.out).toMatch(
        /^ROW NF7 SKIP reason=no-respawn-driver got=snapshots=1 snapshot_sessions_not_the_join_session=0 respawn=not-driven /m,
      );
      const bad = runRows(['--only', 'NF6,NF7'], {
        env: PROBE,
        pending: [join1(ULID_A), snap(ULID_B), quit1(ULID_A)],
      });
      expect(bad.out).toMatch(
        /^ROW NF7 FAIL got=snapshots=1 snapshot_sessions_not_the_join_session=1 /m,
      );
      expect(runRows(['--only', 'NF7']).out).toMatch(
        /^ROW NF7 SKIP reason=dep-not-run-or-unmet:NF6 /m,
      );
    });

    it('NF8 finds IPv4, IPv6 and UUID-shaped strings anywhere and ignores 0.0.0.0; an empty sink skips', () => {
      const rec = (v: string) => ev('geldar.x', sattr('geldar.note', v));
      expect(runRows(['--only', 'NF8']).out).toMatch(
        /^ROW NF8 PASS got=ipv4_hits=0 ipv6_lines=0 uuid_lines=0 /m,
      );
      expect(runRows(['--only', 'NF8'], { initial: [rec('bind 0.0.0.0')] }).out).toMatch(
        /^ROW NF8 PASS /m,
      );
      expect(runRows(['--only', 'NF8'], { initial: [rec('v 26.1.2.126x')] }).out).not.toMatch(
        /ipv4_hits=0 /,
      ); // documented false positive shape
      expect(runRows(['--only', 'NF8'], { initial: [rec('at 192.168.1.20')] }).out).toMatch(
        /^ROW NF8 FAIL got=ipv4_hits=1 /m,
      );
      expect(runRows(['--only', 'NF8'], { initial: [rec('fe80::1')] }).out).toMatch(
        /^ROW NF8 FAIL .*ipv6_lines=1/m,
      );
      expect(
        runRows(['--only', 'NF8'], { initial: [rec('123e4567-e89b-12d3-a456-426614174000')] }).out,
      ).toMatch(/^ROW NF8 FAIL .*uuid_lines=1/m);
      expect(runRows(['--only', 'NF8'], { initial: [] }).out).toMatch(
        /^ROW NF8 SKIP reason=empty-sink /m,
      );
    });

    const cmdRec = (name: string, amount: number) =>
      ev('geldar.rcon.command', sattr('geldar.command', name), iattr('geldar.amount', amount));
    const NAME_ONLY = [cmdRec('say', 1), cmdRec('msg', 2), cmdRec('unknown', 2)];

    it('NF9A fails on a chat export line in either log or any geldar.chat record, skips with chat on in the profile', () => {
      const ok = runRows(['--only', 'NF9A']);
      expect(ok.out).toMatch(
        /^ROW NF9A PASS got=container_log_hits=0 latest_log_hits=0 chat_records=0 /m,
      );
      const inContainer = runRows(['--only', 'NF9A'], {
        env: { FAKE_LOGS: 'x\nledger chat export on\ny' },
      });
      expect(inContainer.out).toMatch(/^ROW NF9A FAIL got=container_log_hits=1 /m);
      const inFile = runRows(['--only', 'NF9A'], { env: { FAKE_LATEST_COUNT: '2' } });
      expect(inFile.out).toMatch(/^ROW NF9A FAIL got=container_log_hits=0 latest_log_hits=2 /m);
      const rec = runRows(['--only', 'NF9A'], {
        initial: [ev('geldar.chat', sattr('geldar.text', 'hi'))],
      });
      expect(rec.out).toMatch(/^ROW NF9A FAIL .*chat_records=present/m);
      const unreadable = runRows(['--only', 'NF9A'], { env: { FAKE_LATEST_COUNT: 'x' } });
      expect(unreadable.out).toMatch(/^ROW NF9A PASS got=.*latest_log_hits=unreadable /m);
      const on = runRows(['--only', 'NF9A'], {
        profileText: 'collector.chat.enabled=true\ncollector.audit.enabled=true\n',
      });
      expect(on.out).toMatch(/^ROW NF9A SKIP reason=chat-enabled-in-profile /m);
    });

    it('NF9B passes with name-only command records and fails when an argument leaks anywhere', () => {
      const ok = runRows(['--only', 'NF9B'], { pending: NAME_ONLY });
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
        const body = runRows(['--only', 'NF9B'], {
          pending: [
            ...NAME_ONLY,
            ev('geldar.rcon.command', sattr('geldar.command', `say ${leak}`)),
          ],
        });
        expect(body.out, leak).toMatch(/^ROW NF9B FAIL .*leaked_argument_strings=1/m);
        const old = runRows(['--only', 'NF9B'], {
          pending: NAME_ONLY,
          initial: [wrap(`{"name":"x","description":"${leak}"}`)],
        });
        expect(old.out, leak).toMatch(/^ROW NF9B FAIL .*leaked_argument_strings=1/m); // anywhere in the journal
      }
      expect(
        runRows(['--only', 'NF9B'], {
          pending: [cmdRec('say', 2), cmdRec('msg', 2), cmdRec('unknown', 1)],
        }).out,
      ).toMatch(/^ROW NF9B FAIL got=say_amount=2 /m);
      expect(
        runRows(['--only', 'NF9B'], { pending: [cmdRec('say', 1), cmdRec('msg', 2)] }).out,
      ).toMatch(/^ROW NF9B FAIL got=.* unknown_records=0 /m);
      const off = runRows(['--only', 'NF9B'], { profileText: 'collector.audit.enabled=false\n' });
      expect(off.out).toMatch(/^ROW NF9B SKIP reason=audit-not-true-in-profile /m);
    });

    it('NF9C is skipped as no-driver without an online agent; with one it expects operator flags 1, 0 and a death by life id', () => {
      const none = runRows(['--only', 'NF9C']);
      expect(none.out).toMatch(/^ROW NF9C SKIP reason=no-driver got=no-agent-online /m);
      const opRec = (f: number) => ev('geldar.operator.change', iattr('geldar.flag', f));
      const death = (id: string) => ev('geldar.combat.player_death', sattr('geldar.life_id', id));
      const env = { FAKE_ONLINE: '1', FAKE_NAMES: 'ag_nfprobe_01' };
      const ok = runRows(['--only', 'NF9C'], {
        env,
        pending: [opRec(1), opRec(0), death('ag_nfprobe_01')],
      });
      expect(ok.out).toMatch(/^ROW NF9C PASS got=operator_flags=1 0 player_death_with_life_id=1/m);
      expect(
        ok.docker
          .filter((c) => /rcon-cli (op|deop|kill) /.test(c))
          .map((c) => c.split('rcon-cli ')[1]),
      ).toEqual(['op ag_nfprobe_01', 'deop ag_nfprobe_01', 'kill ag_nfprobe_01']);
      expect(runRows(['--only', 'NF9C'], { env, pending: [opRec(1), opRec(0)] }).out).toMatch(
        /^ROW NF9C FAIL .*player_death_with_life_id=0/m,
      );
      expect(
        runRows(['--only', 'NF9C'], { env, pending: [opRec(0), opRec(1), death('ag_nfprobe_01')] })
          .out,
      ).toMatch(/^ROW NF9C FAIL got=operator_flags=0 1 /m);
      const human = runRows(['--only', 'NF9C'], { env: { FAKE_ONLINE: '1', FAKE_NAMES: 'Steve' } });
      expect(human.out).toMatch(/^ROW NF9C SKIP reason=no-driver /m); // a human name is never driven
      expect(human.docker.some((c) => c.includes('Steve'))).toBe(false);
    });

    it('the summary reports the idle chat name mask (NF9d)', () => {
      expect(runRows(['--only', 'NF8']).out).toContain('chat_name_mask=idle');
    });
  },
);

describe.skipIf(!SH)(
  'telemetry-rows-nf.sh: NF10 kill switch and scope',
  { timeout: 900_000 },
  () => {
    const pt = (n: number) => gauge('geldar_players_online', n);
    it('NF10 live mode: no points after the edit, points after the restore, no recreate', () => {
      const r = runRows(['--only', 'NF10'], { pendingAt: { 4: [pt(0)] } });
      expect(r.out).toMatch(
        /^ROW NF10 PASS got=mode=live points_while_off=0 points_after_restore=1 copy_restored=yes /m,
      );
      expect(r.files).toContain('enabled=false');
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(compose(r)).toHaveLength(0);
    });

    it('NF10 restart mode: records continue after a live edit, one recreate applies it, a second restores', () => {
      const r = runRows(['--only', 'NF10'], { pendingAt: { 2: [pt(1)], 8: [pt(0)] } });
      expect(r.out).toMatch(
        /^ROW NF10 PASS got=mode=restart points_while_off=0 points_after_restore=1 copy_restored=yes /m,
      );
      expect(compose(r)).toHaveLength(2);
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(r.status).toBe(0);
    });

    it('NF10 fails when records never stop or never resume; ledger housekeeping gauges do not count', () => {
      const still = runRows(['--only', 'NF10'], {
        pendingAt: { 2: [pt(1)], 5: [pt(1)], 8: [pt(0)] },
      });
      expect(still.out).toMatch(/^ROW NF10 FAIL got=mode=restart points_while_off=1 /m);
      const noResume = runRows(['--only', 'NF10']);
      expect(noResume.out).toMatch(
        /^ROW NF10 FAIL got=mode=live points_while_off=0 points_after_restore=0 /m,
      );
      const housekeeping = runRows(['--only', 'NF10'], {
        pendingAt: { 2: [gauge('geldar_ledger_queue_depth', 0)], 4: [pt(0)] },
      });
      expect(housekeeping.out).toMatch(/^ROW NF10 PASS got=mode=live /m);
    });

    it('a failed recreate restores the profile and ends with exit 5 and the default-stack message', () => {
      const r = runRows(['--only', 'NF10'], {
        pendingAt: { 2: [pt(1)] },
        env: { FAKE_COMPOSE_FAIL: '1' },
      });
      expect(r.out).toMatch(/^ROW NF10 FAIL got=live-edit-ignored restart-failed /m);
      expect(r.status).toBe(5);
      expect(r.out).toMatch(/^ABORT reason=default-stack-not-restored$/m);
      expect(r.profile).toBe(PROFILE_TEXT);
      expect(
        runRows(['--only', 'NF10'], { env: { FAKE_CF: '' }, pendingAt: { 2: [pt(1)] } }).out,
      ).toMatch(/^ROW NF10 FAIL /m);
    });

    it('every docker and compose call is project-scoped or on the one label-resolved scratch container', () => {
      const r = runRows(['--only', 'NF0,NF2,NF5,NF9A,NF9B,NF9C,NF10,NF11'], {
        pending: T0(),
        pendingAt: { 2: [pt(1)], 8: [pt(0)] },
      });
      expect(r.docker.length).toBeGreaterThan(20);
      for (const c of r.docker) {
        const w = c.split(' ');
        const verb = w[0] as string;
        if (verb === 'ps') continue;
        if (verb === 'compose') {
          expect(c, c).toMatch(
            /^compose -p scratch-nf --project-directory \/srv\/geldar\/compose -f \S+phase0\.yml -f \S+scratch-neoforge\.yml up -d --no-deps --force-recreate paper$/,
          );
        } else if (verb === 'inspect') {
          expect(['fake-paper', 'live-nats'], c).toContain(w[w.length - 1]);
        } else if (['pause', 'unpause', 'exec', 'logs'].includes(verb)) {
          expect(w[1] === '-i' ? w[2] : w[1], c).toBe('fake-paper');
        } else {
          expect.fail(`unscoped docker call: ${c}`);
        }
        expect(['stop', 'kill', 'rm', 'restart', 'down']).not.toContain(verb);
        expect(c).not.toMatch(/--force-recreate (?!paper)/);
      }
      const ps = r.docker.filter((c) => c.startsWith('ps') && c.includes('service='));
      expect(ps.length).toBeGreaterThan(0);
      for (const c of ps) expect(c).toContain('label=com.docker.compose.project=scratch-nf');
    });
  },
);

function T0(): string[] {
  return [histo('1700000000000000000', 1000), histo('1700000062500000000', 2250)];
}
