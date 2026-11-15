/**
 * Admits a player's life id to the server whitelist over RCON, before its Body connects (threat
 * model rule 9: infrastructure use). `whitelist add` is idempotent; `TestControl` checks the
 * server's reply, so an unexpected reply fails the admission instead of passing silently.
 */
import type { GolemConfig } from '../config.ts';
import { readRconPassword } from '../config.ts';
import { RconClient } from '../rcon.ts';
import type { CommandSource } from '../test-control.ts';
import { TestControl } from '../test-control.ts';

/** Adds `lifeId` to the whitelist. Resolves for "Added" and "already whitelisted"; throws otherwise. */
export async function admitLife(rcon: CommandSource, lifeId: string): Promise<void> {
  await new TestControl(rcon).whitelistAdd(lifeId);
}

/** A command connection that can be closed: an RCON client, or a fake in tests. */
export interface AdmissionRcon extends CommandSource {
  close(): Promise<void>;
}

/** Passes only `whitelist add <lifeId>` for this life to `rcon`; any other command is refused unsent. */
export function admissionOnly(rcon: CommandSource, lifeId: string): CommandSource {
  const allowed = `whitelist add ${lifeId}`;
  return {
    async command(cmd: string): Promise<string> {
      if (cmd !== allowed) throw new Error('admission sends only its own whitelist add');
      return rcon.command(cmd);
    },
  };
}

/**
 * Opens an RCON connection for one admission and closes it after, admitted or not, so the Body
 * process holds no command socket while it runs (threat model rule 9).
 */
export async function admitLifeOverRcon(
  open: () => Promise<AdmissionRcon>,
  lifeId: string,
): Promise<void> {
  const rcon = await open();
  try {
    await admitLife(admissionOnly(rcon, lifeId), lifeId);
  } finally {
    await rcon.close();
  }
}

/**
 * Admits `lifeId` over an RCON connection that this module opens from `cfg` and closes itself. The
 * raw client never leaves this module, so no caller can send any command except the admission.
 */
export async function admitLifeWithConfig(cfg: GolemConfig, lifeId: string): Promise<void> {
  await admitLifeOverRcon(
    async () =>
      RconClient.connect({
        host: cfg.rconHost,
        port: cfg.rconPort,
        password: await readRconPassword(cfg),
      }),
    lifeId,
  );
}

/** Removes `lifeId` from the whitelist. Resolves for "Removed" and "not whitelisted"; throws otherwise. */
export async function removeLife(rcon: CommandSource, lifeId: string): Promise<void> {
  const reply = await new TestControl(rcon).whitelistRemove(lifeId);
  if (!/Removed|not whitelisted/i.test(reply)) {
    throw new Error(`whitelist remove ${lifeId} got an unexpected reply: ${reply}`);
  }
}

/** Opens an RCON connection for one removal and closes it after, removed or not (threat model rule 9). */
export async function removeLifeOverRcon(
  open: () => Promise<AdmissionRcon>,
  lifeId: string,
): Promise<void> {
  const rcon = await open();
  try {
    await removeLife(rcon, lifeId);
  } finally {
    await rcon.close();
  }
}
