# Tester extension

**Repro Tester** is a Chrome extension that lets your QA team run the Repro widget on websites they need to test but **don't control** — staging builds owned by another team, a customer preview, a third-party app, anywhere the SDK hasn't been embedded yet.

It does not replace the `<script>` embed. Real users on customer sites always get the SDK through the embed; the extension is for internal testers only.

::: tip Looking for the end-user guide?
This page is the technical reference. If you're a **tester** who just needs to install the extension and file bug reports, see [**Filing a bug report**](/guide/filing-reports) instead — same content, written for non-technical readers.
:::

## When to use it

Reach for the extension when:

- You need to file a bug report from a page where the SDK isn't installed and you can't ship a new build fast enough.
- You're doing pre-launch QA and the team hasn't added Repro to the site yet.
- You're exercising a third-party integration (SSO provider, checkout widget, CMS preview) that you don't control.

Use the `<script>` embed instead when:

- The site is yours and customer-facing end users need to file reports too. The extension won't help your users — only your testers.
- You want reports attributed to real browsers without Chrome, extension-mode workarounds, or "was this a tester or a real user?" ambiguity.

## How it works

The extension injects the same `@reprojs/core` SDK the embed uses. Behaviour-wise, a report from the extension and a report from an embed land in the same inbox with the same context bundle (annotated screenshot, 30-second replay, logs, system info). The only practical differences:

1. **The tester adds an origin to the extension once**, instead of the host app including a `<script>` tag.
2. **The SDK's intake POST is proxied through the extension service worker** so that on CSP-strict hosts (Next.js dev with `connect-src 'self'`, Vercel preview deployments, etc.) the report submission isn't blocked by `Content-Security-Policy`.

The proxy runs on top of the existing origin allowlist — a report is still only accepted if the page's origin is on the project's allowed-origins list, same as the embed path.

## Install

Published on the Chrome Web Store — install in one click:

> 🧩 **[Repro Tester on the Chrome Web Store](https://chromewebstore.google.com/detail/repro-tester/kiedhhobipcjkgiljemcmmmnfcbcmjbg)**

Chrome handles updates automatically; your testers always get the latest build.

### Install unpacked (for local development)

Need to test a dev build before it ships to the store, or don't want to run the Web Store listing? Install unpacked from a zip:

1. Download `repro-tester-vX.Y.Z.zip` from the [GitHub releases page](https://github.com/Ripwords/ReproJs/releases).
2. Unzip it to a **stable** location — Chrome re-reads the folder on every browser launch, so don't put it in `/tmp` or a download-reaper directory. `~/Documents/repro-tester/` is fine.
3. Open `chrome://extensions`.
4. Toggle **Developer mode** on (top right).
5. Click **Load unpacked** and select the unzipped folder.
6. A "Repro Tester" tile appears. The extension icon lands in your Chrome toolbar (you may need to pin it from the puzzle-piece overflow menu).

## Configure an origin

1. Click the extension icon in the toolbar.
2. Click **+ New origin**.
3. Fill the form:
   - **Label** — anything you'll recognize, e.g. `staging`.
   - **Origin** — the site you want to test on, as scheme + host + port (no path). Example: `https://staging.acme.com` or `http://localhost:3000`.
   - **Project key** — from your dashboard's project settings. Format: `rp_pk_` + 24 characters.
   - **Intake endpoint** — your dashboard's URL, e.g. `https://feedback.example.com` (the SDK appends `/api/intake/reports` itself).
4. Click **Add origin**.
5. Chrome shows a native two-origin permission prompt asking for access to the site AND the intake endpoint host. Accept both.
6. Open a new tab at the configured origin — the Repro launcher appears bottom-right.

The extension remembers the last intake endpoint you used and pre-fills it on the next Add, so adding several test sites that point at the same dashboard doesn't require retyping.

### Dashboard-side: allow the origin

Add the page origin to your project's **Allowed origins** in the dashboard (Settings → Project → Allowed origins) — same entry you'd add for a regular embed. Reports from the extension are checked against this list.

## Permissions

The extension ships with **no** baked-in host permissions — the manifest declares `host_permissions: []` and lists `<all_urls>` as `optional_host_permissions`. This means:

- On install, Chrome does not grant access to any site.
- Access is requested **per-origin, at runtime**, only when a tester adds a config.
- The tester can revoke access for any origin from `chrome://extensions` without uninstalling the extension.

The `chrome://extensions` listing will still show "Read and change all your data on websites you visit" as a warning string — that's Chrome's wording for any extension declaring `optional_host_permissions: ["<all_urls>"]`. It does not mean the extension has that access; it means it can *request* specific subsets of that access interactively.

Other permissions:

| Permission | What it's for |
| --- | --- |
| `storage` | Stores the tester's local list of `{ label, origin, project key, intake endpoint }` entries. Never transmitted. |
| `scripting` | Injects the bundled SDK into pages whose origin the tester has configured + granted permission for. |
| `activeTab` | Ensures the SDK can run on the current tab when the user interacts with the extension. |
| `tabs` | Lets the service worker observe `tabs.onUpdated` as a fallback injection trigger once a page reports `complete`. Only the URL is read; tab titles, favicons, and content are not accessed. |
| `webNavigation` | Lets the service worker inject as soon as the page's DOM is parsed (`onDOMContentLoaded`) instead of waiting for every image and long-poll request to finish. Without it, pages that never reach `complete` would never get the launcher. Only the tab id, frame id, and URL of the navigation are read. |

## Data flow

On submission:

1. User clicks the launcher, annotates a screenshot, writes a description, clicks Send.
2. The SDK builds the report (title + description + annotated screenshot + session replay bytes + log bundle + system info) and calls `fetch(intakeEndpoint + "/api/intake/reports", ...)`.
3. The extension has replaced `window.fetch` in the page's MAIN world with a proxy. The proxy notices the URL matches the configured intake endpoint and, instead of hitting the network, posts a message to an ISOLATED-world content script the extension injected alongside the SDK.
4. The ISOLATED-world script relays the message to the extension service worker via `chrome.runtime.sendMessage`.
5. The service worker validates the request — sender tab, target URL must match one of its stored configs, only paths under `/api/intake/*` are allowed — then `fetch`es the intake from the extension's own origin (which isn't subject to the page's Content-Security-Policy).
6. The service worker attaches `X-Repro-Origin: <the tab's real origin>` (derived from `sender.tab.url`, Chrome-set, unforgeable) because the browser otherwise fixes `Origin` to `chrome-extension://<id>` on extension-initiated fetches.
7. The dashboard's intake endpoint sees `Origin: chrome-extension://<id>` → falls back to `X-Repro-Origin` → checks it against the project's allowed-origins list → on pass, accepts the report.

Reports from the extension are attributed in the dashboard exactly like embed reports — the page origin is stored, not the extension ID.

## Security notes

- **No remote code.** The SDK is bundled into the extension zip at build time. The extension never fetches JavaScript at runtime. Manifest V3 forbids remote code execution anyway, but we don't rely on that; our build is architecturally incapable of loading off-origin scripts.
- **Proxy is not an open relay.** The service worker only forwards fetches whose target URL matches a stored config's intake endpoint AND whose path starts with `/api/intake/`. A script on an origin the extension has permission for cannot use the extension to reach internal intranet URLs or other endpoints on the intake host.
- **X-Repro-Origin cannot be forged from a webpage.** Only installed browser extensions can produce requests with `Origin: chrome-extension://*`, and only the extension service worker sets `X-Repro-Origin`. A malicious webpage with a leaked project key still has to pass the raw-Origin allowlist check like any regular client.
- **Closed Shadow DOM.** The widget renders inside a closed shadow root, so host-page scripts cannot reach into the widget DOM to read annotations, form fields, or in-flight report contents.
- **Sensitive-input masking.** The session replay recorder masks `<input type="password">`, any element tagged `data-repro-mask`, and (configurably) all text inputs. Input *values* never ride in the replay stream.
- **Privacy policy:** see [the privacy page](/privacy).

## Troubleshooting

### "Origin not allowed" on submit

The page origin isn't in the project's allowed-origins list. Add it in the dashboard (Settings → Project → Allowed origins) exactly as it appears in the browser URL bar — same scheme, same port.

### The launcher doesn't appear on a configured origin

- **Permission revoked.** Open the popup. If the config card shows an amber stripe with "Permission required", click **Grant** and accept the Chrome prompt. This covers both the site origin and the intake endpoint host — the extension refuses to inject when either is missing and logs `host permission missing for intake …` in the service worker console, because a widget that mounts but cannot submit is worse than no widget.
- **Service worker stale.** Open `chrome://extensions`, find Repro Tester, click the blue "service worker" link, Inspect. If there are errors there, a hard-reload of the extension (click the reload icon on its card) usually fixes it.
- **Wrong SDK build.** On every successful boot the page console prints `[repro-extension] Repro SDK vX.Y.Z booted`. If that version is older than you expect, the extension was built from a stale `packages/core/dist` — rerun `bun run sdk:build` before `bun run ext:build`.
- **Extension was reloaded while the page was open.** The injected bridge loses its connection to the service worker. Submissions then go through the page's own `fetch` (logged as `bridge: … sending through the page's own fetch instead`), which a strict `connect-src` may block. Reload the page to re-inject.
- **Config not saved.** Chrome closes the popup when its native permission prompt takes focus. The extension saves the config BEFORE requesting permission so this doesn't lose your work — if you denied the prompt, the config will still be in the list with a "Grant" button. Click it and try again.

### "Failed to execute 'attachShadow'"

This used to fire when the injection raced itself on framework dev servers (Next.js Fast Refresh, etc.). It's fixed in current builds — update to the latest extension zip. If you still see it, the launcher should still work; report the environment in an issue.

### Submission fails only for very large reports

The proxy carries the report body through Chrome's extension messaging, which has a hard size cap. Bodies above roughly 30 MB (about 40 MB once encoded) are not proxied; the extension logs `above the … proxy limit; sending through the page's own fetch instead` and lets the browser send the request directly. On a CSP-strict host that direct request may be blocked by `connect-src`. Trim the recording or remove large attachments and resend.

### Reports take forever / hang

The SDK tries the browser's `getDisplayMedia` API to capture a pixel-perfect screenshot. If you cancel the "Share this tab?" prompt, the wizard closes — that's by design. If the prompt hangs without appearing, check for OS-level screen-recording permission on macOS (System Settings → Privacy & Security → Screen Recording → Chrome).

## Uninstall

`chrome://extensions` → Repro Tester → **Remove**. All stored configs and permissions are deleted. No server-side cleanup needed; the extension keeps no remote state.
