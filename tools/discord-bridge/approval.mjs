// Approval of a PR head by a rostered reviewer's reaction on the bot's own review request
// (docs/agents/discord-workflow.md). Read-only: it never posts, reacts or merges.
import { z } from 'zod';
import { DiscordError, snowflake } from './discord.mjs';

export const repository = 'SandboxServers/geldar';
const pullRequestLink = /https:\/\/github\.com\/SandboxServers\/geldar\/pull\/([0-9]+)\b/gi;
const fullSha = /\b[0-9a-f]{40}\b/gi;
// Roster keys that name a plain Unicode reaction. A key with an emojiId names a custom emoji.
const unicodeReactions = { ':thumbsup:': '👍' };
const reactionPageSize = 100;
const maxReactionPages = 10;
const maxFailedRounds = 5;
const exitCodes = { approved: 0, waiting: 2, 'head-changed': 3, closed: 4, merged: 4 };

/** The command's exit code for an outcome. Anything unknown is an error, never an approval. */
export function exitCode(status) {
  return Object.hasOwn(exitCodes, status) ? exitCodes[status] : 1;
}

function boundedNumber(text, minimum, maximum, label) {
  const value = Number(text);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new DiscordError(`${label} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

/** Validate the command's options. `--once` checks a single time and never sleeps. */
export function waitOptions({ once = false, interval = '180', timeout = '25', pr } = {}) {
  if (pr !== undefined && !/^[1-9][0-9]{0,8}$/.test(pr)) {
    throw new DiscordError('--pr must be the PR number, for example --pr 42.');
  }
  return {
    intervalMs: boundedNumber(interval, 30, 3600, '--interval (seconds)') * 1000,
    timeoutMs: once ? 0 : boundedNumber(timeout, 1, 1440, '--timeout (minutes)') * 60_000,
    ...(pr !== undefined && { expectedPr: Number(pr) }),
  };
}

const snowflakeId = z.string().regex(snowflake);
const rosterSchema = z.record(
  z.string().regex(/^:[a-z0-9_]+:$/i),
  z.strictObject({ userId: snowflakeId, emojiId: snowflakeId.optional() }),
);
const messageSchema = z.object({
  content: z.string(),
  author: z.object({ id: snowflakeId }),
  reactions: z
    .array(
      z.object({
        emoji: z.object({ id: snowflakeId.nullish(), name: z.string().nullish() }),
        count_details: z.object({ normal: z.number(), burst: z.number() }).optional(),
      }),
    )
    .default([]),
});
const reactorsSchema = z.array(z.object({ id: snowflakeId }));

/** Turn the private roster file into match rules. Throws when an entry cannot be matched. */
export function parseRoster(data) {
  const parsed = rosterSchema.safeParse(data);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    throw new DiscordError(
      'The reviewer roster is not usable. Rebuild discord-review.json from the pinned ' +
        'Approved Reviewers message, as docs/agents/discord-workflow.md describes.',
    );
  }
  return Object.entries(parsed.data).map(([key, { userId, emojiId }]) => {
    const emoji = unicodeReactions[key];
    if (!emojiId && !emoji) {
      throw new DiscordError(
        `Roster key ${key} needs an emojiId, or must be one of: ${Object.keys(unicodeReactions).join(', ')}.`,
      );
    }
    return emojiId ? { key, userId, emojiId } : { key, userId, emoji };
  });
}

/** The PR and head a review request cites. It must be the bot's own message. */
export function parseReviewRequest(message, botId) {
  if (message.author.id !== botId) {
    throw new DiscordError('Choose a review request or CI update that this bot posted.');
  }
  const numbers = new Set([...message.content.matchAll(pullRequestLink)].map((match) => match[1]));
  const heads = new Set((message.content.match(fullSha) ?? []).map((sha) => sha.toLowerCase()));
  if (numbers.size !== 1 || heads.size !== 1) {
    throw new DiscordError(
      'The review request must cite exactly one Geldar PR link and one full 40-character commit SHA.',
    );
  }
  const [number] = numbers;
  const [head] = heads;
  return { number: Number(number), url: `https://github.com/${repository}/pull/${number}`, head };
}

async function reacted(request, messagePath, routeEmoji, userId, type) {
  const query = new URLSearchParams({ limit: String(reactionPageSize), type: String(type) });
  for (let page = 0; page < maxReactionPages; page += 1) {
    const users = reactorsSchema.safeParse(
      await request(`${messagePath}/reactions/${encodeURIComponent(routeEmoji)}?${query}`),
    );
    if (!users.success) {
      throw new DiscordError('Discord returned unexpected reaction data. Try again later.');
    }
    if (users.data.some((user) => user.id === userId)) return true;
    if (users.data.length < reactionPageSize) return false;
    query.set('after', users.data.at(-1).id);
  }
  throw new DiscordError('The reaction has more accounts than this check reads. Verify by hand.');
}

/** The roster key whose account and emoji both match a reaction on the message, or null. */
export async function findApproval(request, messagePath, message, rules) {
  for (const { emoji, count_details: counts } of message.reactions) {
    const rule = rules.find((candidate) =>
      candidate.emojiId
        ? candidate.emojiId === emoji.id
        : !emoji.id && candidate.emoji === emoji.name,
    );
    // A deleted custom emoji has no name, so its reactors cannot be listed: it approves nothing.
    if (!rule || !emoji.name) continue;
    const routeEmoji = emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
    // Type 0 is an ordinary reaction, type 1 a super reaction. Both are the account's own act.
    for (const type of counts?.burst ? [0, 1] : [0]) {
      if (await reacted(request, messagePath, routeEmoji, rule.userId, type)) return rule.key;
    }
  }
  return null;
}

/**
 * Poll until the review request is approved, its PR head moves, the PR closes, or time runs out.
 * `pullRequest(number)` resolves to `{ state, head }` from GitHub. Resolves to a status object;
 * `waiting` means time ran out with the request still open and unapproved.
 */
export async function waitForApproval({
  request,
  destination,
  messageId,
  roster,
  pullRequest,
  intervalMs,
  timeoutMs,
  expectedPr,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  note = () => {},
}) {
  if (!snowflake.test(messageId)) {
    throw new DiscordError('Supply the numeric Discord ID of the review request message.');
  }
  const rules = parseRoster(roster);
  const messagePath = `/channels/${destination.channelId}/messages/${messageId}`;
  const readMessage = async () => {
    const parsed = messageSchema.safeParse(
      await request(messagePath, 'The bot cannot read that message in the configured channel.'),
    );
    if (!parsed.success) {
      throw new DiscordError('Discord returned unexpected message data. Try again later.');
    }
    return parsed.data;
  };

  const bot = await request('/users/@me');
  const review = parseReviewRequest(await readMessage(), bot?.id);
  if (expectedPr !== undefined && review.number !== expectedPr) {
    throw new DiscordError(
      `That review request is for PR #${review.number}, not #${expectedPr}. Check the message ID.`,
    );
  }
  const outcome = (status, extra = {}) => ({ status, pr: review.url, head: review.head, ...extra });
  const deadline = now() + timeoutMs;
  let failedRounds = 0;
  let lastError;

  for (;;) {
    try {
      // GitHub first: an approval of a head the PR no longer has approves nothing.
      const { state, head } = await pullRequest(review.number);
      if (state !== 'OPEN') return outcome(state === 'MERGED' ? 'merged' : 'closed');
      if (head !== review.head) return outcome('head-changed', { currentHead: head });
      const approvedBy = await findApproval(request, messagePath, await readMessage(), rules);
      if (approvedBy) return outcome('approved', { approvedBy });
      failedRounds = 0;
    } catch (error) {
      failedRounds += 1;
      lastError = error;
      if (!error?.retryable || failedRounds >= maxFailedRounds) throw error;
      note(`Check failed, will retry: ${error.message}`);
    }
    if (now() + intervalMs > deadline) {
      // Out of time on a failed round: report the failure, never an unverified "still waiting".
      if (failedRounds > 0) throw lastError;
      return outcome('waiting');
    }
    await sleep(intervalMs);
  }
}
