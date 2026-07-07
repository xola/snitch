## GoCD Snitch

A webhook based Slack notifier for [GoCD](https://www.gocd.org/)

## Requirements

-   Node 20
-   Webhook GoCD plugin: https://github.com/digitalocean/gocd-webhook-notification-plugin

## Install

```shell
docker build -t snitch .
docker run -p 6000:6000 -it snitch
```

Create/Edit `/var/go/webhook_notify.properties` file and add an entry for the webhook. Example:

```ini
stage.status.endpoint.1=https://your-snitch-url/api/webhooks
agent.status.endpoint.1=https://your-snitch-url/api/webhooks
```

## Deploy on Remote server (current, being phased out)

Run `scripts/release.sh` This will build and run the app. The app is made of three components configured in `pm2.config.cjs`:

1. Snitch app
2. Monitoring agent for Jobs
3. Monitoring agent for Elastic agents

Once run you can view the logs using:

```
docker logs -f snitch
```

This path is being migrated away from — see below.

## Deploying to Lambda (serverless)

Snitch is moving off the always-on GoCD host (crashes under load, manual
Let's Encrypt cert renewal) onto AWS Lambda via the Serverless Framework,
following the same pattern as `miami-zoo`. The three pm2 apps above become:

1. `web` — the Slack Bolt + webhook receiver (`src/index.js`), behind API
   Gateway with a custom domain (TLS handled by ACM, auto-renewing).
2. `monitorJobs` — server-health check (`src/monitor-jobs.js`), on an
   EventBridge schedule instead of an in-process `CronJob`.
3. `monitorAgents` — elastic agent check (`src/monitor-elastic-agents.js`),
   also on an EventBridge schedule.

This deploys to Xola's **CI** AWS account (not the production account other
serverless services use), so the domain, deployment bucket, and GitHub
Actions deploy credentials still need to be filled in — see the `TODO`s in
`serverless.yml` and `.github/workflows/deploy.yml`.

### Configuration / secrets

Non-secret config lives in `config/default.json` and per-environment files
(e.g. `config/production.json`). Secrets (Slack token/signing secret, GoCD
username/password) go in a `config/local-<env>.json` file, which must never
be committed in plain text. Instead, encrypt it and commit the encrypted
output, the same way `miami-zoo` does:

```sh
# one-time per environment: generate a keypair (keep the private key safe,
# store it in the ENCRYPTION_PRIVATE_KEY GitHub secret)
node scripts/crypt.js generateKeys

# fill in config/local-production.json with real secrets, then:
NODE_ENV=production node scripts/crypt.js encrypt
# commit config/local-production.json.encrypted and .encrypted.key
```

At deploy time, CI decrypts the matching file back into
`config/local-<env>.json` before packaging the Lambda.

### Running locally

```sh
npm install
npm run dev      # plain Express/Bolt server, hot reload, no Lambda emulation
npm run offline  # Lambda + API Gateway emulation via serverless-offline
```

### Deploying

There is only one environment — `production` — since this app only ever
runs in Xola's **CI** AWS account (527931183042, separate from the
production account other serverless services like `miami-zoo` use). The
deployment artifact bucket is managed automatically by the Serverless
Framework (no pre-existing bucket needed).

Deploys run from GitHub Actions via the **Deploy** workflow
(`.github/workflows/deploy.yml`), triggered manually.

**`snitch.ci.xola.com` is currently a live CNAME to the old app
(`sage.ci.xola.com`)** — `serverless deploy` alone never touches Route53/ACM,
only `serverless create_domain` does, so the first deploy must validate
against the plain API Gateway invoke URL before cutting the real domain
over:

```sh
# 1. Validate — no DNS touched, reachable only via the auto-generated
#    *.execute-api.us-east-1.amazonaws.com URL printed by this command
npx serverless deploy --stage=production

# 2. Once confirmed working: delete the existing snitch.ci.xola.com CNAME
#    in Route53, then cut over
npx serverless create_domain --stage=production
npx serverless deploy --stage=production
```

### Still to confirm before first deploy

- GitHub Actions secrets/variables for CI-account AWS credentials
  (`CI_DEPLOY_AWS_ACCESS_KEY_ID` / `CI_DEPLOY_AWS_SECRET_ACCESS_KEY`)
- Updating the GoCD `webhook_notify.properties` endpoint and the Slack app's
  Interactivity/Events Request URL to `https://snitch.ci.xola.com/...` once live
