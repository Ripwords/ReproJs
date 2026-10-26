import { defineManifest } from "@crxjs/vite-plugin"
import pkg from "./package.json" with { type: "json" }

export default defineManifest({
  manifest_version: 3,
  name: "Repro Tester",
  description: "Inject the Repro SDK into configured origins for internal QA.",
  version: pkg.version,
  permissions: ["storage", "scripting", "activeTab", "tabs", "webNavigation"],
  host_permissions: [],
  optional_host_permissions: ["<all_urls>"],
  icons: {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png",
  },
  background: {
    service_worker: "src/service-worker/index.ts",
    type: "module",
  },
  action: {
    default_popup: "index.html",
    default_icon: {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png",
    },
  },
  options_page: "options.html",
  // M4: no web_accessible_resources. chrome.scripting.executeScript({
  // files }) from the service worker loads the SDK IIFE directly
  // without needing to expose it to page-initiated fetches. Omitting
  // this prevents fingerprinting via `fetch("chrome-extension://<id>/
  // repro.iife.js")` from arbitrary pages.
})
