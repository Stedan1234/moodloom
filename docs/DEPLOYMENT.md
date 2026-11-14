# Deployment

Moodloom deploys as **one web service and one PostgreSQL database**. The service runs the API, which also serves the built web app and the uploaded files.

Nothing here has been run against a real host yet. The container file and the Render blueprint were written with care but are untested; expect to adjust small things on the first deploy.

## What you need

- A host that runs a Docker container or Node 22 (Render, Railway, Fly.io, a VPS).
- PostgreSQL 14+.
- A **persistent disk** for uploads. Without one, every redeploy deletes users' files.
- A domain with HTTPS (the host usually provides it).

## Settings

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | from the host. Add `DATABASE_SSL=true` if it requires TLS. |
| `JWT_SECRET` | 48+ random bytes. Never reuse the local one. |
| `APP_URL` | `https://your-domain` |
| `PUBLIC_BASE_URL` | the same `https://your-domain` |
| `ALLOWED_ORIGINS` | the same, unless the web app is hosted elsewhere |
| `UPLOADS_DIR` | the disk's mount path, e.g. `/data/uploads` |
| `TRUST_PROXY` | `1` on hosts that put a proxy in front (Render, Railway, Fly) |
| `ENFORCE_PLAN_LIMITS` | `true` once you want free-plan limits to apply |
| `SMTP_*`, `MAIL_FROM` | from a mail provider (Resend, Postmark, Brevo), so password resets arrive |
| `ANTHROPIC_API_KEY` | optional; turns on direction notes |

## With Render

1. Push the repository to GitHub.
2. In Render: **New → Blueprint**, pick the repository. `render.yaml` describes the service, database and disk.
3. After the first deploy, set `APP_URL`, `PUBLIC_BASE_URL` and `ALLOWED_ORIGINS` to the address Render gave you (or your own domain) and redeploy.
4. Open `/api/health`. Then open the site, start a board, save your account.

## With Docker anywhere

```bash
docker build -t moodloom .
docker run -p 3001:3001 -v moodloom_uploads:/data \
  -e DATABASE_URL=... -e JWT_SECRET=... \
  -e APP_URL=https://your-domain -e PUBLIC_BASE_URL=https://your-domain \
  moodloom
```

The container applies the schema on every start, then serves.

## After it's up

- **Extension:** pair it using your domain as the Moodloom address. To publish it in the Chrome Web Store you'll need a developer account (one-off fee) and a privacy policy URL.
- **Phone:** open the site, log in, "Add to Home Screen". Android then offers Moodloom in the share menu.
- **Backups:** switch on the database's automatic backups, and back up the uploads disk. A database without its files is half a backup.
- **Monitoring:** point an uptime check at `/api/health`.

## Costs to expect

A small web instance, a small database and a few GB of disk: roughly the price of a couple of coffees a month at the smallest tiers. Direction notes are billed by the AI provider per note; the free plan's five-a-month cap exists to bound that.

## When one server stops being enough

Move uploads to object storage (S3, R2) behind signed URLs; move rate limits and the job queue to Redis; run analysis in a separate worker; move vectors to pgvector. Each has a single seam in the code (`lib/storage.js`, `middleware/rateLimit.js`, `lib/jobs.js`, `services/ai/similarity.js`).
