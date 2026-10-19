# fielder-cloud

The deployment of the reference Fielder instance. The product is the public repository
[bubulux/fielder](https://github.com/bubulux/fielder), here as the `fielder/` submodule; this
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

From a machine instead, in this repository (`git submodule update --init`, then `pnpm -C fielder install`):
`pnpm -C fielder/apps/worker migrate:remote`, `pnpm -C fielder/apps/worker run deploy`,
`pnpm -C fielder/apps/admin run deploy`. They read [`deploy.env`](deploy.env) here, beside the
submodule (no secrets). Ops scripts work the same way, e.g.
`node fielder/scripts/user.mjs --email … --remote`. Wrangler needs `CLOUDFLARE_API_TOKEN` or
`pnpm -C fielder exec wrangler login --device`.

## Phone app

Actions → **Build APK** → Run workflow: `expo prebuild` + Gradle on the GitHub runner, no Expo account.
The APK is the run's artifact and is **deleted after 3 days** (this private repository has 500 MB of
artifact storage; one APK is ~120 MB). It builds against `APP_URL` and signs with this instance's key
(the `ANDROID_KEY*` secrets; the key itself and its passwords are in `.secrets/android/` and
`.secrets/android.env` of the owner's public checkout, plus the owner's backup). Never make a new key:
it cannot update the installed app.

## Settings

Secrets (Settings → Secrets and variables → Actions):

| Secret | |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions in [self-hosting](https://github.com/bubulux/fielder/blob/main/docs/self-hosting.md#1-a-cloudflare-api-token). Set |
| `CLOUDFLARE_ACCOUNT_ID` | Set |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | The Android signing key for Build APK (made with `fielder/scripts/keystore.sh`). Set |

Variables: `D1_DATABASE_NAME`, `D1_DATABASE_ID`, `R2_BUCKET`, `APP_WORKER_NAME`, `ADMIN_WORKER_NAME`,
`ACCESS_TEAM_DOMAIN`, `ADMIN_ACCESS_AUD`, `APP_URL` (Build APK), optionally `PBKDF2_ITERATIONS`,
`AUTH_PROVIDER`. The same values are in [`deploy.env`](deploy.env); change both together.

## Updating

```sh
git submodule update --init
scripts/bump.sh v0.2.0      # a release tag (fielder/docs/releasing.md), or main
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
