# Widget 3-Mode Launcher, Media Gallery, Screen Recording & Share Links — Design

**Date:** 2026-07-17
**Status:** approved by user, ready for implementation planning
**Related:**
- `docs/superpowers/specs/2026-04-27-sdk-wizard-redesign-and-attachments-design.md` (current 3-step wizard + user attachments)
- `docs/superpowers/specs/2026-04-18-session-replay-design.md` (30s rolling DOM replay — unchanged here)
- `docs/superpowers/specs/2026-04-18-intake-anti-abuse-design.md` (rate limiting / origin allowlist reused by the media endpoint)

---

## 1. Problem

The widget today is single-purpose: the launcher opens the bug-report wizard, which force-fires the OS screenshot dialog before anything else. User feedback asks for a broader capture toolkit:

- Capture a screenshot, annotate it, and *keep it* without filing a report.
- Record the screen (short clip, ≤ 5 minutes), trim the ends, and either attach it to a report or **share it as a link** (paste into Discord, a spreadsheet, a chat).
- Report a bug in two steps (Details → Review) choosing media from previously captured items, instead of being forced through capture-first.

Nothing in the current stack supports video, local media persistence, or report-less uploads.

## 2. Goals

- Launcher opens a 3-option menu: **Capture**, **Record screen** (max 5:00), **Report bug**.
- Capture and Record flows end with **Save to gallery / Discard / Report bug with this**.
- A local, per-origin media gallery persists captures and recordings across page loads.
- Recordings support start/end trim.
- Report Bug becomes 2 steps (Details → Review) with a gallery media picker plus in-flow quick capture/record.
- Any gallery video can be turned into an unguessable public share URL served by the dashboard, with per-project retention and revocation.
- Diagnostic context (30s replay, console/network/system logs) still auto-attaches to every report exactly as today.
- Everything remains additive and backward compatible: old SDKs work against new servers; new SDKs degrade gracefully against old servers.

## 3. Non-goals (v1)

- Audio of any kind in recordings (no mic, no explicit tab-audio UX).
- Real video cutting (re-encode client- or server-side). Trim is playback metadata only.
- Cross-device or server-synced gallery; gallery is per browser profile + origin.
- Expo SDK screen recording (OS-level limitation; mobile keeps its current flow).
- Share links for images (videos only in v1 — images can already be attached to reports; extendable later).
- Share-link view analytics, password-protected links, link expiry UI beyond project retention.
- Editing recordings beyond trim (no crop, blur, zoom).

## 4. Locked decisions

1. **Gallery model: local-first, upload on demand.** Gallery lives in IndexedDB (per origin). Nothing uploads until the user attaches media to a report or mints a share link.
2. **Trim: metadata only.** In/out timestamps stored with the item; every player (gallery preview, dashboard report drawer, public share page) clamps playback to the range. The raw file keeps full length — a raw download shows everything; acceptable for v1 and called out in the share page footer.
3. **Report Bug: gallery picker + quick-capture.** No forced OS dialog on open. Details step offers gallery items plus "Capture now" / "Record now" detours that return with the new item pre-selected.
4. **Share links: unguessable public URL + retention.** No auth wall. Per-project toggle (default **on**) and retention window (default **30 days**), scheduled purge, revoke list in project settings.
5. **No audio in v1.**
6. **Recording bitrate capped** (~2.5 Mbps video) so a maxed 5:00 clip stays under ~100 MB.

## 5. Architecture

### 5.1 SDK — packages/core

```
packages/core/src/
├── screen-record.ts    # NEW — getDisplayMedia + MediaRecorder state machine
└── index.ts            # public API additions
```

- `screen-record.ts` exposes `startScreenRecording(opts) → RecordingSession`:
  - `getDisplayMedia({ video: true, audio: false })`; user gesture + secure context required — on rejection/unsupported, surface a friendly toast and abort.
  - `MediaRecorder` with `videoBitsPerSecond: 2_500_000`, `timeslice: 1000`; chunks accumulate in memory.
  - Auto-stop at 5:00 (constant `MAX_RECORDING_MS`), or on stream `ended` (user clicks browser's native "stop sharing"), or on explicit stop.
  - `pagehide` handler: best-effort assembly of collected chunks into a gallery item so a mid-recording tab close doesn't lose everything.
- Public API additions on the handle returned by `init()`:
  - `feedback.openMenu()` — opens the 3-option menu (launcher click and keyboard shortcut route here).
  - `feedback.capture()` — jumps straight into the capture flow.
  - `feedback.record()` — jumps straight into the record flow.
  - `feedback.open()` — unchanged: opens Report Bug directly (backward compatible; the queued prefill API extends this later).

### 5.2 SDK — packages/ui

```
packages/ui/src/
├── menu.tsx                    # NEW — 3-option launcher menu
├── gallery/
│   ├── store.ts                # NEW — IndexedDB CRUD + quota eviction
│   ├── gallery-view.tsx        # NEW — grid, preview, delete, copy-link, report-with
│   └── thumbnail.ts            # NEW — image downscale / video poster frame
├── record/
│   ├── control-bar.tsx         # NEW — floating timer + stop/cancel while recording
│   ├── trim-screen.tsx         # NEW — <video> preview + start/end range handles
│   └── outcome-bar.tsx         # NEW — Save to gallery / Discard / Report bug with this
├── capture-flow.tsx            # NEW — existing capture+annotate, re-terminated on outcome-bar
├── reporter.tsx                # CHANGED — 2-step state machine (details → review)
└── wizard/
    ├── step-details.tsx        # CHANGED — adds Media section (picker + quick actions)
    └── step-review.tsx         # CHANGED — read-only selected media row
```

- **Gallery store** (`store.ts`): IndexedDB database `repro-gallery`, object store `media`:
  ```ts
  interface GalleryItem {
    id: string                 // crypto.randomUUID()
    kind: "image" | "video"
    blob: Blob                 // annotated PNG or webm
    thumb: Blob                // small poster/preview
    mime: string
    sizeBytes: number
    durationMs?: number        // videos
    trim?: { startMs: number; endMs: number }
    createdAt: number
    shareUrl?: string          // set after a successful link mint
    shareToken?: string
  }
  ```
  Quota: max 50 items / 500 MB total; inserting past either evicts oldest (with a toast naming the eviction). All IndexedDB failures are non-fatal: capture/record flows still work in-memory for the current wizard session (fail-open, per SDK convention).
- **Recording UX**: on start, the widget UI hides except a floating control bar (elapsed / 5:00, stop button, cancel). On stop → trim screen → outcome bar.
- **Trim screen**: range slider over the video; handles snap to 100 ms; live preview seeks to handle positions; "reset trim" affordance. Writes `trim` on the gallery item.
- **Report wizard**: `Details → Review`. Details' Media section renders gallery thumbnails as toggleable chips (multi-select), plus **Capture now** and **Record now** buttons that run the respective flow and return with the item selected. Selected media count/size shown; per-report limits enforced client-side (§5.3). Review lists selected media read-only. Title/description/user-file attachments/honeypot/dwell unchanged.

### 5.3 Intake — report media attachments

- New `AttachmentKind` value: `"media"`. Multipart parts named `media[]` with a JSON sidecar part `mediaMeta` (array aligned by index):
  ```ts
  interface MediaMeta {
    kind: "image" | "video"
    mime: string
    durationMs?: number
    trim?: { startMs: number; endMs: number }
  }
  ```
- Limits (server-authoritative, client-mirrored): max 3 media items per report; images ≤ 10 MB; videos ≤ 100 MB; `INTAKE_MAX_BYTES` raised to accommodate (report total cap 150 MB). Existing user-file limits unchanged.
- Mime allowlist for media parts: `image/png`, `image/jpeg`, `image/webp`, `video/webm`, `video/mp4` (Safari MediaRecorder emits mp4).
- ClamAV: scanned like other parts per the existing pipeline; if scan-size ceilings become a problem for 100 MB blobs, the existing max-size behavior applies (reject, not skip) — flagged for the plan to verify against current `clamav.ts` stream limits.
- `report_attachments` gains nullable columns `duration_ms`, `trim_start_ms`, `trim_end_ms` (additive migration via `bun run db:gen`).
- Compatibility: old server ignores unknown multipart parts → report lands without media (same pattern as the user-attachments rollout). Old SDK sends no media → nothing changes.

### 5.4 Share links — dashboard

- **Endpoint** `POST /api/intake/media` — same auth stack as `POST /api/intake/reports`: public project key, origin allowlist, per-key + per-origin rate limits (stricter: e.g. 10 mints/hour/key). Multipart: one `file` + `meta` JSON (`kind`, `mime`, `durationMs`, `trim`). Rejects when the project has share links disabled. Response: `{ id, token, shareUrl, expiresAt }`.
- **Table `shared_media`:**
  ```
  id             uuid pk
  project_id     uuid fk → projects(id) on delete cascade
  token          text unique          -- 32 random bytes, base64url
  kind           text                 -- 'video' (v1)
  mime           text
  storage_key    text                 -- blob storage adapter key, prefix shared-media/
  size_bytes     bigint
  duration_ms    integer nullable
  trim_start_ms  integer nullable
  trim_end_ms    integer nullable
  created_at     timestamptz
  expires_at     timestamptz          -- created_at + project retention
  revoked_at     timestamptz nullable
  ```
- **Public routes** (no auth):
  - `GET /s/:token` — Nuxt page: minimal branded player clamped to trim, file size/date, "expires <date>" footer. 404s on unknown, expired, or revoked tokens (indistinguishable).
  - `GET /api/shared/:token/blob` — streams the blob (Range supported for video seeking).
  - OG meta tags (`og:title`, `og:video` / `og:image` poster) so Discord/Slack unfurl a preview.
- **Project settings**: `share_links_enabled` boolean (default **on**, including for existing projects), `share_retention_days` integer (default 30). Settings page gains a **Shared media** panel: list (created, size, expiry), copy link, revoke. Permission: `manager`+ can view/revoke; toggling the feature and retention stays with integration-level roles per `permissions.ts` conventions.
- **Purge**: Nitro scheduled task (same pattern as `tasks/github/sync.ts`) hard-deletes blob + row for `expires_at < now()` or revoked rows older than 24 h. SDK-side: a mint response's `expiresAt` is stored on the gallery item so the UI can show "link expired" and offer re-mint.

### 5.5 Dashboard report drawer

- Video media attachments render with a trim-aware `<video>` player (clamps playback range, shows full-length download link). Image media render like existing screenshots. Attachment list groups: screenshot / media / user files.

### 5.6 Extension & Expo

- Extension bundles `@reprojs/core` — inherits all of this at next sync; Playwright suite gains a record-flow smoke test.
- Expo: unchanged. Mobile users record via the OS recorder and attach the file (existing user-attachment path).

## 6. Flows

```
Launcher click / shortcut
   └─ Menu: [Capture] [Record screen] [Report bug]

Capture ─ OS dialog → annotate → outcome bar
   ├─ Save to gallery → toast, close
   ├─ Discard → close
   └─ Report bug with this → Report wizard, item pre-selected

Record ─ OS dialog → control bar (≤5:00) → stop → trim → outcome bar
   ├─ Save to gallery → toast (+ "copy link" shortcut), close
   ├─ Discard → close
   └─ Report bug with this → Report wizard, item pre-selected

Report bug ─ Details (title, description, media picker, quick capture/record,
             user files) → Review → submit
             (replay + logs + system info auto-attached as today)

Gallery (from menu) ─ grid → preview / delete / copy link (video) / report with
```

## 7. Error handling & edge cases

| Case | Behavior |
| --- | --- |
| `getDisplayMedia` denied / unsupported / insecure context | Toast explaining; return to menu. Report flow unaffected (media optional). |
| User clicks browser-native "stop sharing" mid-record | Same as stop: proceed to trim. |
| Tab closed mid-record | `pagehide` best-effort flush of collected chunks to gallery (no trim). |
| 5:00 reached | Auto-stop + toast, proceed to trim. |
| IndexedDB unavailable/full | Fail-open: flows work in-memory for the session; gallery persistence disabled with a subtle notice. Quota eviction toasts name the dropped item. |
| Mint while share links disabled / rate limited | Inline error on the copy-link action with reason. |
| Share token unknown / expired / revoked | Uniform 404 page. |
| Report submit against old server | Media parts ignored server-side; report succeeds; SDK does not error. |
| Recording > size cap (bitrate spike) | Client rejects attach/mint with a "too large" message before upload. |

## 8. Testing

- **Unit (bun test, TDD)**: gallery store CRUD + quota eviction (fake-indexeddb); trim clamp math; recorder state machine (mock MediaRecorder/getDisplayMedia); media validation (limits, mime); share token generation/expiry logic; purge task selection query.
- **Dashboard integration (real Postgres)**: `POST /api/intake/media` auth/limits/disabled-toggle; share blob route Range handling; revoke + purge lifecycle; report intake with media parts + trim columns.
- **E2E**: demo playground gains a record-and-share route (including the strict-CSP page); extension Playwright smoke covers menu → record → trim → gallery.

## 9. Rollout & compatibility

- All schema changes additive (`bun run db:gen`); no backfill.
- Old SDK + new server: unchanged behavior. New SDK + old server: media/report degrade gracefully (parts ignored); share-link mint fails with a clear "server does not support share links" message (404 on the endpoint → mapped to that message).
- Existing `feedback.open()` behavior preserved; launcher default behavior changes from "open reporter" to "open menu" — called out in the changelog as the one intentional UX change.

## 10. Queued follow-ups (separate specs)

- **A. SDK dev-API quick wins** — `open({ prefill })`, `captureError()`, title template. (Addresses Brian's error-page feedback.)
- **B. GitHub upgrade** — reuse existing App installations, import non-Repro issues, dashboard-created tickets, sync fixes.
- **D-ext.** Share links for images; real video cutting; link analytics.
