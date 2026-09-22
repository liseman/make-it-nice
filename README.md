# make it nice

**You can't describe what you like. But you can pick.**

Ten pairs of designs, one at a time. Tap the nicer one. You get your taste back three ways:

1. a result page rendered *in your taste* (colors, type, corners, density, mood — the page wears it),
2. a plain-English description of your style preferences, and
3. a prompt you paste into your AI of choice (Claude, ChatGPT, Gemini…) that saves your taste to its memory so the things it makes for you look better.

Then rate it 1–5 stars, share the link, **Start fresh** or **Make it nicer** (ten more picks that refine, instead of restart).

**Live:** https://liseman.github.io/make-it-nice/ (GitHub Pages) · https://make-it-nice.lukeiseman.workers.dev (Cloudflare, site + API)

The site is a static page (GitHub Pages, DreamHost, S3, anywhere). The bit that learns from everyone lives in a tiny Cloudflare Worker + D1 database.

> "based on 10 choices, my nice is warm, airy minimalism with soft edges"

## How it works

- **Nothing is a stock image.** Every pair is the same little design — a poster, an app card, a pattern tile, a landing page, or a type specimen — rendered twice from the same seed. The two differ on exactly one axis of taste (or, in later rounds, trade two axes off against each other). `site/samples.js` draws them from a 12-axis style vector:
  `cool↔warm · muted↔saturated · dark↔light · soft↔high-contrast · minimal↔ornate · sharp↔rounded · geometric↔organic · flat↔dimensional · sans↔serif · airy↔dense · asymmetric↔symmetric · serious↔playful`
- **Each pick updates a profile** (a vector `w` in [-1, 1]¹² plus a per-axis uncertainty `s`). The next pair is chosen to be maximally informative: uncertain axes first (ordered by how *valuable* the model has learned each axis is), then "how strongly?" (intensity probes), then "which matters more?" (trade-off probes). See `site/engine.js`.
- **The model evolves.** Anonymous results and star ratings are stored by the Worker. After every ~10 new ratings (or ~50 sessions) it recomputes a versioned population model: which axes people actually disagree on (worth asking), which they don't (skip), a rating-weighted prior for new visitors, and which sample types lead to well-rated results. Every session records which model version produced it, so the dashboard can show whether ratings improve version over version.
- **Share links are self-contained**: the URL carries the taste vector, so a shared result renders with no backend at all. Friends can "start from" your nice.
- **Local-only fallback.** If the API is unreachable, everything still works in the browser; nothing is shared or learned, and the dashboard shows only that browser's results.

## Repo layout

```
site/                 static site — deploy this folder anywhere
  index.html          home → picker → result (hash-routed SPA)
  app.js              the UI
  engine.js           taste engine: axes, updates, probe planning, share codes, words, model evolution
  samples.js          procedural design samples (poster, card, pattern, hero, specimen)
  api.js              API client with local-only fallback
  config.js           API_BASE and friends (edit this, or set the API_BASE repo variable for Pages)
  dashboard/          Luke's analytics dashboard (token-gated)
worker/               Cloudflare Worker API + D1 (sessions, ratings, events, model, admin stats)
  src/index.js        the API
  migrations/         D1 schema
  wrangler.toml       config (also serves site/ from the Worker, so one deploy = whole app)
docs/                 step-by-step deploy guides (GitHub Pages, Cloudflare, DreamHost, AWS)
tests/                engine unit tests, API integration tests, a dev gallery of samples
.github/workflows/    Pages deploy (auto), tests, optional Worker deploy
```

## Run it locally

Static site only (local-only mode):

```bash
cd site && python3 -m http.server 8000     # then open http://localhost:8000/
```

Whole thing, with a local database:

```bash
cd worker && npm install
npm run migrate:local                       # creates the local D1 tables
echo "ADMIN_TOKEN=devtoken123" > .dev.vars  # dashboard password for local dev
npm run dev                                 # http://127.0.0.1:8787/  (site + /api/*)
```

Tests:

```bash
node --test tests/engine.test.mjs           # engine
node --test tests/api.test.mjs              # against the running wrangler dev (above)
open tests/gallery.html?mode=random         # eyeball the sample renderers (serve the repo root)
```

## Deploy

| Where | What | Guide |
|---|---|---|
| **GitHub Pages** | the static site, auto-deployed on every push to `main` | [docs/deploy-github-pages.md](docs/deploy-github-pages.md) |
| **Cloudflare** | the Worker API + D1 (and, optionally, the whole site) | [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md) |
| **DreamHost** | the static site on shared hosting | [docs/deploy-dreamhost.md](docs/deploy-dreamhost.md) |
| **AWS** | the static site on Amplify Hosting or S3 + CloudFront | [docs/deploy-aws.md](docs/deploy-aws.md) |

The site finds the API through `API_BASE` in `site/config.js`. Point any copy of the site at the same Worker and they all learn together.

## The dashboard

`/dashboard/` (e.g. `https://liseman.github.io/make-it-nice/dashboard/`). Enter the Worker's `ADMIN_TOKEN` once; it's stored in that browser. Shows starts → completions → ratings, ratings per day, **average rating by model version** (is the evolution working?), where the population lands on every axis and how much the model wants to ask about each, which sample types perform, recent results (open any one), model version history, and a "recompute model now" button.

## Configuration

| Setting | Where | Meaning |
|---|---|---|
| `API_BASE` | `site/config.js` or repo variable `API_BASE` | URL of the Worker. Empty = same origin as the page. |
| `ADMIN_TOKEN` | Worker secret (`npm run secret:admin`) | Dashboard password. |
| `ALLOWED_ORIGINS` | `worker/wrangler.toml` `[vars]` | `*` or a comma-separated list of site origins. |
| D1 `database_id` | `worker/wrangler.toml` | From `wrangler d1 create make-it-nice`. |

## License

MIT. Experimental weirdness by [luke](https://lukeiseman.com).
