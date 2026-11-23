# Discord bridge setup

- Date: 2026-11-22
- Source: Live Discord API checks and the setup guide in `tools/discord-bridge/README.md`

Guild installation and channel access are separate. The token can be valid
and the bot can access the server while the channel endpoint returns
`403 Missing Access`. Assign the bot the Geldar-Agent role and grant the role
channel access.

A bot can read its own messages while seeing empty text for ordinary messages
from others. Enable Message Content Intent on the app that issued the token
and retest against a known text message from another author. Guild member
prefix search works without the full-list intent.
