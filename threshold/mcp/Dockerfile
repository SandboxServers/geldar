# syntax=docker/dockerfile:1
# The real Geldar MCP server (spec 6.2, 6.5; decisions 0021 and 0050). Build from the repo root:
#   docker build -f threshold/mcp/Dockerfile .   (compose/mcp.yml sets context and dockerfile)
# The Node digest is the one threshold/mcp-mock pins; the runtime stage runs as uid 1000 on a read-only root.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
RUN npm install -g pnpm@12.15.0
WORKDIR /opt/geldar
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@geldar/mcp..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS mcp
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# Config comes from the environment and the secret files in /run/secrets (compose/mcp.yml). Nothing is written.
USER 1000:1000
WORKDIR /opt/geldar/threshold/mcp
EXPOSE 8788
ENTRYPOINT ["node", "src/cli.ts"]
# `start` is the only subcommand (cli.ts exits 2 without it); the shard file is read from /opt/geldar/shards.
CMD ["start"]
