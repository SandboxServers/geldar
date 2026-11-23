// Approval matching and the wait loop, against a fake Discord API and a fake GitHub PR reader.
// No network, token or real roster is touched.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseRoster, waitForApproval } from '../approval.mjs';
import { discordClient } from '../discord.mjs';

const destination = { serverId: '100000000000000001', channelId: '100000000000000002' };
const botId = '100000000000000003';
const reviewer = '100000000000000004';
const thumbsReviewer = '100000000000000005';
const stranger = '100000000000000006';
const customEmoji = '100000000000000007';
const messageId = '100000000000000008';
const head = 'a'.repeat(40);
const roster = {
  ':jasonthumb:': { userId: reviewer, emojiId: customEmoji },
  ':thumbsup:': { userId: thumbsReviewer },
};
const content = `Review please: https://github.com/SandboxServers/geldar/pull/42 at ${head}`;
const custom = { id: customEmoji, name: 'jasonthumb' };
const thumbs = { id: null, name: '👍' };

type Reaction = {
  emoji: { id: string | null; name: string };
  normal?: string[];
  burst?: string[];
};

/** A fake bridge client. `rounds` gives the message's reactions for each successive read. */
function fakeDiscord(rounds: Reaction[][], { author = botId, text = content } = {}) {
  const calls: string[] = [];
  // Read 1 parses the review request; read N + 1 is round N of the wait loop.
  let reads = 0;
  const current = () => rounds[Math.min(Math.max(reads - 2, 0), rounds.length - 1)] ?? [];
  const request = async (path: string) => {
    calls.push(path);
    const route = new URL(path, 'https://example.invalid');
    if (route.pathname === '/users/@me') return { id: botId, bot: true };
    const base = `/channels/${destination.channelId}/messages/${messageId}`;
    if (route.pathname === base) {
      reads += 1;
      return {
        content: text,
        author: { id: author },
        reactions: current().map((entry) => ({
          emoji: entry.emoji,
          count_details: { normal: entry.normal?.length ?? 0, burst: entry.burst?.length ?? 0 },
        })),
      };
    }
    const reactions = current();
    const emoji = decodeURIComponent(route.pathname.slice(`${base}/reactions/`.length));
    const entry = reactions.find(
      ({ emoji: { id, name } }) => (id ? `${name}:${id}` : name) === emoji,
    );
    const users = (route.searchParams.get('type') === '1' ? entry?.burst : entry?.normal) ?? [];
    const after = route.searchParams.get('after');
    const from = after ? users.indexOf(after) + 1 : 0;
    return users.slice(from, from + 100).map((id) => ({ id }));
  };
  return { request, calls };
}

const openPr = async () => ({ state: 'OPEN', head });

function wait(overrides: Record<string, unknown>) {
  const sleeps: number[] = [];
  let clock = 0;
  const run = waitForApproval({
    destination,
    messageId,
    roster,
    pullRequest: openPr,
    intervalMs: 1000,
    timeoutMs: 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    ...overrides,
  });
  return { run, sleeps };
}

describe('approval matching', () => {
  it('accepts the rostered account reacting with its own emoji', async () => {
    const { request } = fakeDiscord([[{ emoji: custom, normal: [stranger, reviewer] }]]);
    await expect(wait({ request }).run).resolves.toEqual({
      status: 'approved',
      pr: 'https://github.com/SandboxServers/geldar/pull/42',
      head,
      approvedBy: ':jasonthumb:',
    });
  });

  it.each([
    ['another account using the reviewer emoji', [{ emoji: custom, normal: [stranger] }]],
    [
      'the reviewer using an emoji outside the roster',
      [{ emoji: { id: null, name: '🎉' }, normal: [reviewer] }],
    ],
    ['the reviewer using the other reviewer’s emoji', [{ emoji: thumbs, normal: [reviewer] }]],
    [
      'a custom emoji with the right name and the wrong ID',
      [{ emoji: { id: '100000000000000009', name: 'jasonthumb' }, normal: [reviewer] }],
    ],
    ['a skin-tone thumbs up', [{ emoji: { id: null, name: '👍🏽' }, normal: [thumbsReviewer] }]],
    ['no reactions', []],
  ])('does not accept %s', async (_label, reactions) => {
    const { request } = fakeDiscord([reactions as Reaction[]]);
    await expect(wait({ request }).run).resolves.toMatchObject({ status: 'waiting' });
  });

  it('accepts plain 👍 from its rostered account, including as a super reaction', async () => {
    const { request, calls } = fakeDiscord([
      [{ emoji: thumbs, normal: [stranger], burst: [thumbsReviewer] }],
    ]);
    await expect(wait({ request }).run).resolves.toMatchObject({
      status: 'approved',
      approvedBy: ':thumbsup:',
    });
    expect(
      calls.filter((path) => path.includes('/reactions/')).map((path) => path.split('?')[1]),
    ).toEqual(['limit=100&type=0', 'limit=100&type=1']);
  });

  it('pages through a reaction with more than 100 accounts', async () => {
    const crowd = Array.from({ length: 150 }, (_, index) =>
      String(200000000000000000n + BigInt(index)),
    );
    const { request, calls } = fakeDiscord([[{ emoji: custom, normal: [...crowd, reviewer] }]]);
    await expect(wait({ request }).run).resolves.toMatchObject({ status: 'approved' });
    expect(calls.at(-1)).toContain(`after=${crowd[99]}`);
  });

  it('never returns an account ID', async () => {
    const { request } = fakeDiscord([[{ emoji: custom, normal: [reviewer] }]]);
    expect(JSON.stringify(await wait({ request }).run)).not.toContain(reviewer);
  });
});

describe('the wait loop', () => {
  it('polls at the interval until the approval appears', async () => {
    const { request } = fakeDiscord([[], [], [{ emoji: custom, normal: [reviewer] }]]);
    const { run, sleeps } = wait({ request, timeoutMs: 60_000 });
    await expect(run).resolves.toMatchObject({ status: 'approved' });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('reports waiting when time runs out, without sleeping past the deadline', async () => {
    const { request } = fakeDiscord([[]]);
    const { run, sleeps } = wait({ request, timeoutMs: 2500 });
    await expect(run).resolves.toEqual({
      status: 'waiting',
      pr: 'https://github.com/SandboxServers/geldar/pull/42',
      head,
    });
    expect(sleeps).toEqual([1000, 1000]);
  });

  it.each([
    [
      { state: 'OPEN', head: 'b'.repeat(40) },
      { status: 'head-changed', currentHead: 'b'.repeat(40) },
    ],
    [{ state: 'MERGED', head }, { status: 'merged' }],
    [{ state: 'CLOSED', head }, { status: 'closed' }],
  ])('stops on PR state %j even when the approval reaction is present', async (pr, expected) => {
    const { request, calls } = fakeDiscord([[{ emoji: custom, normal: [reviewer] }]]);
    await expect(wait({ request, pullRequest: async () => pr }).run).resolves.toMatchObject(
      expected,
    );
    expect(calls.some((path) => path.includes('/reactions/'))).toBe(false);
  });

  it('retries a failed read, then gives up after five failed rounds in a row', async () => {
    const flaky = Object.assign(new Error('temporary'), { retryable: true });
    let failures = 2;
    const { request } = fakeDiscord([[{ emoji: custom, normal: [reviewer] }]]);
    const recovering = wait({
      request,
      timeoutMs: 60_000,
      pullRequest: async () => {
        if (failures-- > 0) throw flaky;
        return { state: 'OPEN', head };
      },
    });
    await expect(recovering.run).resolves.toMatchObject({ status: 'approved' });
    expect(recovering.sleeps).toEqual([1000, 1000]);

    const broken = wait({
      request,
      timeoutMs: 60_000,
      pullRequest: async () => {
        throw flaky;
      },
    });
    await expect(broken.run).rejects.toBe(flaky);
    expect(broken.sleeps).toHaveLength(4);
  });

  it('fails instead of reporting waiting when the only check failed', async () => {
    const flaky = Object.assign(new Error('temporary'), { retryable: true });
    const { request } = fakeDiscord([[]]);
    const once = wait({
      request,
      pullRequest: async () => {
        throw flaky;
      },
    });
    await expect(once.run).rejects.toBe(flaky);
  });

  it('stops at once on an error that cannot pass', async () => {
    const { request } = fakeDiscord([[]]);
    const fatal = new Error('gh is not signed in');
    const { run, sleeps } = wait({
      request,
      timeoutMs: 60_000,
      pullRequest: async () => {
        throw fatal;
      },
    });
    await expect(run).rejects.toBe(fatal);
    expect(sleeps).toEqual([]);
  });
});

describe('inputs', () => {
  it.each([
    ['a message another account posted', { author: stranger }, /this bot posted/],
    [
      'a short commit SHA',
      { text: 'https://github.com/SandboxServers/geldar/pull/42 at abc1234' },
      /full 40-character/,
    ],
    [
      'two PR links',
      {
        text: `https://github.com/SandboxServers/geldar/pull/42 https://github.com/SandboxServers/geldar/pull/43 ${head}`,
      },
      /exactly one Geldar PR link/,
    ],
    [
      'a PR in another repository',
      { text: `https://github.com/example/other/pull/42 ${head}` },
      /exactly one Geldar PR link/,
    ],
  ])('rejects %s', async (_label, message, expected) => {
    const { request } = fakeDiscord([[{ emoji: custom, normal: [reviewer] }]], message);
    await expect(wait({ request }).run).rejects.toThrow(expected);
  });

  it('rejects a message ID that is not a Discord ID before calling Discord', async () => {
    const { request, calls } = fakeDiscord([[]]);
    await expect(wait({ request, messageId: '../1' }).run).rejects.toThrow(/numeric Discord ID/);
    expect(calls).toEqual([]);
  });

  it('rejects a roster it cannot match against', () => {
    expect(() => parseRoster({})).toThrow(/roster is not usable/);
    expect(() => parseRoster({ ':jasonthumb:': { userId: 'someone' } })).toThrow(
      /roster is not usable/,
    );
    expect(() => parseRoster({ ':shipit:': { userId: reviewer } })).toThrow(/needs an emojiId/);
    expect(parseRoster(roster)).toEqual([
      { key: ':jasonthumb:', userId: reviewer, emojiId: customEmoji },
      { key: ':thumbsup:', userId: thumbsReviewer, emoji: '👍' },
    ]);
  });

  it('marks a failed read as worth retrying and a failed send as not', async () => {
    const request = discordClient({
      token: 'for-mocked-fetch-only',
      fetchImpl: async () => new Response('', { status: 503 }),
    });
    await expect(request('/users/@me')).rejects.toMatchObject({ retryable: true });
    await expect(request('/messages', undefined, { body: { content: 'x' } })).rejects.toMatchObject(
      {
        retryable: false,
      },
    );
    const denied = discordClient({
      token: 'for-mocked-fetch-only',
      fetchImpl: async () => new Response('', { status: 401 }),
    });
    await expect(denied('/users/@me')).rejects.toMatchObject({ retryable: false });
  });

  it('the command explains its usage and exits 1 without a message ID', () => {
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'wait-approval.mjs');
    const ran = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 });
    expect(ran.status).toBe(1);
    expect(ran.stdout).toBe('');
    expect(ran.stderr).toMatch(
      /Approval check failed\. Usage: node tools\/discord-bridge\/wait-approval\.mjs/,
    );
  });
});
