# Wave M fix requests

## R1

- tools/mcp-tokens/secret-files.ts (CLI): refuse a pepper under 32 bytes at mint time, with the same rule as threshold/mcp `pepperBytes` (one trailing LF or CRLF removed, nothing else trimmed).
- tools/mcp-tokens `init --force`: print a loud warning that the database role password is not changed by a rewrite of postgres-mcp.txt, and document it in the README.
- tools/mcp-tokens checkOutPath: resolve the parent directory with realpath before the in-repo check, so a symlink outside the repo that points in is refused.
- tools/mcp-tokens on win32: mode 0o600 is not enforced and mkdir uses the default mode; add an icacls step or document the limitation.
- Item C (token CLI) done: the pepper golden table holds the CLI and the server to one rule; init --force prints the role-password warning; checkOutPath resolves symlinks; the win32 owner-only ACL runs icacls best effort. The README note for init --force is for the R5 docs owner.

## R4

- journal quota (per-player rate/size cap in tools/journal.ts) is a request to the tools owner: 60 calls/min x 4000 chars is about 240 KB/min.
- wantBody is redundant with touch: both write the same record (awake, desired_body up, stamped now), so the bound-call path could drop the wantBody call.
