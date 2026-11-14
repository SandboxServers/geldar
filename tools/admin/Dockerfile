# syntax=docker/dockerfile:1
# The admin one-shot image for the colo node (decision 0133): tools/migrate and tools/mcp-tokens, run as
#   docker compose -p geldar-colo -f compose/colo.yml --profile admin run --rm admin <subcommand>
# Build from the repo root:  docker build -f tools/admin/Dockerfile -t geldar-admin:c1 .
# The Node digest is the one golem/Dockerfile pins. Nothing secret is set or copied: passwords arrive as files at run time.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
# pnpm comes from corepack, which checks the packageManager sha512 in the repo's package.json.
RUN corepack enable
WORKDIR /opt/geldar
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
# mcp-tokens declares @geldar/mcp, whose workspace closure is these packages. The migration files are the sql/ directory.
COPY contract ./contract
COPY animus ./animus
COPY player-core ./player-core
COPY threshold ./threshold
COPY tools/repo-checks ./tools/repo-checks
COPY tools/migrate ./tools/migrate
COPY tools/mcp-tokens ./tools/mcp-tokens
COPY tools/players-cli ./tools/players-cli
COPY sql ./sql
COPY tools/admin/admin.sh ./tools/admin/admin.sh
# mcp-tokens imports golem/src/players/life-removal.ts (and the golem files it imports), so the CLI does not start
# without them. Its runtime dependencies (the @nats-io packages) are declared in golem/package.json, so both are copied.
COPY golem/package.json ./golem/package.json
COPY golem/src ./golem/src
# --ignore-scripts: no dependency runs an install script (no native module), so none runs in the image build.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@geldar/mcp-tokens..." --filter "@geldar/migrate..." --filter "@geldar/players-cli..." --filter "@geldar/golem..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS admin
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# No credential is set here. The Postgres password arrives as a file (compose/colo.yml), and nothing is written.
USER 1000:1000
WORKDIR /opt/geldar
# The entrypoint is run by sh, so the image does not depend on the executable bit surviving the build context.
ENTRYPOINT ["sh", "/opt/geldar/tools/admin/admin.sh"]
