import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GolemConfig } from '../config.ts';
import { RconClient } from '../rcon.ts';
import {
  type AdmissionRcon,
  admissionOnly,
  admitLife,
  admitLifeOverRcon,
  admitLifeWithConfig,
  removeLife,
  removeLifeOverRcon,
  removeLifeWithConfig,
} from './whitelist.ts';

vi.mock('../rcon.ts', () => ({ RconClient: { connect: vi.fn() } }));

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

  it('in remove mode refuses whitelist add for this life and any remove for another life', async () => {
    const rcon = fakeRcon('ok');
    const source = admissionOnly(rcon.source, 'ag_jason_01', 'remove');
    await expect(source.command('whitelist add ag_jason_01')).rejects.toThrow(
      'admission sends only its own whitelist remove',
    );
    await expect(source.command('whitelist remove ag_billy_01')).rejects.toThrow();
    await expect(source.command('op ag_jason_01')).rejects.toThrow();
    await expect(source.command('stop')).rejects.toThrow();
    expect(rcon.sent).toEqual([]);
    await expect(source.command('whitelist remove ag_jason_01')).resolves.toBe('ok');
    expect(rcon.sent).toEqual(['whitelist remove ag_jason_01']);
  });

  it('in add mode refuses whitelist remove for this life, and any other command', async () => {
    const rcon = fakeRcon('ok');
    const source = admissionOnly(rcon.source, 'ag_jason_01', 'add');
    await expect(source.command('whitelist remove ag_jason_01')).rejects.toThrow();
    await expect(source.command('whitelist list')).rejects.toThrow();
    expect(rcon.sent).toEqual([]);
  });

  it('refuses a mode other than add or remove before it sends anything', () => {
    const rcon = fakeRcon('ok');
    expect(() => admissionOnly(rcon.source, 'ag_jason_01', 'op' as unknown as 'add')).toThrow(
      'admission mode is add or remove',
    );
    expect(rcon.sent).toEqual([]);
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

describe('removeLife', () => {
  it('sends whitelist remove for the life id and accepts Removed', async () => {
    const rcon = fakeRcon('Removed ag_jason_01 from the whitelist');
    await removeLife(rcon.source, 'ag_jason_01');
    expect(rcon.sent).toEqual(['whitelist remove ag_jason_01']);
  });

  it('resolves when the player was not whitelisted (idempotent)', async () => {
    const rcon = fakeRcon('Player is not whitelisted');
    await expect(removeLife(rcon.source, 'ag_billy_01')).resolves.toBeUndefined();
  });

  it('throws on a reply it does not recognise', async () => {
    const rcon = fakeRcon('Unknown command');
    await expect(removeLife(rcon.source, 'ag_trini_01')).rejects.toThrow(/unexpected reply/);
  });
});

describe('removeLifeOverRcon', () => {
  it('closes the connection after a removal, and after a failed one', async () => {
    const ok = fakeConnection('Removed ag_jason_01 from the whitelist');
    await removeLifeOverRcon(async () => ok.connection, 'ag_jason_01');
    expect(ok.sent).toEqual(['whitelist remove ag_jason_01']);
    expect(ok.state.closed).toBe(true);
    const bad = fakeConnection('Unknown command');
    await expect(removeLifeOverRcon(async () => bad.connection, 'ag_trini_01')).rejects.toThrow(
      /unexpected reply/,
    );
    expect(bad.state.closed).toBe(true);
  });
});

describe('removeLifeWithConfig', () => {
  const connect = vi.mocked(RconClient.connect);
  let dir: string;

  beforeEach(async () => {
    connect.mockClear();
    dir = await mkdtemp(join(tmpdir(), 'remove-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function configWithPassword(): Promise<GolemConfig> {
    const passwordFile = join(dir, 'rcon.txt');
    await writeFile(passwordFile, 'pass-word-1\n', 'utf8');
    return {
      mcHost: 'mc.test',
      mcPort: 25565,
      rconHost: 'rcon-host.test',
      rconPort: 25999,
      rconPasswordFile: passwordFile,
    };
  }

  it('connects with the configured password, sends only whitelist remove for the id, and closes', async () => {
    const conn = fakeConnection('Removed ag_jason_01 from the whitelist');
    connect.mockResolvedValueOnce(conn.connection as unknown as RconClient);
    await removeLifeWithConfig(await configWithPassword(), 'ag_jason_01');
    expect(connect).toHaveBeenCalledWith({
      host: 'rcon-host.test',
      port: 25999,
      password: 'pass-word-1',
    });
    expect(conn.sent).toEqual(['whitelist remove ag_jason_01']);
    expect(conn.state.closed).toBe(true);
  });

  it('accepts not whitelisted as an idempotent success', async () => {
    const conn = fakeConnection('Player is not whitelisted');
    connect.mockResolvedValueOnce(conn.connection as unknown as RconClient);
    await expect(
      removeLifeWithConfig(await configWithPassword(), 'ag_jason_01'),
    ).resolves.toBeUndefined();
    expect(conn.state.closed).toBe(true);
  });

  it('closes the client and throws when the reply is unexpected', async () => {
    const conn = fakeConnection('Unknown command');
    connect.mockResolvedValueOnce(conn.connection as unknown as RconClient);
    await expect(removeLifeWithConfig(await configWithPassword(), 'ag_jason_01')).rejects.toThrow(
      /unexpected reply/,
    );
    expect(conn.state.closed).toBe(true);
  });

  it('closes the client when the command rejects', async () => {
    const state = { closed: false };
    const failing = {
      async command(): Promise<string> {
        throw new Error('socket reset');
      },
      async close() {
        state.closed = true;
      },
    };
    connect.mockResolvedValueOnce(failing as unknown as RconClient);
    await expect(removeLifeWithConfig(await configWithPassword(), 'ag_jason_01')).rejects.toThrow(
      'socket reset',
    );
    expect(state.closed).toBe(true);
  });

  it('refuses a malformed id before it sends anything', async () => {
    const conn = fakeConnection('Removed');
    connect.mockResolvedValueOnce(conn.connection as unknown as RconClient);
    await expect(removeLifeWithConfig(await configWithPassword(), 'ag_x;op')).rejects.toThrow();
    expect(conn.sent).toEqual([]);
  });
});

describe('admitLifeWithConfig', () => {
  const connect = vi.mocked(RconClient.connect);
  let dir: string;

  beforeEach(async () => {
    connect.mockClear();
    dir = await mkdtemp(join(tmpdir(), 'admit-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A config whose password file holds `pass-word-1` with a trailing newline, as the secret files do. */
  async function configWithPassword(): Promise<GolemConfig> {
    const passwordFile = join(dir, 'rcon.txt');
    await writeFile(passwordFile, 'pass-word-1\n', 'utf8');
    return {
      mcHost: 'mc.test',
      mcPort: 25565,
      rconHost: 'rcon-host.test',
      rconPort: 25999,
      rconPasswordFile: passwordFile,
    };
  }

  it('connects to the configured host and port with the password read from the file, then admits', async () => {
    const conn = fakeConnection('Added ag_jason_01 to the whitelist');
    connect.mockResolvedValueOnce(conn.connection as unknown as RconClient);
    await admitLifeWithConfig(await configWithPassword(), 'ag_jason_01');
    expect(connect).toHaveBeenCalledWith({
      host: 'rcon-host.test',
      port: 25999,
      password: 'pass-word-1',
    });
    expect(conn.sent).toEqual(['whitelist add ag_jason_01']);
    expect(conn.state.closed).toBe(true);
  });

  it('closes the client when the command rejects', async () => {
    const state = { closed: false };
    const failing = {
      async command(): Promise<string> {
        throw new Error('socket reset');
      },
      async close() {
        state.closed = true;
      },
    };
    connect.mockResolvedValueOnce(failing as unknown as RconClient);
    await expect(admitLifeWithConfig(await configWithPassword(), 'ag_jason_01')).rejects.toThrow(
      'socket reset',
    );
    expect(state.closed).toBe(true);
  });
});
