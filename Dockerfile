# Take It or Leave It — CKO AI Sandbox container image
#
# Air-gapped build: no npm install, no Next.js compile inside Docker.
# Build the static site on a machine with network first (`npm run build:static`),
# then package with `npm run package:sandbox` so `out/index.html` is in the zip.
#
# Platform rules: listen on 3000, GET / → 200, base image via ECR pull-through.

FROM 891377407345.dkr.ecr.eu-west-1.amazonaws.com/cko-pull-through/docker-hub/library/node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Pre-built static export — must include index.html at out/index.html
COPY --chown=nextjs:nodejs out ./out
COPY --chown=nextjs:nodejs scripts/static-server.mjs ./static-server.mjs

USER nextjs
EXPOSE 3000

# Fail fast if the zip was packaged without a build
CMD ["node", "static-server.mjs", "out"]
