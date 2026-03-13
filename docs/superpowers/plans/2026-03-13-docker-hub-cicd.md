# Docker Hub CI/CD Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `main-scraper` to Docker Hub (`jthil23/main-scraper`) via GitHub Actions so every push to `main` automatically builds and pushes a fresh `latest` image; Unraid pulls the image instead of building locally.

**Architecture:** Multi-stage Docker build (builder → runner) produces a lean production image with no dev dependencies or build tooling. GitHub Actions triggers on push to `main`, authenticates to Docker Hub via repository secrets, and pushes `jthil23/main-scraper:latest`. Unraid runs `docker compose pull && docker compose up -d` to update.

**Tech Stack:** Node.js 22 Alpine, TypeScript, Docker multi-stage build, GitHub Actions (`docker/build-push-action`), Docker Hub

---

## Chunk 1: Docker Build Improvements

### Task 1: Add `tsconfig.prod.json`

**Files:**
- Create: `tsconfig.prod.json`

The base `tsconfig.json` emits `.d.ts`, `.d.ts.map`, and `.js.map` files — none needed at runtime, all inflate the image. The production config extends the base and overrides only these three options.

- [ ] **Step 1: Create `tsconfig.prod.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false
  }
}
```

- [ ] **Step 2: Verify it produces no declaration or map files**

Run from `Z:\main-scraper\`:
```bash
npx tsc --project tsconfig.prod.json
```
Then check `dist/` — confirm there are **no** `.d.ts`, `.d.ts.map`, or `.js.map` files:
```bash
ls Z:/main-scraper/dist/
```
Expected: only `.js` files (e.g. `index.js`, `scheduler.js`, etc.) — no `.d.ts` or `.map` files.

Clean up after verifying:
```bash
rm -rf Z:/main-scraper/dist/
```

- [ ] **Step 3: Commit**

```bash
cd Z:/main-scraper
git add tsconfig.prod.json
git commit -m "build: add tsconfig.prod.json to strip sourcemaps from production build"
```

---

### Task 2: Rewrite `Dockerfile` as multi-stage

**Files:**
- Modify: `Dockerfile`

Current Dockerfile is single-stage: installs all deps (including devDependencies), compiles TypeScript, and runs from the same bloated layer. Rewrite as builder → runner using `node:22-alpine` (the existing base image).

- [ ] **Step 1: Rewrite `Dockerfile`**

```dockerfile
# ── Stage 1: Builder ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install all dependencies (including devDeps for TypeScript compiler)
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript using production config (no sourcemaps/declarations)
COPY tsconfig.json tsconfig.prod.json ./
COPY src/ ./src/
RUN npm run build -- --project tsconfig.prod.json

# ── Stage 2: Runner ───────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Verify the build script supports `--project` flag**

Open `package.json` and confirm the `build` script is `"tsc"` (not `"tsc -p tsconfig.json"` or something that would conflict).

Current value: `"build": "tsc"` ✓ — `tsc` accepts `--project` flag passthrough.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile tsconfig.prod.json
git commit -m "build: rewrite Dockerfile as multi-stage builder/runner, use tsconfig.prod.json"
```

---

### Task 3: Update `.dockerignore`

**Files:**
- Modify: `.dockerignore`

Current file has only 3 entries. Extend to exclude all non-essential files from the build context.

- [ ] **Step 1: Replace `.dockerignore` contents**

```
node_modules
dist
docs
.env
.env.example
*.md
.git
```

- [ ] **Step 2: Verify `src/` is NOT excluded**

Confirm `src/` is absent from `.dockerignore` — the builder stage needs it. `dist/` IS excluded because it's rebuilt inside the container; the host's compiled output should never shadow the container build.

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: extend .dockerignore to exclude docs, .env.example, markdown, .git"
```

---

## Chunk 2: CI/CD Wiring

### Task 4: Create GitHub Actions workflow

**Files:**
- Create: `.github/workflows/docker-publish.yml`

On every push to `main`, GitHub Actions will:
1. Check out the code
2. Log in to Docker Hub using repository secrets
3. Set up Docker Buildx (required for `docker/build-push-action`)
4. Build the image for `linux/amd64` and push as `jthil23/main-scraper:latest`

- [ ] **Step 1: Create the workflow directory and file**

```bash
mkdir -p Z:/main-scraper/.github/workflows
```

- [ ] **Step 2: Create `.github/workflows/docker-publish.yml`**

```yaml
name: Build and Push to Docker Hub

on:
  push:
    branches:
      - main

jobs:
  build-and-push:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v6

      - name: Log in to Docker Hub
        uses: docker/login-action@v4
        with:
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v4

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64
          push: true
          tags: jthil23/main-scraper:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

> **Note on caching:** `cache-from/cache-to: type=gha` uses GitHub Actions cache to speed up subsequent builds. This is free and reduces build time from ~3 min to ~45 sec after the first run.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/docker-publish.yml
git commit -m "ci: add GitHub Actions workflow to build and push to Docker Hub"
```

---

### Task 5: Update `docker-compose.yml`

**Files:**
- Modify: `docker-compose.yml`

Remove `build: .` (no local builds on Unraid), add `image:` pointing to Docker Hub, add `pull_policy: always` so `docker compose up -d` always uses the freshest image without needing an explicit `pull` first.

- [ ] **Step 1: Update `docker-compose.yml`**

Replace the entire file with:

```yaml
services:
  main-scraper:
    image: jthil23/main-scraper:latest
    pull_policy: always
    container_name: main-scraper
    env_file: .env
    restart: unless-stopped
    networks:
      - default

networks:
  default:
    driver: bridge
```

- [ ] **Step 2: Validate the compose file syntax**

Run from `Z:\main-scraper\`:
```bash
docker compose config
```
Expected: prints the resolved compose config with no errors. If `pull_policy` causes an error, your Docker Compose is below v2.2 — remove `pull_policy: always` and always run `docker compose pull` manually before `up`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "deploy: update docker-compose.yml to pull image from Docker Hub"
```

---

## Chunk 3: Repo Creation and First Push

### Task 6: Pre-push security audit

Before pushing to a public GitHub repo, confirm no secrets or credentials are hardcoded in `src/`.

- [ ] **Step 1: Search `src/` for hardcoded credentials outside `config.ts`**

```bash
grep -rn "mainPass\|mainUser\|HA_TOKEN\|PLEX_TOKEN\|ADGUARD_PASSWORD\|192\.168\." Z:/main-scraper/src/ | grep -v "src/config.ts"
```
Expected: no matches. `config.ts` intentionally uses these as fallback default strings (e.g. `process.env.MYSQL_PASSWORD || "mainPass"`) — matches there are benign. Matches anywhere else (scrapers, db, etc.) are a problem and must be removed before pushing.

- [ ] **Step 2: Review `.env.example` contents**

```bash
cat Z:/main-scraper/.env.example
```
Confirm it contains only placeholder values (e.g. `your_ha_token`, `your_plex_token`), not real credentials. `.env.example` will be committed and public — it's documentation for the required variables, not a secrets file.

- [ ] **Step 3: Confirm `.gitignore` covers all secret files**

```bash
cat Z:/main-scraper/.gitignore
```
Expected output must include `.env`. Confirm the actual `.env` file (with real credentials) is not staged:
```bash
ls Z:/main-scraper/.env*
```

- [ ] **Step 4: Confirm `dist/` is not staged**

After `git add .`, run:
```bash
git status
```
Verify `dist/` files do NOT appear in the staged changes. If they do, run:
```bash
git rm -r --cached dist/
```

---

### Task 7: Initialize git repo, create GitHub repo, push

**Prerequisites:**
- `gh` CLI installed and authenticated (`gh auth status`)
- Docker Hub access token created and ready to add as GitHub secret after repo creation

- [ ] **Step 1: Initialize git repo**

```bash
cd Z:/main-scraper
git init
git branch -M main
```

- [ ] **Step 2: Stage all files**

```bash
git add .
```

- [ ] **Step 3: Verify nothing sensitive is staged**

```bash
git status
```
Confirm these are NOT in the staged list:
- `.env` (any variant)
- `dist/` directory
- Any file containing tokens or passwords

- [ ] **Step 4: Initial commit**

```bash
git commit -m "feat: initial commit — main-scraper with Docker Hub CI/CD"
```

- [ ] **Step 5: Create GitHub repo and push**

```bash
gh repo create main-scraper --public --source=. --remote=origin --push
```

This creates `github.com/jthil23/main-scraper`, sets it as `origin`, and pushes `main`. The GitHub Actions workflow will trigger immediately — it will **fail** on first run because the secrets aren't added yet. That's expected.

- [ ] **Step 6: Add GitHub secrets**

Go to `https://github.com/jthil23/main-scraper/settings/secrets/actions` and add:

| Name | Value |
|------|-------|
| `DOCKERHUB_USERNAME` | `jthil23` |
| `DOCKERHUB_TOKEN` | (your Docker Hub access token) |

- [ ] **Step 7: Trigger a new build**

Make a trivial commit to re-trigger the workflow:
```bash
git commit --allow-empty -m "ci: trigger first successful Docker Hub build"
git push
```

- [ ] **Step 8: Verify the workflow succeeded**

```bash
gh run watch
```
Or go to `https://github.com/jthil23/main-scraper/actions` and confirm the workflow shows a green checkmark.

- [ ] **Step 9: Verify image is on Docker Hub**

Go to `https://hub.docker.com/r/jthil23/main-scraper` and confirm `latest` tag is present.

---

## Post-Setup: Deploying on Unraid

Once the image is on Docker Hub, deploy on Unraid:

```bash
# Copy docker-compose.yml and .env to Unraid if not already there
# Then run:
cd /mnt/user/appdata/main-scraper
docker compose pull
docker compose up -d
docker logs main-scraper -f
```

Expected: scraper starts, runs initial scrape across all sources, then starts scheduled jobs.

**For future updates:**
```bash
# On your dev machine — push code change:
git add . && git commit -m "fix: ..." && git push
# Wait ~2 min for GitHub Actions

# On Unraid — pull new image:
docker compose pull && docker compose up -d
```
