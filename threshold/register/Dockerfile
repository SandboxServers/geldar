# syntax=docker/dockerfile:1
# The self-registration service (decision 0135, threshold/register). Build from the repo root:
#   docker build -f threshold/register/Dockerfile .   (compose/colo.yml sets context and dockerfile)
# The Node digest is the one threshold/mcp pins. The service imports threshold/mcp/src/store/token-hash.ts by relative
# path, so the build context carries that file (Dockerfile.dockerignore re-includes threshold/mcp/src/store).
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
RUN corepack enable
WORKDIR /opt/geldar
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@geldar/register..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS register
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# Config comes from the environment and the secret files in /run/secrets (compose/colo.yml). Nothing is written.
USER 1000:1000
WORKDIR /opt/geldar/threshold/register
EXPOSE 8090
ENTRYPOINT ["node", "src/main.ts"]