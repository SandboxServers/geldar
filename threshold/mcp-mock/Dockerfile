# syntax=docker/dockerfile:1
FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS deps
# pnpm comes from corepack, which checks the packageManager sha512 in the repo's package.json.
RUN corepack enable
WORKDIR /opt/geldar
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@geldar/mcp-mock..."

FROM node:22.23.2-trixie-slim@sha256:c5849ff9c9ebcd66615412f0b548ca5b8ecaef84003dc9ac2e077ebe46aaa3f6 AS mock
LABEL org.opencontainers.image.source="https://github.com/SandboxServers/geldar"
COPY --from=deps /opt/geldar /opt/geldar
ENV NODE_ENV=production
USER node
WORKDIR /opt/geldar/threshold/mcp-mock
EXPOSE 8787
ENTRYPOINT ["node", "src/cli.ts"]
CMD ["--tokens", "/run/secrets/mcp-tokens.json", "--scenario", "scenarios/dawn.scenario.json", "--host", "0.0.0.0"]
