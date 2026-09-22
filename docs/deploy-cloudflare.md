# Deploy the API (and optionally the whole site) to Cloudflare

Everything that learns across visitors — sessions, ratings, the evolving model, the dashboard's numbers — is a single Cloudflare Worker with a D1 (SQLite) database. Free tier is plenty: D1 allows 100k writes/day and a session is one write plus one for the rating.

The Worker also serves `site/` as static assets, so `https://make-it-nice.<you>.workers.dev/` is a complete deployment on its own. Other copies of the site (GitHub Pages, DreamHost, AWS) just point at the same API.

## Prerequisites

- A Cloudflare account (free) and Node 18+.
- `cd worker && npm install` (installs `wrangler`).

## Step by step

1. **Log in** (opens a browser):
   ```bash
   cd worker
   npx wrangler login
   ```
   Or, non-interactive (CI, servers): create an API token at *My Profile → API Tokens* with permissions **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read**, then
   ```bash
   export CLOUDFLARE_API_TOKEN=...   CLOUDFLARE_ACCOUNT_ID=...   # account id: Workers & Pages overview, right sidebar
   ```

2. **Create the database** and paste its id into `wrangler.toml`:
   ```bash
   npx wrangler d1 create make-it-nice
   # → database_id = "xxxxxxxx-...."   → put it in [[d1_databases]] database_id in wrangler.toml
   ```
   (This repo's `wrangler.toml` already carries Luke's id; replace it with yours if you're forking.)

3. **Create the tables**:
   ```bash
   npm run migrate          # = wrangler d1 migrations apply make-it-nice --remote
   ```

4. **Set the dashboard password** (any long random string; this is the only secret):
   ```bash
   npm run secret:admin     # = wrangler secret put ADMIN_TOKEN   → paste, enter
   ```

5. **Deploy**:
   ```bash
   npm run deploy           # = wrangler deploy
   ```
   Wrangler prints the URL, e.g. `https://make-it-nice.lukeiseman.workers.dev`. Check `…/api/health` → `{"ok":true}`.

6. **Tell the site where the API is**: set `API_BASE` in `site/config.js` to that URL (or the `API_BASE` repository variable for GitHub Pages — see [deploy-github-pages.md](deploy-github-pages.md)). The copy served by the Worker itself works either way (same origin).

## Deploy from GitHub Actions instead (optional)

`.github/workflows/worker.yml` deploys on every push that touches `worker/` or `site/`, but only if you opt in:

- Repository **variable** `DEPLOY_WORKER` = `true`
- Repository **secrets** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`

## Custom domain (optional)

Workers & Pages → make-it-nice → Settings → Domains & Routes → **Add → Custom domain** (the zone must be on Cloudflare). No code changes; update `API_BASE` in the site if you want other copies to use the pretty URL.

## Locking down CORS (optional)

`ALLOWED_ORIGINS` in `wrangler.toml` `[vars]` is `*` by default (the API holds nothing secret and the admin endpoints need the token). To restrict it: `ALLOWED_ORIGINS = "https://liseman.github.io,https://nice.example.com"` then `npm run deploy`.

## Day-to-day

```bash
npm run tail                                     # live logs
npx wrangler d1 execute make-it-nice --remote --command "SELECT COUNT(*) FROM sessions"
npx wrangler d1 export make-it-nice --remote --output backup.sql     # backup
```

The model recomputes itself (a new version after every ~10 new ratings or ~50 sessions); the dashboard has a **recompute model now** button too. Versions are kept in the `model` table, so you can always see what changed.

## Troubleshooting

- `no such table: sessions` → step 3 (migrations) wasn't applied to the **remote** database.
- Dashboard says the Worker has no `ADMIN_TOKEN` → step 4.
- `You do not have a workers.dev subdomain` → open *Workers & Pages* once in the dashboard (it creates one), or run `npx wrangler subdomain <name>`.
- CORS errors in the browser console → the site is calling a different origin than `ALLOWED_ORIGINS` allows.
