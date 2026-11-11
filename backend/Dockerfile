# The QR Parking backend image (Sprint 6a). Adapted from
# C:\Dev\eparking\backend\Dockerfile: the same two stages and OpenSSL lesson,
# plus a non-root user and a .dockerignore (eparking runs as root and has none).
#
# Nothing site-specific or secret is baked in: SITE_CODE, the database, Redis,
# JWT_SECRET, the T13 secret and the Paystack key all come from the
# environment at run time (compose.prod.yml, from the server's .env).
# The same image runs the api, the one-shot migration and the seeds.

FROM node:22-alpine AS build
WORKDIR /app
# OpenSSL BEFORE prisma generate, in both stages: without it Prisma picks an
# engine linked against libssl.so.1.1, which Alpine does not have.
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npx nest build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY package*.json ./
# prisma (the CLI) is a runtime dependency on purpose: the migrate job runs
# `prisma migrate deploy` in this image, pinned to the version the code was
# built against.
RUN npm ci --omit=dev && npm cache clean --force
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
# Tests and their helpers are compiled into dist too; they are not needed to run.
RUN find dist \( -name '*.test.js' -o -name '*.test.js.map' \) -delete && rm -rf dist/test-support && chown -R node:node /app
# The image's own unprivileged user (uid 1000), never root.
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
