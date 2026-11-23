/**
 * The developer agent board (decision 0436): no tracked or untracked text names the
 * board's public host or carries a board API key. The keys live only in Key Vault.
 * The patterns are written so that this file holds no host and no key-shaped value.
 */
const BOARD_HOST = /\bboard\.[a-z0-9-]+\.app\b/i;
const BOARD_KEY_HEADER = /Api-Key:\s*[0-9a-f]{20,}/i;
const BOARD_KEY_ASSIGNMENT = /discourse-agent-.*[:=] *[A-Za-z0-9]{20,}/;

/** One finding per offending line. The finding never repeats the matched text. */
export function findBoardLeaks(path: string, text: string): string[] {
  const findings: string[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (BOARD_HOST.test(line)) {
      findings.push(`${path}:${index + 1}: names the developer board host (docs/agents/board.md)`);
    } else if (BOARD_KEY_HEADER.test(line) || BOARD_KEY_ASSIGNMENT.test(line)) {
      findings.push(
        `${path}:${index + 1}: looks like a board API key (keys live only in Key Vault)`,
      );
    }
  }
  return findings;
}
