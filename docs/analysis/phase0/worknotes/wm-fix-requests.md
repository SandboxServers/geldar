# Wave M fix requests

## R1

- tools/mcp-tokens/secret-files.ts (CLI): refuse a pepper under 32 bytes at mint time, with the same rule as threshold/mcp `pepperBytes` (one trailing LF or CRLF removed, nothing else trimmed).
- tools/mcp-tokens `init --force`: print a loud warning that the database role password is not changed by a rewrite of postgres-mcp.txt, and document it in the README.
- tools/mcp-tokens checkOutPath: resolve the parent directory with realpath before the in-repo check, so a symlink outside the repo that points in is refused.
- tools/mcp-tokens on win32: mode 0o600 is not enforced and mkdir uses the default mode; add an icacls step or document the limitation.
