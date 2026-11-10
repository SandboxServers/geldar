/**
 * Guards for the live cases. A case that acts on a player the operator names in env must refuse any player
 * without the test marker before it touches anything. The marker is `ag-test-` (the life id form is `ag_test_`),
 * the same as the test player ag-test-01 that the live cases use.
 */
export const TEST_PLAYER_MARKER = 'ag-test-';

/** Returns the player id when it carries the test marker; throws otherwise. The message does not repeat the id. */
export function assertTestPlayer(playerId: string): string {
  if (!playerId.startsWith(TEST_PLAYER_MARKER)) {
    throw new Error(`refusing a live case on a player without the ${TEST_PLAYER_MARKER} marker`);
  }
  return playerId;
}

/**
 * True when `value` serialises to JSON that holds `text` in its JSON-escaped form. A canary with quotes or
 * newlines appears escaped in JSON, so a plain substring check on the raw text misses it.
 */
export function jsonHas(value: unknown, text: string): boolean {
  const escaped = JSON.stringify(text).slice(1, -1);
  return (JSON.stringify(value) ?? '').includes(escaped);
}
