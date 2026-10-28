#!/usr/bin/env node
// Writes the Grafana dashboards and alert rules (grafana/dashboards/*.json, grafana/alerts/rules.json)
// from the definitions below and instance.mjs. No dependencies.
//
//   node grafana/build.mjs          write the files
//   node grafana/build.mjs --check  fail when the committed files differ from what would be written
//
// Every panel queries Cloudflare's GraphQL Analytics API live through the Infinity data source; nothing
// is stored in Grafana. Rules that shape the code:
// - Rows are shaped with jq (Infinity's "jq-backend" parser; its plain "backend" parser reads root
//   selectors as gjson paths). A Cloudflare error is raised with jq's error(), so the panel shows it.
// - Time range and constants go into the GraphQL text itself, never into GraphQL variables: Infinity's
//   backend (which alert rules use) interpolates macros only in the query text, and alert rules have no
//   dashboard variables. The one dashboard variable in use (a D1 id found by name) is dashboard-only.
// - The API allows 300 queries per 5 minutes: one query per panel at most, panels that show another view
//   of the same data reuse it through the "-- Dashboard --" source, detail rows start collapsed (a
//   collapsed row does not query), and the dashboards do not auto-refresh.
// - Each dataset has its own window on this plan (instance audit, deploy#15): zone daily 365 days, zone
//   per host 31 days, account datasets 90 days back and at most 32 days per query, Web Analytics 184 days.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCOUNT, ENVIRONMENTS, GRAFANA, ZONES } from "./instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const check = process.argv.includes("--check");

// ---------- Query building blocks ----------
const DS = { type: "yesoreyeram-infinity-datasource", uid: GRAFANA.datasourceUid };
const REUSE_DS = { type: "datasource", uid: "-- Dashboard --" };
const FROM = "${__from:date:iso}", TO = "${__to:date:iso}";
const FROM_D = "${__from:date:YYYY-MM-DD}", TO_D = "${__to:date:YYYY-MM-DD}";
/** 15-minute buckets up to 2 days, hourly up to 10, then daily; aliased `t` so every root selector reads the same field. */
const IV = "t: $__customInterval(2d,datetimeFifteenMinutes,10d,datetimeHour,date)";
const account = (body) => `{ viewer { accounts(filter: { accountTag: "${ACCOUNT}" }) { ${body} } } }`;
const zone = (id, body) => `{ viewer { zones(filter: { zoneTag: "${id}" }) { ${body} } } }`;
const list = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
/** A bucket as a timestamp: daily buckets come as YYYY-MM-DD. */
const T = (e) => `(if (${e} | length) == 10 then ${e} + "T00:00:00Z" else ${e} end)`;
/** The groups of a dataset, as a jq stream. */
const zoneSet = (ds) => `.data.viewer.zones[]?.${ds}[]?`;
const accountSet = (ds) => `.data.viewer.accounts[]?.${ds}[]?`;
/** Cloudflare answers errors next to (or instead of) data: raise them, so the panel shows the message. */
const guard = (expr) => `if ((.errors // []) | length) > 0 then error([.errors[].message] | join("; ")) else (${expr}) end`;
const obj = (fields) => `{ ${Object.entries(fields).map(([k, v]) => `${k}: (${v})`).join(", ")} }`;
/** jq: one row per group, then optionally summed per key (`sum: { keys, values }`) and sorted. */
function rows(path, fields, { sum, sortDesc, limit } = {}) {
  let e = `[${path} | ${obj(fields)}]`;
  if (sum) e += ` | group_by([${sum.keys.map((k) => "." + k).join(", ")}]) | map(${obj({ ...Object.fromEntries(sum.keys.map((k) => [k, `.[0].${k}`])), ...Object.fromEntries(sum.values.map((v) => [v, `map(.${v}) | add`])) })})`;
  if ("time" in fields) e += " | sort_by(.time)";
  if (sortDesc) e += ` | sort_by(-.${sortDesc})`;
  if (limit) e += ` | .[:${limit}]`;
  return guard(e);
}

const col = (selector, type = "number", text = selector) => ({ selector, text, type });
const TIME = col("time", "timestamp", "Time");

function target({ query, root, columns, url = "/graphql", method = "POST", params, refId = "A" }) {
  return {
    refId, datasource: DS, type: method === "POST" ? "graphql" : "json", source: "url", url, parser: "jq-backend", format: "table",
    root_selector: root, columns,
    url_options: method === "POST"
      ? { method, body_type: "graphql", body_content_type: "application/json", body_graphql_query: query, body_graphql_variables: "" }
      : { method, ...(params ? { params } : {}) },
  };
}

// ---------- Panels ----------
let nextId = 1;
const partition = (field) => ({ id: "partitionByValues", options: { fields: [field], keepFields: false, naming: { asLabels: true } } });
const keepFields = (names) => ({ id: "filterFieldsByName", options: { include: { names } } });

/**
 * A panel. `t` is the query (or `reuse` another panel's); `split` turns a label column into one series
 * per value; `series` names those series (Grafana display-name syntax).
 */
function panel({ type = "timeseries", title, description, w = 12, h = 8, t, reuse, split, series, unit = "short", bars = false, stack = false, points = false, thresholds, transformations = [], options = {}, overrides = [], custom = {} }) {
  const id = nextId++;
  const p = {
    id, type, title, description, gridPos: { w, h },
    datasource: reuse ? REUSE_DS : DS,
    targets: reuse ? [{ refId: "A", datasource: REUSE_DS, panelId: reuse.id }] : [t],
    transformations: [...transformations, ...(split ? [partition(split)] : [])],
    fieldConfig: {
      defaults: {
        unit,
        ...(series ? { displayName: series } : {}),
        ...(thresholds ? { thresholds: { mode: "absolute", steps: [{ color: "green", value: null }, ...thresholds.map(([value, color]) => ({ value, color }))] } } : {}),
        custom: type === "timeseries"
          ? { drawStyle: bars ? "bars" : "line", lineWidth: 2, fillOpacity: bars ? 80 : 10, showPoints: points ? "always" : "never", pointSize: 5, spanNulls: false, stacking: { mode: stack ? "normal" : "none", group: "A" }, ...(thresholds ? { thresholdsStyle: { mode: "line+area" } } : {}), ...custom }
          : custom,
      },
      overrides,
    },
    options: type === "timeseries"
      ? { legend: { displayMode: "list", placement: "bottom", showLegend: true }, tooltip: { mode: "multi", sort: "desc" }, ...options }
      : options,
  };
  return p;
}
/** A table; its columns stay in the order they are defined (the parser sorts them by name). */
const table = (o) => panel({ type: "table", options: { showHeader: true, cellHeight: "sm" }, ...o, transformations: [...(o.t ? [{ id: "organize", options: { indexByName: Object.fromEntries(o.t.columns.map((c, i) => [c.text, i])), excludeByName: {}, renameByName: {} } }] : []), ...(o.transformations ?? [])] });
const stat = (o) => panel({ type: "stat", options: { reduceOptions: { calcs: ["sum"], fields: "", values: false }, colorMode: "none", graphMode: "none", textMode: "value_and_name", justifyMode: "auto", orientation: "horizontal" }, ...o });

/** Lays panels out left to right, 24 columns wide; a row starts a new line and owns what follows it. */
function layout(sections) {
  const out = [];
  let y = 0;
  for (const s of sections) {
    const row = { id: nextId++, type: "row", title: s.title, collapsed: Boolean(s.collapsed), gridPos: { h: 1, w: 24, x: 0, y }, panels: [] };
    y += 1;
    let x = 0, lineH = 0;
    const placed = s.panels.map((p) => {
      if (x + p.gridPos.w > 24) { y += lineH; x = 0; lineH = 0; }
      const q = { ...p, gridPos: { ...p.gridPos, x, y } };
      x += p.gridPos.w; lineH = Math.max(lineH, p.gridPos.h);
      return q;
    });
    y += lineH;
    if (s.collapsed) { row.panels = placed; out.push(row); } else out.push(row, ...placed);
  }
  return out;
}

function dashboard({ uid, title, description, sections, variables = [] }) {
  return {
    uid, title, description, tags: ["openclapper", "cloudflare"], editable: true, graphTooltip: 1, timezone: "utc",
    time: { from: "now-7d", to: "now" }, refresh: "", schemaVersion: 41, fiscalYearStartMonth: 0, liveNow: false, weekStart: "",
    timepicker: { refresh_intervals: ["15m", "30m", "1h"] },
    templating: { list: variables }, annotations: { list: [] }, links: [],
    panels: layout(sections),
  };
}

// ---------- Traffic ----------
const STATUS_CLASS = (e) => `((${e} / 100 | floor | tostring) + "xx")`;

function zoneDaily(z) {
  return target({
    query: zone(z.id, `httpRequests1dGroups(limit: 400, filter: { date_geq: "${FROM_D}", date_leq: "${TO_D}" }, orderBy: [date_ASC]) { dimensions { date } sum { requests pageViews threats cachedRequests bytes } uniq { uniques } }`),
    root: rows(zoneSet("httpRequests1dGroups"), { time: `.dimensions.date + "T00:00:00Z"`, requests: ".sum.requests", pageViews: ".sum.pageViews", visitors: ".uniq.uniques", threats: ".sum.threats", bytes: ".sum.bytes", cachedShare: "if .sum.requests == 0 then 0 else .sum.cachedRequests / .sum.requests end" }),
    columns: [TIME, col("requests", "number", "Requests"), col("pageViews", "number", "Page views"), col("visitors", "number", "Unique visitors"), col("threats", "number", "Threats"), col("bytes", "number", "Bandwidth"), col("cachedShare", "number", "Cached share")],
  });
}
function zoneHosts(z, { known }) {
  const hostFilter = known ? `, clientRequestHTTPHost_in: ${list(z.hosts)}` : "";
  return target({
    query: zone(z.id, `httpRequestsAdaptiveGroups(limit: 10000, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball"${hostFilter} }) { count sum { edgeResponseBytes visits } dimensions { ${IV} clientRequestHTTPHost } }`),
    root: rows(zoneSet("httpRequestsAdaptiveGroups"), { time: T(".dimensions.t"), host: ".dimensions.clientRequestHTTPHost", requests: ".count", bytes: ".sum.edgeResponseBytes", visits: ".sum.visits" }),
    columns: [TIME, col("host", "string"), col("requests", "number", "Requests"), col("bytes", "number", "Bandwidth"), col("visits", "number", "Visits")],
  });
}
function zoneStatus(z, { known }) {
  const hostFilter = known ? `, clientRequestHTTPHost_in: ${list(z.hosts)}` : "";
  return target({
    query: zone(z.id, `httpRequestsAdaptiveGroups(limit: 10000, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball"${hostFilter} }) { count dimensions { ${IV} edgeResponseStatus } }`),
    root: rows(zoneSet("httpRequestsAdaptiveGroups"), { time: T(".dimensions.t"), class: STATUS_CLASS(".dimensions.edgeResponseStatus"), requests: ".count" }, { sum: { keys: ["time","class"], values: ["requests"] } }),
    columns: [TIME, col("class", "string"), col("requests", "number", "Requests")],
  });
}

function trafficDashboard() {
  nextId = 1;
  const app = ZONES.app, org = ZONES.org;
  const appDaily = panel({ title: `${app.name}: requests, page views and visitors per day`, description: "Every host of the zone together, from Cloudflare's daily zone totals (kept a year). Today is partial. Visitors are unique per day, so they do not add up across days.", w: 16, t: zoneDaily(app), points: true, transformations: [keepFields(["Time", "Requests", "Page views", "Unique visitors"])] });
  const appTotals = stat({ title: "In the range", description: "Sums of the daily totals on the left. Bandwidth is what Cloudflare sent to visitors.", w: 8, reuse: appDaily, transformations: [keepFields(["Requests", "Page views", "Threats", "Bandwidth"])], overrides: [{ matcher: { id: "byName", options: "Bandwidth" }, properties: [{ id: "unit", value: "bytes" }] }] });
  const hosts = panel({ bars: true, stack: true, title: "Requests per host", description: "Visitor requests (no Worker subrequests) per known host. Scanners on odd ports are left out here and listed in the details row. Per host, Cloudflare keeps 31 days.", t: zoneHosts(app, { known: true }), transformations: [keepFields(["Time", "host", "Requests"])], split: "host", series: "${__field.labels.host}" });
  const hostBytes = panel({ bars: true, stack: true, title: "Bandwidth per host", description: "Bytes sent to visitors, per host.", reuse: hosts, unit: "bytes", transformations: [keepFields(["Time", "host", "Bandwidth"])], split: "host", series: "${__field.labels.host}" });
  const hostVisits = panel({ bars: true, stack: true, title: "Visits per host", description: "Cloudflare's visits: a request from another site or none, roughly a session start.", reuse: hosts, transformations: [keepFields(["Time", "host", "Visits"])], split: "host", series: "${__field.labels.host}" });
  const status = panel({ title: "Responses by status class", description: "All known hosts together.", w: 12, t: zoneStatus(app, { known: true }), bars: true, stack: true, split: "class", series: "${__field.labels.class}" });
  const errorsByHost = table({
    title: "4xx and 5xx by host and status", description: "In the range; scanners probing paths show up as 404s.", w: 12,
    t: target({
      query: zone(app.id, `httpRequestsAdaptiveGroups(limit: 200, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball", edgeResponseStatus_geq: 400 }, orderBy: [count_DESC]) { count dimensions { clientRequestHTTPHost edgeResponseStatus } }`),
      root: rows(zoneSet("httpRequestsAdaptiveGroups"), { host: ".dimensions.clientRequestHTTPHost", status: ".dimensions.edgeResponseStatus", requests: ".count" }),
      columns: [col("host", "string", "Host"), col("status", "number", "Status"), col("requests", "number", "Requests")],
    }),
  });
  const paths = table({
    title: `Top paths on ${app.hosts[0]}`, w: 8, h: 10,
    t: target({
      query: zone(app.id, `httpRequestsAdaptiveGroups(limit: 25, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball", clientRequestHTTPHost: "${app.hosts[0]}" }, orderBy: [count_DESC]) { count dimensions { clientRequestPath } }`),
      root: rows(zoneSet("httpRequestsAdaptiveGroups"), { path: ".dimensions.clientRequestPath", requests: ".count" }),
      columns: [col("path", "string", "Path"), col("requests", "number", "Requests")],
    }),
  });
  const countries = table({
    title: "Countries", description: "Every host of the zone, from the daily totals.", w: 8, h: 10,
    t: target({
      query: zone(app.id, `httpRequests1dGroups(limit: 400, filter: { date_geq: "${FROM_D}", date_leq: "${TO_D}" }) { sum { countryMap { clientCountryName requests threats } } }`),
      root: rows(`${zoneSet("httpRequests1dGroups")}.sum.countryMap[]`, { country: ".clientCountryName", requests: ".requests", threats: ".threats" }, { sum: { keys: ["country"], values: ["requests", "threats"] }, sortDesc: "requests", limit: 30 }),
      columns: [col("country", "string", "Country"), col("requests", "number", "Requests"), col("threats", "number", "Threats")],
    }),
  });
  const others = table({
    title: "Other hosts (scanners, odd ports)", description: "Requests to host names that are not ours as listed in instance.mjs, mostly bots probing ports.", w: 8, h: 10,
    t: target({
      query: zone(app.id, `httpRequestsAdaptiveGroups(limit: 25, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball", clientRequestHTTPHost_notin: ${list(app.hosts)} }, orderBy: [count_DESC]) { count dimensions { clientRequestHTTPHost } }`),
      root: rows(zoneSet("httpRequestsAdaptiveGroups"), { host: ".dimensions.clientRequestHTTPHost", requests: ".count" }),
      columns: [col("host", "string", "Host"), col("requests", "number", "Requests")],
    }),
  });
  const cache = panel({
    type: "piechart", title: "Cache status", description: "Known hosts. The Studio's assets come from the edge; the API is never cached.", w: 8, h: 10,
    t: target({
      query: zone(app.id, `httpRequestsAdaptiveGroups(limit: 50, filter: { datetime_geq: "${FROM}", datetime_leq: "${TO}", requestSource: "eyeball", clientRequestHTTPHost_in: ${list(app.hosts)} }) { count dimensions { cacheStatus } }`),
      root: rows(zoneSet("httpRequestsAdaptiveGroups"), { cache: ".dimensions.cacheStatus", requests: ".count" }),
      columns: [col("cache", "string", "Cache"), col("requests", "number", "Requests")],
    }),
    options: { reduceOptions: { values: true, calcs: ["lastNotNull"], fields: "" }, pieType: "donut", legend: { displayMode: "table", placement: "right", values: ["value", "percent"], showLegend: true }, displayLabels: [] },
  });
  const orgDaily = panel({ title: `${org.name}: requests, page views and visitors per day`, description: "The public site's zone, every host together (daily totals, kept a year). Empty until the site is deployed.", w: 12, t: zoneDaily(org), points: true, transformations: [keepFields(["Time", "Requests", "Page views", "Unique visitors"])] });
  const orgHosts = panel({ bars: true, stack: true, title: `${org.name}: requests per host`, description: "Every host name the zone answered, odd ports included.", w: 12, t: zoneHosts(org, { known: false }), transformations: [keepFields(["Time", "host", "Requests"])], split: "host", series: "${__field.labels.host}" });
  const orgStatus = panel({ title: `${org.name}: responses by status class`, w: 12, t: zoneStatus(org, { known: false }), bars: true, stack: true, split: "class", series: "${__field.labels.class}" });
  const orgBytes = panel({ bars: true, stack: true, title: `${org.name}: bandwidth per host`, w: 12, reuse: orgHosts, unit: "bytes", transformations: [keepFields(["Time", "host", "Bandwidth"])], split: "host", series: "${__field.labels.host}" });

  const rumHosts = [...ZONES.app.hosts.slice(0, 1), ...ZONES.org.hosts];
  const RUM_FILTER = `datetime_geq: "${FROM}", datetime_leq: "${TO}", requestHost_in: ${list(rumHosts)}`;
  const rumViews = panel({
    title: "Web Analytics: page views per site", description: "Cloudflare Web Analytics (the beacon in the page), not the edge logs: only real browsers that run the script count. Kept 184 days.",
    t: target({
      query: account(`rumPageloadEventsAdaptiveGroups(limit: 10000, filter: { ${RUM_FILTER} }) { count sum { visits } dimensions { ${IV} requestHost } }`),
      root: rows(accountSet("rumPageloadEventsAdaptiveGroups"), { time: T(".dimensions.t"), host: ".dimensions.requestHost", pageViews: ".count", visits: ".sum.visits" }),
      columns: [TIME, col("host", "string"), col("pageViews", "number", "Page views"), col("visits", "number", "Visits")],
    }),
    bars: true, transformations: [keepFields(["Time", "host", "Page views"])], split: "host", series: "${__field.labels.host}",
  });
  const rumLoad = panel({ points: true,
    title: "Web Analytics: page load time", description: "Median and 90th percentile of the full page load, per site.", unit: "ms",
    t: target({
      query: account(`rumPerformanceEventsAdaptiveGroups(limit: 10000, filter: { ${RUM_FILTER} }) { count quantiles { pageLoadTimeP50 pageLoadTimeP90 firstContentfulPaintP50 } dimensions { ${IV} requestHost } }`),
      root: rows(accountSet("rumPerformanceEventsAdaptiveGroups"), { time: T(".dimensions.t"), host: ".dimensions.requestHost", p50: ".quantiles.pageLoadTimeP50 / 1000", p90: ".quantiles.pageLoadTimeP90 / 1000" }),
      columns: [TIME, col("host", "string"), col("p50", "number", "p50"), col("p90", "number", "p90")],
    }),
    split: "host", series: "${__field.name} ${__field.labels.host}",
  });
  const rumTable = (title, dims, columns, rowFields) => table({
    title, w: 8, h: 10,
    t: target({
      query: account(`rumPageloadEventsAdaptiveGroups(limit: 25, filter: { ${RUM_FILTER} }, orderBy: [count_DESC]) { count sum { visits } dimensions { ${dims} } }`),
      root: rows(accountSet("rumPageloadEventsAdaptiveGroups"), { ...rowFields, pageViews: ".count", visits: ".sum.visits" }),
      columns: [...columns, col("pageViews", "number", "Page views"), col("visits", "number", "Visits")],
    }),
  });
  const rumPages = rumTable("Web Analytics: top pages", "requestHost requestPath", [col("host", "string", "Site"), col("path", "string", "Path")], { host: ".dimensions.requestHost", path: ".dimensions.requestPath" });
  const rumRefs = rumTable("Web Analytics: referrers", "requestHost refererHost", [col("host", "string", "Site"), col("referrer", "string", "Referrer")], { host: ".dimensions.requestHost", referrer: `if .dimensions.refererHost == "" then "(direct)" else .dimensions.refererHost end` });
  const rumWho = rumTable("Web Analytics: countries and devices", "countryName deviceType", [col("country", "string", "Country"), col("device", "string", "Device")], { country: ".dimensions.countryName", device: ".dimensions.deviceType" });

  return dashboard({
    uid: "oc-traffic", title: "OpenClapper · Traffic",
    description: "Visitor traffic on openclapper.app (production, admin, staging) and openclapper.org, and Cloudflare Web Analytics. Live from Cloudflare's GraphQL API; generated by grafana/build.mjs in the deploy repository.",
    sections: [
      { title: app.name, panels: [appDaily, appTotals, hosts, hostBytes, hostVisits, status, errorsByHost] },
      { title: `${app.name}: details`, collapsed: true, panels: [paths, countries, others, cache] },
      { title: org.name, panels: [orgDaily, orgHosts, orgStatus, orgBytes] },
      { title: "Web Analytics (openclapper.app, openclapper.org)", panels: [rumViews, rumLoad, rumPages, rumRefs, rumWho] },
    ],
  });
}

// ---------- Platform ----------
const R2_CLASS_A = ["PutObject", "CopyObject", "ListObjects", "ListObjectsV2", "ListBuckets", "CreateMultipartUpload", "UploadPart", "UploadPartCopy", "CompleteMultipartUpload", "ListMultipartUploads", "ListParts", "PutBucket", "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration", "LifecycleStorageTierTransition"];
const R2_CLASS_B = ["GetObject", "HeadObject", "HeadBucket", "UsageSummary", "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration"];
const ACCOUNT_RANGE = `datetime_geq: "${FROM}", datetime_leq: "${TO}"`;
const DATE_RANGE = `date_geq: "${FROM_D}", date_leq: "${TO_D}"`;
const d1Var = (env) => `d1_${env}`;

/** A hidden variable: the environment's D1 id, looked up by name on every load (staging's changes with each clone). */
function d1Variable(env, e) {
  return {
    type: "query", name: d1Var(env), label: `D1 ${env}`, hide: 2, refresh: 1, skipUrlSync: true, includeAll: false, multi: false,
    datasource: DS, current: {}, options: [], sort: 0,
    query: {
      queryType: "infinity", refId: "variable",
      infinityQuery: target({ url: `/accounts/${ACCOUNT}/d1/database`, method: "GET", params: [{ key: "name", value: e.db }], root: `if (.success == false) then error([.errors[]?.message] | join("; ")) else [.result[] | select(.name == "${e.db}") | { uuid }] end`, columns: [col("uuid", "string")], refId: "variable" }),
    },
  };
}
const dbLabel = `if .dimensions.databaseId == "\${${d1Var("production")}}" then "production" elif .dimensions.databaseId == "\${${d1Var("staging")}}" then "staging" else "earlier staging copy" end`;

function costSection() {
  const workers = panel({
    title: "Workers: requests per day, every script", description: "All Workers of the account, as Cloudflare counts them toward the plan.", bars: true, stack: true,
    t: target({
      query: account(`workersInvocationsAdaptive(limit: 10000, filter: { ${ACCOUNT_RANGE} }) { sum { requests } dimensions { date scriptName } }`),
      root: rows(accountSet("workersInvocationsAdaptive"), { time: `.dimensions.date + "T00:00:00Z"`, script: ".dimensions.scriptName", requests: ".sum.requests" }, { sum: { keys: ["time","script"], values: ["requests"] } }),
      columns: [TIME, col("script", "string"), col("requests", "number", "Requests")],
    }),
    split: "script", series: "${__field.labels.script}",
  });
  const d1Rows = panel({
    title: "D1: rows read per day, every database", description: "Earlier staging copies are the databases Recreate from production replaced.", bars: true, stack: true,
    t: target({
      query: account(`d1AnalyticsAdaptiveGroups(limit: 10000, filter: { ${DATE_RANGE} }) { sum { rowsRead rowsWritten } dimensions { date databaseId } }`),
      root: rows(accountSet("d1AnalyticsAdaptiveGroups"), { time: `.dimensions.date + "T00:00:00Z"`, database: dbLabel, read: ".sum.rowsRead", written: ".sum.rowsWritten" }, { sum: { keys: ["time","database"], values: ["read","written"] } }),
      columns: [TIME, col("database", "string"), col("read", "number", "Rows read"), col("written", "number", "Rows written")],
    }),
    transformations: [keepFields(["Time", "database", "Rows read"])], split: "database", series: "${__field.labels.database}",
  });
  const d1Written = panel({ title: "D1: rows written per day, every database", bars: true, stack: true, reuse: d1Rows, transformations: [keepFields(["Time", "database", "Rows written"])], split: "database", series: "${__field.labels.database}" });
  const r2Storage = panel({
    title: "R2: storage per bucket (stacked = the account total)", description: "Payload plus metadata, the largest sample per bucket and bucket of time. Storage is billed on the account total, every bucket together. Cloudflare samples it, so it lags uploads and deletes.", unit: "bytes", stack: true,
    t: target({
      query: account(`r2StorageAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE} }) { max { payloadSize metadataSize objectCount } dimensions { ${IV} bucketName } }`),
      root: rows(accountSet("r2StorageAdaptiveGroups"), { time: T(".dimensions.t"), bucket: ".dimensions.bucketName", bytes: ".max.payloadSize + .max.metadataSize" }),
      columns: [TIME, col("bucket", "string"), col("bytes", "number", "Bytes")],
    }),
    split: "bucket", series: "${__field.labels.bucket}", custom: { fillOpacity: 40 },
  });
  const r2Ops = panel({
    title: "R2: operations per day by class, every bucket", description: "Class A: writes and lists. Class B: reads. Deletes are free.", bars: true, stack: true,
    t: target({
      query: account(`r2OperationsAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE} }) { sum { requests } dimensions { date actionType } }`),
      root: rows(accountSet("r2OperationsAdaptiveGroups"), { time: `.dimensions.date + "T00:00:00Z"`, class: `.dimensions.actionType as $a | if (${list(R2_CLASS_A)} | index([$a])) then "Class A" elif (${list(R2_CLASS_B)} | index([$a])) then "Class B" else "Free" end`, requests: ".sum.requests" }, { sum: { keys: ["time","class"], values: ["requests"] } }),
      columns: [TIME, col("class", "string"), col("requests", "number", "Requests")],
    }),
    split: "class", series: "${__field.labels.class}",
  });
  const dos = panel({
    title: "Durable Objects: requests per day, every script", bars: true, stack: true,
    t: target({
      query: account(`durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE} }) { sum { requests } dimensions { date scriptName } }`),
      root: rows(accountSet("durableObjectsInvocationsAdaptiveGroups"), { time: `.dimensions.date + "T00:00:00Z"`, script: ".dimensions.scriptName", requests: ".sum.requests" }, { sum: { keys: ["time","script"], values: ["requests"] } }),
      columns: [TIME, col("script", "string"), col("requests", "number", "Requests")],
    }),
    split: "script", series: "${__field.labels.script}",
  });
  const d1Size = panel({
    title: "D1: size per database", unit: "bytes",
    t: target({
      query: account(`d1StorageAdaptiveGroups(limit: 10000, filter: { ${DATE_RANGE} }) { max { databaseSizeBytes } dimensions { date databaseId } }`),
      root: rows(accountSet("d1StorageAdaptiveGroups"), { time: `.dimensions.date + "T00:00:00Z"`, database: dbLabel, bytes: ".max.databaseSizeBytes" }, { sum: { keys: ["time","database"], values: ["bytes"] } }),
      columns: [TIME, col("database", "string"), col("bytes", "number", "Bytes")],
    }),
    split: "database", series: "${__field.labels.database}",
  });
  return { title: "Cost: every environment together", panels: [workers, dos, d1Rows, d1Written, r2Storage, r2Ops, d1Size] };
}

function environmentSections(env, e, expanded) {
  const scripts = [e.api, e.admin];
  const workersQ = target({
    query: account(`workersInvocationsAdaptive(limit: 10000, filter: { ${ACCOUNT_RANGE}, scriptName_in: ${list(scripts)} }) { sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 } dimensions { ${IV} scriptName } }`),
    root: rows(accountSet("workersInvocationsAdaptive"), { time: T(".dimensions.t"), script: ".dimensions.scriptName", requests: ".sum.requests", subrequests: ".sum.subrequests", cpuP50: ".quantiles.cpuTimeP50 / 1000", cpuP99: ".quantiles.cpuTimeP99 / 1000", wallP50: ".quantiles.wallTimeP50 / 1000", wallP99: ".quantiles.wallTimeP99 / 1000" }),
    columns: [TIME, col("script", "string"), col("requests", "number", "Requests"), col("subrequests", "number", "Subrequests"), col("cpuP50", "number", "CPU p50"), col("cpuP99", "number", "CPU p99"), col("wallP50", "number", "Wall p50"), col("wallP99", "number", "Wall p99")],
  });
  const requests = panel({ bars: true, stack: true, title: `${e.title}: Worker requests`, description: `${e.api} (API and Studio) and ${e.admin} (admin plane).`, w: 12, t: workersQ, transformations: [keepFields(["Time", "script", "Requests"])], split: "script", series: "${__field.labels.script}" });
  const outcomes = panel({
    title: `${e.title}: Worker invocations that did not succeed`, description: "By outcome: an exception, exceeded CPU or memory, the client went away, …", w: 12, bars: true, stack: true,
    t: target({
      query: account(`workersInvocationsAdaptive(limit: 10000, filter: { ${ACCOUNT_RANGE}, scriptName_in: ${list(scripts)}, status_neq: "success" }) { sum { requests } dimensions { ${IV} scriptName status } }`),
      root: rows(accountSet("workersInvocationsAdaptive"), { time: T(".dimensions.t"), outcome: `.dimensions.scriptName + " · " + .dimensions.status`, requests: ".sum.requests" }),
      columns: [TIME, col("outcome", "string"), col("requests", "number", "Requests")],
    }),
    split: "outcome", series: "${__field.labels.outcome}",
  });
  const cpu = panel({ points: true, title: `${e.title}: Worker CPU time`, description: "Median and 99th percentile per script. The Workers free plan stops a request at 10 ms of CPU.", w: 12, unit: "ms", reuse: requests, thresholds: [[10, "red"]], transformations: [keepFields(["Time", "script", "CPU p50", "CPU p99"])], split: "script", series: "${__field.name} ${__field.labels.script}" });
  const wall = panel({ points: true, title: `${e.title}: Worker wall time`, description: "Median and 99th percentile per script, waiting on D1 and R2 included.", w: 12, unit: "ms", reuse: requests, transformations: [keepFields(["Time", "script", "Wall p50", "Wall p99"])], split: "script", series: "${__field.name} ${__field.labels.script}" });

  const db = `\${${d1Var(env)}}`;
  const d1Q = target({
    query: account(`d1AnalyticsAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE}, databaseId: "${db}" }) { sum { rowsRead rowsWritten readQueries writeQueries } quantiles { queryBatchTimeMsP50 queryBatchTimeMsP90 } dimensions { ${IV} } }`),
    root: rows(accountSet("d1AnalyticsAdaptiveGroups"), { time: T(".dimensions.t"), read: ".sum.rowsRead", written: ".sum.rowsWritten", readQueries: ".sum.readQueries", writeQueries: ".sum.writeQueries", p50: ".quantiles.queryBatchTimeMsP50", p90: ".quantiles.queryBatchTimeMsP90" }),
    columns: [TIME, col("read", "number", "Rows read"), col("written", "number", "Rows written"), col("readQueries", "number", "Read queries"), col("writeQueries", "number", "Write queries"), col("p50", "number", "Batch p50"), col("p90", "number", "Batch p90")],
  });
  const d1Rows = panel({ bars: true, title: `${e.title}: D1 rows`, description: `${e.db}, found by name.`, w: 8, t: d1Q, transformations: [keepFields(["Time", "Rows read", "Rows written"])] });
  const d1Queries = panel({ bars: true, title: `${e.title}: D1 queries`, w: 8, reuse: d1Rows, transformations: [keepFields(["Time", "Read queries", "Write queries"])] });
  const d1Latency = panel({ points: true, title: `${e.title}: D1 batch time`, description: "Time inside the database per batch of statements, median and 90th percentile.", w: 8, unit: "ms", reuse: d1Rows, transformations: [keepFields(["Time", "Batch p50", "Batch p90"])] });
  const d1Top = table({
    title: `${e.title}: D1 statements by total time`, description: "The statements that cost the most database time in the range; average per run next to it.", w: 24, h: 10,
    t: target({
      query: account(`d1QueriesAdaptiveGroups(limit: 25, filter: { ${ACCOUNT_RANGE}, databaseId: "${db}" }, orderBy: [sum_queryDurationMs_DESC]) { count sum { queryDurationMs rowsRead rowsWritten } dimensions { query } }`),
      root: rows(accountSet("d1QueriesAdaptiveGroups"), { query: ".dimensions.query", runs: ".count", totalMs: ".sum.queryDurationMs", avgMs: "if .count == 0 then 0 else .sum.queryDurationMs / .count end", rowsRead: ".sum.rowsRead", rowsWritten: ".sum.rowsWritten" }),
      columns: [col("query", "string", "Statement"), col("runs", "number", "Runs"), col("totalMs", "number", "Total ms"), col("avgMs", "number", "Avg ms"), col("rowsRead", "number", "Rows read"), col("rowsWritten", "number", "Rows written")],
    }),
    overrides: [{ matcher: { id: "byName", options: "Statement" }, properties: [{ id: "custom.width", value: 640 }] }, { matcher: { id: "byRegexp", options: "Total ms|Avg ms" }, properties: [{ id: "decimals", value: 2 }] }],
  });

  const r2Q = target({
    query: account(`r2StorageAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE}, bucketName: "${e.bucket}" }) { max { payloadSize metadataSize objectCount } dimensions { ${IV} } }`),
    root: rows(accountSet("r2StorageAdaptiveGroups"), { time: T(".dimensions.t"), bytes: ".max.payloadSize + .max.metadataSize", objects: ".max.objectCount" }),
    columns: [TIME, col("bytes", "number", "Bytes"), col("objects", "number", "Objects")],
  });
  const r2Bytes = panel({ title: `${e.title}: R2 storage`, description: `${e.bucket}: payload plus metadata, sampled.`, w: 8, unit: "bytes", t: r2Q, transformations: [keepFields(["Time", "Bytes"])] });
  const r2Objects = panel({ title: `${e.title}: R2 objects`, w: 8, reuse: r2Bytes, transformations: [keepFields(["Time", "Objects"])] });
  const r2Ops = panel({
    title: `${e.title}: R2 operations by type`, w: 8, bars: true, stack: true,
    t: target({
      query: account(`r2OperationsAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE}, bucketName: "${e.bucket}" }) { sum { requests } dimensions { ${IV} actionType } }`),
      root: rows(accountSet("r2OperationsAdaptiveGroups"), { time: T(".dimensions.t"), action: ".dimensions.actionType", requests: ".sum.requests" }),
      columns: [TIME, col("action", "string"), col("requests", "number", "Requests")],
    }),
    split: "action", series: "${__field.labels.action}",
  });
  const r2Failed = table({
    title: `${e.title}: R2 operations that failed`, w: 24, h: 6,
    t: target({
      query: account(`r2OperationsAdaptiveGroups(limit: 100, filter: { ${ACCOUNT_RANGE}, bucketName: "${e.bucket}", actionStatus_neq: "success" }, orderBy: [sum_requests_DESC]) { sum { requests } dimensions { actionType actionStatus responseStatusCode } }`),
      root: rows(accountSet("r2OperationsAdaptiveGroups"), { action: ".dimensions.actionType", status: ".dimensions.actionStatus", code: ".dimensions.responseStatusCode", requests: ".sum.requests" }),
      columns: [col("action", "string", "Operation"), col("status", "string", "Status"), col("code", "number", "HTTP"), col("requests", "number", "Requests")],
    }),
  });

  const doQ = target({
    query: account(`durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { ${ACCOUNT_RANGE}, scriptName: "${e.api}" }) { sum { requests errors } quantiles { wallTimeP50 wallTimeP99 } dimensions { ${IV} } }`),
    root: rows(accountSet("durableObjectsInvocationsAdaptiveGroups"), { time: T(".dimensions.t"), requests: ".sum.requests", errors: ".sum.errors", p50: ".quantiles.wallTimeP50 / 1000", p99: ".quantiles.wallTimeP99 / 1000" }),
    columns: [TIME, col("requests", "number", "Requests"), col("errors", "number", "Errors"), col("p50", "number", "Wall p50"), col("p99", "number", "Wall p99")],
  });
  const doReq = panel({ bars: true, title: `${e.title}: Durable Object requests and errors`, description: "The live layout preview rooms (PreviewRoom) of the API Worker.", w: 12, t: doQ, transformations: [keepFields(["Time", "Requests", "Errors"])] });
  const doWall = panel({ points: true, title: `${e.title}: Durable Object wall time`, description: "A preview websocket stays open while the Studio previews, so long wall times are normal.", w: 12, unit: "ms", reuse: doReq, transformations: [keepFields(["Time", "Wall p50", "Wall p99"])] });

  return [
    { title: `${e.title} · Workers`, collapsed: !expanded, panels: [requests, outcomes, cpu, wall] },
    { title: `${e.title} · D1`, collapsed: true, panels: [d1Rows, d1Queries, d1Latency, d1Top] },
    { title: `${e.title} · R2`, collapsed: true, panels: [r2Bytes, r2Objects, r2Ops, r2Failed] },
    { title: `${e.title} · Durable Objects`, collapsed: true, panels: [doReq, doWall] },
  ];
}

function platformDashboard() {
  nextId = 1;
  const sections = [costSection()];
  for (const [env, e] of Object.entries(ENVIRONMENTS)) sections.push(...environmentSections(env, e, env === "production"));
  return dashboard({
    uid: "oc-platform", title: "OpenClapper · Platform",
    description: "Workers, D1, R2 and Durable Objects: the account-wide totals Cloudflare bills on, then each environment on its own resources for debugging. Ranges over 32 days fail on the per-resource panels (Cloudflare's limit per query). Generated by grafana/build.mjs in the deploy repository.",
    variables: Object.entries(ENVIRONMENTS).map(([env, e]) => d1Variable(env, e)),
    sections,
  });
}

// ---------- Alert rules (production only) ----------
/** One alert rule: query A gives one number, B takes it, C compares. Constants only: no dashboard variables here. */
function rule({ uid, title, summary, query, root, above, minutes = 60 }) {
  const a = target({ query, root, columns: [col("value")] });
  return {
    uid, title, condition: "C", for: "0s", noDataState: "OK", execErrState: "Error",
    annotations: { summary, description: `Checked every ${GRAFANA.ruleInterval} over the last ${minutes} minutes. Dashboard: OpenClapper · Platform or Traffic.` },
    labels: { instance: "production" },
    data: [
      { refId: "A", datasourceUid: GRAFANA.datasourceUid, queryType: "", relativeTimeRange: { from: minutes * 60, to: 0 }, model: { ...a, datasource: DS, intervalMs: 60000, maxDataPoints: 43200 } },
      { refId: "B", datasourceUid: "__expr__", queryType: "", relativeTimeRange: { from: 0, to: 0 }, model: { refId: "B", type: "reduce", expression: "A", reducer: "last", settings: { mode: "replaceNN", replaceWithValue: 0 }, datasource: { type: "__expr__", uid: "__expr__" } } },
      { refId: "C", datasourceUid: "__expr__", queryType: "", relativeTimeRange: { from: 0, to: 0 }, model: { refId: "C", type: "threshold", expression: "B", conditions: [{ evaluator: { type: "gt", params: [above] } }], datasource: { type: "__expr__", uid: "__expr__" } } },
    ],
  };
}

function alertRules() {
  const p = ENVIRONMENTS.production;
  return {
    title: GRAFANA.ruleGroup, folderUid: GRAFANA.folderUid, interval: 15 * 60,
    rules: [
      rule({
        uid: "oc-api-errors", title: "Production API: Worker errors", above: 0,
        summary: `${p.api} had invocations that ended in an error in the last hour.`,
        query: account(`workersInvocationsAdaptive(limit: 100, filter: { ${ACCOUNT_RANGE}, scriptName: "${p.api}" }) { sum { errors } }`),
        root: guard(`[{ value: ([${accountSet("workersInvocationsAdaptive")} | .sum.errors] | add // 0) }]`),
      }),
      rule({
        uid: "oc-api-cpu", title: "Production API: CPU p99 above 10 ms", above: 10,
        summary: `${p.api}'s 99th percentile CPU time was above 10 ms in the last hour, the Workers free plan's limit per request.`,
        query: account(`workersInvocationsAdaptive(limit: 10, filter: { ${ACCOUNT_RANGE}, scriptName: "${p.api}" }) { quantiles { cpuTimeP99 } }`),
        root: guard(`[{ value: (([${accountSet("workersInvocationsAdaptive")} | .quantiles.cpuTimeP99] | max // 0) / 1000) }]`),
      }),
      rule({
        uid: "oc-app-5xx", title: `${ZONES.app.hosts[0]}: 5xx share above 5 %`, above: 5,
        summary: `More than 5 % of the requests to ${ZONES.app.hosts[0]} answered 5xx in the last hour (at least 20 requests).`,
        query: zone(ZONES.app.id, `httpRequestsAdaptiveGroups(limit: 100, filter: { ${ACCOUNT_RANGE}, requestSource: "eyeball", clientRequestHTTPHost: "${ZONES.app.hosts[0]}" }) { count dimensions { edgeResponseStatus } }`),
        root: guard(`[${zoneSet("httpRequestsAdaptiveGroups")}] as $g | ($g | map(.count) | add // 0) as $all | [{ value: (if $all < 20 then 0 else 100 * ($g | map(select(.dimensions.edgeResponseStatus >= 500) | .count) | add // 0) / $all end) }]`),
      }),
    ],
  };
}

// ---------- Write ----------
const outputs = {
  "dashboards/traffic.json": trafficDashboard(),
  "dashboards/platform.json": platformDashboard(),
  "alerts/rules.json": alertRules(),
};
let stale = 0;
for (const [rel, obj] of Object.entries(outputs)) {
  const path = join(here, rel);
  const text = `${JSON.stringify(obj, null, 2)}\n`;
  if (check) {
    let current = "";
    try { current = readFileSync(path, "utf8"); } catch { /* missing */ }
    if (current !== text) { console.error(`grafana/${rel} is not up to date: run node grafana/build.mjs`); stale++; }
  } else {
    writeFileSync(path, text);
    console.log(`wrote grafana/${rel}`);
  }
}
if (stale) process.exit(1);
