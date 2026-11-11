# syntax=docker/dockerfile:1
# The Body for Adam on the colo node: golem/src/adam/main.ts (decision 0083). Build from the repo root:
#   docker build -f golem/Dockerfile -t geldar-body:c1 .
# The Node digest is the one threshold/mcp pins (pushed 2026-09-19, past the 14-day floor).
# Pins: pnpm comes from corepack and the packageManager sha512 in package.json; installs use the frozen lockfile.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
RUN corepack enable
WORKDIR /opt/geldar
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contract ./contract
COPY golem ./golem
# --ignore-scripts: no dependency runs an install script (no native module), so none runs in the image build.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@geldar/golem..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS body
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# No credential is set here. The NATS password arrives as a file path at run time (compose/nats-auth.yml).
# The shard file is read from /opt/geldar/shards, mounted by the compose slot (C1-02). Nothing is written.
USER 1000:1000
WORKDIR /opt/geldar/golem
ENTRYPOINT ["node", "src/adam/main.ts"]
