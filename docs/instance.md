# The reference instance

What the public docs no longer name (they describe any instance).

| | |
| --- | --- |
| Cloudflare account | `3868cbc17be171c90972dd32e41e7783` |
| App | Worker `fielder-api`, https://fielder-api.fielder-worker.workers.dev (API + dashboard) |
| Admin plane | Worker `fielder-admin`, https://fielder-admin.fielder-worker.workers.dev |
| D1 | `fielder-db`, `b12cf742-e055-4f75-aa01-0cf73e36dc63` (WEUR) |
| R2 | `fielder-shots` (WEUR) |
| Zero Trust team | `weathered-salad-6072.cloudflareaccess.com` |
| Access app for the admin plane | AUD `727fade57871978d220f144dd28ccd5d99cb5683aa4f736e8856a0a1bb6a2ed7`; policy: the owner's email, one-time PIN |
| Expo / EAS | project `@bubulux/fielder`; the APK's `EXPO_PUBLIC_API_URL` = the app URL (`APP_URL`) |

## History

- 2026-09-13: the service token early builds used was revoked; APKs from before then cannot reach the API.
- 2026-10-18: multi-user foundation (epic bubulux/fielder#107) merged.
- 2026-10-19: cutover done. Migrations 0021 + 0022 applied (backup before: `.secrets/prod-before-0021.sql` in the owner's public checkout), the admin plane behind its own Access app, the app's Access app (AUD `8512a955…`) deleted, the bootstrap user has the owner's email and password, the Access fallback removed (bubulux/fielder#118).
- 2026-10-19: `deploy.env` moved here from the public checkout; the public Makefile has no deploy targets any more (bubulux/fielder#131). APK builds via Build APK (bubulux/fielder#132).

## Local

`.secrets/` in the public checkout (gitignored) holds `access-app.json`, a short-lived Cloudflare API
token used only for Access administration from the CLI, and the pre-0021 database backup. The
instance's settings are in [`deploy.env`](../deploy.env) here.
