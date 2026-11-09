/**
 * Loopback-only rule (docs/threat-model.md section 1): every `ports:` entry in
 * compose/*.yml starts with `127.0.0.1:`, because a bare `"5432:5432"` binds
 * every interface. Only the port rule is checked here. Long-syntax entries
 * (mappings) have no prefix to compare, so they are reported too.
 */

export const LOOPBACK_PREFIX = '127.0.0.1:';

/** True for the compose files the rule applies to, by repo-relative, forward-slash path. */
export function isComposeFile(path: string): boolean {
  return /^compose\/[^/]+\.ya?ml$/.test(path);
}

export interface PortFinding {
  path: string;
  line: number;
  entry: string;
}

/** Removes quotes around a scalar and a trailing ` # comment`. */
function scalar(text: string): string {
  return text
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

/** The `ports:` entries of one compose file that do not start with the loopback prefix. */
export function findPublicPorts(path: string, text: string): PortFinding[] {
  const findings: PortFinding[] = [];
  const report = (line: number, entry: string) => {
    if (entry !== '' && !entry.startsWith(LOOPBACK_PREFIX)) findings.push({ path, line, entry });
  };

  // Indent of the `ports:` key while its block list is being read, else null.
  let portsIndent: number | null = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').replace(/\r$/, '');
    const content = line.trim();
    if (content === '' || content.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (portsIndent !== null && indent > portsIndent) {
      const item = content.match(/^-\s*(.*)$/);
      if (item) report(index + 1, scalar(item[1] ?? ''));
      continue;
    }
    portsIndent = null;

    const key = content.match(/^ports:\s*(.*)$/);
    if (!key) continue;
    const rest = scalar(key[1] ?? '');
    if (rest === '') {
      portsIndent = indent; // block list follows on the next lines
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      for (const entry of rest.slice(1, -1).split(',')) report(index + 1, scalar(entry));
    }
  }
  return findings;
}
