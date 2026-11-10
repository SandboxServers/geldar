/**
 * The gates for the Wave M live cases (WM-12). A case runs only when the operator sets the env, so
 * `./geldar.ps1 check` and CI never reach a stack. gate.test.ts pins these rules.
 */

/** The live MCP cases need the shard, the MCP container and the test players (GELDAR_IT=1 GELDAR_MCP_LIVE=1). */
export function liveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GELDAR_IT === '1' && env.GELDAR_MCP_LIVE === '1';
}

/** The integration cases against a real Postgres need GELDAR_IT=1 and the stack up. */
export function integrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GELDAR_IT === '1';
}
