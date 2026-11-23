// Wait for a rostered reviewer to approve a PR head by reacting to the bot's review request.
//
//   node tools/discord-bridge/wait-approval.mjs <review request message ID> --pr <number>
//        [--once] [--interval <seconds>] [--timeout <minutes>]
//
// Prints one JSON line and exits 0 approved, 2 still waiting, 3 PR head changed, 4 PR closed or
// merged, 1 on an error. Run it as a background task, like the CI wait in the ship-pr skill.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { exitCode, repository, waitForApproval, waitOptions } from './approval.mjs';
import destination from './destination.json' with { type: 'json' };
import { DiscordError, discordClient } from './discord.mjs';

const usage =
  'Usage: node tools/discord-bridge/wait-approval.mjs <review request message ID> --pr <number> ' +
  '[--once] [--interval <seconds>] [--timeout <minutes>]';

// Linked worktrees share one git directory, so the roster and the token file are found from any
// of them: the roster inside that directory, .env.discord in the checkout that owns it.
function sharedGitDirectory() {
  try {
    return execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new DiscordError('Run this from inside a Geldar checkout or worktree.');
  }
}

function readRoster(gitDirectory) {
  const path = join(gitDirectory, 'discord-review.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new DiscordError(
      `No readable reviewer roster at ${path}. Save the pinned Approved Reviewers roster there ` +
        'first (docs/agents/discord-workflow.md, Private reviewer roster).',
    );
  }
}

const runGh = promisify(execFile);
// gh exits 4 when it needs a sign-in. That and a missing gh cannot pass on a retry; the rest can.
async function pullRequest(number) {
  try {
    const { stdout } = await runGh(
      'gh',
      ['pr', 'view', String(number), '--repo', repository, '--json', 'state,headRefOid'],
      { timeout: 30_000 },
    );
    const { state, headRefOid } = JSON.parse(stdout);
    return { state, head: headRefOid };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new DiscordError('The gh command is not installed or not on PATH.');
    }
    if (error?.code === 4) {
      throw new DiscordError('gh is not signed in. Run gh auth login, then retry.');
    }
    throw Object.assign(
      new DiscordError(`Could not read PR #${number} with gh. Check gh auth status.`),
      {
        retryable: true,
      },
    );
  }
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      once: { type: 'boolean', default: false },
      interval: { type: 'string' },
      timeout: { type: 'string' },
      pr: { type: 'string' },
    },
  });
  if (positionals.length !== 1) throw new DiscordError(usage);

  const gitDirectory = sharedGitDirectory();
  const tokenFile = join(dirname(gitDirectory), '.env.discord');
  if (!process.env.DISCORD_BOT_TOKEN && existsSync(tokenFile)) process.loadEnvFile(tokenFile);

  const outcome = await waitForApproval({
    request: discordClient({ token: process.env.DISCORD_BOT_TOKEN }),
    destination,
    messageId: positionals[0],
    roster: readRoster(gitDirectory),
    pullRequest,
    ...waitOptions(values),
    note: (text) => console.error(text),
  });
  console.log(JSON.stringify(outcome));
  process.exitCode = exitCode(outcome.status);
} catch (error) {
  const known = error instanceof DiscordError || error?.code?.startsWith?.('ERR_PARSE_ARGS');
  console.error(`Approval check failed. ${known ? error.message : 'Unexpected error.'}`);
  process.exitCode = 1;
}
