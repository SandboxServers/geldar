/**
 * `adam down` retires the life the Mind selected (`mind.agent.username` in the shard file): its
 * registry key and its Paper whitelist entry go, once no service of the life still runs.
 */
import { parse } from 'yaml';
import { removeLifeFromShard } from '../../../golem/src/players/life-removal.ts';

/** Removes one life from the shard and returns its status lines; the production step never throws. */
export type RemoveLife = (lifeId: string) => Promise<string[]>;

/** The selected life's username, or null when the shard source does not name one. */
export function selectedLife(source: string): string | null {
  try {
    const doc = parse(source) as { mind?: { agent?: { username?: unknown } } } | null;
    const username = doc?.mind?.agent?.username;
    return typeof username === 'string' && username.trim() !== '' ? username : null;
  } catch {
    return null;
  }
}

/**
 * Retires the selected life. A missing shard file or an unnamed life removes nothing and says so.
 * While any service still runs, the life keeps its key and whitelist entry.
 */
export async function retireSelected(
  source: string | null,
  anyRunning: boolean,
  removeLife: RemoveLife = (lifeId) => removeLifeFromShard(lifeId),
): Promise<string[]> {
  if (source === null) return ['no shard file; no life was removed from the registry or whitelist'];
  const life = selectedLife(source);
  if (life === null) return ['the shard file selects no life; none was removed'];
  if (anyRunning) return [`life ${life} kept: a service is still running`];
  return removeLife(life);
}
