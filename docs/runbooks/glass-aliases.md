# Glass and Kino display aliases

Glass (the thought stream and `/api/agents`) and Kino (the picker and the 3D name labels) can show a public alias
instead of an agent's stored name, so the humans watching do not see who is who.

## The alias file

- One JSON object on the node: `{"<agent id>": "<alias>"}`. One entry per life id; ids without an entry show the stored name.
- The file is private. It is root-owned on the node (mode 0640, readable by the Glass service uid), kept in the
  directory `aliases` under `GELDAR_STATE_DIR` (default `/var/lib/geldar-colo/aliases`), file name `aliases.json`, and **never committed**.
  The repo holds only made-up test fixtures.
- Compose mounts the directory read-only into Glass at `/run/geldar-aliases` and sets `GELDAR_ALIASES_FILE`
  to `/run/geldar-aliases/aliases.json`. A directory is mounted so the stack starts without the file.
- No file, an unreadable file or invalid JSON: Glass logs one line (it never prints a name) and shows stored names.
- The file is read once at start; restart Glass after editing it.

## What changes and what does not

Changed: the `name` field of agent, thought, journal and stream rows, and the `label` of each `/kino/targets` entry
(shown in the picker and on the name sprite). The agent id stays in the API, for routing and skin URLs.

Not changed: the database, the Mind, in-game names, and anything agents wrote (thought text, speech, receipts may
still contain real names). Treat Glass and Kino as alias-fronted, not anonymous.
