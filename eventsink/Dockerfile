# Build context is the repo root (compose sets it): the sink needs the workspace's contract package.
FROM node:22.23-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY contract ./contract
COPY eventsink ./eventsink
RUN pnpm install --frozen-lockfile --prod --filter @geldar/eventsink...
USER node
WORKDIR /app/eventsink
CMD ["node", "src/main.ts"]
