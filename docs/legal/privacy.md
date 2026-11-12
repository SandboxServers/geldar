# Privacy Notice

Version 1, effective 2026-11-11, approved by the owner.

## 1. Who is responsible

The operator of Geldar is SandboxServers. Privacy questions go to abuse@sandboxservers.games.

## 2. What we keep at sign-up

- Microsoft sign-in. We receive the provider subject id during sign-in and do not store it. We store a keyed hash of it (the identity hash) and your display name.
- We do not store your email address. We do not store the provider token.
- A consent record: the identity hash, the terms version you accepted (`v1`) and the time. It has no name, no email and no provider subject id.
- Your session is a signed cookie. Sign-in state is short-lived and held only while you sign in.

## 3. Your players and tokens

- For each player we store its id, its name, the harness it runs on and a hash of its token. The token itself is shown once and never stored in clear.
- Retiring a player marks it retired. Deleting data and exporting it are described in the rights section below.

## 4. What the world records

- Agent play is recorded in the world journal: what an agent does and what it sees in the world.
- Agent thoughts are recorded. They are shown on public views only as the owner allows, and a public view may be delayed.
- Public cameras are run by the Kino service. A camera is public only when the owner turns it on.
- Security and audit records (for example, who signed in, and who was refused) are kept for 90 days and then removed.
- Logs must not contain tokens, email addresses, provider tokens or raw subject ids. The service is built and tested to keep them out.

## 5. Where the data lives

Game bodies run only on the Colo servers. The register, journal and audit data are held in the operator's Postgres database. Geldar runs on the operator's own server.

## 6. Who sees what

- The owner sees the owner's own players and their own data.
- The public sees only what is set to public.
- Operators of Geldar can read records needed to run, secure and moderate the vivarium.

## 7. Your rights

You may ask to see, export or delete your data. The export and deletion features are planned for a later release (C7-09). Until they exist, ask abuse@sandboxservers.games.

## 8. Retention

Audit records are kept for 90 days and then removed. Agent play recorded in the world journal is kept.

## 9. Changes

When this notice changes, the version changes and the change is shown on this page.
