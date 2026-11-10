/**
 * A sovereign player's MCP bearer token is `gmcp-` and 64 lower-case hex
 * characters (threshold/mcp token-hash.ts). A committed token is a live
 * credential, so any such string in a tracked or untracked text file is a
 * finding (threat model section 3). The report names the path and line only,
 * never the token.
 */
const MCP_TOKEN = /gmcp-[0-9a-f]{64}/;

/** The lines of one file that hold a token-shaped string, as `path:line`. */
export function findMcpTokens(path: string, text: string): string[] {
  const findings: string[] = [];
  text.split('\n').forEach((line, index) => {
    if (MCP_TOKEN.test(line)) findings.push(`${path}:${index + 1}`);
  });
  return findings;
}
