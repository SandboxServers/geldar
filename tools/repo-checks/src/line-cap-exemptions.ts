/**
 * Reasoned exemptions from the line caps (file-caps.ts). A file may sit above the soft
 * cap, and above the default hard cap, when it is listed here with its own hard cap and a
 * reason. The list is data reviewed like code. A missing or malformed list fails the gate.
 */

export interface LineCapExemption {
  /** An exact repo-relative path, or a glob: `*` stays within one segment, `**` crosses them. */
  path: string;
  /** The hard cap for the matching files; an integer above the default hard cap. */
  hardCap: number;
  /** Why the file legitimately grows; never empty. */
  reason: string;
}

export interface ParsedLineCapExemptions {
  exemptions: LineCapExemption[];
  /** One line per defect; any problem fails the gate. Defective entries are left out. */
  problems: string[];
}

const ENTRY_KEYS = new Set(['path', 'hardCap', 'reason']);

/**
 * Parses the exemption list. `text` is undefined when the file cannot be read, which is a
 * problem: the gate fails closed rather than judging every file by the defaults.
 */
export function parseLineCapExemptions(
  text: string | undefined,
  source: string,
  defaultHardCap: number,
): ParsedLineCapExemptions {
  const exemptions: LineCapExemption[] = [];
  if (text === undefined) {
    return {
      exemptions,
      problems: [`${source} is missing; the line-cap exemption list fails closed`],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { exemptions, problems: [`${source} is not JSON: ${(error as Error).message}`] };
  }
  const list = (data as { exemptions?: unknown } | null)?.exemptions;
  if (typeof data !== 'object' || data === null || !Array.isArray(list)) {
    return {
      exemptions,
      problems: [`${source} must be an object with an "exemptions" array`],
    };
  }

  const problems: string[] = [];
  const seen = new Set<string>();
  list.forEach((raw, index) => {
    const at = `${source} entry ${index + 1}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const fields = raw as Record<string, unknown>;
    const unknown = Object.keys(fields).filter((key) => !ENTRY_KEYS.has(key));
    if (unknown.length > 0) problems.push(`${at} has unknown keys: ${unknown.join(', ')}`);

    const { path, hardCap, reason } = fields;
    const pathOk =
      typeof path === 'string' &&
      path.trim() !== '' &&
      !path.startsWith('/') &&
      !path.includes('\\');
    if (!pathOk) {
      problems.push(`${at}: "path" must be a repo-relative path with forward slashes`);
      return;
    }
    const label = `${at} (${path})`;
    if (typeof reason !== 'string' || reason.trim() === '') {
      problems.push(`${label} has no reason`);
      return;
    }
    if (typeof hardCap !== 'number' || !Number.isInteger(hardCap) || hardCap <= defaultHardCap) {
      problems.push(`${label}: "hardCap" must be an integer above ${defaultHardCap}`);
      return;
    }
    if (seen.has(path)) {
      problems.push(`${at}: duplicate entry for ${path}`);
      return;
    }
    seen.add(path);
    if (unknown.length === 0) exemptions.push({ path, hardCap, reason });
  });
  return { exemptions, problems };
}

/**
 * The first entry whose path (exact, or glob) matches; file order decides between overlapping
 * globs. Undefined when the file is on no list, so the default caps apply.
 */
export function exemptionFor(
  path: string,
  exemptions: readonly LineCapExemption[],
): LineCapExemption | undefined {
  return exemptions.find((exemption) => globToRegExp(exemption.path).test(path));
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] as string;
    if (char === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      source += '(?:.*/)?'; // `**/` is zero or more whole segments
      i += 2;
    } else if (char === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}
