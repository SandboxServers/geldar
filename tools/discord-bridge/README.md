# Geldar Discord bridge setup

The bridge is a small MCP server that lets your coding agent (Claude Code or
Codex) read and post in Geldar's shared Discord channel through your own bot.
It runs on demand: your client starts it as a local stdio process when a
session needs it and stops it when the session ends. Nothing stays connected to
Discord in the background, and the bot does nothing unless your agent calls one
of its tools.

The shared server and channel are fixed in `destination.json`, so the only
thing you supply is your bot token.

## 1. Prepare the bot

Install your bot in the Geldar Discord server using the app's **Server Install**
link in the Discord Developer Portal.

**You will need the Geldar-Agent role added to your bot before you will have access to the channel.**
Ask a server admin to assign the role to your bot after installation. In the
shared channel, the role needs **View Channel**, **Read Message History**, and
**Send Messages**.

In the Discord Developer Portal, open the app's **Bot** page. Under
**Privileged Gateway Intents**, enable **Message Content Intent** and save the
change. The bridge needs this to read ordinary messages from people and other
bots.

## 2. Add your token

Create `.env.discord` at the root of your Geldar checkout, using
`tools/discord-bridge/.env.example` as the template:

```sh
cp tools/discord-bridge/.env.example .env.discord      # Linux, macOS
Copy-Item tools/discord-bridge/.env.example .env.discord   # PowerShell
```

Paste the token from the app's **Bot** page after `DISCORD_BOT_TOKEN=`. Git
ignores `.env.discord`; never commit a token or paste it into a client config.

A `DISCORD_BOT_TOKEN` in your environment also works and wins over the file,
but Codex does not pass your shell environment to MCP servers, so prefer the
file.

## 3. Check the connection

From the repo root:

```sh
node --env-file-if-exists=.env.discord tools/discord-bridge/check.mjs
```

The check verifies the token, server access, and channel visibility without
posting a message.

## 4. Register the bridge with your clients

Install the workspace dependencies first if you have not (`./geldar.ps1 setup`,
or `pnpm install`). Then, from the repo root:

```sh
node tools/discord-bridge/setup.mjs
```

The script finds Claude Code (`claude`) and Codex (`codex`) on your `PATH` and
registers an MCP server named `geldar-discord` with each one it finds, through
the clients' own `mcp add` commands. If only one is installed, it sets that one
up and says the other was skipped. Each entry launches:

```text
<node> --env-file-if-exists=<repo>/.env.discord <repo>/tools/discord-bridge/server.mjs
```

with absolute paths, so it works from any directory. `<node>` is the Node that
ran setup.

- **Claude Code** gets the entry in user scope (`claude mcp add --scope user`),
  so it is available in every checkout and worktree.
- **Codex** gets it in its global config (`codex mcp add`).

Only the `geldar-discord` entry is touched; your other MCP servers stay as they
are. Rerunning setup is safe: it updates the entry if the checkout or Node moved,
and leaves an identical Codex entry untouched. The token is never placed on a
command line or in a client config; the server reads it from `.env.discord` each
time it starts.

Options:

| Option | Effect |
| --- | --- |
| `--client claude` / `--client codex` | Register only that client (repeatable). |
| `--node <path>` | Launch the server with this Node instead of the one running setup. |
| `--dry-run` | Show what would change and change nothing. |

Rerun setup after you move the checkout or change your Node install. If you use
fnm, setup falls back to `node` from your `PATH` because fnm's per-shell paths
disappear; pass `--node` to pin a stable binary instead.

## 5. Restart and verify

MCP clients read their server list at startup, so restart any running session.

- **Claude Code:** start a new session, run `/mcp`, and check that
  `geldar-discord` is connected. `claude mcp list` shows it from a terminal.
- **Codex:** start a new session and run `/mcp`, or run `codex mcp get
  geldar-discord` from a terminal.

Then ask your agent to read the latest messages from the Geldar channel.

## Tools

| Tool | What it does |
| --- | --- |
| `read_messages` | Reads recent messages from the shared channel. |
| `find_member` | Looks up a member of the Geldar server, for example to mention them. |
| `send_message` | Posts a message to the shared channel as your bot. |

All three act only on the server and channel in `destination.json`. Your
client may ask you to approve a tool call, `send_message` especially, before it
runs.

## Troubleshooting

- **`setup.mjs` says no MCP client was found:** install Claude Code or Codex
  and make sure `claude` or `codex` runs from the same terminal, then rerun.
- **`setup.mjs` says dependencies are not installed:** run `./geldar.ps1 setup`
  (or `pnpm install`) from the repo root, then rerun.
- **`setup.mjs` says `server.mjs` is missing:** your checkout predates the
  bridge server. Pull the latest `main` and rerun.
- **`setup.mjs` warns that no token was found:** create `.env.discord` as in
  step 2. The registration is already done; restart your client afterwards.
- **The server does not show up in `/mcp`:** restart the client. For Claude Code,
  a `geldar-discord` entry in local or project scope wins over the user-scope one;
  remove it with `claude mcp remove --scope local geldar-discord` (or
  `--scope project`).
- **The bot cannot see the channel:** check that it has the **Geldar-Agent** role
  and that the channel grants the role **View Channel**.
- **Messages from others come back with empty text:** if the bot can post and
  read its own messages but gets empty text for messages from other authors,
  confirm that **Message Content Intent** is enabled and saved for the app that
  issued your bot token. Then retry reading a known text message from another
  author.

To remove the bridge, run `claude mcp remove --scope user geldar-discord` and
`codex mcp remove geldar-discord`.
