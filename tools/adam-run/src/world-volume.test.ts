import { describe, expect, it } from 'vitest';
import { FakeWorldVolumes, MemoryFiles } from '../test/fakes.ts';
import type { ExecResult, Runner } from './ports.ts';
import {
  createWorldVolumes,
  parsePrepared,
  preparedText,
  prepareWorldVolume,
  volumeNameFor,
} from './world-volume.ts';

interface FakeVolume {
  labels: Record<string, string> | null;
  containers: string[];
  listing: string;
}

/**
 * A fake `docker` in memory. It answers the four calls the port makes: volume inspect, volume create, ps and the
 * read-only `ls` run. Every call is recorded as the argument array, so a test can see what would have run.
 */
class FakeDocker implements Runner {
  readonly volumes = new Map<string, FakeVolume>();
  readonly calls: string[][] = [];
  /** The running Paper containers and their mounts, as `docker ps` and `docker inspect` report them. */
  readonly paper: { id: string; mounts: { Type: string; Name: string; Destination: string }[] }[] =
    [];
  async exec(file: string, args: readonly string[]): Promise<ExecResult> {
    this.calls.push([file, ...args]);
    const ok = (stdout = ''): ExecResult => ({ code: 0, stdout, stderr: '' });
    if (args[0] === 'ps' && args.includes('label=com.docker.compose.service=paper')) {
      return ok(this.paper.map((p) => `${p.id}\n`).join(''));
    }
    if (args[0] === 'inspect') {
      const found = this.paper.find((p) => p.id === args[args.length - 1]);
      if (found === undefined) return { code: 1, stdout: '', stderr: 'No such container' };
      return ok(`${JSON.stringify(found.mounts)}\n`);
    }
    if (args[0] === 'volume' && args[1] === 'inspect') {
      const vol = this.volumes.get(args[4] ?? '');
      if (vol === undefined) return { code: 1, stdout: '', stderr: 'Error: No such volume: x' };
      return ok(`${JSON.stringify(vol.labels)}\n`);
    }
    if (args[0] === 'volume' && args[1] === 'create') {
      const labels: Record<string, string> = {};
      args.forEach((a, i) => {
        if (args[i - 1] === '--label') {
          const [k = '', v = ''] = a.split('=');
          labels[k] = v;
        }
      });
      this.volumes.set(args[args.length - 1] ?? '', { labels, containers: [], listing: '' });
      return ok();
    }
    if (args[0] === 'ps') {
      const name = (args[args.indexOf('--filter') + 1] ?? '').replace('volume=', '');
      return ok((this.volumes.get(name)?.containers ?? []).map((id) => `${id}\n`).join(''));
    }
    if (args[0] === 'run') {
      const mount = args[args.indexOf('-v') + 1] ?? '';
      const name = mount.split(':')[0] ?? '';
      return ok(this.volumes.get(name)?.listing ?? '');
    }
    return { code: 2, stdout: '', stderr: `unexpected ${args.join(' ')}` };
  }
}

const COMPOSE_LABELS = {
  'com.docker.compose.project': 'geldar-phase0',
  'com.docker.compose.volume': 'paper-data',
};

describe('createWorldVolumes.inspect', () => {
  it('reports a missing volume as missing, not as an error', async () => {
    const state = await createWorldVolumes(new FakeDocker()).inspect('nope');
    expect(state.exists).toBe(false);
  });

  it('reads the compose labels, the users, and whether the listing is empty', async () => {
    const docker = new FakeDocker();
    docker.volumes.set('v1', {
      labels: COMPOSE_LABELS,
      containers: ['abc123'],
      listing: '',
    });
    const state = await createWorldVolumes(docker).inspect('v1');
    expect(state).toEqual({ exists: true, labelled: true, empty: true, usedBy: ['abc123'] });
  });

  it('is not labelled for compose when the labels are absent or name another project', async () => {
    const docker = new FakeDocker();
    docker.volumes.set('bare', { labels: null, containers: [], listing: '' });
    docker.volumes.set('other', {
      labels: { ...COMPOSE_LABELS, 'com.docker.compose.project': 'someone-else' },
      containers: [],
      listing: '',
    });
    const port = createWorldVolumes(docker);
    expect((await port.inspect('bare')).labelled).toBe(false);
    expect((await port.inspect('other')).labelled).toBe(false);
  });

  it('is not empty when the read-only listing names an entry', async () => {
    const docker = new FakeDocker();
    docker.volumes.set('used', { labels: COMPOSE_LABELS, containers: [], listing: 'level.dat\n' });
    expect((await createWorldVolumes(docker).inspect('used')).empty).toBe(false);
  });

  it('runs the emptiness check read-only, with no network, over the volume only', async () => {
    const docker = new FakeDocker();
    docker.volumes.set('v1', { labels: COMPOSE_LABELS, containers: [], listing: '' });
    await createWorldVolumes(docker).inspect('v1');
    const run = docker.calls.find((c) => c[1] === 'run') ?? [];
    expect(run).toEqual(
      expect.arrayContaining(['--read-only', '--network', 'none', 'v1:/data:ro']),
    );
  });
});

describe('createWorldVolumes.create', () => {
  it('creates the volume with the two compose labels, so compose adopts it', async () => {
    const docker = new FakeDocker();
    await createWorldVolumes(docker).create('geldar-phase0-world-x', 'x');
    const created = docker.volumes.get('geldar-phase0-world-x');
    expect(created?.labels).toEqual({ ...COMPOSE_LABELS, 'geldar.run-id': 'x' });
  });
});

describe('createWorldVolumes.paperVolumes', () => {
  const data = (name: string) => ({ Type: 'volume', Name: name, Destination: '/data' });
  const bind = { Type: 'bind', Name: '', Destination: '/geldar/paper-entrypoint.sh' };

  it('is null when no Paper container runs', async () => {
    expect(await createWorldVolumes(new FakeDocker()).paperVolumes()).toBeNull();
  });

  it('names the volume Paper mounts at /data, not the other mounts', async () => {
    const docker = new FakeDocker();
    docker.paper.push({ id: 'paper1', mounts: [data('geldar-phase0-world-run-1'), bind] });
    expect(await createWorldVolumes(docker).paperVolumes()).toEqual(['geldar-phase0-world-run-1']);
  });

  it('reports the old default volume when Paper still mounts it', async () => {
    const docker = new FakeDocker();
    docker.paper.push({ id: 'paper1', mounts: [data('geldar-phase0_paper-data')] });
    expect(await createWorldVolumes(docker).paperVolumes()).toEqual(['geldar-phase0_paper-data']);
  });

  it('refuses when two Paper containers run', async () => {
    const docker = new FakeDocker();
    docker.paper.push({ id: 'a', mounts: [] }, { id: 'b', mounts: [] });
    await expect(createWorldVolumes(docker).paperVolumes()).rejects.toThrow('2 Paper containers');
  });
});

describe('prepareWorldVolume', () => {
  const RUN = 'run-1';
  const RUN_DIR = '/repo/.geldar/runs/run-1';
  const input = { profile: '8b', runId: RUN, runDir: RUN_DIR };

  it('names the volume after the run, creates it, and records it in manifest.json', async () => {
    const volumes = new FakeWorldVolumes();
    const files = new MemoryFiles();
    const res = await prepareWorldVolume({ volumes, files, nowMs: 0 }, input);
    expect(res.ok).toBe(true);
    expect(volumeNameFor(RUN)).toBe('geldar-phase0-world-run-1');
    const rec = parsePrepared(files.read(`${RUN_DIR}/manifest.json`));
    expect(rec?.worldVolume).toBe('geldar-phase0-world-run-1');
    expect(rec?.profile).toBe('8b');
  });

  it('refuses an existing name, creates nothing, and writes no record', async () => {
    const volumes = new FakeWorldVolumes();
    volumes.volumes.set('geldar-phase0-world-run-1', {
      exists: true,
      labelled: true,
      empty: true,
      usedBy: [],
    });
    const files = new MemoryFiles();
    const res = await prepareWorldVolume({ volumes, files, nowMs: 0 }, input);
    expect(res.ok).toBe(false);
    expect(volumes.calls.some((c) => c.startsWith('create'))).toBe(false);
    expect(files.read(`${RUN_DIR}/manifest.json`)).toBeNull();
  });

  it('leaves a created volume in place and refuses when it is not empty', async () => {
    const volumes = new FakeWorldVolumes();
    volumes.create = async (name: string) => {
      volumes.volumes.set(name, { exists: true, labelled: true, empty: false, usedBy: [] });
    };
    const files = new MemoryFiles();
    const res = await prepareWorldVolume({ volumes, files, nowMs: 0 }, input);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('left in place');
    expect(files.read(`${RUN_DIR}/manifest.json`)).toBeNull();
  });

  it('prints the variable to set and the start line', () => {
    const text = preparedText(
      {
        schema: 'adam-run-prepared/1',
        profile: '8b',
        runId: RUN,
        worldVolume: 'geldar-phase0-world-run-1',
        preparedAt: '2026-11-10T00:00:00.000Z',
      },
      RUN_DIR,
    );
    expect(text).toContain("$env:GELDAR_WORLD_VOLUME = 'geldar-phase0-world-run-1'");
    expect(text).toContain('docker compose -f compose/phase0.yml -p geldar-phase0 up -d --wait');
    expect(text).toContain('adam-run 8b start --run-id run-1');
  });
});

describe('parsePrepared', () => {
  it('reads a prepared record and returns null for a run manifest, bad JSON or no file', () => {
    expect(
      parsePrepared(
        JSON.stringify({ schema: 'adam-run-prepared/1', profile: '8b', worldVolume: 'v' }),
      ),
    ).not.toBeNull();
    expect(parsePrepared(JSON.stringify({ startedAt: '2026-11-10T00:00:00Z' }))).toBeNull();
    expect(parsePrepared('{')).toBeNull();
    expect(parsePrepared('null')).toBeNull();
    expect(parsePrepared(null)).toBeNull();
  });
});
