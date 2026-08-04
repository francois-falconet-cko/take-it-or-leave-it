# Take It or Leave It — container image for the internal platform
#
# Builds the static export into `out/` (includes index.html) and serves it on
# port 3000. Pricing runs entirely in the browser; AI parse is unavailable
# without a Node API (enter fields manually).
#
# Build:
#   docker build -t take-it-or-leave-it .
#   docker build --build-arg NEXT_PUBLIC_DEMO_MODE=false -t take-it-or-leave-it .
#
# Run (platform requires port 3000):
#   docker run --rm -p 3000:3000 take-it-or-leave-it

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stub the gitignored live book from the demo book when absent.
RUN node scripts/ensure-book.mjs

ARG NEXT_PUBLIC_DEMO_MODE=true
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
ENV BUILD_TARGET=static
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build \
  && test -f out/index.html

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Static file server; -l 3000 is required by the platform.
RUN npm install -g serve@14.2.4 \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Platform looks for out/index.html — keep that path in the image.
COPY --from=builder --chown=nextjs:nodejs /app/out ./out

USER nextjs
EXPOSE 3000

CMD ["serve", "out", "-l", "3000"]
