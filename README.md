# fielder-cloud

The deployment of the reference Fielder instance. The product is the public repository
[bubulux/fielder](https://github.com/bubulux/fielder), here as the `fielder/` submodule; this
repository only holds what is specific to this instance: its settings, its deploy pipeline, its notes,
and later the hosted-only extensions (billing) plugged in through the auth seam.

## Deploy

Actions → **Deploy** → Run workflow. It runs the public repository's Deploy workflow on the pinned
version: provision (no-op once D1 and R2 exist), D1 migrations, the app Worker (API + dashboard), the
admin plane. Deploying is always a manual step.

From a machine instead, in this repository (`git submodule update --init`, then `pnpm -C fielder install`):
`pnpm -C fielder/apps/worker migrate:remote`, `pnpm -C fielder/apps/worker run deploy`,
`pnpm -C fielder/apps/admin run deploy`. They read [`deploy.env`](deploy.env) here, beside the
submodule (no secrets). Ops scripts work the same way, e.g.
`node fielder/scripts/user.mjs --email … --remote`. Wrangler needs `CLOUDFLARE_API_TOKEN` or
`pnpm -C fielder exec wrangler login --device`.

## Phone app

Actions → **Build APK** → Run workflow:
- **runner** (default): built on the GitHub runner, no EAS quota. The APK is the run's artifact and is
  **deleted after 3 days** (this private repository has 500 MB of artifact storage; one APK is ~120 MB).
- **cloud**: queued on EAS; download it from the build's page on expo.dev.

It builds against `APP_URL` and signs with the keystore of the Expo project `@bubulux/fielder`.

## Settings

Secrets (Settings → Secrets and variables → Actions):

| Secret | |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions in [self-hosting](https://github.com/bubulux/fielder/blob/main/docs/self-hosting.md#1-a-cloudflare-api-token). Set |
| `CLOUDFLARE_ACCOUNT_ID` | Set |
| `EXPO_TOKEN` | An Expo access token (expo.dev → Account settings → Access tokens), for Build APK. **Still to create.** |

Variables: `D1_DATABASE_NAME`, `D1_DATABASE_ID`, `R2_BUCKET`, `APP_WORKER_NAME`, `ADMIN_WORKER_NAME`,
`ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `APP_URL` (Build APK), optionally `PBKDF2_ITERATIONS`,
`AUTH_PROVIDER`. The same values are in [`deploy.env`](deploy.env); change both together.

## Updating

```sh
git submodule update --init
scripts/bump.sh main        # or a release tag once there are tags
git commit -m "fielder → …" && git push
```

then run Deploy. `bump.sh` moves the submodule and the workflows' refs together, so the scripts and the
workflows that run them come from the same version. Migrations are additive; read the new ones
in `fielder/apps/worker/migrations/` before deploying.

## Hosted extensions (later)

A module here (e.g. `hosted/provider.ts`) that exports `provider: AuthProvider` and wraps the
first-party one, with billing checks in `allow`, goes live by setting the variable
`AUTH_PROVIDER=../hosted/provider.ts` (relative to `fielder/`). See
[the auth seam](https://github.com/bubulux/fielder/blob/main/apps/worker/src/authn/provider.ts).

Instance notes: [docs/instance.md](docs/instance.md).
