# The reference instances

What the public docs no longer name (they describe any instance).

| | |
| --- | --- |
| Cloudflare account | `3868cbc17be171c90972dd32e41e7783` |
| App | Worker `openclapper-api`, https://openclapper.app (API + Studio; old: `fielder-api`, https://fielder-api.fielder-worker.workers.dev) |
| Admin plane | Worker `openclapper-admin`, https://admin.openclapper.app (was `fielder-admin`) |
| D1 | `openclapper-db`, `6d7ada22-afa6-4bb2-bd77-59e22d7cc36c` (WEUR; was `fielder-db`) |
| R2 | `openclapper-media` (WEUR; was `fielder-shots`) |
| Zero Trust team | `weathered-salad-6072.cloudflareaccess.com` |
| Access app for the admin plane | "Fielder-Admin" (to be renamed "OpenClapper Admin" in the dashboard; its destinations still list the deleted Fielder admin Worker, which blocks an API update until removed), AUD `727fade57871978d220f144dd28ccd5d99cb5683aa4f736e8856a0a1bb6a2ed7`; the reusable policy "Owner auth" (`89f333bc-2657-4af2-8670-d32e8b943c45`): the owner's email, one-time PIN |
| Android signing key | `CN=Fielder`, alias `fielder`, made 2026-10-19 (`scripts/keystore.sh`): `.secrets/android/` in the owner's public checkout + this repo's secrets + the owner's backup. The APK's `EXPO_PUBLIC_API_URL` = `APP_URL`. The Expo project `@bubulux/fielder` is no longer used |

## Staging

First deployed 2026-10-22 (#6) from core `main` (7ed7fca).

| | |
| --- | --- |
| App | Worker `openclapper-staging-api`, https://staging.openclapper.app |
| Admin plane | Worker `openclapper-staging-admin`, https://staging-admin.openclapper.app |
| D1 | `openclapper-staging-db` (WEUR, `D1_LOCATION`), first id `a6047bce-a3e6-413d-b510-30c1cb923498`; the id changes with every clone (deleted and created again by name), so it is never pinned |
| R2 | `openclapper-staging-media` |
| Access app for the admin plane | "OpenClapper Admin (staging)" (`31edf42f-26b0-44a5-bf5e-5d687239c570`), AUD `b5992eb5c9f1571536a58f276a33829a19f4a71ebfc36e6b4ce690b4f129966e`, the same reusable policy "Owner auth" and login method as production, 24 h sessions |
| Phone | "OpenClapper Staging", `org.openclapper.staging`, signed with the production key |

After a clone, staging holds production's accounts and password hashes (sessions excepted), behind the same Access policy for its admin plane.

## History

- 2026-10-22: the repository went public with GitHub environments; production's settings left the repository variables (all but `APP_URL`), so the `staging` environment cannot inherit them, and production reads them from `deploy.env` until #7. Staging deployed twice (resources, then its Access application) and serves staging.openclapper.app; no accounts until the first clone.
- 2026-10-22: staging planned (#2): its own resources in the same account, settings in the `staging` GitHub environment, workflows Deploy staging, Build APK staging, Clone production to staging.
- 2026-10-20: v0.6.0, everything renamed to OpenClapper (#233). The phone app is now `org.openclapper` (a new app; the old Fielder app can be uninstalled), the submodule is `core/`, and Build APK takes `variant: dev` for the development client.

- 2026-10-20: rename to OpenClapper. D1 and R2 copied to `openclapper-db` / `openclapper-media` (25 tables, 183 objects, verified identical); Workers redeploy as `openclapper-api` / `openclapper-admin` on openclapper.app / admin.openclapper.app (APP_DOMAIN/ADMIN_DOMAIN). Verified same day (both web clients + APK); the old Workers, `fielder-db` and `fielder-shots` were deleted on 2026-10-20. The installed APK still points at the old URL and is abandoned (next build uses APP_URL).

- 2026-09-13: the service token early builds used was revoked; APKs from before then cannot reach the API.
- 2026-10-18: multi-user foundation (epic bubulux/fielder#107) merged.
- 2026-10-19: cutover done. Migrations 0021 + 0022 applied (backup before: `.secrets/prod-before-0021.sql` in the owner's public checkout), the admin plane behind its own Access app, the app's Access app (AUD `8512a955…`) deleted, the bootstrap user has the owner's email and password, the Access fallback removed (bubulux/fielder#118).
- 2026-10-19: `deploy.env` moved here from the public checkout; the public Makefile has no deploy targets any more (bubulux/fielder#131). APK builds via Build APK (bubulux/fielder#132).
- 2026-10-19: EAS removed (bubulux/fielder#135): builds are `expo prebuild` + Gradle with this instance's own key. APKs from before were signed by an EAS-generated key, so the first own-key APK needs one uninstall of the old app. One product version and releases (bubulux/fielder#136).

## Local

`.secrets/` in the public checkout (gitignored) holds `access-app.json`, a short-lived Cloudflare API
token used only for Access administration from the CLI, and the pre-0021 database backup. The
instance's settings are in [`deploy.env`](../deploy.env) here.
