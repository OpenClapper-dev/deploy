# Grafana

Operational monitoring of this instance (production, staging, openclapper.org) on a Grafana Cloud free
stack: two dashboards and three alert rules, all reading Cloudflare's GraphQL Analytics API live through
the Infinity data source. Nothing is ingested into Grafana. Issue [#15](https://github.com/OpenClapper-dev/deploy/issues/15).

Core has its own, product-level monitoring in the admin plane (storage per workspace, the operator's marks).
This is the operations side and belongs to this instance only.

## What is on it

**OpenClapper · Traffic**
- openclapper.app: requests, page views and unique visitors per day (all hosts, kept a year); requests,
  bandwidth and visits per host (openclapper.app, admin, staging, staging-admin; 31 days); responses by
  status class; 4xx and 5xx by host and status.
- openclapper.app details (collapsed): top paths, countries, other host names (scanners on odd ports),
  cache status.
- openclapper.org: the same daily and per-host view, empty until the site is deployed.
- Web Analytics (the beacon in the page, kept 184 days): page views and load time per site, top pages,
  referrers, countries and devices. Web Analytics must be enabled per site in Cloudflare
  (Web Analytics → Add a site); openclapper.app has it, openclapper.org needs it once it is live.

**OpenClapper · Platform**
- Cost (every environment together, as Cloudflare bills): Workers and Durable Object requests per script,
  D1 rows read and written and size per database, R2 storage per bucket (stacked = the account total) and
  operations by class.
- Production and Staging, a row per service (Workers expanded for production, the rest collapsed):
  - Workers: requests per script, invocations that did not succeed by outcome, CPU p50/p99 against the
    free plan's 10 ms, wall time p50/p99;
  - D1: rows, queries, batch time p50/p90, **the statements with the most total time**;
  - R2: storage, objects, operations by type, failed operations;
  - Durable Objects: requests and errors, wall time.
  The D1 database is found by name when the dashboard loads (a hidden variable on the D1 list): staging's id
  changes with every *Staging · Recreate from production*.

**Alerts** (folder OpenClapper, group `openclapper`, every 15 minutes, production only): API Worker errors in
the last hour, API CPU p99 above 10 ms, 5xx share on openclapper.app above 5 % (from 20 requests). They go
to the stack's default contact point.

## Limits that shape it

| Dataset | Kept | Longest range per query |
| --- | --- | --- |
| Zone, daily | 365 days | a year |
| Zone, per host (adaptive) | 31 days | 30 days |
| Workers, D1, R2, Durable Objects | 90 days | 32 days |
| Web Analytics | 184 days | 93 days |

A dashboard range above 30 days fails on the per-host and per-resource panels; the daily panels go further.
Cloudflare's GraphQL API allows 300 queries per 5 minutes. Opening Traffic costs 12 queries and Platform 8;
the collapsed rows query only when opened, and the dashboards do not refresh by themselves.

Grafana Cloud Free: 3 users, alerting, 14-day retention (irrelevant here: nothing is stored).

## How it is built

- `instance.mjs`: the identifiers (account, zones, each environment's Workers, bucket and database name).
- `build.mjs`: the panels and rules, written to `dashboards/*.json` and `alerts/rules.json`. Run
  `node grafana/build.mjs` after a change and commit the JSON with it.
- `sync.mjs`: pushes the data source, the dashboards and the rules to the stack. The **Grafana · Sync**
  workflow runs it, after checking that the committed JSON is what `build.mjs` writes.

Choices that are easy to undo by accident:
- Rows are shaped with jq (Infinity's `jq-backend` parser). Its plain `backend` parser reads the root
  selector as a gjson path, not JSONata as its docs say. A Cloudflare error is raised with jq's `error()`,
  so the panel shows Cloudflare's message.
- Time ranges and constants are written into the GraphQL text, never into GraphQL variables: Infinity's
  backend, which alert rules use, interpolates `${__from:date:iso}` and `$__customInterval(…)` only there,
  and alert rules have no dashboard variables.
- The bucket size follows the range: 15 minutes up to 2 days, hourly up to 10, then daily (aliased `t`).
- Edits made in Grafana's UI are overwritten by the next sync: change `build.mjs` instead.

## Setting it up

1. A Grafana Cloud account and a free stack (`https://<stack>.grafana.net`). Install the **Infinity** plugin
   on it (Administration → Plugins and data → Plugins → Infinity → Install).
2. In the stack: Administration → Users and access → Service accounts → Add, role **Admin** (it writes the
   data source), then Add service account token.
3. A Cloudflare API token (My Profile → API Tokens → Create Token → Custom token), read-only:
   **Account · Account Analytics · Read**, **Account · D1 · Read** (to find the databases by name),
   **Zone · Analytics · Read** on all zones of the account.
4. This repository → Settings → Environments → New environment `monitoring` (deployment branches: `main`):
   the variable `GRAFANA_URL` (the stack's address) and the secrets `GRAFANA_TOKEN` (step 2) and
   `CF_GRAFANA_TOKEN` (step 3).
5. Actions → **Grafana · Sync** → Run workflow.
6. In Grafana: Alerting → Contact points → the default email contact point → your address.

To rotate either token: replace the secret and run the sync again.
