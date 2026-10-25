# Workflow Management System - server deploy (34.93.171.14)

Stack folder: ~/workflow-stack   Compose dir: ~/workflow-stack/deploy
Containers: workflow-db, workflow-api, workflow-web, workflow-onlyoffice
Documents: Cloudflare R2 (no document volume). Database: /mnt/disks/data/db/workflow

## 0. Cloudflare R2 (once)
1. Cloudflare dashboard > R2 > Create bucket, name: workflow-documents (keep it PRIVATE, no public access).
2. R2 > Manage API tokens > Create token, permission "Object Read & Write", scoped to that bucket only.
3. Put the Account ID, Access Key ID and Secret in deploy/.env (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).

## 1. DNS
A records to 34.93.171.14 for APP_DOMAIN and OFFICE_DOMAIN. Check:

    nslookup wk.testsys.shop
    nslookup wk-office.testsys.shop

## 2. Code, env, data folder

    cd ~
    git clone <repo-url> workflow-stack
    cd ~/workflow-stack/deploy
    cp .env.example .env
    nano .env
    findmnt /mnt/disks/data
    sudo mkdir -p /mnt/disks/data/db/workflow
    sudo chown -R 999:999 /mnt/disks/data/db/workflow
    df -h /mnt/disks/data

Generate secrets with: openssl rand -hex 32

## 3. Start

    cd ~/workflow-stack/deploy
    docker compose up -d --build
    docker compose ps
    docker compose logs --tail=50 api
    docker stats --no-stream

All four containers must be healthy. OnlyOffice needs about 2 minutes to become healthy.

## 4. SSL certificate
Follow the DOK certbot steps (section 7 of the dok-docker-deploy skill) for both domains. Verify the TXT record on 8.8.8.8, 1.1.1.1 and 9.9.9.9 before pressing Enter.

## 5. Nginx
Paste deploy/nginx-workflow.conf into ~/dok-stack/nginx/nginx.conf (replace the domains), then:

    cd ~/dok-stack
    docker compose exec nginx nginx -t
    docker compose exec nginx nginx -s reload

## 6. Smoke test (before telling anyone it is live)
1. https://<APP_DOMAIN>/api/health returns {"status":"ok"}.
2. Log in with ADMIN_EMAIL / ADMIN_PASSWORD, then change the password in Profile.
3. Create a document type, a template file and a workflow; start an instance.
4. Open the online editor, edit, save, reopen: the change must be there (tests OnlyOffice callback).
5. Upload an attachment and download it. In Cloudflare R2 the object must appear under <tenant-id>/.
6. Forgot-password email arrives (tests SMTP).
7. docker compose logs --tail=100 api shows no errors.

## 7. Backups
- Database: add a pg_dump of workflow-db into /mnt/disks/data/backups (daily cron).
- Documents: R2 has no versioning by default. Enable bucket versioning or a periodic copy to a second bucket.
- Add an Uptime Kuma monitor for https://<APP_DOMAIN>/api/health

## 8. Update after a push

    cd ~/workflow-stack
    git pull origin main
    cd deploy
    docker compose up -d --build api web
    docker compose ps
    docker compose logs --tail=50 api
    cd ~/dok-stack
    docker compose exec nginx nginx -s reload
