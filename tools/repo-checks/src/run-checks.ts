/**
 * The repo hygiene gate as a function: every git and file-system read goes through
 * a `RepoPort` and the clock is a parameter, so tests run it in-process. `cli.ts`
 * wires the real git-backed port. Output order and wording are the CLI's contract.
 */
import { findControlChar, type IndexEntry } from './control-chars.ts';
import { checkDecisionIndex } from './decision-index.ts';
import { checkFileCaps, HARD_CAP, SOFT_CAP } from './file-caps.ts';
import { checkSovereignIdentity, isShardFile } from './identity-mode.ts';
import { checkIntegrationFloor, countIntegrationFiles } from './integration-floor.ts';
import { findIpLiterals, parseIpAllowlist } from './ip-literals.ts';
import { findPublicPorts, isComposeFile } from './loopback-ports.ts';
import { findMcpTokens } from './mcp-token.ts';
import { checkPins } from './pin-rules.ts';
import {
  checkReleaseAge,
  extractPins,
  parseFirstPartyPrefixes,
  parseReleaseDates,
} from './release-age.ts';
import { checkWorkflowYaml, isWorkflowFile } from './workflow-yaml.ts';

const RELEASE_DATES = 'tools/repo-checks/src/release-dates.json';
const FIRST_PARTY_IMAGES = 'tools/repo-checks/src/first-party-images.json';
const INTEGRATION_FLOOR = 'tools/repo-checks/src/integration-floor.json';
const IP_ALLOWLIST = 'tools/repo-checks/src/ip-literal-allowlist.json';

/** What the gate reads from a repository. Paths are relative to the repo root. */
export interface RepoPort {
  /** Index entries (`git ls-files -s`). May throw: the caller reports it. */
  indexEntries(): IndexEntry[];
  /** Untracked, not-ignored paths. */
  untrackedPaths(): string[];
  /** Paths committed with CRLF line endings (`git ls-files --eol`). */
  crlfPaths(): string[];
  /** The committed (index) bytes of each entry; throws when git cannot read one. */
  indexBlobs(entries: IndexEntry[]): Map<string, Buffer>;
  /** Working-tree text, or undefined when the file cannot be read. */
  readText(path: string): string | undefined;
  /** Working-tree bytes of a regular file, or undefined when missing or not a file. */
  readFileBytes(path: string): Buffer | undefined;
}

export interface RepoChecksResult {
  failed: boolean;
  lines: string[];
}

export function runRepoChecks(port: RepoPort, now: Date): RepoChecksResult {
  const lines: string[] = [];
  let failed = false;
  const log = (line: string): void => {
    lines.push(line);
  };
  const readFiles = (paths: string[]): { path: string; text: string }[] =>
    paths.flatMap((path) => {
      const text = port.readText(path);
      return text === undefined ? [] : [{ path, text }]; // deleted in the working tree but still in the index
    });

  const entries = port.indexEntries();
  const tracked = readFiles(entries.map((entry) => entry.path));
  const untrackedPaths = port.untrackedPaths();
  const untracked = readFiles(untrackedPaths);
  const all = [...tracked, ...untracked];

  for (const finding of checkFileCaps(all)) {
    const cap = finding.level === 'hard' ? HARD_CAP : SOFT_CAP;
    const tag = finding.level === 'hard' ? 'error' : 'warning';
    log(`${tag}: ${finding.path} has ${finding.lines} lines (cap ${cap})`);
    if (finding.level === 'hard') failed = true;
  }

  const crlfPaths = new Set(port.crlfPaths());
  for (const path of crlfPaths) {
    log(`error: ${path} is committed with CRLF line endings; .gitattributes requires LF`);
    failed = true;
  }

  const indexFindings: string[] = [];
  try {
    for (const [path, content] of port.indexBlobs(entries)) {
      const found = findControlChar(path, content);
      // A CRLF file is already reported above: one message per file.
      if (found) indexFindings.push(`${path}:${found.line}:${found.byte}`);
      if (found && !(found.byte === 0x0d && crlfPaths.has(path))) {
        const byte = found.byte.toString(16).padStart(2, '0');
        log(
          `error: ${path}:${found.line} has a control character (0x${byte}); use LF and no raw control bytes`,
        );
        failed = true;
      }
    }
  } catch (error) {
    // A git failure must fail the gate with one line, not a stack trace.
    log(`error: control-character check: ${(error as Error).message}`);
    failed = true;
  }

  /**
   * The working tree too: tracked files (an unstaged edit) and untracked,
   * not-ignored files (a new file not yet added). A defect already reported from
   * the index is not repeated.
   */
  try {
    const reported = new Set(indexFindings);
    const treePaths = [
      ...entries.filter((entry) => !entry.gitlink).map((entry) => entry.path),
      ...untrackedPaths,
    ];
    for (const path of new Set(treePaths)) {
      const bytes = port.readFileBytes(path);
      if (bytes === undefined) continue;
      const found = findControlChar(path, bytes, true);
      if (!found) continue;
      const key = `${path}:${found.line}:${found.byte}`;
      if (reported.has(key)) continue;
      const byte = found.byte.toString(16).padStart(2, '0');
      log(
        `error: ${path}:${found.line} has a control character (0x${byte}) in the working tree; use LF and no raw control bytes`,
      );
      failed = true;
    }
  } catch (error) {
    log(`error: working-tree control-character check: ${(error as Error).message}`);
    failed = true;
  }

  for (const file of all.filter((f) => isComposeFile(f.path))) {
    for (const hit of findPublicPorts(file.path, file.text)) {
      log(
        `error: ${hit.path} service ${hit.service}: ${hit.reason} (docs/threat-model.md section 1)`,
      );
      failed = true;
    }
  }

  for (const file of all) {
    for (const location of findMcpTokens(file.path, file.text)) {
      log(
        `error: ${location}: an MCP bearer token is committed; revoke it and remove it (docs/threat-model.md section 3)`,
      );
      failed = true;
    }
  }

  for (const file of all.filter((f) => isWorkflowFile(f.path))) {
    for (const problem of checkWorkflowYaml(file.path, file.text)) {
      log(`error: ${problem}`);
      failed = true;
    }
  }

  for (const file of all) {
    for (const problem of checkPins(file.path, file.text)) {
      log(`error: ${problem}`);
      failed = true;
    }
  }

  const releaseDates = parseReleaseDates(port.readText(RELEASE_DATES), RELEASE_DATES);
  const firstParty = parseFirstPartyPrefixes(port.readText(FIRST_PARTY_IMAGES), FIRST_PARTY_IMAGES);
  const pins = all.flatMap((file) => extractPins(file.path, file.text));
  const ageProblems = [
    ...releaseDates.problems,
    ...firstParty.problems,
    ...checkReleaseAge(pins, releaseDates.dates, now, firstParty.prefixes),
  ];
  for (const problem of ageProblems) {
    log(`error: ${problem} (docs/threat-model.md, decision 0005: 14-day release floor)`);
    failed = true;
  }

  const integrationCount = countIntegrationFiles(all);
  for (const problem of checkIntegrationFloor(
    integrationCount,
    port.readText(INTEGRATION_FLOOR),
    INTEGRATION_FLOOR,
  )) {
    log(`error: ${problem}`);
    failed = true;
  }

  for (const file of all.filter((f) => isShardFile(f.path))) {
    for (const problem of checkSovereignIdentity(file.path, file.text)) {
      log(`error: ${problem}`);
      failed = true;
    }
  }

  for (const problem of checkDecisionIndex(all)) {
    log(`error: ${problem}`);
    failed = true;
  }

  /** The IPv4 literal policy (decision 0132): a malformed allowlist fails closed. */
  const ipAllowlist = parseIpAllowlist(port.readText(IP_ALLOWLIST), IP_ALLOWLIST);
  for (const problem of ipAllowlist.problems) {
    log(`error: ${problem}`);
    failed = true;
  }
  const ipAllowed = new Set(ipAllowlist.paths);
  for (const file of all) {
    if (file.text.includes('\0')) continue; // a binary file has no IPv4 text to scan
    for (const finding of findIpLiterals(file.path, file.text, ipAllowed)) {
      log(`error: ${finding}`);
      failed = true;
    }
  }

  log(failed ? 'repo checks: failed' : 'repo checks: ok');
  return { failed, lines };
}
