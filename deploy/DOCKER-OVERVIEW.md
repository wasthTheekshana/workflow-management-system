# Workflow Management System - Docker Setup Overview

Server: DOK shared GCP server `34.93.171.14`
Stack folder: `~/workflow-stack/deploy` (repo cloned to `~/workflow-stack`)
Nginx/Certbot: the shared ones in `~/dok-stack` (this stack has none)

## 1. Files in the repo

| File | Purpose |
|------|---------|
| `deploy/docker-compose.yml` | Production stack for the shared server (db, api, web, onlyoffice) |
| `deploy/nginx-workflow.conf` | Nginx server blocks to paste into `~/dok-stack/nginx/nginx.conf` |
| `deploy/DEPLOY.md` | Step-by-step deploy notes |
| `backend/Dockerfile` | API image (Node 20 Alpine, runs as user `node`) |
| `backend/docker-compose.yml` | LOCAL development stack only (not for the server) |
| `frontend/Dockerfile` | Two-stage build: Vite build, then nginx serves static files |
| `frontend/nginx.conf` | Static files only, `try_files ... /index.html`, no `proxy_pass` |
| `frontend/.dockerignore`, `backend/.dockerignore` | Exclude node_modules, .env, .git, tests, docs |

## 2. Production services (`deploy/docker-compose.yml`)

| Service | Container | Image | Port (expose) | Networks | CPU / RAM / pids |
|---------|-----------|-------|---------------|----------|------------------|
| db | workflow-db | postgres:16-alpine | 5432 | app-net | 1 / 4G / 200 |
| api | workflow-api | built from `../backend` | 3000 | app-net, shared-nginx | 1.5 / 2G / 200 |
| web | workflow-web | built from `../frontend` | 80 | shared-nginx | 0.5 / 256M / 100 |
| onlyoffice | workflow-onlyoffice | onlyoffice/documentserver:${ONLYOFFICE_TAG} | 80 | app-net, shared-nginx | 3 / 8G / 1000 |

Server rules already followed:
- `expose` only, no `ports`
- DB is on `app-net` only, never on `shared-nginx`
- `container_name`, `restart: unless-stopped`, healthchecks on every service
- `no-new-privileges` and CPU/RAM/pids limits on every service
- DB data bind-mounted at `/mnt/disks/data/db/workflow`
- api waits for DB health (`depends_on: service_healthy`)
- Documents are stored in Cloudflare R2 (`STORAGE_DRIVER=s3`), so no document volume
- Secrets come from `deploy/.env` (not committed)

### api start command
`npx knex migrate:latest && node scripts/seed.js && node src/server.js`
(`knex` is in the backend production dependencies; the seed only creates the admin from `ADMIN_*` if missing.)

### Healthchecks (current)
- db: `pg_isready`
- api: `wget http://127.0.0.1:3000/health` (route exists, returns `{"status":"ok"}`)
- web: `wget http://127.0.0.1:80/`
- onlyoffice: `curl http://127.0.0.1/healthcheck` (start_period 120s)

## 3. Dockerfiles

### backend/Dockerfile
- `FROM node:20-alpine`
- `npm install --omit=dev`
- `USER node` (non-root), `EXPOSE 3000`
- Default CMD runs migrate + seed + server (compose overrides it with the same command)

### frontend/Dockerfile
- Stage 1: `node:20-alpine`, `npm ci`, `npm run build`
- Build args baked in at build time: `VITE_API_BASE_URL`, `VITE_ONLYOFFICE_DOCUMENT_SERVER_URL`
- Stage 2: `nginx:alpine`, copies `dist` and `nginx.conf`
- Changing the domain later means rebuilding `web`

## 4. Nginx (`deploy/nginx-workflow.conf`)

- Port 80 redirect to HTTPS for both domains, with the ACME challenge path
- App domain: `/api/` goes to `http://workflow-api:3000/` (trailing slash strips `/api`, because backend routes have no `/api` prefix); `/` goes to `http://workflow-web:80`
- Office domain: everything goes to `http://workflow-onlyoffice:80` with websocket headers
- `client_max_body_size 100m` on both blocks; OnlyOffice read timeout 300s

## 5. `.env` keys (`deploy/.env.example`)

Domains: `APP_DOMAIN`, `OFFICE_DOMAIN`
Database: `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
Secrets: `JWT_SECRET`, `JWT_EXPIRES_IN`, `ONLYOFFICE_JWT_SECRET`
Admin seed: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `TENANT_NAME`
URLs: `CORS_ORIGINS`, `FRONTEND_BASE_URL`, `ONLYOFFICE_DOCUMENT_SERVER_URL`, `ONLYOFFICE_CALLBACK_BASE_URL` (`http://workflow-api:3000`)
Storage (R2): `STORAGE_DRIVER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`
Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`

`ONLYOFFICE_TAG` must be set to a pinned version before starting.

## 6. Local dev stack (`backend/docker-compose.yml`) - not for the server

Uses `ports` bound to 127.0.0.1, named volumes, `onlyoffice/documentserver:latest`, an optional `minio` profile, and `localhost` URLs. It is for development only and does not follow the shared-server rules.

## 7. Changes requested by the server team - all applied

1. OnlyOffice image pinned: `onlyoffice/documentserver:${ONLYOFFICE_TAG}` (compose fails if unset)
2. web, api and OnlyOffice healthchecks use `127.0.0.1`
3. frontend Dockerfile uses `npm ci`
4. `.env.example`: `DB_NAME=workflow`, `DB_USER=workflow_app`, `DB_SSL=false`, wk domains, `ONLYOFFICE_TAG`
5. Nginx: wk domains, certificate `live/testsys.shop/`, `client_max_body_size 100m`, OnlyOffice `proxy_read_timeout 300s`, `X-Real-IP`/`X-Forwarded-For` on the app `/` location
6. `/api/` proxy keeps the trailing slash (backend routes have no `/api` prefix)
7. Attachment uploads now also check file signatures (magic bytes) before storing to R2

## 8. Before starting on the server

```
nslookup wk.testsys.shop
nslookup wk-office.testsys.shop
findmnt /mnt/disks/data
sudo mkdir -p /mnt/disks/data/db/workflow
sudo chown -R 999:999 /mnt/disks/data/db/workflow
cd ~/workflow-stack/deploy
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 api
```

The wildcard certificate expires Nov 4, so renew it first.
