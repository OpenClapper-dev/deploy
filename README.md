# fielder-cloud

The deployment of the reference Fielder instance. The product is the public repository
[bubulux/fielder](https://github.com/bubulux/fielder), here as the `fielder/` submodule; this
repository only holds what is specific to this instance: its settings, its deploy pipeline, its notes,
and later the hosted-only extensions (billing) plugged in through the auth seam.

## Deploy

Actions → **Deploy** → Run workflow. It runs the public repository's Deploy workflow on the pinned
version: provision (no-op once D1 and R2 exist), D1 migrations, the app Worker (API + dashboard), the
admin plane. Deploying is always a manual step.

From a machine instead: work in a checkout of the public repository with this instance's `deploy.env`
(the values below) and `make deploy` / `make deploy-admin`.

## Settings

Secrets (Settings → Secrets and variables → Actions):

| Secret | |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions in [self-hosting](https://github.com/bubulux/fielder/blob/main/docs/self-hosting.md#1-a-cloudflare-api-token). **Still to create.** |
| `CLOUDFLARE_ACCOUNT_ID` | Set |

Variables: `D1_DATABASE_NAME`, `D1_DATABASE_ID`, `R2_BUCKET`, `APP_WORKER_NAME`, `ADMIN_WORKER_NAME`,
`ACCESS_TEAM_DOMAIN`, `APP_ACCESS_AUD` (only until the cutover, then delete it), `ADMIN_ACCESS_AUD`
(once the admin Access application exists), optionally `PBKDF2_ITERATIONS`, `AUTH_PROVIDER`.

## Updating

```sh
git submodule update --init
scripts/bump.sh main        # or a release tag once there are tags
git commit -m "fielder → …" && git push
```

then run Deploy. `bump.sh` moves the submodule and the workflow's ref together, so the deploy scripts
and the workflow that runs them come from the same version. Migrations are additive; read the new ones
in `fielder/apps/worker/migrations/` before deploying.

## Hosted extensions (later)

A module here (e.g. `hosted/provider.ts`) that exports `provider: AuthProvider` and wraps the
first-party one, with billing checks in `allow`, goes live by setting the variable
`AUTH_PROVIDER=../hosted/provider.ts` (relative to `fielder/`). See
[the auth seam](https://github.com/bubulux/fielder/blob/main/apps/worker/src/authn/provider.ts).

Instance notes: [docs/instance.md](docs/instance.md).
