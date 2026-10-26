# Cross-surface audit — 2026-10-26

Scope: web SDK (`packages/core`, `ui`, `recorder`, `sdk-utils`), dashboard server (`apps/dashboard/server`), dashboard UI (`apps/dashboard/app`), Chrome tester extension (`apps/extension`), Expo SDK (`packages/expo`), and the GitHub screenshot-embedding question. Read-only; nothing was changed. Baseline: `main` at `e1f6d58`, all SDK / Expo / GitHub-integration unit tests passing (0 failures across every package).

Severity scale: **Critical** = loses user data or blocks the core flow with no feedback. **High** = frequent, user-visible failure. **Medium** = occasional or edge-case failure, or a clear UX cost. **Low** = polish.

Findings marked *unverified* were reasoned from source but not reproduced at runtime.

---

## 1. Executive summary

The "unreliable" feedback has concrete causes. Most are not random flakiness; they are a handful of design gaps that each produce a silent failure:

| # | Surface | Problem | Why users call it "unreliable" |
|---|---|---|---|
| 1 | Web SDK | Log/replay buffers are **drained** on first submit attempt | Retrying a failed send ships an empty report |
| 2 | Web SDK | Submit handler has **no try/catch**; `CompressionStream` unguarded | "Sending…" spinner forever on older Safari/Firefox |
| 3 | Web SDK | Screenshot failure (denied / iOS / undecodable) **closes the widget** silently | "I clicked capture and it disappeared" |
| 4 | Dashboard API | Allowed origins stored raw, matched by exact string | Works in dev, 403 in prod because of `/`, path, or case |
| 5 | Dashboard API | Report row committed before attachments; retries short-circuit on idempotency key | Reports with missing screenshot/replay that never heal |
| 6 | Dashboard API | Webhook dedupe recorded **before** processing | A transient DB error permanently drops a GitHub event |
| 7 | Dashboard API | Enqueue resets `syncing` jobs to `pending` | Duplicate GitHub issues under concurrent reconciles |
| 8 | Expo | Queue stores `file://` URIs only; unreadable file = fatal drop | Offline queue loses reports across app restart/update |
| 9 | Expo | No fetch timeout; `running` flag never clears on a hung upload | One stalled upload freezes all future sends |
| 10 | Extension | Inject only on `status: "complete"` | Launcher missing on slow pages |

On UX, the dashboard is well engineered under the hood (URL-driven inbox, humanised errors, role gating) but the **first-run path and the triage loop** both have friction: a fake-key install snippet, no origin-allowlist guidance, no status column, triage panel collapsed by default, no keyboard highlight, and sync failures invisible from the report itself.

On GitHub image upload: **no official API exists**, and the undocumented endpoint `gh --attach` uses rejects GitHub App installation tokens. The viable path is committing the PNG to the repo via the Contents API and referencing it with a `github.com/{o}/{r}/raw/...` URL. Details in §7.

---

## 2. Recommended fix order

Grouped so each batch is a small, independently shippable PR.

**Batch A — stop losing data (SDKs)**
1. Web SDK: `peek()` instead of `drain()` in `snapshotAll`; clear only after 2xx. Wrap `handleSend` in try/catch. Guard `CompressionStream` and `AbortSignal.timeout`.
2. Web SDK: toast + fall back to DOM capture when `getDisplayMedia` is missing or denied instead of closing the widget.
3. Expo: copy attachments to `documentDirectory` at enqueue; send without the attachment rather than drop the report. Add a 60 s `AbortController` to the intake client. Serialize AsyncStorage ops behind a promise mutex. Add a `rerunRequested` flag to `flush`.

**Batch B — intake correctness (dashboard)**
4. Normalise origins to `new URL(x).origin` on write; compare normalised. Show a warning banner when a project has zero origins.
5. Validate every part (including replay size) **before** the transaction; write blobs first; insert report + attachment rows in one transaction; roll back blobs on failure.
6. Make the idempotency index unique and insert with `ON CONFLICT DO NOTHING RETURNING`.
7. Treat ClamAV `isInfected: null` as a failed scan.

**Batch C — GitHub sync integrity**
8. Record webhook delivery in the same transaction as the mutation (or delete it in `catch`).
9. Enqueue: `WHERE state <> 'syncing'`, set a `rerun_requested` flag instead. Advisory lock around create-or-link; persist issue number before anything else.
10. Comment race: on inbound `issue_comment.created`, link to a dashboard comment with null `github_comment_id` and matching body before inserting. Treat unique violation on reconcile as "already linked".
11. Per-report sync failure surfaced in the report's GitHub section with `lastError` + Retry.

**Batch D — UX quick wins (all S effort)**
12. Project-aware install snippet (real key, copy button, `async`/`onload` form) on project Overview; retire the fake-key page or make it pick a project.
13. Setup checklist card on Overview when `total === 0`.
14. Inbox: Status column; default to Open; quick views (Open / Mine / Unassigned / Urgent).
15. Report page: triage panel open by default (persist); editable status + priority in header.
16. Visible j/k highlight on rows; mount the shortcuts modal on `?`.

**Batch E — extension**
17. Inject on `webNavigation.onDOMContentLoaded`, keep `complete` as fallback.
18. Forward the SDK `AbortSignal` through the proxy; check intake-host permission in `tryInject`.

**Batch F — ops hygiene**
19. Boot warning when `TRUST_XFF=false` and `X-Forwarded-For` is present.
20. Drain the sync queue until empty per cron tick (not 10/min).
21. Prune `github_webhook_deliveries`; atomic local-disk writes (`.tmp` + rename).
22. Dedicated `COMMENT_SIGNING_SECRET`; support a list of previous secrets for verification.

---

## 3. Web SDK findings

### Critical
- **Submit spinner can hang forever.** `packages/ui/src/reporter.tsx:220` awaits `onSubmit` with no try/catch; `setSubmitting(false)` never runs on a throw. `packages/core/src/index.ts:80-97` calls `snapshotAll`, `gatherContext`, `flushReplay` unguarded. `packages/recorder/src/compress.ts:82` does `new CompressionStream("gzip")` with no feature check → `ReferenceError` on Safari < 16.4 / Firefox < 113. Back button is disabled while submitting (`reporter.tsx:320`). **Verified.**
- **Buffers drained on first attempt; retry sends an empty report.** `packages/ui/src/collectors/index.ts:79-82` → `snapshot()` → `RingBuffer.drain()` (`packages/sdk-utils/src/ring-buffer.ts:12-16`) empties console/network/breadcrumbs. `packages/recorder/src/record.ts:203` `buffer.flush()` empties replay. On 429/5xx/timeout and "Send report" again, the second POST has no logs and no replay. **Verified.**

### High
- **30 s hard timeout vs 100 MB uploads, no retry, no offline handling.** `packages/core/src/intake-client.ts:117` `AbortSignal.timeout(30_000)` for the whole multipart POST; client allows 100 MB video (`packages/sdk-utils/src/media/types.ts:17`). Slow uplink → abort → combined with the drain bug, retry loses logs. Server keeps processing the first request, so a resubmit creates a duplicate (web has no idempotency key).
- **Silent screenshot failure closes the widget.** `packages/core/src/display-media.ts:53-56` returns `null` on denial or missing API (all iOS browsers); `capture()` in "auto" mode has no DOM fallback (`screenshot.ts:103`); `capture-flow.tsx:55-57` → `discarded` → `mount.ts:291-298` `setMode("closed")`. `config.ts:14-16` still documents a fallback that no longer exists.
- **`init()` throws before `<body>` exists.** `packages/ui/src/shadow.ts:17` `document.body.appendChild` unguarded. Docs recommend `<script async onload="Repro.init(...)">`; in `<head>` with a cached bundle, `onload` fires before body parses. `index.ts:48-52` has already patched fetch/XHR/console and started the recorder → half-initialised SDK.
- **Saving to gallery can strand the UI.** `mount.ts:233-245` `gallery.add()` has no try/catch; IDB quota errors or `rows.toSorted` (`store.ts:72`, Chrome < 110 / Safari < 16) leave the outcome bar stuck.

### Medium
- Streaming responses never reach the host when `network.responseBody: true` — `packages/ui/src/collectors/network.ts:191-193` awaits `clone.text()` before returning. Host `await fetch()` of SSE hangs.
- Reporter clobbers host `body.style.overflow` (`reporter.tsx:91-96` resets to `""`, not previous value).
- `flatten()` rejection on "Continue" unhandled (`step-annotate.tsx:64-67`); 2× DPR on 4K exceeds Safari's ~16.7 MP canvas cap → `toBlob` null → button does nothing. *Unverified on real Safari.*
- Recorder perf: O(n²) removed-node collapse (`observers/mutation.ts:116-126`), attribute observer without `attributeFilter` (`:241-247`), synchronous full-DOM serialization inside `init()` (`record.ts:122`). *Magnitude unverified.*
- Full snapshot larger than the 4 MB buffer silently yields no replay (`buffer.ts:77-82` evicts the just-pushed snapshot).
- Clipboard write after a 60 s await fails on Safari; minted share link never shown (`gallery-view.tsx:262-270`).

### Low
- `AbortSignal.timeout` undefined on Safari < 16 (`intake-client.ts:117`, `share-client.ts:75`).
- Two SDK copies → second `attachShadow` on `#repro-host` throws (`shadow.ts:21`).
- macOS `alt+letter` hotkeys never fire; compare `event.code` (`hotkey.ts:69`).
- Adopted-stylesheet observer referenced but not registered (`stylesheet-rule.ts:19` vs `record.ts:130-145`); no shadow-root serialization.
- `setTimeout(onClose, 1500)` not cleared on unmount (`reporter.tsx:231`).
- `network.ts:298` `stop()` restores pre-Repro fetch, wiping later patches (Sentry etc.).

### Done well
Screen-recording lifecycle (first-trigger-wins, tracks stopped on every exit, pagehide flush); replay buffer pauses while widget is open; `decode()` race guard in `display-media.ts`; no `blob:` URLs so strict CSPs don't blank the screenshot; interceptors wrap their own work in try/catch and `beforeSend` exceptions fall back to the original report.

---

## 4. Dashboard server findings

### Critical
- **Half-stored reports that never heal.** `server/api/intake/reports.ts:530-638`: report row committed at `:530`; replay size check at `:575` runs *after* insert (oversized replay → 413 → orphan report with zero attachments); screenshot/logs `Promise.all` at `:600-637` has no `rollbackPuts`. Expo retries with the same `Idempotency-Key` and `:194-204` returns `200 {id}` for the existing row, so attachments are never re-uploaded. The SDK targets exactly 1,048,576 bytes for replay (`packages/ui/src/collectors/replay.ts:29`) against a 1 MB default cap, so "a few bytes over" is realistic. **Verified.**
- **Webhook events dropped forever on transient failure.** `webhook.post.ts:185-188` calls `recordDelivery` before processing; GitHub redelivery with the same GUID is answered `202 replay`. **Verified.**

### High
- **Origin allowlist is exact-string, never normalised.** `server/lib/intake-cors.ts:63` `allowed.includes(origin)`; `packages/shared/src/projects.ts:30` `z.string().url()` accepts trailing slash, path, mixed case. Browsers send a canonical `Origin`. **Verified.** Most likely root cause of "worked in dev, rejected in prod".
- **Per-IP intake limiter collapses onto the proxy IP when `TRUST_XFF` is left at its default of `false`.** `env.ts:155`; `reports.ts:105,229-243`. The reverse-proxy guide does say to set it `true`, so this is a missed-setup-step hazard rather than an unconditional bug. Add a boot-time warning. **Verified.**
- **Duplicate GitHub issues from concurrent reconciles.** `enqueue-sync.ts:41-44,67-70` `onConflictDoUpdate` sets `state='pending'` even when `syncing`; two `reconcileReport` runs overlap; both see null issue number; `findIssueByMarker` (GitHub Search, indexing lag, 30 req/min, errors swallowed → null) misses; both create. First worker's delete removes the row the second is working on.
- **Write-lock echo check matches only the final webhook of a multi-label write.** `github-reconcile.ts:133-135,218-227`; `webhook.post.ts:311-392`. GitHub emits one `labeled`/`unlabeled` event per label; intermediate sets get treated as inbound edits and overwrite `reports.tags`/`priority`. *Partially unverified.*
- **Dashboard comment → GitHub race.** `github-reconcile.ts:364-380` creates the GitHub comment before `recordWriteLock`; the inbound webhook can insert a duplicate `report_comments` row first; the subsequent `UPDATE ... SET github_comment_id` hits the unique constraint, job retries 5× and posts 5 more GitHub comments.

### Medium
- Non-unique idempotency index (`schema/reports.ts:73-75`); check-then-insert races on mobile retries.
- ClamAV `isInfected: null` treated as clean (`clamav.ts:75-83`).
- In-memory singletons (SSE bus `report-events-bus.ts:23-25`, `github-cache.ts:59`, `rate-limit.ts:71-75`, better-auth limiter `auth.ts:165`) break with `--scale dashboard=3`, which the ops docs recommend.
- Sync queue drains 10 jobs/min after restart (`github-sync-runner.ts:172`, `nuxt.config.ts:134`).
- Rotating `BETTER_AUTH_SECRET` breaks comment-footer HMAC recognition (`comment-serializer.ts:31-41`); rotating `ATTACHMENT_URL_SECRET` breaks every embedded GitHub screenshot (100-year TTL, `github-helpers.ts:15`).
- `github_webhook_deliveries` grows forever (`github-webhook-auth.ts:16-23`).

### Low
- Migration journal `when` out of order at idx 9/10 (`meta/_journal.json`); harmless now, hazard for future hand-inserted migrations.
- Pg limiter first-take off-by-one (`rate-limit-pg.ts:47,57`).
- Local-disk writes not atomic (`storage/local-disk.ts:15-21`).
- Enqueue when integration connected but no repo chosen → 5 failed attempts of noise (`enqueue-sync.ts:25-31`).
- `installation.unsuspend` never reconnects (`webhook.post.ts:202-210`).

### Unverified
- Nitro `scheduledTasks` under `bun .output/server/index.mjs` in the Docker image. Confirm `github:sync` ticks appear in production logs.

### Done well
Intake validates and virus-scans every part before the report row exists and uses `pg_advisory_xact_lock` for the daily cap; sync claims are conditional `UPDATE ... RETURNING` with stale-sweep and bounded backoff; SSE endpoint has close-before-subscribe, subscriber cap, 25 s heartbeat, `X-Accel-Buffering: no`; env is Zod-validated at boot with pool timeouts; compose runs `drizzle-kit migrate` on start.

---

## 5. Dashboard UX findings

Paths relative to `apps/dashboard/app/`.

### Onboarding
- **Fake-key install page (High).** `pages/settings/install.vue:15` hard-codes `rp_pk_xxx…`; `:308-313` sends the admin to Project → Settings → Security. The project Security tab snippet (`pages/projects/[id]/settings.vue:555-563`) has no copy button, no highlighting, and omits the `async`/`onload` form the install page deliberately includes (`install.vue:68-77`). Two snippets, neither complete.
- **Allowed origins are a silent blocker (High).** Only `settings.vue:355` help text mentions that an empty list makes the project inactive in prod. Nothing on Overview or the reports empty state.
- After creating a project you land back on the grid (Medium). Navigate into the new project.
- "Security" tab does not read as "where I get my key" (Low).

### Information architecture
- Settings in three places: project Settings, project Integrations, global Admin → GitHub. `github-panel.vue:151-167` shows a dead "Install on GitHub" button when the App isn't configured; detect and link to `/settings/github` (Medium).
- `pages/settings/identities.vue` (Linked accounts) has no inbound link anywhere (Medium), yet `reports/index.vue:139-143` dropped "Assign to me" because the GitHub identity is unknown.
- Naming drift: "report" vs "ticket" (`settings/github.vue:173,279`, `settings/mcp.vue:99`, `oauth/consent.vue:30-33`); "Labels" vs `tag` (Low).

### Inbox / triage
- **No Status column (High).** `reports/index.vue:218-335`. On the default "All" tab you cannot tell open from closed.
- Multi-status deep links supported by URL (`use-inbox-query.ts:40`) but tabs emit single values and show nothing selected (Medium).
- No saved views, no "Mine", default is "All" not "Open" (Medium).
- Bulk actions lack priority, labels, create-issue; selection is page-scoped (Medium).
- j/k navigation scrolls but applies no highlight class (`reports/index.vue:202-214,426`); `keyboard-shortcuts-modal.vue` exists but is never mounted (Medium).
- Every triage action requires leaving the list; no inline edit or preview pane (Medium).
- URL state is good (filters, sort, page, overflow self-heal).

### Report detail
- **Triage panel defaults closed (High).** `[reportId].vue:156`.
- Header shows priority only; status is read-only in Overview while editable controls are in the collapsed panel (Medium).
- Replay is a tab with a dot; for a bug tool it should be a headline CTA next to the screenshot (Medium).
- Logs: stacked cards, no errors-only toggle, no copy/export; System and Raw tabs are `JSON.stringify` dumps (Medium).
- GitHub sync failure invisible from the report; only on Integrations page (`sync-status.vue:119-151`) (Medium).
- Assignees gated on `isReportLinked` (`triage-footer.vue:286-294`) while bulk-assign works without GitHub (Medium).
- `CommentsTab` mounted in Overview and as its own tab; two pollers (Low).

### Feedback & errors
- Several paths bypass `describeApiError`: `comments-tab.vue:97-98,120-121,221-222,254-255`; `settings/identities.vue:48-52` has no try/catch (Medium).
- Loading states inconsistent; `AppLoadingSkeleton` used only on report detail (Medium).
- "Saved" toast on every edit (`triage-footer.vue:147-167`); no optimistic updates; no undo on bulk actions (Low–Medium).
- No global `error.vue`.

### Consistency / responsive / a11y
- Four tab implementations (`status-tabs.vue`, `report-drawer/tabs.vue`, `UTabs`, pill group in `install.vue:231-246`).
- Mobile effectively unsupported: fixed 256 px sidebar, 240 px facets, 320 px triage aside (Medium).
- Color-only indicators (priority dots, hasData dots) without text alternative; table rows not focusable; `⌘+Enter` shown on non-Mac.

### Role handling
Mostly good: disabled controls with explanation copy. Gaps: General tab disables inputs with no explanation; manager/developer split explained only on Integrations page.

### Top 10 UX improvements

| # | Improvement | Effort |
|---|---|---|
| 1 | Project-aware install snippet with real key, copy button; one snippet source | M |
| 2 | Setup checklist + empty-origins warning on Overview | S |
| 3 | Status column; default to Open; quick views | M |
| 4 | Triage panel open by default; editable status/priority in header | S |
| 5 | Row highlight for j/k; mount shortcuts modal on `?`; focusable rows | S |
| 6 | Per-report sync failure + Retry; "App not configured" state in github-panel | M |
| 7 | Bulk priority/labels/create-issue; select-all-matching | M |
| 8 | All errors through `describeApiError`; optimistic updates; undo on bulk | M |
| 9 | Responsive shell | L |
| 10 | Unify tabs and skeletons; link Linked accounts from user menu | S |

### Done well
URL-driven inbox state with tested helpers; `describeApiError` with Zod flattening; single `useConfirm()` host with typed-name delete; lazy-loaded logs/replay with SSE live updates and layered Esc handling; role gating via disabled controls, not 403s; magic-link landing that does not spend the token on load.

---

## 6. Extension and Expo findings

### Chrome extension
**High**
- Inject only on `tabs.onUpdated` `status: "complete"` (`src/service-worker/index.ts:110-113`). A hanging image or long-poll iframe keeps the page at `interactive`; launcher appears late or never.
- Dedupe slot is set after two awaits (`index.ts:28-42`), so two `complete` events (common on Vite/Next dev servers) both pass the check and the IIFE evaluates twice; `window.Repro` becomes a second, never-initialised instance. **Verified.**

**Medium**
- Fetch proxy drops `init.signal` (`src/bootstrap/proxy-fetch.ts:94-182`); SDK 30 s timeout is inert, proxy's 60 s is the only bail-out.
- No intake-host permission check in `tryInject`; failure surfaces as "Failed to fetch".
- Re-injection on pushState/bfcache overwrites `window.Repro`; `Repro.open()` then throws "called before init". *Unverified for bfcache.*
- Bodies base64-inflated through `runtime.sendMessage` with no size guard; ~48 MB+ hits Chrome's 64 MB message limit.

**Low**
- Orphaned bridge after extension reload hangs submissions 60 s (`src/bootstrap/bridge.ts:33`).
- Removing one config revokes an origin permission another config shares (`src/popup/useConfigs.ts:98-110`).
- Two configs for the same origin: first match wins silently.
- `scripts/sync-sdk.ts` copies whatever is in `packages/core/dist`; a local build with a stale `dist/` ships a stale SDK. Log the bundled SDK version.
- E2E covers only a fresh `goto`; no reload / pushState / slow-load cases.

### Expo SDK
**Critical**
- Queue persists only `file://` URIs (`src/queue/storage.ts:6-13`); screenshots are view-shot `tmpfile` results, picked files live in the cache dir. iOS rotates the container UUID on update and purges `tmp/`; Android clears cache. `xhrBlobFromUri` then throws `IntakeError(0, …, { fatal: true })` (`src/intake-client.ts:116-120`) and `flush.ts:103-118` deletes the whole report. **Verified.** The offline queue only survives within one app session.

**High**
- No request timeout (`intake-client.ts:137-142`); `running = true` (`flush.ts:71-72`) never clears on a hung upload; every later trigger returns early. One stalled upload freezes the queue until app kill.
- Read-modify-write races on the single AsyncStorage key (`storage.ts:66-97`); a new enqueue during a background `remove` can vanish.
- Enqueue during a running flush is not sent until an unrelated trigger (`flush.ts:71,140`).

**Medium**
- Eviction is silent; `provider.tsx:239` ignores `evictedIds`; screenshots enqueued with `bytes: 0` so the size cap is inert.
- Flatten may capture before the image decodes (`src/capture/flatten.tsx:36-57`, no `onLoad` gate). *Unverified on Android.*
- Network collector wraps `fetch` only; axios/XHR invisible, yet wizard says "Console, network & breadcrumbs" (`sheet.tsx:167`).
- `stop()` clobbers other libraries' fetch/console wrappers (`network.ts:122-127`, `console.ts:77-86`).

**Low**
- Corrupt queue JSON silently discarded (`storage.ts:48-53`).
- `rootSize` may be `{0,0}` before first `onLayout` (`provider.tsx:174,229`).
- `expo-document-picker` / `expo-image-picker` declared required but treated optional; "Add attachment" silently does nothing if missing.

### Done well
Expo WinterCG fetch detection and multipart self-heal; end-to-end idempotency key; clear fatal/retryable/exhausted taxonomy with `onDrop` logging; tight extension proxy security model (origin from `sender.tab.url`, path gate, header allowlist); popup persists config before the permission prompt.

---

## 7. GitHub image upload — can we stop using public asset links?

**Short answer: not via any official API, and the unofficial route is blocked for a GitHub App.** Checked 2026-10-26.

### What exists
- REST and GraphQL have **no** attachment endpoint. The community request has been open since 2022; a Sep 2026 staff comment confirms `gh --attach` uploads client-side and "the REST API still lacks an attachment endpoint" ([community #46951](https://github.com/community/community/discussions/46951), [#28219](https://github.com/orgs/community/discussions/28219)).
- `gh --attach` (GA since gh 2.99, [changelog 2026-09-01](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments)) calls `POST https://uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=…` with a bearer token ([cli source](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go)). It works with OAuth `gho_`, classic and fine-grained PATs. **Installation tokens (`ghs_`) and user-to-server tokens (`ghu_`) return 404**; a maintainer called this "intended behavior for now" and it was re-confirmed broken on 2026-10-23 ([cli/cli#14309](https://github.com/cli/cli/issues/14309)). Undocumented, unversioned, not on GHES, already broke once in May 2025.
- Repro's per-user GitHub identity link uses the GitHub App's OAuth client (`server/api/me/identities/github/start.post.ts:28`), so those are `ghu_` tokens, and the token is not persisted (`schema/user-identities.ts`). Option A is therefore blocked for Repro today.
- Octokit has nothing. Comparable tools (Jam, Marker.io, BugHerd, Sentry) all link to their own hosted asset; none upload into GitHub.

### Options

| Option | Private repo renders inline? | Official? | App permission | Size | Effort |
|---|---|---|---|---|---|
| A. `uploads.github.com/user-attachments/assets` | Yes | No; rejects `ghs_`/`ghu_` | needs human PAT/OAuth | 10 MB | Blocked |
| **B. Contents API commit + `github.com/{o}/{r}/raw/{branch}/{path}`** | **Yes** for logged-in collaborators (not in email notifications) | Yes | `contents: write` (today the App has only `issues: write`, `metadata: read`, `emails: read` — `packages/integrations/github/src/manifest.ts:34-41`) | 100 MB blob | ~1 day |
| C. Release asset | No for private repos | Yes | `contents: write` | 2 GiB | Skip |
| D. Base64 `data:` URI | No, sanitizer strips it; 65,536-char body cap | — | — | — | Dead end |
| E. LFS / Packages | No | — | — | — | Not viable |
| F. Signed dashboard URL (current) | Yes via Camo | Yours | none | Camo fetch cap ~5 MiB (OSS default; GitHub's prod value unverified) | Harden |

### Recommendation
1. **Ship option B as an opt-in per project** ("Store screenshots in GitHub"): on sync, `PUT /repos/{o}/{r}/contents/repro/<reportId>/screenshot.png` to an orphan `repro-assets` branch, then embed `![Screenshot](https://github.com/{o}/{r}/raw/repro-assets/repro/<reportId>/screenshot.png)`. Requires adding `contents: write` to the manifest and a re-authorisation prompt for existing installs. Removes the public-dashboard requirement and the host leak; works for private repos. Document: no inline image in email notifications; repo grows one PNG per report (offer a pruning job).
2. **Keep the signed-URL path as default/fallback** for installs that decline `contents: write`, but harden it: add a key id so rotation (not expiry) revokes old links; bind the token to the attachment hash; serve with `Cache-Control: public, max-age=31536000, immutable` so Camo rarely re-fetches; optionally serve attachments from a separate public hostname. Replace the 100-year TTL with "valid until key rotated".
3. **Watch [cli/cli#14309](https://github.com/cli/cli/issues/14309).** If GitHub opens the upload endpoint to `ghs_`, option A becomes the best path with zero repo pollution.

---

## 8. Test and CI observations

- SDK, Expo, and GitHub-integration unit suites: all green locally (per-file isolation via `scripts/test-sdk.sh`).
- Dashboard has API integration tests against real Postgres (good) but **no browser E2E** for the dashboard UI; the extension has Playwright. None of the UX findings in §5 would be caught by the current suite.
- Extension E2E covers only fresh navigation; add reload, pushState, slow-load.
- Three open GitHub issues (#14 intake 405 Allow header, #15 magic-link `allowedAttempts` vs link prefetchers, #16 unreachable OAuth error codes) are small and consistent with the "unreliable" theme; #15 in particular blocks sign-in behind corporate mail scanners.
