// Fixture for the CD-2a delta deploy tests (deploy/colo-cd.sh). It builds on colo-deploy-fixture.ts (the temp dir, fake
// secrets, merged config and the sh finder) and replaces its docker shim with one that records every call, answers `ps -q`
// and `inspect` per service (FAKE_UNHEALTHY makes one service unhealthy), answers `buildx imagetools inspect` with a revision
// label (FAKE_REVISION: the release sha, another sha, or "none" for no label) and prints a line for `exec -T postgres`.
// The export dir (git-less, a plain copy of the tree) and the src extract (GELDAR_COLO_ROOT) are plain directories. Every
// run has a wall-clock timeout, so a hung child fails its test in seconds. No real docker, node, git or network is used.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEPLOY,
  type Fixture,
  fixture,
  posix,
  REAL,
  calls as readCalls,
  SH,
  writeShim,
} from './colo-deploy-fixture';

// The wall-clock limit of one colo-cd.sh run. GELDAR_CD_TEST_TIMEOUT_MS raises it on a loaded machine (each fork is slow
// on Windows); the default fails a hung run in seconds.
export const CD_TIMEOUT_MS = Number(process.env.GELDAR_CD_TEST_TIMEOUT_MS) || 30_000;
export const GHCR = 'ghcr.io/sandboxservers';
// The release sha (40 lowercase hex) and the commit the node ran before the release (only read as text).
export const REL_SHA = '1234567890abcdef1234567890abcdef12345678';
export const FROM_SHA = 'b'.repeat(40);

// The fake docker: records its arguments. `buildx imagetools inspect` prints the revision label FAKE_REVISION (or no label
// for "none"); `ps -q SVC` answers cid-SVC; `inspect` answers unhealthy for $FAKE_UNHEALTHY and healthy otherwise;
// `exec -T postgres` prints a line for the dump. Every other call succeeds.
// A player host is a file (its image) and an optional <host>.state file "status exitcode restarts" (default "running 0 0").
// `ps` lists the running and restarting hosts, `ps -a` every host; `inspect` answers State.Status, State.ExitCode and
// RestartCount from that file. FAKE_NEW_STATE gives a host started on the new image (not FAKE_OLD_IMAGE) that state, and
// FAKE_UPDATE_FAIL makes `update --restart` fail.
export const CD_DOCKER_SHIM = `#!/bin/sh
printf '%s\\n' "$*" >>"$DOCKER_CALLS_LOG"
hn=
for a; do case $a in name=^*) hn=\${a#name=^}; hn=\${hn%\\$} ;; geldar-colo-players-host-*) hn=$a ;; esac; done
prev=
for a; do if [ "$prev" = --name ]; then hn=$a; fi; prev=$a; done
st_of() {
  hs=running
  hc=0
  hr=0
  if [ -f "$FAKE_HOSTS_DIR/$1.state" ]; then read -r hs hc hr <"$FAKE_HOSTS_DIR/$1.state"; fi
}
case "$*" in
  *"ps "*"name=^geldar-colo-players-host-"*)
    if [ -f "$FAKE_HOSTS_DIR/$hn" ]; then
      st_of "$hn"
      case "$*" in
        *" -a "*) echo "$hn" ;;
        *) case $hs in running | restarting) echo "$hn" ;; esac ;;
      esac
    fi
    exit 0 ;;
  "inspect "*"geldar-colo-players-host-"*)
    [ -f "$FAKE_HOSTS_DIR/$hn" ] || exit 1
    img=$(cat "$FAKE_HOSTS_DIR/$hn")
    case "$*" in
      *Config.Image*) echo "$img" ;;
      *Labels*)
        if [ "$img" = "\${FAKE_OLD_IMAGE:-}" ]; then echo "$FAKE_OLD_REVISION"
        elif [ -n "\${FAKE_BAD_LABEL:-}" ]; then echo "$FAKE_OLD_REVISION"
        else echo "$FAKE_REVISION"; fi ;;
      *State.Status*) st_of "$hn"; echo "$hs" ;;
      *State.ExitCode*) st_of "$hn"; echo "$hc" ;;
      *RestartCount*) st_of "$hn"; echo "$hr" ;;
      *) echo running ;;
    esac
    exit 0 ;;
  "stop geldar-colo-players-host-"* | "rm geldar-colo-players-host-"* | "rm -f geldar-colo-players-host-"*) rm -f "$FAKE_HOSTS_DIR/$hn" "$FAKE_HOSTS_DIR/$hn.state"; exit 0 ;;
  "update --restart on-failure:5 geldar-colo-players-host-"*) if [ -n "\${FAKE_UPDATE_FAIL:-}" ]; then exit 1; fi; exit 0 ;;
  *" run -d "*" players-host "*)
    if [ -n "\${FAKE_RUN_FAIL:-}" ] && [ "$GELDAR_BODY_IMAGE" != "\${FAKE_OLD_IMAGE:-}" ]; then exit 1; fi
    printf '%s\\n' "$GELDAR_BODY_IMAGE" >"$FAKE_HOSTS_DIR/$hn"
    rm -f "$FAKE_HOSTS_DIR/$hn.state"
    if [ -n "\${FAKE_NEW_STATE:-}" ] && [ "$GELDAR_BODY_IMAGE" != "\${FAKE_OLD_IMAGE:-}" ]; then printf '%s\\n' "$FAKE_NEW_STATE" >"$FAKE_HOSTS_DIR/$hn.state"; fi
    exit 0 ;;
esac
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"config"*) cat "$DOCKER_CONFIG_FIXTURE"; exit 0 ;;
  *"buildx imagetools inspect"*)
    if [ "\${FAKE_REVISION:-}" = none ]; then
      printf '{"image":{"config":{"Labels":{}}}}\\n'
    else
      printf '{"image":{"config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}}\\n' "$FAKE_REVISION"
    fi
    exit 0 ;;
  *" ps -q "*) for a; do last=$a; done; echo "cid-$last"; exit 0 ;;
  *inspect*)
    for a; do last=$a; done
    s=\${last#cid-}
    if [ "$s" = "\${FAKE_UNHEALTHY:-}" ]; then echo unhealthy; else echo healthy; fi
    exit 0 ;;
  *" exec -T postgres "*) echo "-- pg_dump test output"; exit 0 ;;
esac
exit 0
`;

// The seven manifest keys, each with its GHCR package name (colo-images.yml pushes geldar-<name>) and a digest.
const IMAGES = [
  'GELDAR_BODY_IMAGE',
  'GELDAR_MIND_IMAGE',
  'GELDAR_EVENTSINK_IMAGE',
  'GELDAR_MCP_IMAGE',
  'GELDAR_ADMIN_IMAGE',
  'GELDAR_GLASS_IMAGE',
  'GELDAR_REGISTER_IMAGE',
];

// A release manifest. The keys in `bump` get a new digest (the image changed in this release); `prefix` is the registry.
export function manifest(bump: string[] = [], prefix = GHCR): string {
  const lines = IMAGES.map((key, i) => {
    const name = `geldar-${key.replace(/^GELDAR_|_IMAGE$/g, '').toLowerCase()}`;
    const digest = (bump.includes(key) ? '8' : String(i + 1)).repeat(64);
    return `${key}=${prefix}/${name}@sha256:${digest}\n`;
  });
  return `# cd test manifest\n${lines.join('')}`;
}

export interface Cd {
  fx: Fixture;
  repo: string;
  extract: string;
  state: string;
  newFile: string;
}

export const BASE_FILES: Record<string, string> = {
  'src/eventsink.txt': 'v1\n',
  'src/glass.txt': 'v1\n',
  'src/mcp.txt': 'v1\n',
  'sql/001.sql': 'select 1;\n',
};

function writeTree(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

// Builds the fixture: the export holds BASE_FILES plus `edits`, the src extract holds BASE_FILES. The installed manifest
// is the unbumped one, the recorded release commit is FROM_SHA, and the new manifest is `bump`ed under `prefix`.
export function cdSetup(edits: Record<string, string>, bump: string[] = [], prefix = GHCR): Cd {
  const fx = fixture();
  const repo = join(fx.dir, 'export');
  const extract = join(fx.dir, 'extract');
  mkdirSync(repo);
  mkdirSync(extract);
  mkdirSync(fx.state, { recursive: true });
  writeTree(extract, BASE_FILES);
  writeTree(repo, { ...BASE_FILES, ...edits });
  writeFileSync(join(fx.state, 'release.env'), manifest());
  writeFileSync(join(fx.state, 'release.commit'), `${FROM_SHA}\n`);
  const newFile = join(fx.dir, 'new-release.env');
  writeFileSync(newFile, manifest(bump, prefix));
  const emptyEnv = join(fx.dir, 'colo-env.sh');
  writeFileSync(emptyEnv, '');
  writeShim(join(fx.dir, 'bin'), 'docker', CD_DOCKER_SHIM);
  fx.env.GELDAR_COLO_ROOT = posix(extract);
  fx.env.COLO_CD_ENV_FILE = posix(emptyEnv);
  fx.env.FAKE_REVISION = REL_SHA;
  return { fx, repo, extract, state: fx.state, newFile };
}

// Runs colo-cd.sh with a wall-clock timeout (a hang fails the test, it does not stall the file). Default args are the
// positional form: <release.env> <sha> <export dir>; `--dry-run` is added with opts.dryRun. The notice wait is zero.
export function cdRun(
  cd: Cd,
  opts: { dryRun?: boolean; env?: Record<string, string>; args?: string[]; cwd?: string } = {},
): { code: number; out: string } {
  const args = opts.args ?? [
    ...(opts.dryRun ? ['--dry-run'] : []),
    posix(cd.newFile),
    REL_SHA,
    posix(cd.repo),
  ];
  const base = opts.dryRun ? {} : REAL;
  const r = spawnSync(SH, [posix(join(DEPLOY, 'colo-cd.sh')), ...args], {
    env: { ...cd.fx.env, COLO_CD_NOTICE_SECONDS: '0', ...base, ...(opts.env ?? {}) },
    cwd: opts.cwd,
    encoding: 'utf8',
    timeout: CD_TIMEOUT_MS,
  });
  const spawnErr = r.error ? `\n[spawn: ${r.error.message}]` : '';
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}${spawnErr}` };
}

// The body image an old player host runs (not the manifest's), and the revision its label reports.
export const OLD_HOST_IMAGE = `${GHCR}/geldar-body@sha256:${'7'.repeat(64)}`;
export const OLD_HOST_REV = 'a'.repeat(40);

// Gives the fake docker some player hosts (container name -> image) and a shard file listing `ids`. A listed id without a
// container is a hibernating player. `states` (id -> "status exitcode restarts", e.g. "exited 137 5") sets a host's state;
// a host without one is running with no restarts.
export function withHosts(
  cd: Cd,
  ids: string[],
  running: Record<string, string>,
  states: Record<string, string> = {},
) {
  const dir = join(cd.fx.dir, 'hosts');
  mkdirSync(dir, { recursive: true });
  for (const [id, image] of Object.entries(running)) {
    writeFileSync(join(dir, `geldar-colo-players-host-${id}`), `${image}\n`);
  }
  for (const [id, state] of Object.entries(states)) {
    writeFileSync(join(dir, `geldar-colo-players-host-${id}.state`), `${state}\n`);
  }
  const shard = join(cd.fx.dir, 'colo-mind.yaml');
  writeFileSync(shard, `${ids.map((id) => `- {player_id: ${id}}\n`).join('')}`);
  cd.fx.env.FAKE_HOSTS_DIR = posix(dir);
  cd.fx.env.GELDAR_COLO_SHARD = posix(shard);
  cd.fx.env.FAKE_OLD_IMAGE = OLD_HOST_IMAGE;
  cd.fx.env.FAKE_OLD_REVISION = OLD_HOST_REV;
  cd.fx.env.COLO_CD_PLAYER_SETTLE = '0';
  cd.fx.env.COLO_CD_PLAYER_WAIT = '1';
  return (id: string) => {
    const f = join(dir, `geldar-colo-players-host-${id}`);
    return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
  };
}

export const cdCalls = (cd: Cd): string[] => readCalls(cd.fx);
// A compose call that changes a container: pull, up, exec, restart, stop, start or rm.
export const mutating = (log: string[]): string[] =>
  log.filter((c) => / (pull|up|exec|restart|stop|start|rm) /.test(c));
// The service a compose call names: its last word.
export const lastArg = (call: string): string => call.split(' ').pop() ?? '';
// The services of the normal `up` calls (not the rollback's `--pull never` ones), in call order.
export const upServices = (log: string[]): string[] =>
  log.filter((c) => / up -d --no-deps --wait /.test(c) && !c.includes('--pull never')).map(lastArg);
export const readText = (path: string): string => readFileSync(path, 'utf8');
