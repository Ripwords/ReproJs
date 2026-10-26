import { defineManifest } from "@crxjs/vite-plugin"
import pkg from "./package.json" with { type: "json" }

export default defineManifest({
  manifest_version: 3,
  name: "Repro Tester (E2E)",
  version: pkg.version,
  permissions: ["storage", "scripting", "activeTab", "tabs", "webNavigation"],
  host_permissions: ["<all_urls>"],
  icons: {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  background: {
    service_worker: "src/service-worker/index.ts",
    type: "module",
  },
  action: { default_popup: "index.html" },
  options_page: "options.html",
  // No web_accessible_resources — matches the production manifest.
})
