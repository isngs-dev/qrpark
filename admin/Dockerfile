# The QR Parking Admin Portal image (Sprint 6a). Written new (eparking has no
# portal image); the layout follows the backend's.
#
# Runs `next start`, NOT Next's "standalone" server: the standalone server does
# not run next.config.mjs at start-up, so Hardening H3's refusal to start
# without an https QRPARK_API_URL would be skipped. Here it still runs.
# No address or secret is baked in: QRPARK_API_URL and
# QRPARK_CLIENT_ADDRESS_SECRET come from the environment at run time.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.mjs ./
COPY lib/backend-url.mjs ./lib/backend-url.mjs
RUN rm -rf .next/cache && chown -R node:node /app
# The image's own unprivileged user (uid 1000), never root.
USER node
EXPOSE 3000
CMD ["npx", "--no-install", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
