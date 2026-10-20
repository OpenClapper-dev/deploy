# The reference instance

What the public docs no longer name (they describe any instance).

| | |
| --- | --- |
| Cloudflare account | `3868cbc17be171c90972dd32e41e7783` |
| App | Worker `openclapper-api`, https://openclapper.app (API + Studio; old: `fielder-api`, https://fielder-api.fielder-worker.workers.dev) |
| Admin plane | Worker `openclapper-admin`, https://admin.openclapper.app (was `fielder-admin`) |
| D1 | `openclapper-db`, `6d7ada22-afa6-4bb2-bd77-59e22d7cc36c` (WEUR; was `fielder-db`) |
| R2 | `openclapper-media` (WEUR; was `fielder-shots`) |
| Zero Trust team | `weathered-salad-6072.cloudflareaccess.com` |
| Access app for the admin plane | AUD `727fade57871978d220f144dd28ccd5d99cb5683aa4f736e8856a0a1bb6a2ed7`; policy: the owner's email, one-time PIN |
| Android signing key | `CN=Fielder`, alias `fielder`, made 2026-10-19 (`scripts/keystore.sh`): `.secrets/android/` in the owner's public checkout + this repo's secrets + the owner's backup. The APK's `EXPO_PUBLIC_API_URL` = `APP_URL`. The Expo project `@bubulux/fielder` is no longer used |

## History

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
