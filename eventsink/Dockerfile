# Build context is the repo root (compose sets it): the sink needs the workspace's contract package.
# Node is the .nvmrc patch (22.23.2); the digest was pushed 2026-09-17, older than the 14-day floor.
FROM node:22.23.2-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contract ./contract
COPY eventsink ./eventsink
RUN pnpm install --frozen-lockfile --prod --filter @geldar/eventsink...
USER node
WORKDIR /app/eventsink
CMD ["node", "src/main.ts"]
