/**
 * Pin rules for supply-chain inputs (docs/threat-model.md, decision 0005):
 * exact npm versions, Docker base images and compose images pinned by digest,
 * GitHub Actions pinned by full commit SHA, and a lockfile with registry
 * sources only. Each checker returns one message per problem.
 *
 * Not checked here: the age of each release (the 14-day floor). That needs
 * the network, so it stays a manual step (docs/analysis/phase0/worknotes/fix-f.md).
 */
import { parse } from 'yaml';
import { isWorkflowFile } from './workflow-yaml.ts';

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIGEST = /@sha256:[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/** True for a package manifest (`package.json`, at any depth). */
export function isManifestFile(path: string): boolean {
  return /(^|\/)package\.json$/.test(path);
}

/** True for a Dockerfile (`Dockerfile`, `Dockerfile.x`, `x.Dockerfile`), not a `.dockerignore`. */
export function isDockerfile(path: string): boolean {
  return (
    /(^|\/)(Dockerfile(\.[^/]+)?|[^/]+\.Dockerfile)$/.test(path) && !path.endsWith('.dockerignore')
  );
}

/** True for a compose file by name: `compose.yml`, `docker-compose.yml`, `compose/x.yml` and variants. */
export function isComposeImageFile(path: string): boolean {
  return (
    /(^|\/)(docker-)?compose([.-][^/]*)?\.ya?ml$/.test(path) || /^compose\/[^/]+\.ya?ml$/.test(path)
  );
}

/** True for a lockfile whose sources are checked: `pnpm-lock.yaml`. */
export function isLockfile(path: string): boolean {
  return path === 'pnpm-lock.yaml';
}

/** The pin rule for one file, by its path; a file no rule covers returns no problems. */
export function checkPins(path: string, text: string): string[] {
  if (isManifestFile(path)) return checkExactDependencies(path, text);
  if (isDockerfile(path)) return checkDockerfileFrom(path, text);
  if (isComposeImageFile(path)) return checkComposeImageDigests(path, text);
  if (isLockfile(path)) return checkLockfileSources(path, text);
  if (isWorkflowFile(path)) return checkActionPins(path, text);
  return [];
}

/** Every dependency range in a manifest is an exact version or a `workspace:` link. */
export function checkExactDependencies(path: string, text: string): string[] {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [`${path}: is not valid JSON`];
  }
  const problems: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) continue;
      if (typeof range === 'string' && EXACT_VERSION.test(range)) continue;
      problems.push(
        `${path}: ${field}.${name} is ${JSON.stringify(range)}; pin an exact version (saveExact)`,
      );
    }
  }
  return problems;
}

/**
 * Every `FROM` names a digest, `scratch`, or a stage defined earlier in the
 * same file (a stage reference is not a registry pull).
 */
export function checkDockerfileFrom(path: string, text: string): string[] {
  const stages = new Set<string>(['scratch']);
  const problems: string[] = [];
  text.split('\n').forEach((raw, index) => {
    const match = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(raw.trim());
    if (!match) return;
    const image = match[1] as string;
    if (!stages.has(image) && !DIGEST.test(image)) {
      problems.push(`${path}:${index + 1}: FROM ${image} is not pinned by digest`);
    }
    if (match[2]) stages.add(match[2]);
  });
  return problems;
}

/** Every service that pulls an image names it by digest. A service with `build:` is built locally. */
export function checkComposeImageDigests(path: string, text: string): string[] {
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return [`${path}: is not valid YAML`];
  }
  const services = (document as { services?: unknown } | null)?.services;
  if (!services || typeof services !== 'object') return [];
  const problems: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    const fields = (service ?? {}) as { image?: unknown; build?: unknown };
    if (fields.build !== undefined) continue;
    if (typeof fields.image !== 'string' || !DIGEST.test(fields.image)) {
      problems.push(
        `${path} service ${name}: image ${JSON.stringify(fields.image)} is not pinned by digest`,
      );
    }
  }
  return problems;
}

/**
 * Every `uses:` names a local path, a `docker://` image pinned by digest, or a
 * repository at a full 40-character commit SHA.
 */
export function checkActionPins(path: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    const match = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)/.exec(line);
    if (!match) return;
    const target = match[1] as string;
    if (target.startsWith('./')) return;
    if (target.startsWith('docker://')) {
      if (!DIGEST.test(target)) {
        problems.push(`${path}:${index + 1}: ${target} is not pinned by digest`);
      }
      return;
    }
    const at = target.lastIndexOf('@');
    if (at < 0 || !COMMIT_SHA.test(target.slice(at + 1))) {
      problems.push(`${path}:${index + 1}: ${target} is not pinned by full commit SHA`);
    }
  });
  return problems;
}

/** A lockfile has registry tarballs only: no git, tarball-URL, or file sources. */
export function checkLockfileSources(path: string, text: string): string[] {
  const problems: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (
      /\btarball:/.test(line) ||
      /\btype:\s*(git|directory)\b/.test(line) ||
      /git\+|(^|[\s'"{,])file:\S/.test(line)
    ) {
      problems.push(`${path}:${index + 1}: a non-registry source: ${line.trim()}`);
    }
  });
  return problems;
}
