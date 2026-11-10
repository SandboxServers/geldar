# WM interface requests and open points

## WM-09

Open points from the WM-09 token and seed work. Each needs an owner decision or a follow-up; none blocks the merge.

a. Initial life budget. The initial life budget is set to cap_credits (240). Owner to confirm.

b. Rotate grace period. The default grace period for `rotate` is 10 minutes. The spec is silent on the value. Owner to confirm.

c. Token-hash helper export. WM-09 imports the token-hash helper by relative path. threshold/mcp should add a subpath export for it so consumers do not reach into the package by path.

d. Integration round trips for the CLI are not written. Ops follow-up against the dev Postgres: mint then resolve; revoke then expect 401; rotate and check the grace window.

e. `init --force` re-creates the Postgres password file too. After a forced init, the role password must be set again with `migrate --set-role-password`.

f. Seed input and storage (decision 0060):
   - The seed input is `--identity-file` (max 8192 bytes) and `--goals-file` (max 4096 bytes).
   - Goals are stored under a `## Goals` heading appended to personality_seed. There is no goals column.
