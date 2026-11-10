import { describe, expect, it } from 'vitest';
import { type AdmissionRcon, admissionOnly, admitLife, admitLifeOverRcon } from './whitelist.ts';

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

/** A fake connection: records its commands, and whether it was closed. */
function fakeConnection(reply: string) {
  const sent: string[] = [];
  const state = { closed: false };
  const connection: AdmissionRcon = {
    async command(cmd: string) {
      sent.push(cmd);
      return reply;
    },
    async close() {
      state.closed = true;
    },
  };
  return { connection, sent, state };
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

describe('admissionOnly', () => {
  it('refuses any command but this life whitelist add, and sends nothing for it', async () => {
    const rcon = fakeRcon('ok');
    const source = admissionOnly(rcon.source, 'ag_jason_01');
    await expect(source.command('op ag_jason_01')).rejects.toThrow(/only its own whitelist add/);
    await expect(source.command('whitelist add ag_billy_01')).rejects.toThrow();
    await expect(source.command('say hi')).rejects.toThrow();
    expect(rcon.sent).toEqual([]);
    await expect(source.command('whitelist add ag_jason_01')).resolves.toBe('ok');
    expect(rcon.sent).toEqual(['whitelist add ag_jason_01']);
  });
});

describe('admitLifeOverRcon', () => {
  it('closes the connection after a successful admission', async () => {
    const conn = fakeConnection('Added ag_jason_01 to the whitelist');
    await admitLifeOverRcon(async () => conn.connection, 'ag_jason_01');
    expect(conn.sent).toEqual(['whitelist add ag_jason_01']);
    expect(conn.state.closed).toBe(true);
  });

  it('still closes the connection when the admission fails', async () => {
    const conn = fakeConnection('Unknown command');
    await expect(admitLifeOverRcon(async () => conn.connection, 'ag_trini_01')).rejects.toThrow(
      /unexpected reply/,
    );
    expect(conn.state.closed).toBe(true);
  });
});
