# Deploying Take It or Leave It (CKO AI Sandbox)

Your S3 error (`NoSuchKey` for `frontbook-express/index.html`) means the
**Website** upload did not contain `index.html` at the zip root. Uploading the
repo source (or a zip with `out/index.html` nested) puts the file at the wrong
key.

## Quick path

```bash
npm ci
npm run package:sandbox
```

That builds the static site and writes two zips under `dist/`:

| Zip | Select in the UI | Why |
| --- | --- | --- |
| `dist/sandbox-website.zip` | **Website** only | `index.html` at zip root → S3 key `<shortname>/index.html` |
| `dist/sandbox-container.zip` | **Container** only | Root `Dockerfile` + prebuilt `out/` (air-gapped image build) |

Do **not** select both unless you know the platform merges them correctly.

Verify the website zip before upload:

```bash
unzip -l dist/sandbox-website.zip | head
# first entries must include index.html (not out/index.html)
```

---

## Option A — Website (fixes your current 404)

1. `npm run package:sandbox`
2. Upload **`dist/sandbox-website.zip`**
3. Components: **Website** only
4. Shortname: e.g. `frontbook-express`

Suggested form fields: Title `Take It or Leave It`, description as you like.

Demo rates by default. For real rates, compile the book then rebuild:

```bash
npm run book:compile
NEXT_PUBLIC_DEMO_MODE=false npm run package:sandbox
```

---

## Option B — Container (sandbox packaging Option 2)

Per the sandbox packaging rules: Dockerfile present → zip with Dockerfile at
root, listen on **3000**, `GET /` → 200, ECR pull-through base image.

1. `npm run package:sandbox` (builds `out/` on your machine — Docker does **not**
   run `next build`, so no Google Fonts / npm registry needed in CodeBuild)
2. Upload **`dist/sandbox-container.zip`**
3. Components: **Container** only

Image serves `out/` via `scripts/static-server.mjs` on port 3000.

---

## Local checks

```bash
npm run build:static
npm run start:static          # http://0.0.0.0:3000 — same as the container
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

---

## Why the old upload failed

| What was uploaded | S3 key looked up | Result |
| --- | --- | --- |
| Repo source / nested `out/` | `frontbook-express/index.html` | **NoSuchKey** |
| Contents of `out/` at zip root | `frontbook-express/index.html` | Works |
