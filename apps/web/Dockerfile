# syntax=docker/dockerfile:1.6
# Multi-stage build for the Next.js web app, deployed to Fly.io.
# Output: a slim runtime image (~150 MB) with Next.js standalone server.

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
# Workspace files
COPY pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY packages packages
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prefer-offline || pnpm install

FROM deps AS builder
WORKDIR /repo
COPY apps/web apps/web
WORKDIR /repo/apps/web

# NEXT_PUBLIC_* values must be available at `next build` time so they get
# baked into the client bundle. Receive them as build args (set via
# fly.toml [build.args]) and re-export as env vars for the build.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SOLANA_NETWORK
ARG NEXT_PUBLIC_SOLANA_RPC
ARG NEXT_PUBLIC_VAULT_PROGRAM_ID
ARG NEXT_PUBLIC_USDC_MINT
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SOLANA_NETWORK=$NEXT_PUBLIC_SOLANA_NETWORK \
    NEXT_PUBLIC_SOLANA_RPC=$NEXT_PUBLIC_SOLANA_RPC \
    NEXT_PUBLIC_VAULT_PROGRAM_ID=$NEXT_PUBLIC_VAULT_PROGRAM_ID \
    NEXT_PUBLIC_USDC_MINT=$NEXT_PUBLIC_USDC_MINT \
    NEXT_TELEMETRY_DISABLED=1

# Build the Next.js standalone bundle. transpilePackages handles the workspace
# packages (no separate package builds needed).
RUN pnpm build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Drop privileges
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Copy standalone bundle (next.config.ts: output:'standalone' generates this)
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
