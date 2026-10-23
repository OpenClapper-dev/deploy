# deploy

The deployment of the reference OpenClapper instances, production and staging. The product is the public repository
[OpenClapper-dev/core](https://github.com/OpenClapper-dev/core), here as the `core/` submodule; this
repository only holds what is specific to this instance: its settings, its deploy pipeline, its notes,
and later the hosted-only extensions (billing) plugged in through the auth seam.

## Release (one button)

Actions → **Release** → Run workflow puts the newest release of the public repository live:
1. It finds the newest `v*` tag, pre-releases included.
2. It moves this repository to that tag (`scripts/bump.sh`, committed and pushed by the bot).
3. It runs **Deploy**, waits for it to go green, then runs **Build APK**.

When the tag is already pinned, it still deploys and builds. New D1 migrations stop it, with the list in the run's summary; review them, then run it again with **Apply new migrations** ticked. The two runs it starts are linked in its summary.

It needs the secret `RELEASE_TOKEN`, because the bump rewrites the workflow files' pinned refs and a run's own token may never push workflow files. Create a fine-grained personal access token for **this repository only**, with Contents and Workflows set to Read and write, and store it as that secret. When it expires, Release stops at its first step and says so.

## Deploy

Actions → **Deploy** → Run workflow. It runs the public repository's Deploy workflow on the pinned
version: provision (no-op once D1 and R2 exist), D1 migrations, the app Worker (API + dashboard), the
admin plane. Deploying is always a manual step.

There is no local deploy: every setting lives in GitHub (the `production` and `staging` environments, the
shared secrets), and core reads them from the run's environment only.

## Phone app

Actions → **Build APK** → Run workflow: `expo prebuild` + Gradle on the GitHub runner, no Expo account.
The APK is the run's artifact and is **deleted after 3 days** (this private repository has 500 MB of
artifact storage; one APK is ~120 MB). It builds against `APP_URL` and signs with this instance's key
(the `ANDROID_KEY*` secrets; the key itself and its passwords are also in the owner's offline backup,
nowhere else). Never make a new key: it cannot update the installed app.

## Staging

A second instance with its own Workers, D1, R2 and Access application, on
[staging.openclapper.app](https://staging.openclapper.app) and staging-admin.openclapper.app. It tracks
core's `main` (its workflows use `@main` and take a `ref` for a branch), and shows a clay "staging"
badge in the Studio and the admin board. Its settings are the `staging` GitHub environment.

- **Deploy staging**: core's `main` (or the `ref` given) to staging.
- **Build APK staging**: "OpenClapper Staging" (`org.openclapper.staging`), next to the production app,
  same signing key.
- **Clone production to staging**: replaces staging with a 1:1 copy of production (R2, then D1;
  sessions not copied), then deploys staging. Type `openclapper-staging-db` to confirm. Staging then holds
  production's accounts and password hashes, behind the same Access policy for its admin plane.

Before a release: Deploy staging on `main` (Clone first for a migration), click through, then release.

## Settings

Shared secrets (Settings → Secrets and variables → Actions), used by both instances:

| Secret | |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions in [self-hosting](https://github.com/OpenClapper-dev/core/blob/main/docs/self-hosting.md#1-a-cloudflare-api-token). Set |
| `CLOUDFLARE_ACCOUNT_ID` | Set |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | The Android signing key for Build APK (made with `core/scripts/keystore.sh`). Set |

`CF_ANALYTICS_TOKEN` (read-only analytics for the admin boards) and `RELEASE_TOKEN` (Release) are shared
secrets too. There are **no repository variables**: a repository variable reaches every environment that
does not set the same name, which is how staging could end up on production's database.

The `production` environment (Settings → Environments, `main` only): `D1_DATABASE_NAME=openclapper-db`,
`D1_DATABASE_ID`, `R2_BUCKET=openclapper-media`, `APP_WORKER_NAME=openclapper-api`,
`ADMIN_WORKER_NAME=openclapper-admin`, `APP_DOMAIN=openclapper.app`, `ADMIN_DOMAIN=admin.openclapper.app`,
`APP_URL=https://openclapper.app`, `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `D1_LOCATION=weur`; optionally
`PBKDF2_ITERATIONS`, `AUTH_PROVIDER`. The ids are in [docs/instance.md](docs/instance.md).

The `staging` environment (Settings → Environments, `main` only) has the same names with staging's values:
`D1_DATABASE_NAME=openclapper-staging-db`, `R2_BUCKET=openclapper-staging-media`,
`APP_WORKER_NAME=openclapper-staging-api`, `ADMIN_WORKER_NAME=openclapper-staging-admin`,
`APP_DOMAIN=staging.openclapper.app`, `ADMIN_DOMAIN=staging-admin.openclapper.app`,
`APP_URL=https://staging.openclapper.app`, `ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD` (its own Access
application), `INSTANCE_LABEL=staging`, `D1_LOCATION=weur`, and for the clone
`SOURCE_D1_DATABASE_NAME=openclapper-db`, `SOURCE_R2_BUCKET=openclapper-media`. No `D1_DATABASE_ID`: the
clone recreates the database, and the deploy finds it by name. Its secrets are the two R2 tokens of the
clone: `SOURCE_R2_ACCESS_KEY_ID` / `SOURCE_R2_SECRET_ACCESS_KEY` (Object Read only on
`openclapper-media`) and `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Object Read & Write on
`openclapper-staging-media`). The Cloudflare token and the Android key are shared repository secrets.

## Updating

```sh
git submodule update --init
scripts/bump.sh v0.2.0      # a release tag (core/docs/releasing.md), or main
git commit -m "core → …" && git push
```

then run Deploy. `bump.sh` moves the submodule and the workflows' refs together, so the scripts and the
workflows that run them come from the same version. Migrations are additive; read the new ones
in `core/apps/worker/migrations/` before deploying.

## Hosted extensions (later)

A module here (e.g. `hosted/provider.ts`) that exports `provider: AuthProvider` and wraps the
first-party one, with billing checks in `allow`, goes live by setting the variable
`AUTH_PROVIDER=../hosted/provider.ts` (relative to `core/`). See
[the auth seam](https://github.com/OpenClapper-dev/core/blob/main/apps/worker/src/authn/provider.ts).

Instance notes: [docs/instance.md](docs/instance.md).
