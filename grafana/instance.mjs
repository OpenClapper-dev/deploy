// The instance the dashboards look at: one Cloudflare account, two zones, two environments.
// Identifiers only, nothing secret (docs/instance.md names them too). Change here, then run build.mjs.

export const ACCOUNT = "3868cbc17be171c90972dd32e41e7783";

/** Zones with their hosts. openclapper.org carries the public site from late October 2026. */
export const ZONES = {
  app: { id: "229c2121dbd38d2df02496f515c8c7b4", name: "openclapper.app", hosts: ["openclapper.app", "admin.openclapper.app", "staging.openclapper.app", "staging-admin.openclapper.app"] },
  org: { id: "9adc703717aec978ff419ff8563841de", name: "openclapper.org", hosts: ["openclapper.org", "www.openclapper.org"] },
};

/**
 * Each environment's resources. The D1 database is named, not pinned: staging's id changes with every
 * Staging · Recreate from production, so the dashboard looks the id up by name when it loads.
 */
export const ENVIRONMENTS = {
  production: { title: "Production", api: "openclapper-api", admin: "openclapper-admin", bucket: "openclapper-media", db: "openclapper-db" },
  staging: { title: "Staging", api: "openclapper-staging-api", admin: "openclapper-staging-admin", bucket: "openclapper-staging-media", db: "openclapper-staging-db" },
};

/** Grafana side: where everything lands. The data source uid is what every panel refers to. */
export const GRAFANA = { folderUid: "openclapper", folderTitle: "OpenClapper", datasourceUid: "cloudflare-analytics", datasourceName: "Cloudflare analytics", ruleGroup: "openclapper", ruleInterval: "15m" };
