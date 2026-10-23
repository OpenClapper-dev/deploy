# deploy

The deployment of the reference OpenClapper instances, production and staging. The product is the public repository
[OpenClapper-dev/core](https://github.com/OpenClapper-dev/core), here as the `core/` submodule; this
repository only holds what is specific to this instance: its settings, its deploy pipeline, its notes,
and later the hosted-only extensions (billing) plugged in through the auth seam.

## Workflows

All manual, named by instance first:

| Workflow | What it does |
| --- | --- |
| **Production · Release** | the newest core release live: bump, Deploy server, Build phone app with the Play upload |
| **Production · Deploy server** | D1 migrations, the app Worker (API + Studio), the admin plane, on the pinned core |
| **Production · Build phone app** | APK + App Bundle with the production key; `track: internal` uploads to Play |
| **Staging · Update** | core's `main` (or a `ref`) on staging: Deploy server, then Build phone app with the Play upload; staging's data stays |
| **Staging · Deploy server** | the same for staging, on core's `main` or a `ref` |
| **Staging · Build phone app** | "OpenClapper Staging", APK + App Bundle; `track: internal` uploads to Play |
| **Staging · Recreate from production** | staging rebuilt as a copy of production (production only read), then deployed |

The development client is not built here: it needs no deployment (core's Build phone app, `variant: dev`).

## Release (one button)

Actions → **Production · Release** → Run workflow puts the newest release of the public repository live:
1. It finds the newest `v*` tag, pre-releases included.
2. It moves this repository to that tag (`scripts/bump.sh`, committed and pushed by the bot).
3. It runs **Production · Deploy server**, waits for it to go green, then runs **Production · Build phone app** with `track: internal`: the bundle
   goes to the production app's internal track on Google Play, and Play updates the testers' phones.
   Pressed again on the same version, the upload is skipped with a notice.

When the tag is already pinned, it still deploys and builds. New D1 migrations stop it, with the list in the run's summary; review them, then run it again with **Apply new migrations** ticked. The two runs it starts are linked in its summary.

It needs the secret `RELEASE_TOKEN`, because the bump rewrites the workflow files' pinned refs and a run's own token may never push workflow files. Create a fine-grained personal access token for **this repository only**, with Contents and Workflows set to Read and write, and store it as that secret. When it expires, Production · Release stops at its first step and says so.

## Deploy server

Actions → **Production · Deploy server** → Run workflow. It runs core's Deploy server workflow on the
pinned version: provision (no-op once D1 and R2 exist), D1 migrations, the app Worker (API + Studio),
the admin plane. Deploying is always a manual step.

There is no local deploy: every setting lives in GitHub (the `production` and `staging` environments, the
shared secrets), and core reads them from the run's environment only.

## Phone app

Actions → **Production · Build phone app** → Run workflow: `expo prebuild` + Gradle on the GitHub runner, no Expo account.
It builds against the `production` environment's `APP_URL`, signs with that environment's key, and leaves
an APK (for sideloading) and an App Bundle (for Google Play) as the run's artifacts for 3 days. With
`track: internal` the bundle also goes to the production app's internal track; the Release button does
that by itself. Phones get the app from Play: an APK from here is signed with the upload key, Play's
install with Google's key, so the two cannot update each other (uninstall to switch).

## Staging

A second instance with its own Workers, D1, R2 and Access application, on
[staging.openclapper.app](https://staging.openclapper.app) and staging-admin.openclapper.app. It tracks
core's `main` (its workflows use `@main` and take a `ref` for a branch), and shows a clay "staging"
badge in the Studio and the admin board. Its settings are the `staging` GitHub environment.

- **Staging · Update**: core's `main` (or the `ref` given) on staging, server first, then the app with the
  upload to the internal track. Staging's data stays as it is, to see how new code behaves on it.
- **Staging · Deploy server**: core's `main` (or the `ref` given) to staging.
- **Staging · Build phone app**: "OpenClapper Staging" (`org.openclapper.staging`), next to the production app,
  as an APK and an App Bundle; with `track: internal` the bundle also goes to the staging app's internal
  track on Google Play (#8). Its version code is the commit count of core's `main`.
- **Staging · Recreate from production**: replaces staging with a 1:1 copy of production (R2, then D1;
  sessions not copied), then deploys staging. Type `openclapper-staging-db` to confirm. Staging then holds
  production's accounts and password hashes, behind the same Access policy for its admin plane.

Before a release: Staging · Update on `main` (Staging · Recreate from production first, to try a migration on production's data), click through, then release.

## Settings

Shared secrets (Settings → Secrets and variables → Actions), used by both instances:

| Secret | |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions in [self-hosting](https://github.com/OpenClapper-dev/core/blob/main/docs/self-hosting.md#1-a-cloudflare-api-token). Set |
| `CLOUDFLARE_ACCOUNT_ID` | Set |

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
`openclapper-staging-media`). The Cloudflare token is a shared repository secret.

Per environment, `production` and `staging` each have their own secrets for the phone app: the Android
key (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`;
the app's upload key on Google Play, which signs with a Google-generated key) and
`PLAY_SERVICE_ACCOUNT_JSON` (the key of that app's own service account, `play-uploader-production` or
`play-uploader-staging`, invited in the Play Console on its own app only, "Release apps to testing
tracks"). Copies of all keys are in the owner's Bitwarden, nowhere else. A lost upload key can be reset
through Play Console support; a lost service account key is replaced by a new key on the account.

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
