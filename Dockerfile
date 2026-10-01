FROM alpine:3.23 AS init
RUN apk add --no-cache openssl
COPY deploy/init-certs.sh /init-certs.sh
ENTRYPOINT ["sh", "/init-certs.sh"]

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS migration-builder
COPY scripts/migrate.ts ./scripts/migrate.ts
COPY src/lib/db/schema.ts ./src/lib/db/schema.ts
COPY src/lib/password.ts ./src/lib/password.ts
# This target builds independently of Next.js and bundles all migration dependencies.
RUN pnpm exec esbuild scripts/migrate.ts --bundle --platform=node --format=cjs --outfile=dist/migrate.cjs

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 dockyard && adduser --system --uid 1001 --ingroup dockyard dockyard
USER dockyard

FROM runtime AS migrate
COPY --from=migration-builder --chown=dockyard:dockyard /app/dist/migrate.cjs ./dist/migrate.cjs
COPY --chown=dockyard:dockyard drizzle ./drizzle
ENTRYPOINT ["node", "dist/migrate.cjs"]

FROM dependencies AS web-builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm build

FROM runtime AS web
ENV NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-builder --chown=dockyard:dockyard /app/.next/standalone ./
COPY --from=web-builder --chown=dockyard:dockyard /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
