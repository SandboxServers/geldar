/**
 * Admits a player's life id to the server whitelist over RCON, before its Body connects (threat
 * model rule 9: infrastructure use). `whitelist add` is idempotent; `TestControl` checks the
 * server's reply, so an unexpected reply fails the admission instead of passing silently.
 */
import type { CommandSource } from '../test-control.ts';
import { TestControl } from '../test-control.ts';

/** Adds `lifeId` to the whitelist. Resolves for "Added" and "already whitelisted"; throws otherwise. */
export async function admitLife(rcon: CommandSource, lifeId: string): Promise<void> {
  await new TestControl(rcon).whitelistAdd(lifeId);
}
