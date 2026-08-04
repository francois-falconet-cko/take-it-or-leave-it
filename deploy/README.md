# Deploying Take It or Leave It

The app is almost entirely client-side: the pricing engine is a pure TypeScript
function bundled into the page. The only server piece is
`/api/parse-merchant` (optional plain-English → form fields via Claude).

Your internal tool offers two components. Pick one.

| Component | When to use | Artifact |
| --- | --- | --- |
| **Website** (S3 static) | Recommended. Full pricing, approvals, deal-on-a-page. AI "Fill the form" degrades to manual entry. | `out/` |
| **Container** (ECS) | Only if you need the AI parse button with an `ANTHROPIC_API_KEY`. | Docker image from `Dockerfile` |

Do **not** select both unless the platform wires them together on one hostname —
the static site calls `/api/parse-merchant` on the same origin.

---

## Option A — Website (recommended)

### 1. Build the static site

```bash
npm ci
npm run book:compile          # only needed for real rates; see below
npm run build:static
```

That writes HTML/JS/CSS to **`out/`** and a copy at **`dist/`** (same
contents — use whichever path your platform asks for). Index document:
`index.html`.

### 2. Form fields in the create-site UI

Suggested values:

| Field | Value |
| --- | --- |
| Title | Take It or Leave It |
| Shortname | `take-it-or-leave-it` (or whatever your naming scheme wants) |
| Description | Front-book pricing on Acquirer Guidance |
| Components | **Website** only |

### 3. Demo vs real rates

| Goal | Build command |
| --- | --- |
| Safe for demos / recordings (default) | `npm run build:static` |
| Real Acquirer Guidance rates | `NEXT_PUBLIC_DEMO_MODE=false npm run build:static` after `npm run book:compile` |

`data/pricing-book.json` is gitignored. Without it, `build:static` stubs from the
demo book so the build still succeeds — but rates stay obfuscated until you
compile and set `NEXT_PUBLIC_DEMO_MODE=false`.

### What you lose on static

- Plain-English "Fill the form" returns an error and asks the rep to type
  fields manually. Pricing itself is unchanged.

---

## Option B — Container

Use this when you want Claude-backed intake parse on the deployed URL.

### 1. Build the image

```bash
# Demo rates (default)
docker build -t take-it-or-leave-it .

# Real rates — compile the book on the host first, then:
docker build --build-arg NEXT_PUBLIC_DEMO_MODE=false -t take-it-or-leave-it .
```

Or without Docker locally:

```bash
npm run build:standalone
# then run the traced server under .next/standalone (see Next.js standalone docs)
```

### 2. Runtime env

| Variable | Required? | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | No | Enables `/api/parse-merchant`. Without it the UI falls back to manual entry. |
| `PORT` | No | Defaults to `3000` in the image (platform requirement). |
| `NEXT_PUBLIC_DEMO_MODE` | Build-time | Must be set at **image build**, not only at run — it is inlined into the client bundle. |

### 3. Form fields

| Field | Value |
| --- | --- |
| Components | **Container** only |
| Dockerfile | repo root `Dockerfile` |

Health / listen: the process binds `0.0.0.0:3000` (required by the internal platform).

---

## Commands cheat sheet

```bash
npm run build:static       # → out/ and dist/  for S3 Website
npm run build:standalone   # → .next/standalone  for containers
npm run build:container    # docker build -t take-it-or-leave-it .
```

Local preview of the static export:

```bash
npx serve dist -p 3400
```
