/**
 * The leak scan for envs/*.yaml: a secret-shaped value, an account name or an address
 * other than 127.0.0.1 is refused. A finding names the rule, never the value, so a
 * report cannot repeat a secret. The rules follow the repo's IPv4 policy (decision
 * 0132) and its credential check, and are stricter: an environment value may hold no
 * address but loopback, and the subnet is the only CIDR.
 */

/** Four octets, each 0 to 255, not part of a longer number or of a five-part dotted number. */
const DOTTED_QUAD =
  /(?<![\d.])((?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\.?\d)/g;

/** A pinned image digest is hex by design: it is stripped before the random-string rule runs. */
const DIGEST = /@sha256:[a-f0-9]{64}\b/g;

/** Value rules, each with the label a finding reports. */
const RULES: { label: string; pattern: RegExp }[] = [
  { label: 'a PEM key block', pattern: /-----BEGIN [A-Z0-9 ]*-----/ },
  { label: 'a NATS seed or key', pattern: /\bS[A-Z][A-Z2-7]{50,}/ },
  {
    label: 'a service token',
    pattern: /\b(?:gh[pousr]_|github_pat_|xox[abprs]-|AKIA|ASIA)\w{16,}/,
  },
  { label: 'a JSON Web Token', pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}/ },
  { label: 'a URL with a password', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
  {
    label: 'a secret assignment',
    pattern: /\b(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S{6,}/i,
  },
  {
    label: 'a long random string',
    pattern: /(?=[\w+/-]*\d)(?=[\w+/-]*[A-Z])(?=[\w+/-]*[a-z])[\w+/-]{40,}/,
  },
  { label: 'an email address (an account name)', pattern: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i },
  {
    label: 'an IPv6 address',
    pattern:
      /(?<![\w:])(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}(?![\w:])|(?<![\w:])::[0-9a-f]{1,4}(?![\w:])/i,
  },
];

/** The one address an environment may name. */
const ALLOWED_IPV4 = '127.0.0.1';

/** The labels of every rule a text breaks, each once; empty when the text is clean. */
export function textFindings(text: string): string[] {
  const labels: string[] = [];
  const stripped = text.replace(DIGEST, '@digest');
  for (const match of stripped.matchAll(DOTTED_QUAD)) {
    if (match[0] !== ALLOWED_IPV4) {
      labels.push('an IPv4 address other than 127.0.0.1');
      break;
    }
  }
  for (const rule of RULES) {
    if (rule.pattern.test(stripped)) labels.push(rule.label);
  }
  return [...new Set(labels)];
}

/**
 * Every finding in a parsed environment, as `label found` strings. The subnet value is
 * skipped: the schema checks it as a documentation CIDR. Keys are scanned too.
 */
export function findLeaks(data: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const label of textFindings(value)) found.add(label);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value !== null && typeof value === 'object') {
      for (const [name, child] of Object.entries(value)) {
        for (const label of textFindings(name)) found.add(label);
        visit(child);
      }
    }
  };
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const [name, child] of Object.entries(data)) {
      if (name === 'subnet') continue; // the schema checks it as a documentation CIDR
      for (const label of textFindings(name)) found.add(label);
      visit(child);
    }
  }
  return [...found].map((label) => `${label} found`);
}
