# Take It or Leave It — ECS / container image
#
# Keeps the optional /api/parse-merchant route (needs ANTHROPIC_API_KEY at
# runtime). Prefer the static S3 deploy when you do not need plain-English
# parse — see deploy/README.md.
#
# Build:
#   docker build -t take-it-or-leave-it .
#   # real rates (book must exist on the host before build):
#   docker build --build-arg NEXT_PUBLIC_DEMO_MODE=false -t take-it-or-leave-it .
#
# Run (must listen on 3000 — platform requirement):
#   docker run --rm -p 3000:3000 take-it-or-leave-it
#   docker run --rm -p 3000:3000 -e ANTHROPIC_API_KEY=sk-… take-it-or-leave-it

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
ENV BUILD_TARGET=standalone
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output is a minimal Node server + traced deps.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
