import { describe, expect, it } from 'vitest';
import { admitLife } from './whitelist.ts';

/** A fake RCON that records each command and answers with `reply`. */
function fakeRcon(reply: string): {
  source: { command(c: string): Promise<string> };
  sent: string[];
} {
  const sent: string[] = [];
  return {
    sent,
    source: {
      async command(cmd: string) {
        sent.push(cmd);
        return reply;
      },
    },
  };
}

describe('admitLife', () => {
  it('sends whitelist add for the life id', async () => {
    const rcon = fakeRcon('Added ag_jason_01 to the whitelist');
    await admitLife(rcon.source, 'ag_jason_01');
    expect(rcon.sent).toEqual(['whitelist add ag_jason_01']);
  });

  it('resolves when the player is already whitelisted (idempotent)', async () => {
    const rcon = fakeRcon('Player is already whitelisted');
    await expect(admitLife(rcon.source, 'ag_billy_01')).resolves.toBeUndefined();
  });

  it('throws on a reply it does not recognise', async () => {
    const rcon = fakeRcon('Unknown command');
    await expect(admitLife(rcon.source, 'ag_trini_01')).rejects.toThrow(/unexpected reply/);
  });

  it('refuses a name that is not a Minecraft username before it sends anything', async () => {
    const rcon = fakeRcon('Added');
    await expect(admitLife(rcon.source, 'ag_x;op')).rejects.toThrow(RangeError);
    expect(rcon.sent).toEqual([]);
  });
});
