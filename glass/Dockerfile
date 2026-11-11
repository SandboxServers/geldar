# syntax=docker/dockerfile:1
# The Glass, the Thought Stream server (wave 6 item 10; decision 0083 pattern). Build from the repo root:
#   docker build -f glass/Dockerfile .
# The Node digest is the one threshold/mcp pins; the runtime stage runs as uid 1000 on a read-only root.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
# pnpm comes from corepack, which checks the packageManager sha512 in the repo's package.json.
RUN corepack enable
WORKDIR /opt/geldar
COPY . .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@geldar/glass..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS glass
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# Config comes from the environment and the secret files in /run/secrets. Glass writes nothing.
USER 1000:1000
WORKDIR /opt/geldar/glass
# Glass listens on GELDAR_GLASS_PORT (default 8787) and, by its own guard, only on GELDAR_GLASS_HOST (127.0.0.1).
EXPOSE 8787
ENTRYPOINT ["node", "src/main.ts"]
