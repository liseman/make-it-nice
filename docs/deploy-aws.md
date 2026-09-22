# Deploy the site to AWS

Two ways, both for the static `site/` folder. The API stays on the Cloudflare Worker ([deploy-cloudflare.md](deploy-cloudflare.md)); set `API_BASE` in `site/config.js` to its URL first.

## Option A — AWS Amplify Hosting (easiest, deploys from GitHub on every push)

1. AWS Console → **Amplify → Create new app → Host web app → GitHub** → authorize → pick `liseman/make-it-nice`, branch `main`.
2. Build settings → **Edit** the YAML so Amplify publishes the `site` folder with no build step:
   ```yaml
   version: 1
   frontend:
     phases:
       build:
         commands: []
     artifacts:
       baseDirectory: site
       files:
         - '**/*'
     cache:
       paths: []
   ```
   (You can also commit this as `amplify.yml` at the repo root.)
3. **Save and deploy.** Amplify gives you `https://main.<id>.amplifyapp.com`; every push to `main` redeploys.
4. Custom domain: Amplify → **Hosting → Custom domains → Add domain**. Amplify provisions the certificate and (for Route 53 zones) the DNS records.

Cost: free tier covers a small site; otherwise cents per GB.

## Option B — S3 + CloudFront (classic, CLI)

Needs the AWS CLI configured (`aws configure`). Pick a globally unique bucket name.

```bash
export BUCKET=make-it-nice-site REGION=us-east-1
aws s3 mb s3://$BUCKET --region $REGION

# static website hosting
aws s3 website s3://$BUCKET --index-document index.html --error-document index.html

# allow public reads (this bucket serves a public site)
aws s3api put-public-access-block --bucket $BUCKET \
  --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false
cat > /tmp/policy.json <<EOF
{ "Version": "2012-10-17", "Statement": [ { "Sid": "PublicRead", "Effect": "Allow", "Principal": "*",
  "Action": "s3:GetObject", "Resource": "arn:aws:s3:::$BUCKET/*" } ] }
EOF
aws s3api put-bucket-policy --bucket $BUCKET --policy file:///tmp/policy.json

# upload (re-run to update)
aws s3 sync site/ s3://$BUCKET --delete \
  --cache-control "max-age=300" --exclude "*.js" --exclude "*.css"
aws s3 sync site/ s3://$BUCKET --delete \
  --cache-control "max-age=86400" --exclude "*" --include "*.js" --include "*.css"
```

The site is now at `http://$BUCKET.s3-website-$REGION.amazonaws.com/` (HTTP only). For HTTPS and a custom domain add CloudFront:

1. **Certificate**: ACM (must be **us-east-1** for CloudFront) → Request → `nice.example.com` → DNS validation → add the CNAME it gives you.
2. **CloudFront → Create distribution**:
   - Origin domain: the S3 *website endpoint* above (type it; don't pick the bucket from the dropdown — website endpoints serve `index.html` for folders like `/dashboard/`).
   - Protocol: HTTP only (to the origin). Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Default root object: `index.html`. Alternate domain name: `nice.example.com`, custom SSL certificate: the ACM one.
3. **DNS**: `CNAME nice → d1234abcd.cloudfront.net` (Route 53: alias A record to the distribution).
4. After each `aws s3 sync`, invalidate the cache:
   ```bash
   aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
   ```

CLI-only alternative for step 2: `aws cloudfront create-distribution --origin-domain-name $BUCKET.s3-website-$REGION.amazonaws.com --default-root-object index.html` creates a basic distribution on the default `*.cloudfront.net` name; add the certificate/alias afterwards in the console.

## Check

- `https://nice.example.com/` → home; `https://nice.example.com/dashboard/` → token prompt.
- Finish a run and open the console: no CORS errors (add the origin to the Worker's `ALLOWED_ORIGINS` if you restricted it).

## Notes

- Deep links are hash-based (`#/result/...`), so no S3/CloudFront rewrite rules are needed; the `error-document index.html` setting is just belt and braces.
- To run the *API* on AWS too you'd port `worker/src/index.js` to Lambda + DynamoDB/RDS; the logic is ~300 lines of plain JS with D1 SQL, but that's not included here — the Worker is free and already global.
