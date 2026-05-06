# syntax=docker/dockerfile:1.6
FROM node:22-bookworm-slim AS builder
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/game-server apps/game-server
RUN pnpm install --frozen-lockfile --prefer-offline || pnpm install
RUN pnpm --filter @stacks/poker-engine build \
 && pnpm --filter @stacks/tournament-engine build \
 && pnpm --filter @stacks/shared-types build \
 && pnpm --filter @stacks/game-server build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=builder /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/packages /app/packages
COPY --from=builder /repo/apps/game-server /app/apps/game-server
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/game-server/dist/index.js"]
