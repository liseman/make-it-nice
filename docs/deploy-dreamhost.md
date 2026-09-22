# Deploy the site to DreamHost

The site is plain static files (`site/`), so any DreamHost plan works — shared hosting included. No PHP, no Node, no database on DreamHost: the learning/dashboard API stays on the Cloudflare Worker ([deploy-cloudflare.md](deploy-cloudflare.md)) and the site talks to it from the browser.

## 1. Set up the domain (panel)

1. **Websites → Manage Websites → Add Website** (or pick an existing domain/subdomain, e.g. `nice.lukeiseman.com`).
2. Hosting type: **DreamHost** (fully hosted). Note the **user** it's assigned to and the **web directory** — by default `/home/<user>/nice.lukeiseman.com/`.
3. **Websites → Secure Certificates → Add** next to the domain → **Let's Encrypt** (free). Takes a few minutes.
4. If you plan to use `rsync`/`ssh` (recommended), make the user a *shell* user: **Users → Manage Users → Edit → User type: Shell**. SFTP works without this.

## 2. Point the site at your API

Edit `site/config.js` so `API_BASE` is your Worker URL (e.g. `https://make-it-nice.lukeiseman.workers.dev`). Commit it, or just edit the copy you upload.

## 3. Upload `site/`

**Option A — rsync (repeatable, fast):**

```bash
# from the repo root; trailing slashes matter
rsync -avz --delete site/ <user>@nice.lukeiseman.com:~/nice.lukeiseman.com/
```

Re-run the same command to deploy updates. `--delete` keeps the server identical to `site/`.

**Option B — SFTP (any client: Cyberduck, FileZilla, Transmit):**

- Host: your domain (or the server name shown in the panel), port 22, protocol SFTP, the user from step 1.
- Upload the *contents* of `site/` into the web directory, so `index.html` sits at `/home/<user>/nice.lukeiseman.com/index.html` and the dashboard at `.../dashboard/index.html`.

**Option C — git on the server (shell users):**

```bash
ssh <user>@nice.lukeiseman.com
git clone https://github.com/liseman/make-it-nice.git ~/make-it-nice
rm -rf ~/nice.lukeiseman.com && ln -s ~/make-it-nice/site ~/nice.lukeiseman.com
# later:  cd ~/make-it-nice && git pull
```

## 4. Optional `.htaccess` (caching + HTTPS redirect)

Save as `site/.htaccess` before uploading (harmless on other hosts; GitHub Pages ignores it):

```apache
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 5 minutes"
  ExpiresByType text/css "access plus 1 day"
  ExpiresByType application/javascript "access plus 1 day"
</IfModule>
AddType application/javascript .js
```

(DreamHost's panel also has a **Force HTTPS** toggle under the domain's settings; use either.)

## 5. Check

- `https://nice.lukeiseman.com/` → home page.
- `https://nice.lukeiseman.com/dashboard/` → token prompt.
- Browser console should show no CORS errors when you finish a run; if it does, add your origin to `ALLOWED_ORIGINS` on the Worker (or leave it `*`).

## Notes

- Hash routing (`#/result/...`) means no rewrite rules are needed for deep links.
- Fonts load from Google Fonts; everything else is self-hosted. To go fully offline, download the five families and swap the `<link>` in `index.html` for `@font-face` rules.
- A DreamHost VPS could host the API too, but the Worker is free, global, and already done — there's no Node/PHP version of the API in this repo.
