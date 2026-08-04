# Deploying Take It or Leave It

The app is almost entirely client-side: the pricing engine is a pure TypeScript
function bundled into the page. The only server piece is
`/api/parse-merchant` (optional plain-English → form fields via Claude).

Your internal tool offers two components. Pick one.

| Component | When to use | Artifact |
| --- | --- | --- |
| **Website** (S3 static) | Point the platform at a pre-built `out/` / `dist/` folder. | `out/` |
| **Container** (ECS) | Zip the repo with the root `Dockerfile`. Image builds `out/` and serves it on port 3000. | Docker image |

Either way you get the same static app. AI "Fill the form" is unavailable in both
(manual entry still works). Do not select both components unless the platform
wires them on one hostname.

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

Builds the same static site into `out/`, then serves it on **port 3000**
(`out/index.html` must exist — the platform checks for it).

### 1. Build the image

```bash
# Demo rates (default)
docker build -t take-it-or-leave-it .

# Real rates — compile the book on the host first, then:
docker build --build-arg NEXT_PUBLIC_DEMO_MODE=false -t take-it-or-leave-it .
```

### 2. Runtime env

| Variable | Required? | Notes |
| --- | --- | --- |
| `PORT` | — | Fixed at **3000** in the image (platform requirement). |
| `NEXT_PUBLIC_DEMO_MODE` | Build-time | Must be set at **image build**, not only at run — it is inlined into the client bundle. |
| `ANTHROPIC_API_KEY` | n/a | Not used: this image serves static files only. |

### 3. Form fields

| Field | Value |
| --- | --- |
| Components | **Container** |
| Dockerfile | repo root `Dockerfile` |

Health / listen: serves `out/` on `0.0.0.0:3000` (includes `out/index.html`).

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
