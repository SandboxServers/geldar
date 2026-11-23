import assert from 'node:assert/strict';
import test from 'node:test';
import { checkConnection, discordClient } from '../discord.mjs';

const destination = { serverId: '100000000000000001', channelId: '100000000000000002' };
const fixtureCredential = 'for-mocked-fetch-only';

test('uses Discord API v10 and sends the JSON body in a single POST', async () => {
  const path = `/channels/${destination.channelId}/messages`;
  const body = { content: 'fixture', allowed_mentions: { parse: [], replied_user: false } };
  const calls = [];
  const request = discordClient({
    token: `  ${fixtureCredential}  `,
    fetchImpl: async (...args) => {
      calls.push(args);
      return Response.json({ id: '100000000000000003' });
    },
  });

  await request(path, undefined, { body });
  assert.equal(calls.length, 1);
  const [[url, options]] = calls;
  assert.equal(url, `https://discord.com/api/v10${path}`);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, `Bot ${fixtureCredential}`);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.redirect, 'error');
  assert.deepEqual(JSON.parse(options.body), body);
});

for (const [label, respond, expected] of [
  [
    'network failure',
    () => {
      throw new Error(fixtureCredential);
    },
    /check the channel before resending/i,
  ],
  ['rate limit', () => new Response(fixtureCredential, { status: 429 }), /rate-limited/],
  [
    'server failure',
    () => new Response(fixtureCredential, { status: 503 }),
    /check the channel before resending/i,
  ],
  ['invalid JSON', () => new Response(fixtureCredential), /check the channel before resending/i],
]) {
  test(`a send with ${label} is never retried and hides upstream details`, async () => {
    let calls = 0;
    const request = discordClient({
      token: fixtureCredential,
      fetchImpl: async () => {
        calls += 1;
        return respond();
      },
    });
    await assert.rejects(
      request('/messages', undefined, { body: { content: 'fixture' } }),
      (error) => expected.test(error.message) && !error.message.includes(fixtureCredential),
    );
    assert.equal(calls, 1);
  });
}

test('connection preflight preserves token, missing-install, and channel-role guidance', async () => {
  assert.throws(() => discordClient({ token: '' }), /Set DISCORD_BOT_TOKEN/);
  for (const [deniedPath, status, expected] of [
    ['/users/@me', 401, /rejected the token/],
    [`/guilds/${destination.serverId}`, 404, /Install the app.*Server Install link/],
    [`/channels/${destination.channelId}`, 403, /Geldar-Agent.*View Channel/],
  ]) {
    const request = discordClient({
      token: fixtureCredential,
      fetchImpl: async (url, options) => {
        assert.equal(options.method, 'GET');
        return new URL(url).pathname === `/api/v10${deniedPath}`
          ? new Response(fixtureCredential, { status })
          : Response.json({ bot: true });
      },
    });
    await assert.rejects(checkConnection(destination, request), expected);
  }
});

test('connection preflight rejects a channel from a different guild', async () => {
  const request = async (path) =>
    path === `/channels/${destination.channelId}`
      ? { guild_id: '100000000000000099', type: 0 }
      : { bot: true };
  await assert.rejects(checkConnection(destination, request), /regular text channel/);
});
