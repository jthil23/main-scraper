# Design: Docker Hub CI/CD for main-scraper

**Date**: 2026-03-13
**Status**: Approved
**Author**: Jeff Thilmany

---

## Overview

Publish the `main-scraper` Node.js/TypeScript cron service as a Docker image on Docker Hub (`jthil23/main-scraper`) via GitHub Actions CI/CD. Every push to `main` automatically builds and pushes a fresh `latest` image. Unraid pulls the image via `docker-compose.yml` — no local builds on the server.

---

## Goals

- Zero local build footprint on Unraid (no build cache, no intermediate layers)
- Automated: push code → image updates automatically, no manual steps
- Simple tagging: `latest` only (no versioning complexity for now)
- Unraid deployment via `docker compose pull && docker compose up -d`

---

## Architecture

```
Developer (Windows PC)
    │
    ├── git push → github.com/jthil23/main-scraper (main branch)
    │                       │
    │           GitHub Actions: docker-publish.yml
    │                       │
    │                builds linux/amd64 image
    │                       │
    │               docker push jthil23/main-scraper:latest
    │                       │
    │               hub.docker.com/r/jthil23/main-scraper
    │
Unraid Server (192.168.1.103)
    │
    └── docker compose pull && docker compose up -d
        └── pulls jthil23/main-scraper:latest
```

---

## Components

### 1. GitHub Repository
- **Repo**: `github.com/jthil23/main-scraper` (public)
- Created via `gh repo create`
- Initial commit includes full existing codebase

**Pre-push security checklist** (required before first push to public repo):
- Confirm no credentials or tokens are hardcoded in `src/` (all secrets are in `.env`)
- Confirm `dist/` is in `.gitignore` and not staged (`.gitignore` already has this entry — verify before `git add`)
- Confirm `.env` and any `*.env*` variants (`.env.local`, `.env.production`, etc.) are in `.gitignore` and not staged

### 2. `.dockerignore` (update existing)
The existing `.dockerignore` has only 3 entries (`node_modules`, `dist`, `.env`). It must be extended to:
```
node_modules
dist
docs
.env
.env.example
*.md
.git
```

### 3. `Dockerfile` (rewrite as multi-stage)
The existing Dockerfile is **single-stage** — it installs all dependencies (including devDependencies) and leaves build tooling in the final image. It must be rewritten as a proper multi-stage build using `node:22-alpine` as the base image for both stages (matching the existing Dockerfile's base):

- **Stage 1 (`builder`)**: Copy `package.json` + `package-lock.json`, run `npm ci` (all deps), copy `tsconfig.json` + `src/`, run `npm run build`
- **Stage 2 (`runner`)**: Copy `package.json` + `package-lock.json`, run `npm ci --omit=dev` (production deps only), copy `dist/` from builder stage, set `CMD ["node", "dist/index.js"]`

Additionally, `tsconfig.json` emits `declaration`, `declarationMap`, and `sourceMap` files into `dist/`. These are not needed at runtime and inflate the image. Disable them for the production build either by updating `tsconfig.json` or by adding a `tsconfig.prod.json` used only during Docker builds.

### 4. GitHub Actions Workflow: `.github/workflows/docker-publish.yml`
**Trigger**: `push` to `main` branch

**Steps**:
1. Checkout code
2. Log in to Docker Hub using `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` secrets
3. Set up Docker Buildx
4. Build and push `jthil23/main-scraper:latest` (platform: `linux/amd64`)

### 5. `docker-compose.yml` (update)
- Remove `build: .` directive
- Add `image: jthil23/main-scraper:latest`
- Add `pull_policy: always` (requires Docker Compose plugin v2.2+ — see Prerequisites)
- Keep all existing env, volumes, restart policy, networks unchanged

---

## Prerequisites

### GitHub Secrets (must be added manually by Jeff)
| Secret Name | Value | How to get it |
|-------------|-------|---------------|
| `DOCKERHUB_USERNAME` | `jthil23` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | (access token) | Docker Hub → Account Settings → Security → New Access Token |

> These require your Docker Hub password — cannot be automated.

### Unraid Docker Compose Version
`pull_policy: always` requires Docker Compose plugin v2.2+. Verify on Unraid:
```bash
docker compose version
```
If version is below v2.2, omit `pull_policy` from `docker-compose.yml` and always run `docker compose pull` explicitly before `up -d`.

### `.env` on Unraid
The `.env` file is never committed to the repo. It must exist on the Unraid host alongside `docker-compose.yml` before the container can start. Copy it manually to `/mnt/user/appdata/main-scraper/.env` after setting up the server.

---

## Deployment Workflow (After Setup)

**To publish a code change:**
```bash
git add .
git commit -m "your message"
git push
# GitHub Actions builds and pushes automatically (~2-3 min)
```

**To update main-scraper on Unraid:**
```bash
cd /mnt/user/appdata/main-scraper
docker compose pull
docker compose up -d
```

---

## Out of Scope

- Version tags / semantic versioning (can be added later)
- Multi-platform builds (arm64, etc.) — Unraid runs amd64
- Fixing broken scrapers (Frigate not running, Prometheus node_exporter) — separate task
- Status/health dashboard UI — separate project

---

## File Changes Summary

| File | Action | Notes |
|------|--------|-------|
| `.github/workflows/docker-publish.yml` | Create | GitHub Actions CI/CD workflow |
| `.dockerignore` | Update | Extend existing 3-entry file to full list |
| `docker-compose.yml` | Update | Remove `build:`, add `image:` + `pull_policy:` |
| `Dockerfile` | Rewrite | Single-stage → multi-stage, remove dev deps from final image |
| `tsconfig.json` or `tsconfig.prod.json` | Update/Create | Disable `declaration`, `declarationMap`, `sourceMap` for production |
