/**
 * Release-age floor (docs/threat-model.md, decision 0005): every third-party
 * version or digest a repo pins must have been published at least 14 days
 * before the check runs. Publish dates come from `release-dates.json`, keyed by
 * the pin itself (`npm:name@version`, `maven:group:artifact:version`,
 * `gradle-dist:version`, `docker:<image reference>`). A pin with no date fails;
 * it is never skipped. Images this repo builds and publishes are exempt from
 * the date by `first-party-images.json` (a list of repository prefixes), but
 * must still be pinned by digest.
 */
import { parse } from 'yaml';
import { isComposeImageFile, isDockerfile, isLockfile, isManifestFile } from './pin-rules.ts';

export const MIN_AGE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DIGEST_SUFFIX = /@sha256:[0-9a-f]{64}$/;
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
const LOCK_PACKAGE = /^ {2}'?(@?[^\s'@]+(?:\/[^\s'@]+)?)@(\d[^\s'(:]*)'?:$/;

/** One pinned input: its date key, the file and line it came from, and whether it is an image reference. */
export interface Pin {
  key: string;
  path: string;
  line: number;
  image?: string;
}

/** The release-age data: the dates keyed by pin, and any problem reading the data file itself. */
export interface ReleaseDates {
  dates: ReadonlyMap<string, string>;
  problems: string[];
}

/** True for a Gradle build or version-catalog file whose pins are checked. */
export function isGradleFile(path: string): boolean {
  return (
    /(^|\/)(gradle-wrapper\.properties|libs\.versions\.toml)$/.test(path) ||
    /(^|\/)(build|settings)\.gradle(\.kts)?$/.test(path)
  );
}

/** Every pin in one file. A file no rule covers returns no pins; a file that cannot be parsed returns none (checkPins reports it). */
export function extractPins(path: string, text: string): Pin[] {
  if (isManifestFile(path)) return manifestPins(path, text);
  if (isLockfile(path)) return lockfilePins(path, text);
  if (isDockerfile(path)) return dockerfilePins(path, text);
  if (isComposeImageFile(path)) return composePins(path, text);
  if (path.endsWith('gradle-wrapper.properties')) return gradleWrapperPins(path, text);
  if (isGradleFile(path)) return versionCatalogPins(path, text);
  return [];
}

function manifestPins(path: string, text: string): Pin[] {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text);
  } catch {
    return [];
  }
  const pins: Pin[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string' || range.startsWith('workspace:')) continue;
      pins.push({ key: `npm:${name}@${range}`, path, line: lineOf(text, `"${name}"`) });
    }
  }
  const packageManager = manifest.packageManager;
  if (typeof packageManager === 'string') {
    const match = /^pnpm@(\d+\.\d+\.\d+)/.exec(packageManager);
    if (match)
      pins.push({ key: `npm:pnpm@${match[1]}`, path, line: lineOf(text, 'packageManager') });
  }
  return pins;
}

/** The registry packages in a pnpm v9 lockfile: one `name@version:` key per package, at any indentation of two. */
function lockfilePins(path: string, text: string): Pin[] {
  const pins: Pin[] = [];
  text.split('\n').forEach((line, index) => {
    const match = LOCK_PACKAGE.exec(line.replace(/\r$/, ''));
    if (match) pins.push({ key: `npm:${match[1]}@${match[2]}`, path, line: index + 1 });
  });
  return pins;
}

/** Every `FROM` that names an image (a stage reference is not a registry pull). */
function dockerfilePins(path: string, text: string): Pin[] {
  const stages = new Set<string>(['scratch']);
  const pins: Pin[] = [];
  text.split('\n').forEach((raw, index) => {
    const match = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(raw.trim());
    if (!match) return;
    const image = match[1] as string;
    if (!stages.has(image)) pins.push(imagePin(path, index + 1, image));
    if (match[2]) stages.add(match[2]);
  });
  return pins;
}

/** Every service that pulls an image (a service with `build:` is built here, not pulled). */
function composePins(path: string, text: string): Pin[] {
  let document: unknown;
  try {
    document = parse(text);
  } catch {
    return [];
  }
  const services = (document as { services?: unknown } | null)?.services;
  if (!services || typeof services !== 'object') return [];
  const pins: Pin[] = [];
  for (const [name, service] of Object.entries(services)) {
    const fields = (service ?? {}) as { image?: unknown; build?: unknown };
    if (fields.build !== undefined || typeof fields.image !== 'string') continue;
    pins.push(imagePin(path, lineOf(text, `${name}:`), fields.image));
  }
  return pins;
}

function imagePin(path: string, line: number, image: string): Pin {
  return { key: `docker:${image}`, path, line, image };
}

/** `distributionUrl=...gradle-9.8.2-bin.zip` names the Gradle distribution. */
function gradleWrapperPins(path: string, text: string): Pin[] {
  const pins: Pin[] = [];
  text.split('\n').forEach((line, index) => {
    const match = /distributionUrl=.*\/gradle-(\d+\.\d+(?:\.\d+)?)-(?:bin|all)\.zip/.exec(line);
    if (match) pins.push({ key: `gradle-dist:${match[1]}`, path, line: index + 1 });
  });
  return pins;
}

/** A version catalog: each `module = "g:a"` with `version.ref` or an inline `version` is one maven pin. */
function versionCatalogPins(path: string, text: string): Pin[] {
  const versions = new Map<string, string>();
  for (const match of text.matchAll(/^([\w.-]+)\s*=\s*"([^"]+)"/gm)) {
    versions.set(match[1] as string, match[2] as string);
  }
  const pins: Pin[] = [];
  text.split('\n').forEach((line, index) => {
    const module = /module\s*=\s*"([^"]+)"/.exec(line)?.[1];
    if (!module) return;
    const ref = /version\.ref\s*=\s*"([^"]+)"/.exec(line)?.[1];
    const inline = /version\s*=\s*"([^"]+)"/.exec(line)?.[1];
    const version = ref ? versions.get(ref) : inline;
    if (version) pins.push({ key: `maven:${module}:${version}`, path, line: index + 1 });
  });
  return pins;
}

function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  return index < 0 ? 1 : index + 1;
}

/** The release-age data file: a JSON object of pin key to ISO 8601 UTC publish time. */
export function parseReleaseDates(text: string | undefined, path: string): ReleaseDates {
  if (text === undefined) {
    return {
      dates: new Map(),
      problems: [`${path}: cannot be read; release ages cannot be checked`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { dates: new Map(), problems: [`${path}: is not valid JSON`] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { dates: new Map(), problems: [`${path}: must be a JSON object of key to date`] };
  }
  const dates = new Map<string, string>();
  const problems: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && DATE_FORMAT.test(value) && !Number.isNaN(Date.parse(value))) {
      dates.set(key, value);
    } else {
      problems.push(`${path}: ${key} has an invalid date ${JSON.stringify(value)}`);
    }
  }
  return { dates, problems };
}

/** The repository prefixes of first-party images (exempt from the date, not from the digest). */
export function parseFirstPartyPrefixes(
  text: string | undefined,
  path: string,
): { prefixes: string[]; problems: string[] } {
  if (text === undefined) return { prefixes: [], problems: [`${path}: cannot be read`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { prefixes: [], problems: [`${path}: is not valid JSON`] };
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    return { prefixes: [], problems: [`${path}: must be a JSON array of strings`] };
  }
  return { prefixes: parsed, problems: [] };
}

/** The repository of an image reference, without its tag and digest. */
export function imageRepository(image: string): string {
  return image.replace(DIGEST_SUFFIX, '').replace(/:[^/:]*$/, '');
}

/**
 * One problem per pin that fails the floor: no date, an unreadable date, or
 * a publish time under MIN_AGE_DAYS before `now`. A first-party image (its
 * repository starts with an allowlisted prefix) needs only a digest.
 */
export function checkReleaseAge(
  pins: Pin[],
  dates: ReadonlyMap<string, string>,
  now: Date,
  firstPartyPrefixes: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  for (const pin of pins) {
    const where = `${pin.path}:${pin.line}: ${pin.key}`;
    if (
      pin.image !== undefined &&
      firstPartyPrefixes.some((p) => imageRepository(pin.image as string).startsWith(p))
    ) {
      if (!DIGEST_SUFFIX.test(pin.image)) {
        problems.push(`${where} is a first-party image not pinned by digest`);
      }
      continue;
    }
    const published = dates.get(pin.key);
    if (published === undefined) {
      problems.push(`${where} has no release date in release-dates.json`);
      continue;
    }
    const ageDays = (now.getTime() - Date.parse(published)) / DAY_MS;
    if (!(ageDays >= MIN_AGE_DAYS)) {
      problems.push(
        `${where} was published ${published}, ${ageDays.toFixed(1)} days before the check; the floor is ${MIN_AGE_DAYS}`,
      );
    }
  }
  return problems;
}
