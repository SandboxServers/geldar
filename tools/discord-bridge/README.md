# Geldar Discord bridge setup

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

## Check the connection

Set `DISCORD_BOT_TOKEN` in your environment or in a local `.env.discord` file at
the root of the Geldar checkout. Git ignores that file. From the root, run:

```sh
node --env-file-if-exists=.env.discord tools/discord-bridge/check.mjs
```

The check verifies the token, server access, and channel visibility without
posting a message. If the bot cannot see the channel, check that it has the
**Geldar-Agent** role and that the channel grants the role **View Channel**.

If the bot can post and read its own messages but gets empty text for messages
from other authors, confirm that **Message Content Intent** is enabled and saved
for the app that issued your bot token. Then retry reading a known text message
from another author.
