# The reference instance

What the public docs no longer name (they describe any instance).

| | |
| --- | --- |
| Cloudflare account | `3868cbc17be171c90972dd32e41e7783` |
| App | Worker `fielder-api`, https://fielder-api.fielder-worker.workers.dev (API + dashboard) |
| Admin plane | Worker `fielder-admin`, https://fielder-admin.fielder-worker.workers.dev (once deployed) |
| D1 | `fielder-db`, `b12cf742-e055-4f75-aa01-0cf73e36dc63` (WEUR) |
| R2 | `fielder-shots` (WEUR) |
| Zero Trust team | `weathered-salad-6072.cloudflareaccess.com` |
| Access app "Fielder" (app hostname, until the cutover) | AUD `8512a955cdb50da65faefe935b15cded1660e2e47cbd4c73bd5c24dbe7d81ed4`; one policy: the owner's email, one-time PIN; no service tokens |
| Access app for the admin plane | not created yet |
| Expo / EAS | project `@bubulux/fielder`; `EXPO_PUBLIC_API_URL` = the app URL |

## History

- 2026-09-13: the service token early builds used was revoked; APKs from before then cannot reach the API.
- 2026-10-18: multi-user foundation (epic bubulux/fielder#107) merged; migrations 0021 and 0022 not yet applied remotely. The cutover from Access follows [infrastructure](https://github.com/bubulux/fielder/blob/main/docs/infrastructure.md#cutover-from-cloudflare-access-reference-instance-epic-107).

## Local

`.secrets/` in the public checkout (gitignored) holds `access-app.json` and a short-lived Cloudflare API
token used only for Access administration from the CLI. The public checkout's `deploy.env` holds the
values above for deploying from the machine.
