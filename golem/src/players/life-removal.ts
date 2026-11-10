/**
 * Removes a life from the shard when its player is retired: the life registry key over NATS, then
 * the Paper whitelist entry over RCON. `players down`, `adam stop` and `mcp-tokens retire` call it.
 * It never throws: each failed step becomes a line that names the manual command to run instead.
 */
import { type GolemConfig, loadStackConfig, readRconPassword } from '../config.ts';
import { RconClient } from '../rcon.ts';
import { removeRegistryKey } from '../registry.ts';
import { removeLifeOverRcon } from './whitelist.ts';

/** The two side effects of a removal; production uses NATS and RCON, tests pass fakes. */
export interface RemovalSteps {
  deleteKey(natsUrl: string, lifeId: string): Promise<void>;
  removeWhitelist(cfg: GolemConfig, lifeId: string): Promise<void>;
}

const PRODUCTION_STEPS: RemovalSteps = {
  deleteKey: removeRegistryKey,
  async removeWhitelist(cfg, lifeId) {
    const password = await readRconPassword(cfg);
    await removeLifeOverRcon(
      () => RconClient.connect({ host: cfg.rconHost, port: cfg.rconPort, password }),
      lifeId,
    );
  },
};

/** The manual command that deletes a life's registry key (the bucket is `geldar-life-registry`). */
export function manualKeyCommand(lifeId: string): string {
  return `nats kv del geldar-life-registry ${lifeId}`;
}

/** The manual command that removes a life from the Paper whitelist, run inside the stack. */
export function manualWhitelistCommand(lifeId: string): string {
  return `docker compose -f compose/phase0.yml exec paper rcon-cli whitelist remove ${lifeId}`;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs both removal steps for `lifeId` and returns one status line per step. Each line says what
 * happened, and a line for a failed or skipped step also gives the manual command.
 */
export async function removeLifeFromShard(
  lifeId: string,
  env: Record<string, string | undefined> = process.env,
  steps: RemovalSteps = PRODUCTION_STEPS,
): Promise<string[]> {
  let cfg: GolemConfig;
  try {
    cfg = loadStackConfig(env);
  } catch (error) {
    return [
      `life ${lifeId}: shard settings unreadable (${reason(error)}); run: ${manualKeyCommand(lifeId)} and ${manualWhitelistCommand(lifeId)}`,
    ];
  }
  const lines: string[] = [];
  if (cfg.natsUrl === undefined) {
    lines.push(`registry key ${lifeId}: NATS is off; run: ${manualKeyCommand(lifeId)}`);
  } else {
    try {
      await steps.deleteKey(cfg.natsUrl, lifeId);
      lines.push(`registry key ${lifeId}: deleted`);
    } catch (error) {
      lines.push(
        `registry key ${lifeId}: not deleted (${reason(error)}); run: ${manualKeyCommand(lifeId)}`,
      );
    }
  }
  try {
    await steps.removeWhitelist(cfg, lifeId);
    lines.push(`whitelist ${lifeId}: removed`);
  } catch (error) {
    lines.push(
      `whitelist ${lifeId}: not removed (${reason(error)}); run: ${manualWhitelistCommand(lifeId)}`,
    );
  }
  return lines;
}
