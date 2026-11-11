/**
 * The IPv4 literal policy (decision 0132, the repo rule in CLAUDE.md). A dotted
 * quad is one of three classes. Loopback (127/8 and 0.0.0.0) and the RFC 5737
 * documentation ranges are allowed in any file. A private or link-local address
 * (10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10) is allowed only in a file
 * on the allowlist (`ip-literal-allowlist.json`), which implements or tests IP
 * and CIDR handling. Any other address is public and fails everywhere. A report
 * names the path, the line and the class, never the address.
 */

/** Four octets, each 0 to 255, not part of a longer number or of a five-part dotted number. */
const DOTTED_QUAD =
  /(?<![\d.])((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\.?\d)/g;

/** A `version` key (JSON, YAML) or a Maven `version="..."` attribute: a version string, not an address. */
const VERSION_FIELD = /["']?\bversion\b["']?\s*[:=]/i;

/** Paths whose dotted quads are versions, hashes or generated data, not addresses. */
const EXCLUDED_PATHS = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)release-dates\.json$/,
  /(^|\/)CHANGELOG[^/]*$/i,
  /(^|\/)verification-metadata\.xml$/,
  /[.-]lock(?:file|\.json)?$/i,
  /^contract\/src\/generated\//,
  /(^|\/)node_modules\//,
];

export type IpClass = 'anywhere' | 'private' | 'public';

/** The class of one dotted quad that DOTTED_QUAD matched. */
export function classifyIpv4(literal: string): IpClass {
  const [a, b, c] = literal.split('.').map(Number);
  if (a === 127 || literal === '0.0.0.0') return 'anywhere';
  if (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return 'anywhere';
  }
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  ) {
    return 'private';
  }
  return 'public';
}

/** Whether a tracked or untracked path is scanned at all (lockfiles, changelogs and generated code are not). */
export function isIpScanned(path: string): boolean {
  return !EXCLUDED_PATHS.some((pattern) => pattern.test(path));
}

const MESSAGES: Record<'private' | 'public', string> = {
  private:
    'private IPv4 literal in a file not on tools/repo-checks/src/ip-literal-allowlist.json (decision 0132)',
  public:
    'public IPv4 literal; only loopback, 0.0.0.0 and the RFC 5737 documentation ranges are allowed (decision 0132)',
};

/**
 * The findings for one text file, as `path:line: message`. A private literal is
 * a finding unless the path is on the allowlist; a public literal always is.
 */
export function findIpLiterals(
  path: string,
  text: string,
  allowlist: ReadonlySet<string>,
): string[] {
  if (!isIpScanned(path)) return [];
  const findings: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (VERSION_FIELD.test(line)) return;
    const classes = new Set<IpClass>();
    for (const match of line.matchAll(DOTTED_QUAD)) classes.add(classifyIpv4(match[0]));
    for (const cls of classes) {
      if (cls === 'anywhere') continue;
      if (cls === 'private' && allowlist.has(path)) continue;
      findings.push(`${path}:${index + 1}: ${MESSAGES[cls]}`);
    }
  });
  return findings;
}

export type IpAllowlist = { paths: string[]; problems: string[] };

/**
 * The allowlist: a JSON array of `{ "path", "reason" }`, paths repo-relative.
 * A missing or malformed file fails the check closed rather than allowing nothing quietly.
 */
export function parseIpAllowlist(text: string | undefined, source: string): IpAllowlist {
  if (text === undefined) {
    return {
      paths: [],
      problems: [`${source} cannot be read; the IPv4 literal check fails closed`],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { paths: [], problems: [`${source} is not valid JSON: ${(error as Error).message}`] };
  }
  if (!Array.isArray(parsed)) {
    return { paths: [], problems: [`${source} must be a JSON array`] };
  }
  const paths: string[] = [];
  const problems: string[] = [];
  for (const entry of parsed) {
    const fields =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const { path, reason } = fields;
    if (
      typeof path !== 'string' ||
      path === '' ||
      path.startsWith('/') ||
      path.includes('..') ||
      typeof reason !== 'string' ||
      reason.trim() === ''
    ) {
      problems.push(`${source}: each entry needs a repo-relative "path" and a non-empty "reason"`);
      continue;
    }
    paths.push(path);
  }
  return { paths, problems };
}
