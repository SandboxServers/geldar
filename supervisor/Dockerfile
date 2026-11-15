# syntax=docker/dockerfile:1
# The supervisor (C7-03b5, decision 0260): the control responder for Body containers. The image holds no Docker
# client, no Docker CLI and no socket path: the host body helper controls the containers over NATS. Build from the repo root:
#   docker build -f supervisor/Dockerfile .   (the Colo workflow builds it; see .github/workflows/colo-images.yml)
# The Node digest is the one threshold/register pins. Pnpm comes from corepack; installs use the frozen lockfile.
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
RUN corepack enable
WORKDIR /opt/geldar
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@geldar/supervisor..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS supervisor
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
# Config comes from the environment and the secret files in /run/secrets (compose/colo.yml). Nothing is written.
USER 1000:1000
WORKDIR /opt/geldar/supervisor
ENTRYPOINT ["node", "src/main.ts"]
