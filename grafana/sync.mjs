#!/usr/bin/env node
// Pushes the generated dashboards and alert rules to a Grafana stack, with the Cloudflare data source
// they read from. Idempotent: run it after every change (the Grafana · Sync workflow does).
//
//   GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=… CF_GRAFANA_TOKEN=… node grafana/sync.mjs
//
// In the workflow these come from the monitoring environment (README.md).
// GRAFANA_TOKEN: a service account token of the stack with the Admin role (it writes the data source).
// CF_GRAFANA_TOKEN: the read-only Cloudflare API token the data source sends (README.md).
// The Infinity plugin must be installed on the stack; the script stops with a hint when it is not.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAFANA } from "./instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const need = (name) => process.env[name] || (console.error(`sync: ${name} is not set`), process.exit(1));
const base = need("GRAFANA_URL").replace(/\/+$/, "");
const token = need("GRAFANA_TOKEN");
const cfToken = need("CF_GRAFANA_TOKEN");
const json = (rel) => JSON.parse(readFileSync(join(here, rel), "utf8"));

/** One Grafana API call; a non-2xx answer stops the sync with what Grafana said. 404 is returned when allowed. */
async function api(method, path, body, { allow404 = false, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (allow404 && res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) { console.error(`sync: ${method} ${path} answered ${res.status}: ${text.slice(0, 500)}`); process.exit(1); }
  return text ? JSON.parse(text) : null;
}

// 1. The plugin.
if (!(await api("GET", "/api/plugins/yesoreyeram-infinity-datasource/settings", undefined, { allow404: true }))) {
  console.error("sync: the Infinity plugin is not installed on this stack (Administration → Plugins → Infinity → Install), then run again");
  process.exit(1);
}

// 2. The folder.
if (!(await api("GET", `/api/folders/${GRAFANA.folderUid}`, undefined, { allow404: true }))) {
  await api("POST", "/api/folders", { uid: GRAFANA.folderUid, title: GRAFANA.folderTitle });
  console.log(`sync: folder ${GRAFANA.folderTitle} created`);
}

// 3. The data source: Cloudflare's API with the read-only token, and nothing else reachable through it.
const datasource = {
  uid: GRAFANA.datasourceUid, name: GRAFANA.datasourceName, type: "yesoreyeram-infinity-datasource", access: "proxy",
  url: "https://api.cloudflare.com/client/v4", isDefault: false,
  jsonData: { auth_method: "bearerToken", allowedHosts: ["https://api.cloudflare.com"], timeoutInSeconds: 60, global_queries: [] },
  secureJsonData: { bearerToken: cfToken },
};
const existing = await api("GET", `/api/datasources/uid/${GRAFANA.datasourceUid}`, undefined, { allow404: true });
if (existing) await api("PUT", `/api/datasources/uid/${GRAFANA.datasourceUid}`, { ...datasource, id: existing.id, version: existing.version });
else await api("POST", "/api/datasources", datasource);
console.log(`sync: data source ${GRAFANA.datasourceName} ${existing ? "updated" : "created"}`);

// 4. The dashboards, replaced as a whole (edits made in the UI are overwritten: change build.mjs instead).
for (const file of ["traffic", "platform"]) {
  const dashboard = json(`dashboards/${file}.json`);
  await api("POST", "/api/dashboards/db", { dashboard: { ...dashboard, id: null }, folderUid: GRAFANA.folderUid, overwrite: true, message: "grafana/sync.mjs" });
  console.log(`sync: dashboard ${dashboard.title}`);
}

// 5. The alert rules: the whole group, replaced. Provenance off, so a rule can be paused in the UI.
const group = json("alerts/rules.json");
await api("PUT", `/api/v1/provisioning/folder/${GRAFANA.folderUid}/rule-groups/${encodeURIComponent(group.title)}`, group, { headers: { "X-Disable-Provenance": "true" } });
console.log(`sync: ${group.rules.length} alert rules in group ${group.title}, every ${group.interval / 60} minutes`);
