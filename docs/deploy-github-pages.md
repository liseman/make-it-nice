# Deploy the site to GitHub Pages

The static site lives in `site/`. The workflow in `.github/workflows/pages.yml` publishes that folder to GitHub Pages on every push to `main` (and on demand from the Actions tab). Nothing to build.

## One-time setup

1. Push this repo to GitHub (e.g. `liseman/make-it-nice`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (If the first workflow run fails with "Pages not enabled", this is the step you missed.)
3. Actions → *Deploy site to GitHub Pages* → **Run workflow** (or just push to `main`).
4. Your site is at `https://<user>.github.io/<repo>/` — for this repo, `https://liseman.github.io/make-it-nice/`.

## Point it at your API

The site reads the API URL from `site/config.js` (`API_BASE`). You can either edit that file, or set a **repository variable** so the deploy rewrites it for you:

**Settings → Secrets and variables → Actions → Variables → New repository variable**
`API_BASE` = `https://make-it-nice.<your-subdomain>.workers.dev`

The workflow substitutes it into `config.js` at deploy time; the committed file is untouched. Leave the variable unset to use whatever is committed.

If there's no API yet, the site runs in local-only mode (everything works, nothing is learned across visitors).

## Custom domain (optional)

1. Settings → Pages → Custom domain: `nice.example.com` → Save. GitHub creates a `CNAME` file; keep the `site/` folder as the Pages source (the workflow uploads `site/`, so add the file as `site/CNAME` containing just the domain).
2. At your DNS provider: `CNAME nice → liseman.github.io` (apex domains use the four `A` records from GitHub's docs).
3. Tick **Enforce HTTPS** once the certificate is issued (a few minutes).

## Updating

Push to `main`. Only changes under `site/` trigger a deploy; the Worker is separate (see [deploy-cloudflare.md](deploy-cloudflare.md)).

## Troubleshooting

- **404 on the site root** — check the workflow run; the artifact path must be `site`.
- **Result pages / share links break on refresh** — they can't: routing is hash-based (`#/result/...`) precisely so static hosts need no rewrite rules.
- **Dashboard says "couldn't reach the API"** — the Worker isn't deployed, or `API_BASE` points at the wrong place. Open `<API_BASE>/api/health` in a browser; it should return `{"ok":true,...}`.
