# Widget 3-Mode Launcher, Gallery, Recording & Share Links — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the widget into a 3-mode tool (Capture / Record screen ≤5:00 / Report bug) with a local IndexedDB gallery, metadata-based trim, a 2-step report wizard fed by the gallery, intake support for media attachments, and public share links with retention on the dashboard.

**Architecture:** SDK side: a new `screen-record.ts` MediaRecorder module in `@reprojs/core`, a gallery store + new flow components in `@reprojs/ui`, and a rewritten mode-aware `mount.ts`/`reporter.tsx`. Dashboard side: additive `media` attachment kind on intake, a `shared_media` table + `POST /api/intake/media` mint endpoint, Range-streaming blob routes, a public `/s/:token` player page, and a nightly purge task.

**Tech Stack:** TypeScript strict, Preact + Shadow DOM, IndexedDB (fake-indexeddb for tests), MediaRecorder/getDisplayMedia, Nuxt 4 + Nitro, Drizzle + Postgres, bun test.

**Spec:** `docs/superpowers/specs/2026-07-17-widget-modes-gallery-recording-design.md`

## Global Constraints

- Package scope is `@reprojs/*` (core is published; ui/sdk-utils/shared/recorder are workspace packages bundled into core).
- Bun for everything: `bun test`, `bun run`, `bun add`. Never npm/npx/vitest/jest.
- TDD: every task writes the failing test first. Unit tests live next to source (`foo.ts` + `foo.test.ts`).
- Conventional Commits, one concern per commit, each commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No `any`. `as unknown as X` only when strictly necessary with an inline justification.
- Drizzle migrations: NEVER hand-write `.sql` or snapshot files. Edit schema TS, then run `bun run db:gen` from the REPO ROOT (it runs auth:gen then drizzle-kit generate), then `bun run db:migrate`.
- Widget CSS: edit `packages/ui/src/styles.css` ONLY, then regenerate with `bun run packages/ui/build-css.ts`. Never hand-edit `packages/ui/src/styles-inline.ts`. New CSS must not contain backticks or `${`.
- Do not clobber unrelated edits in `apps/dashboard/nuxt.config.ts` — make minimal, targeted insertions (the user edits this file directly).
- oxlint is pinned at 1.59.0; do not bump. `bun run check` (root) must pass before each commit (husky runs it).
- Dashboard integration tests (`apps/dashboard/tests/`) require the dev server running (`bun run dev` in another terminal, `TEST_BASE_URL` default `http://localhost:3000`) and real Postgres (`bun run dev:docker`).
- Wire-contract constants (from spec): recording max 5:00 (`300_000` ms), video bitrate 2_500_000 bps, gallery quota 50 items / 500 MB, media per report max 3, image ≤ 10 MB, video ≤ 100 MB, share token 32 random bytes base64url, retention default 30 days, share links default ON.
- Intake multipart part names today: `report`, `screenshot`, `logs`, `replay`, `attachment[N]`. This plan adds `media[N]` + `mediaMeta`. The project key travels INSIDE the `report` (or `meta`) JSON body, not a header.

## File Map (created ▲ / modified ●)

```
packages/shared/src/reports.ts                ● AttachmentKind + "media", MediaMetaEntry/MediaMetaInput, AttachmentDTO trim fields
packages/shared/src/projects.ts               ● UpdateProjectInput/ProjectDTO share settings
packages/shared/src/shared-media.ts           ▲ ShareMintResponse, SharedMediaDTO
packages/sdk-utils/src/format.ts              ▲ formatBytes (promoted from attachment-list)
packages/sdk-utils/src/media/{types,validate}.ts ▲ TrimRange, MEDIA_LIMITS, validateMediaSelection
packages/core/src/screen-record.ts            ▲ MediaRecorder session state machine
packages/core/src/share-client.ts             ▲ mintShareLink()
packages/core/src/hotkey.ts                   ▲ optional open-menu hotkey
packages/core/src/intake-client.ts            ● media[N] + mediaMeta parts
packages/core/src/config.ts                   ● InitOptions.hotkey
packages/core/src/index.ts                    ● openMenu/capture/record exports + new mount wiring
packages/ui/src/gallery/{store,thumbnail}.ts  ▲ IndexedDB store + poster helper
packages/ui/src/gallery/gallery-view.tsx      ▲ grid / preview / delete / copy-link / report-with
packages/ui/src/record/{control-bar,trim-screen,outcome-bar}.tsx ▲
packages/ui/src/menu.tsx                      ▲ 3-option launcher menu
packages/ui/src/capture-flow.tsx              ▲ annotate → outcome bar flow
packages/ui/src/reporter.tsx                  ● 2-step wizard (Details → Review)
packages/ui/src/wizard/step-details.tsx       ● media picker section
packages/ui/src/wizard/media-picker.tsx       ▲ gallery chips + capture/record-now buttons
packages/ui/src/mount.ts                      ● mode state machine
packages/ui/src/styles.css                    ● new classes (then regen styles-inline)
apps/dashboard/server/db/schema/reports.ts    ● kind check + duration/trim columns
apps/dashboard/server/db/schema/projects.ts   ● share_links_enabled, share_retention_days
apps/dashboard/server/db/schema/shared-media.ts ▲ shared_media table
apps/dashboard/server/api/intake/reports.ts   ● media part handling
apps/dashboard/server/api/intake/media.post.ts ▲ share-link mint
apps/dashboard/server/api/shared/[token]/index.get.ts ▲ public meta
apps/dashboard/server/api/shared/[token]/blob.get.ts  ▲ public Range streaming
apps/dashboard/server/api/projects/[id]/reports/[reportId]/media/[attachmentId].get.ts ▲ authed Range streaming
apps/dashboard/server/api/projects/[id]/shared-media/{index.get.ts,[mediaId].delete.ts} ▲ list + revoke
apps/dashboard/server/lib/storage/{index,local-disk,s3}.ts ● getStream()
apps/dashboard/server/lib/range.ts            ▲ Range header parsing
apps/dashboard/server/tasks/media/purge.ts    ▲ retention purge
apps/dashboard/app/pages/s/[token].vue        ▲ public player page
apps/dashboard/app/components/report-drawer/trim-video.vue ▲ trim-aware player
apps/dashboard/app/components/report-drawer/attachments-tab.vue ● media section
apps/dashboard/app/pages/projects/[id]/settings.vue ● Sharing tab
apps/dashboard/app/middleware/auth.global.ts  ● publicPaths += "/s"
apps/dashboard/nuxt.config.ts                 ● routeRules + media-src CSP + purge schedule
```

---

### Task 1: Shared contracts (`@reprojs/shared`)

**Files:**
- Modify: `packages/shared/src/reports.ts` (AttachmentKind at lines ~218-225, AttachmentDTO at ~227-241)
- Modify: `packages/shared/src/projects.ts` (UpdateProjectInput at ~26-32, ProjectDTO at ~7-19)
- Create: `packages/shared/src/shared-media.ts`
- Modify: `packages/shared/src/index.ts` (add `export * from "./shared-media"`)
- Test: `packages/shared/src/shared-media.test.ts`, extend `packages/shared/src/reports.test.ts` if present (create if not)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by every later task):
  - `AttachmentKind` gains `"media"`.
  - `MediaMetaEntry` / `MediaMetaInput` zod schemas + inferred types.
  - `AttachmentDTO` gains `durationMs: number | null`, `trimStartMs: number | null`, `trimEndMs: number | null`.
  - `UpdateProjectInput` gains `shareLinksEnabled?: boolean`, `shareRetentionDays?: number (1..365)`; `ProjectDTO` gains both (required).
  - `ShareMintResponse`, `SharedMediaDTO`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/shared-media.test.ts`:

```ts
import { test, expect } from "bun:test"
import { AttachmentKind, MediaMetaInput, ShareMintResponse, SharedMediaDTO } from "./index"

test("AttachmentKind accepts media", () => {
  expect(AttachmentKind.parse("media")).toBe("media")
})

test("MediaMetaInput enforces max 3 entries and trim shape", () => {
  const good = MediaMetaInput.parse([
    { kind: "video", mime: "video/webm", durationMs: 12_000, trim: { startMs: 1000, endMs: 9000 } },
    { kind: "image", mime: "image/png" },
  ])
  expect(good).toHaveLength(2)
  expect(() =>
    MediaMetaInput.parse([{ kind: "video", mime: "video/webm" }, { kind: "video", mime: "video/webm" }, { kind: "video", mime: "video/webm" }, { kind: "video", mime: "video/webm" }]),
  ).toThrow()
  expect(() => MediaMetaInput.parse([{ kind: "gif", mime: "image/gif" }])).toThrow()
})

test("ShareMintResponse roundtrip", () => {
  const r = ShareMintResponse.parse({
    id: "e48d797c-1af8-4b16-95df-a99b78277c1c",
    token: "a".repeat(43),
    shareUrl: "https://feedback.example.com/s/" + "a".repeat(43),
    expiresAt: "2026-08-16T00:00:00.000Z",
  })
  expect(r.token.length).toBeGreaterThanOrEqual(43)
})

test("SharedMediaDTO parses a revoked row", () => {
  const dto = SharedMediaDTO.parse({
    id: "e48d797c-1af8-4b16-95df-a99b78277c1c",
    kind: "video",
    mime: "video/webm",
    sizeBytes: 1024,
    durationMs: 5000,
    createdAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-08-16T00:00:00.000Z",
    revokedAt: "2026-07-18T00:00:00.000Z",
    shareUrl: "https://feedback.example.com/s/tok",
  })
  expect(dto.revokedAt).not.toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && bun test src/shared-media.test.ts`
Expected: FAIL — `MediaMetaInput`/`ShareMintResponse`/`SharedMediaDTO` not exported; `AttachmentKind.parse("media")` throws.

- [ ] **Step 3: Implement**

In `packages/shared/src/reports.ts`, extend the enum and DTO, and add media-meta schemas right below `AttachmentKind`:

```ts
export const AttachmentKind = z.enum([
  "screenshot",
  "annotated-screenshot",
  "replay",
  "logs",
  "user-file",
  "media",
])

/** Sidecar metadata for gallery media parts (`media[N]` + `mediaMeta`). */
export const MediaMetaEntry = z.object({
  kind: z.enum(["image", "video"]),
  mime: z.string().min(1).max(255),
  durationMs: z.number().int().nonnegative().optional(),
  trim: z
    .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })
    .refine((t) => t.endMs > t.startMs, "endMs must be after startMs")
    .optional(),
})
export type MediaMetaEntry = z.infer<typeof MediaMetaEntry>
export const MediaMetaInput = z.array(MediaMetaEntry).max(3)
export type MediaMetaInput = z.infer<typeof MediaMetaInput>
```

In `AttachmentDTO`, add:

```ts
  durationMs: z.number().int().nullable(),
  trimStartMs: z.number().int().nullable(),
  trimEndMs: z.number().int().nullable(),
```

In `packages/shared/src/projects.ts`: add to `UpdateProjectInput`:

```ts
  shareLinksEnabled: z.boolean().optional(),
  shareRetentionDays: z.number().int().min(1).max(365).optional(),
```

and to `ProjectDTO`:

```ts
  shareLinksEnabled: z.boolean(),
  shareRetentionDays: z.number().int(),
```

Create `packages/shared/src/shared-media.ts`:

```ts
import { z } from "zod"

export const ShareMintResponse = z.object({
  id: z.string().uuid(),
  token: z.string().min(43),
  shareUrl: z.string().url(),
  expiresAt: z.string(),
})
export type ShareMintResponse = z.infer<typeof ShareMintResponse>

export const SharedMediaDTO = z.object({
  id: z.string().uuid(),
  kind: z.literal("video"),
  mime: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  shareUrl: z.string().url(),
})
export type SharedMediaDTO = z.infer<typeof SharedMediaDTO>
```

Add `export * from "./shared-media"` to `packages/shared/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && bun test`
Expected: PASS (all shared tests, not just the new file — the enum change must not break existing tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): media attachment kind, media-meta contract, share-link DTOs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `@reprojs/sdk-utils` — shared byte formatter + media limits/validation

**Files:**
- Create: `packages/sdk-utils/src/format.ts`, `packages/sdk-utils/src/format.test.ts`
- Create: `packages/sdk-utils/src/media/types.ts`, `packages/sdk-utils/src/media/validate.ts`, `packages/sdk-utils/src/media/validate.test.ts`, `packages/sdk-utils/src/media/index.ts`
- Modify: `packages/sdk-utils/src/index.ts` (barrel: `export * from "./format"`, `export * from "./media"`)
- Modify: `packages/ui/src/wizard/attachment-list.tsx` (delete the local `formatBytes` at lines 14-18, import from `@reprojs/sdk-utils`)

**Interfaces:**
- Produces:
  - `formatBytes(n: number): string` — exact behavior of the current local helper in attachment-list.tsx (`<1024 → "N B"`, `<1 MiB → "K KB"` 0dp, else `"M MB"` 1dp).
  - `interface TrimRange { startMs: number; endMs: number }`
  - `type MediaKind = "image" | "video"`
  - `interface MediaLimits { maxCount: number; imageMaxBytes: number; videoMaxBytes: number }`
  - `const MEDIA_LIMITS: MediaLimits = { maxCount: 3, imageMaxBytes: 10 * 1024 * 1024, videoMaxBytes: 100 * 1024 * 1024 }`
  - `validateMediaSelection(items: { kind: MediaKind; sizeBytes: number }[], limits?: MediaLimits): { ok: boolean; errors: string[] }`

- [ ] **Step 1: Write the failing tests**

`packages/sdk-utils/src/format.test.ts`:

```ts
import { test, expect } from "bun:test"
import { formatBytes } from "./format"

test("formatBytes matches the widget's existing rendering", () => {
  expect(formatBytes(512)).toBe("512 B")
  expect(formatBytes(2048)).toBe("2 KB")
  expect(formatBytes(1_572_864)).toBe("1.5 MB")
})
```

`packages/sdk-utils/src/media/validate.test.ts`:

```ts
import { test, expect } from "bun:test"
import { MEDIA_LIMITS, validateMediaSelection } from "./validate"

test("accepts up to 3 items within per-kind caps", () => {
  const r = validateMediaSelection([
    { kind: "image", sizeBytes: 5 * 1024 * 1024 },
    { kind: "video", sizeBytes: 90 * 1024 * 1024 },
  ])
  expect(r.ok).toBe(true)
  expect(r.errors).toHaveLength(0)
})

test("rejects a 4th item", () => {
  const items = Array.from({ length: 4 }, () => ({ kind: "image" as const, sizeBytes: 1024 }))
  const r = validateMediaSelection(items)
  expect(r.ok).toBe(false)
  expect(r.errors[0]).toContain(String(MEDIA_LIMITS.maxCount))
})

test("rejects oversize video and oversize image with distinct messages", () => {
  expect(validateMediaSelection([{ kind: "video", sizeBytes: 101 * 1024 * 1024 }]).ok).toBe(false)
  expect(validateMediaSelection([{ kind: "image", sizeBytes: 11 * 1024 * 1024 }]).ok).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/sdk-utils && bun test src/format.test.ts src/media/validate.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

`packages/sdk-utils/src/format.ts` (move the exact logic from `packages/ui/src/wizard/attachment-list.tsx:14-18`):

```ts
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
```

(Before writing, read attachment-list.tsx lines 14-18 and copy its exact rounding — the test values above assume `Math.round` for KB and `toFixed(1)` for MB; if the source differs, match the source and fix the test.)

`packages/sdk-utils/src/media/types.ts`:

```ts
export type MediaKind = "image" | "video"

export interface TrimRange {
  startMs: number
  endMs: number
}

export interface MediaLimits {
  maxCount: number
  imageMaxBytes: number
  videoMaxBytes: number
}

export const MEDIA_LIMITS: MediaLimits = {
  maxCount: 3,
  imageMaxBytes: 10 * 1024 * 1024,
  videoMaxBytes: 100 * 1024 * 1024,
}
```

`packages/sdk-utils/src/media/validate.ts`:

```ts
import { formatBytes } from "../format"
import { MEDIA_LIMITS, type MediaKind, type MediaLimits } from "./types"

export { MEDIA_LIMITS } from "./types"

export function validateMediaSelection(
  items: { kind: MediaKind; sizeBytes: number }[],
  limits: MediaLimits = MEDIA_LIMITS,
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (items.length > limits.maxCount) {
    errors.push(`At most ${limits.maxCount} media items per report`)
  }
  for (const item of items) {
    const cap = item.kind === "video" ? limits.videoMaxBytes : limits.imageMaxBytes
    if (item.sizeBytes > cap) {
      errors.push(`${item.kind} exceeds ${formatBytes(cap)} limit`)
    }
  }
  return { ok: errors.length === 0, errors }
}
```

`packages/sdk-utils/src/media/index.ts`:

```ts
export * from "./types"
export * from "./validate"
```

Barrel: append `export * from "./format"` and `export * from "./media"` to `packages/sdk-utils/src/index.ts`.

In `packages/ui/src/wizard/attachment-list.tsx`: delete the local `formatBytes` (lines 14-18) and add `formatBytes` to the existing `@reprojs/sdk-utils` import.

- [ ] **Step 4: Run tests**

Run: `cd packages/sdk-utils && bun test && cd ../ui && bun test`
Expected: PASS — including the existing attachment-list tests (unchanged rendering).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk-utils packages/ui/src/wizard/attachment-list.tsx
git commit -m "feat(sdk-utils): shared formatBytes and media selection limits

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `@reprojs/core` — screen recording session (`screen-record.ts`)

**Files:**
- Create: `packages/core/src/screen-record.ts`
- Test: `packages/core/src/screen-record.test.ts` (model on `packages/core/src/display-media.test.ts`, which already shows how to bootstrap happy-dom and stub `navigator.mediaDevices.getDisplayMedia`)

**Interfaces:**
- Produces (consumed by Task 8's mount wiring and Task 5's UI):

```ts
export const MAX_RECORDING_MS = 300_000
export const RECORDING_VIDEO_BPS = 2_500_000
export type RecordingEndReason = "stopped" | "auto" | "track-ended" | "cancelled" | "error"
export interface RecordingResult { blob: Blob; mime: string; durationMs: number }
export interface RecordingSession {
  stop(): void                       // triggers onEnd("stopped") with assembled result
  cancel(): void                     // triggers onEnd("cancelled") with null result
  snapshot(): RecordingResult | null // best-effort assembly of chunks so far (pagehide flush)
  elapsedMs(): number
}
export interface ScreenRecordDeps {
  getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream>
  createMediaRecorder?: (stream: MediaStream, opts: MediaRecorderOptions) => MediaRecorder
  now?: () => number
}
export interface ScreenRecordOptions extends ScreenRecordDeps {
  maxMs?: number                                  // default MAX_RECORDING_MS
  onTick?: (elapsedMs: number) => void            // fired every TICK_MS (500)
  onEnd: (result: RecordingResult | null, reason: RecordingEndReason) => void
}
/** Resolves null (after calling nothing) when getDisplayMedia is unavailable/denied. */
export function startScreenRecording(opts: ScreenRecordOptions): Promise<RecordingSession | null>
```

Behavior contract:
- Requests `{ video: true, audio: false }` (no audio in v1).
- Picks mime: first supported of `video/webm;codecs=vp9`, `video/webm`, `video/mp4` via `MediaRecorder.isTypeSupported` (fall back to `video/webm` if `isTypeSupported` is absent).
- `new MediaRecorder(stream, { mimeType, videoBitsPerSecond: RECORDING_VIDEO_BPS })`, `start(1000)` (1s timeslice), chunks accumulated from `dataavailable`.
- Auto-stop when `elapsedMs() >= maxMs` (checked on the tick interval) → reason `"auto"`.
- Video track `ended` (user hits the browser's native "Stop sharing") → reason `"track-ended"` with assembled result.
- `cancel()` discards chunks, stops tracks, `onEnd(null, "cancelled")`.
- All paths stop every track and clear the interval exactly once (idempotent teardown).
- `getDisplayMedia` rejection or absence → resolve `null` (caller shows a toast); never throw.

- [ ] **Step 1: Write the failing test**

`packages/core/src/screen-record.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { startScreenRecording, MAX_RECORDING_MS, RECORDING_VIDEO_BPS } from "./screen-record"

let win: Window
beforeAll(() => {
  win = new Window()
  Object.assign(globalThis, { window: win, document: win.document, navigator: win.navigator })
})
afterAll(() => {
  // @ts-expect-error test cleanup of injected globals
  delete globalThis.window; // @ts-expect-error
  delete globalThis.document; // @ts-expect-error
  delete globalThis.navigator
})

type Listener = (ev: { data?: Blob }) => void

class FakeTrack {
  stopped = false
  private listeners: (() => void)[] = []
  stop() { this.stopped = true }
  addEventListener(_: "ended", cb: () => void) { this.listeners.push(cb) }
  fireEnded() { for (const cb of this.listeners) cb() }
}

class FakeStream {
  tracks = [new FakeTrack()]
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks }
}

class FakeMediaRecorder {
  static created: FakeMediaRecorder[] = []
  ondataavailable: Listener | null = null
  onstop: (() => void) | null = null
  state = "inactive"
  constructor(public stream: FakeStream, public opts: { mimeType?: string; videoBitsPerSecond?: number }) {
    FakeMediaRecorder.created.push(this)
  }
  start(_timeslice: number) { this.state = "recording" }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: "video/webm" }) })
    this.onstop?.()
  }
}

function deps(stream: FakeStream) {
  return {
    getDisplayMedia: async () => stream as unknown as MediaStream, // FakeStream implements the used surface
    createMediaRecorder: (s: MediaStream, o: MediaRecorderOptions) =>
      new FakeMediaRecorder(s as unknown as FakeStream, o) as unknown as MediaRecorder,
  }
}

test("constants match the spec", () => {
  expect(MAX_RECORDING_MS).toBe(300_000)
  expect(RECORDING_VIDEO_BPS).toBe(2_500_000)
})

test("stop() assembles chunks, reports duration, stops tracks", async () => {
  const stream = new FakeStream()
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({
    ...deps(stream),
    onEnd: (result, reason) => { ended = { result, reason } },
  })
  expect(session).not.toBeNull()
  session!.stop()
  await Bun.sleep(10)
  expect(ended!.reason).toBe("stopped")
  const result = ended!.result as { blob: Blob; mime: string; durationMs: number }
  expect(result.blob.size).toBeGreaterThan(0)
  expect(result.mime).toContain("video/")
  expect(stream.tracks[0]!.stopped).toBe(true)
})

test("cancel() discards and reports null", async () => {
  const stream = new FakeStream()
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({ ...deps(stream), onEnd: (r, reason) => { ended = { result: r, reason } } })
  session!.cancel()
  await Bun.sleep(10)
  expect(ended).toEqual({ result: null, reason: "cancelled" })
  expect(stream.tracks[0]!.stopped).toBe(true)
})

test("native stop-sharing (track ended) finishes the recording", async () => {
  const stream = new FakeStream()
  let reason = ""
  const session = await startScreenRecording({ ...deps(stream), onEnd: (_r, why) => { reason = why } })
  expect(session).not.toBeNull()
  stream.tracks[0]!.fireEnded()
  await Bun.sleep(10)
  expect(reason).toBe("track-ended")
})

test("auto-stops at maxMs", async () => {
  const stream = new FakeStream()
  let reason = ""
  await startScreenRecording({
    ...deps(stream),
    maxMs: 40,
    onEnd: (_r, why) => { reason = why },
  })
  await Bun.sleep(700) // TICK_MS is 500; one tick past maxMs must fire auto-stop
  expect(reason).toBe("auto")
})

test("returns null when getDisplayMedia rejects", async () => {
  const session = await startScreenRecording({
    getDisplayMedia: async () => { throw new Error("denied") },
    onEnd: () => {},
  })
  expect(session).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun test src/screen-record.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/core/src/screen-record.ts`**

```ts
export const MAX_RECORDING_MS = 300_000
export const RECORDING_VIDEO_BPS = 2_500_000
const TICK_MS = 500
const MIME_CANDIDATES = ["video/webm;codecs=vp9", "video/webm", "video/mp4"]

export type RecordingEndReason = "stopped" | "auto" | "track-ended" | "cancelled" | "error"

export interface RecordingResult {
  blob: Blob
  mime: string
  durationMs: number
}

export interface RecordingSession {
  stop(): void
  cancel(): void
  snapshot(): RecordingResult | null
  elapsedMs(): number
}

export interface ScreenRecordDeps {
  getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream>
  createMediaRecorder?: (stream: MediaStream, opts: MediaRecorderOptions) => MediaRecorder
  now?: () => number
}

export interface ScreenRecordOptions extends ScreenRecordDeps {
  maxMs?: number
  onTick?: (elapsedMs: number) => void
  onEnd: (result: RecordingResult | null, reason: RecordingEndReason) => void
}

function pickMime(): string {
  const MR = globalThis.MediaRecorder as typeof MediaRecorder | undefined
  if (!MR || typeof MR.isTypeSupported !== "function") return "video/webm"
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? "video/webm"
}

export async function startScreenRecording(opts: ScreenRecordOptions): Promise<RecordingSession | null> {
  const now = opts.now ?? (() => performance.now())
  const maxMs = opts.maxMs ?? MAX_RECORDING_MS
  const getDM =
    opts.getDisplayMedia ??
    (navigator.mediaDevices?.getDisplayMedia
      ? navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices)
      : null)
  if (!getDM) return null

  let stream: MediaStream
  try {
    stream = await getDM({ video: true, audio: false })
  } catch {
    return null
  }

  const mime = pickMime()
  const createRecorder =
    opts.createMediaRecorder ?? ((s: MediaStream, o: MediaRecorderOptions) => new MediaRecorder(s, o))
  let recorder: MediaRecorder
  try {
    recorder = createRecorder(stream, { mimeType: mime, videoBitsPerSecond: RECORDING_VIDEO_BPS })
  } catch {
    for (const t of stream.getTracks()) t.stop()
    return null
  }

  const chunks: Blob[] = []
  const startedAt = now()
  let finished = false
  let pendingReason: RecordingEndReason = "stopped"

  const elapsed = () => Math.max(0, Math.round(now() - startedAt))
  const assemble = (): RecordingResult | null =>
    chunks.length === 0 ? null : { blob: new Blob(chunks, { type: mime }), mime, durationMs: elapsed() }

  const teardown = () => {
    clearInterval(timer)
    for (const t of stream.getTracks()) t.stop()
  }

  const finish = (reason: RecordingEndReason, result: RecordingResult | null) => {
    if (finished) return
    finished = true
    teardown()
    opts.onEnd(result, reason)
  }

  recorder.ondataavailable = (ev: BlobEvent) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data)
  }
  recorder.onstop = () => {
    if (pendingReason === "cancelled") finish("cancelled", null)
    else finish(pendingReason, assemble())
  }
  recorder.onerror = () => {
    pendingReason = "error"
    stopRecorder()
  }

  const stopRecorder = () => {
    try {
      if (recorder.state !== "inactive") recorder.stop()
      else recorder.onstop?.call(recorder, new Event("stop"))
    } catch {
      finish(pendingReason === "cancelled" ? "cancelled" : "error", pendingReason === "cancelled" ? null : assemble())
    }
  }

  const videoTrack = stream.getVideoTracks()[0]
  videoTrack?.addEventListener("ended", () => {
    pendingReason = "track-ended"
    stopRecorder()
  })

  const timer = setInterval(() => {
    const ms = elapsed()
    opts.onTick?.(ms)
    if (ms >= maxMs) {
      pendingReason = "auto"
      stopRecorder()
    }
  }, TICK_MS)

  try {
    recorder.start(1000)
  } catch {
    finish("error", null)
    return null
  }

  return {
    stop() {
      pendingReason = "stopped"
      stopRecorder()
    },
    cancel() {
      pendingReason = "cancelled"
      chunks.length = 0
      stopRecorder()
    },
    snapshot: assemble,
    elapsedMs: elapsed,
  }
}
```

Note: the test's `FakeMediaRecorder` lacks `onerror`/`state` transitions beyond the used surface — the two `as unknown as` casts in the test are justified as test doubles implementing only the consumed surface.

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun test`
Expected: PASS (new file + all existing core tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/screen-record.ts packages/core/src/screen-record.test.ts
git commit -m "feat(core): screen recording session with auto-stop, cancel and snapshot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `@reprojs/ui` — gallery store (IndexedDB) + thumbnail helper

**Files:**
- Create: `packages/ui/src/gallery/store.ts`, `packages/ui/src/gallery/store.test.ts`
- Create: `packages/ui/src/gallery/thumbnail.ts`, `packages/ui/src/gallery/thumbnail.test.ts`
- Modify: `packages/ui/package.json` (add devDependency `fake-indexeddb`)

**Interfaces:**
- Consumes: `TrimRange` from `@reprojs/sdk-utils` (Task 2).
- Produces (consumed by Tasks 5-8):

```ts
export interface GalleryItem {
  id: string
  kind: "image" | "video"
  blob: Blob
  thumb: Blob | null
  mime: string
  sizeBytes: number
  durationMs?: number
  trim?: TrimRange
  createdAt: number
  shareUrl?: string
  shareToken?: string
  shareExpiresAt?: string
}
export const GALLERY_MAX_ITEMS = 50
export const GALLERY_MAX_TOTAL_BYTES = 500 * 1024 * 1024
export interface GalleryStore {
  add(item: GalleryItem): Promise<{ evicted: GalleryItem[] }>
  list(): Promise<GalleryItem[]>                    // newest first
  get(id: string): Promise<GalleryItem | null>
  update(id: string, patch: Partial<Pick<GalleryItem, "trim" | "shareUrl" | "shareToken" | "shareExpiresAt">>): Promise<void>
  remove(id: string): Promise<void>
}
/** Resolves null when IndexedDB is unavailable — callers must fail open. */
export function openGallery(deps?: { indexedDB?: IDBFactory }): Promise<GalleryStore | null>
```

- `thumbnail.ts` produces `makeThumbnail(blob: Blob, kind: "image" | "video"): Promise<Blob | null>` — image path decodes via `decodeImage` (reuse `packages/ui/src/decode-image.ts`, CSP-safe) and downscales to ≤160px on a canvas; video path returns `null` in v1 environments without seekable video (always wrapped in try/catch; any failure → `null`; UI renders a generic tile for `thumb: null`).

- [ ] **Step 1: Add fake-indexeddb**

Run: `cd packages/ui && bun add -d fake-indexeddb`
Expected: `fake-indexeddb` appears under devDependencies in `packages/ui/package.json`.

- [ ] **Step 2: Write the failing store test**

`packages/ui/src/gallery/store.test.ts`:

```ts
import { beforeEach, expect, test } from "bun:test"
import { IDBFactory } from "fake-indexeddb"
import { GALLERY_MAX_ITEMS, openGallery, type GalleryItem } from "./store"

let idb: IDBFactory
beforeEach(() => {
  idb = new IDBFactory() // fresh DB per test
})

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  const blob = new Blob(["x".repeat(overrides.sizeBytes ?? 100)], { type: "image/png" })
  return {
    id: crypto.randomUUID(),
    kind: "image",
    blob,
    thumb: null,
    mime: "image/png",
    sizeBytes: blob.size,
    createdAt: Date.now(),
    ...overrides,
  }
}

test("add + list returns newest first", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const a = item({ createdAt: 1000 })
  const b = item({ createdAt: 2000 })
  await store.add(a)
  await store.add(b)
  const all = await store.list()
  expect(all.map((i) => i.id)).toEqual([b.id, a.id])
})

test("get/update/remove roundtrip", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const v = item({ kind: "video", mime: "video/webm", durationMs: 9000 })
  await store.add(v)
  await store.update(v.id, { trim: { startMs: 500, endMs: 8000 }, shareUrl: "https://x/s/tok" })
  const got = await store.get(v.id)
  expect(got?.trim).toEqual({ startMs: 500, endMs: 8000 })
  expect(got?.shareUrl).toBe("https://x/s/tok")
  await store.remove(v.id)
  expect(await store.get(v.id)).toBeNull()
})

test("evicts oldest past GALLERY_MAX_ITEMS", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  const items = Array.from({ length: GALLERY_MAX_ITEMS + 1 }, (_, i) => item({ createdAt: i + 1 }))
  let evicted: GalleryItem[] = []
  for (const it of items) {
    const r = await store.add(it) // eslint-disable-line no-await-in-loop -- sequential inserts are the behavior under test
    evicted = evicted.concat(r.evicted)
  }
  expect(evicted.map((e) => e.id)).toEqual([items[0]!.id])
  expect((await store.list())).toHaveLength(GALLERY_MAX_ITEMS)
})

test("evicts oldest past the byte budget", async () => {
  const store = (await openGallery({ indexedDB: idb }))!
  // Use a tiny injected budget via the exported test seam
  const big = item({ sizeBytes: 400 })
  const bigger = item({ sizeBytes: 400, createdAt: Date.now() + 1 })
  await store.add(big)
  const r = await store.add(bigger, /* maxTotalBytes test seam */ 600)
  expect(r.evicted.map((e) => e.id)).toEqual([big.id])
})

test("openGallery returns null without IndexedDB", async () => {
  expect(await openGallery({ indexedDB: undefined })).toBeNull()
})
```

Note: `add` takes an optional second parameter `maxTotalBytes` (defaults `GALLERY_MAX_TOTAL_BYTES`) purely so the byte-eviction path is testable without allocating 500 MB. Reflect that in the `GalleryStore` interface: `add(item: GalleryItem, maxTotalBytes?: number)`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/ui && bun test src/gallery/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `packages/ui/src/gallery/store.ts`**

```ts
import type { TrimRange } from "@reprojs/sdk-utils"

export interface GalleryItem {
  id: string
  kind: "image" | "video"
  blob: Blob
  thumb: Blob | null
  mime: string
  sizeBytes: number
  durationMs?: number
  trim?: TrimRange
  createdAt: number
  shareUrl?: string
  shareToken?: string
  shareExpiresAt?: string
}

export const GALLERY_MAX_ITEMS = 50
export const GALLERY_MAX_TOTAL_BYTES = 500 * 1024 * 1024
const DB_NAME = "repro-gallery"
const STORE = "media"

export interface GalleryStore {
  add(item: GalleryItem, maxTotalBytes?: number): Promise<{ evicted: GalleryItem[] }>
  list(): Promise<GalleryItem[]>
  get(id: string): Promise<GalleryItem | null>
  update(
    id: string,
    patch: Partial<Pick<GalleryItem, "trim" | "shareUrl" | "shareToken" | "shareExpiresAt">>,
  ): Promise<void>
  remove(id: string): Promise<void>
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error)
  })
}

export async function openGallery(deps?: { indexedDB?: IDBFactory }): Promise<GalleryStore | null> {
  const factory = deps ? deps.indexedDB : globalThis.indexedDB
  if (!factory) return null
  let db: IDBDatabase
  try {
    const open = factory.open(DB_NAME, 1)
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE, { keyPath: "id" })
      store.createIndex("createdAt", "createdAt")
    }
    db = await req(open as IDBRequest<IDBDatabase>)
  } catch {
    return null
  }

  const listAll = async (): Promise<GalleryItem[]> => {
    const tx = db.transaction(STORE, "readonly")
    const rows = await req(tx.objectStore(STORE).getAll() as IDBRequest<GalleryItem[]>)
    return rows.sort((a, b) => b.createdAt - a.createdAt)
  }

  return {
    async add(item, maxTotalBytes = GALLERY_MAX_TOTAL_BYTES) {
      const existing = await listAll()
      const evicted: GalleryItem[] = []
      // Evict oldest-first until both budgets fit the incoming item.
      let count = existing.length + 1
      let bytes = existing.reduce((n, i) => n + i.sizeBytes, 0) + item.sizeBytes
      for (let i = existing.length - 1; i >= 0 && (count > GALLERY_MAX_ITEMS || bytes > maxTotalBytes); i--) {
        const victim = existing[i]!
        evicted.push(victim)
        count--
        bytes -= victim.sizeBytes
      }
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      for (const v of evicted) store.delete(v.id)
      store.put(item)
      await txDone(tx)
      return { evicted }
    },
    list: listAll,
    async get(id) {
      const tx = db.transaction(STORE, "readonly")
      const row = await req(tx.objectStore(STORE).get(id) as IDBRequest<GalleryItem | undefined>)
      return row ?? null
    },
    async update(id, patch) {
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      const row = await req(store.get(id) as IDBRequest<GalleryItem | undefined>)
      if (row) store.put({ ...row, ...patch })
      await txDone(tx)
    },
    async remove(id) {
      const tx = db.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(id)
      await txDone(tx)
    },
  }
}
```

- [ ] **Step 5: Write + implement the thumbnail helper**

`packages/ui/src/gallery/thumbnail.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { makeThumbnail } from "./thumbnail"

let win: Window
beforeAll(() => {
  win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})
afterAll(() => {
  // @ts-expect-error test cleanup
  delete globalThis.window; // @ts-expect-error
  delete globalThis.document
})

test("returns null instead of throwing when decoding is impossible", async () => {
  const junk = new Blob(["not an image"], { type: "image/png" })
  expect(await makeThumbnail(junk, "image")).toBeNull()
  expect(await makeThumbnail(junk, "video")).toBeNull()
})
```

`packages/ui/src/gallery/thumbnail.ts`:

```ts
import { closeSource, decodeImage, sourceHeight, sourceWidth } from "../decode-image"

const MAX_EDGE = 160

/** Best-effort poster/preview. Any failure returns null — UI renders a generic tile. */
export async function makeThumbnail(blob: Blob, kind: "image" | "video"): Promise<Blob | null> {
  if (kind !== "image") return null // video posters need blob: URLs, which strict host CSPs block; v1 uses a generic tile
  try {
    const source = await decodeImage(blob)
    if (!source) return null
    try {
      const w = sourceWidth(source)
      const h = sourceHeight(source)
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    } finally {
      closeSource(source)
    }
  } catch {
    return null
  }
}
```

(Check the actual export names in `packages/ui/src/decode-image.ts` before writing — the exploration confirmed `decodeImage`, `ImageSource`, `sourceWidth`, `sourceHeight`, `closeSource` exist; if `drawImage` needs a narrower type than `CanvasImageSource`, follow how `annotation/flatten` draws the same `ImageSource`.)

- [ ] **Step 6: Run tests**

Run: `cd packages/ui && bun test src/gallery/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/gallery packages/ui/package.json bun.lock
git commit -m "feat(ui): IndexedDB gallery store with quota eviction and thumbnail helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `@reprojs/ui` — recording UI (control bar, trim screen, outcome bar)

**Files:**
- Create: `packages/ui/src/record/control-bar.tsx`, `packages/ui/src/record/trim-screen.tsx`, `packages/ui/src/record/outcome-bar.tsx`
- Test: `packages/ui/src/record/control-bar.test.ts`, `packages/ui/src/record/trim-screen.test.ts`, `packages/ui/src/record/outcome-bar.test.ts`
- Modify: `packages/ui/src/styles.css` (new `.ft-rec-*`, `.ft-trim-*`, `.ft-outcome-*` classes), then regen `styles-inline.ts`

**Interfaces:**
- Consumes: `formatBytes`, `TrimRange` (Task 2); `GalleryItem` (Task 4); existing `PrimaryButton`/`SecondaryButton` from `wizard/controls.tsx`.
- Produces (consumed by Task 6/8 mount):

```ts
// control-bar.tsx
export function RecordControlBar(props: {
  elapsedMs: number
  maxMs: number
  onStop: () => void
  onCancel: () => void
}): JSX.Element  // renders mm:ss / 5:00, a Stop and a Cancel button

// trim-screen.tsx
export function TrimScreen(props: {
  blob: Blob
  durationMs: number
  initial?: TrimRange
  onConfirm: (trim: TrimRange | undefined) => void  // undefined = full length
  onCancel: () => void
}): JSX.Element
export function clampTrim(t: { startMs: number; endMs: number }, durationMs: number): TrimRange | undefined
// clampTrim: clamps into [0, durationMs], snaps to 100ms, returns undefined when the range covers the full clip

// outcome-bar.tsx
export function OutcomeBar(props: {
  kind: "image" | "video"
  onSave: () => void
  onDiscard: () => void
  onReport: () => void
}): JSX.Element  // "Save to gallery" / "Discard" / "Report bug with this"
```

Trim-screen behavior: renders a `<video>` via `URL.createObjectURL(blob)` inside try/catch — if the host CSP blocks `blob:` media (`onerror` on the video element), show a fallback message ("Preview unavailable on this site — the recording is intact") and keep the Confirm/Cancel buttons working with numeric-only trim inputs. Always `URL.revokeObjectURL` on unmount.

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/record/trim-screen.test.ts` (the pure logic is the valuable test; component render smoke-tested like `step-review.test.ts` does — copy its happy-dom bootstrap):

```ts
import { expect, test } from "bun:test"
import { clampTrim } from "./trim-screen"

test("clampTrim clamps to duration and snaps to 100ms", () => {
  expect(clampTrim({ startMs: -50, endMs: 99_999 }, 10_000)).toEqual({ startMs: 0, endMs: 10_000 })
  expect(clampTrim({ startMs: 149, endMs: 8_051 }, 10_000)).toEqual({ startMs: 100, endMs: 8_100 })
})

test("clampTrim returns undefined for a full-length range", () => {
  expect(clampTrim({ startMs: 0, endMs: 10_000 }, 10_000)).toBeUndefined()
  expect(clampTrim({ startMs: 49, endMs: 10_000 }, 10_000)).toBeUndefined() // snaps to 0..duration
})

test("clampTrim keeps at least 100ms of clip", () => {
  expect(clampTrim({ startMs: 5_000, endMs: 5_020 }, 10_000)).toEqual({ startMs: 5_000, endMs: 5_100 })
})
```

`control-bar.test.ts` and `outcome-bar.test.ts`: render with preact `render()` into a happy-dom document (bootstrap identical to `packages/ui/src/wizard/step-review.test.ts`), assert: control bar shows `0:07 / 5:00` for `elapsedMs: 7_000, maxMs: 300_000`; clicking Stop/Cancel/Save/Discard/Report fires the matching callback exactly once.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/ui && bun test src/record/`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the three components**

`clampTrim` (in trim-screen.tsx):

```ts
export function clampTrim(t: { startMs: number; endMs: number }, durationMs: number): TrimRange | undefined {
  const snap = (n: number) => Math.round(n / 100) * 100
  const start = Math.min(Math.max(0, snap(t.startMs)), durationMs)
  let end = Math.min(Math.max(0, snap(t.endMs)), durationMs)
  if (end - start < 100) end = Math.min(durationMs, start + 100)
  if (start <= 0 && end >= durationMs) return undefined
  return { startMs: start, endMs: end }
}
```

Component markup uses `h()`/JSX consistent with existing wizard components, `PrimaryButton`/`SecondaryButton` from `../wizard/controls`, and classes: `.ft-rec-bar` (fixed bottom-center pill: red dot, `elapsed / max` mono text, stop + cancel), `.ft-trim` (video preview, two `<input type="range">` sliders for start/end bound to ms state, live labels via a local `msToClock(ms)` helper), `.ft-outcome-bar` (three buttons; Report is primary, Save secondary, Discard tertiary/text). Control bar formats time as `Math.floor(ms/60000)}:${String(Math.floor((ms%60000)/1000)).padStart(2,"0")`.

Add the CSS to `packages/ui/src/styles.css` following the `.ft-wizard` section's token usage (`var(--ft-color-*)`, `var(--ft-radius-*)`), then run `bun run packages/ui/build-css.ts`.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/record packages/ui/src/styles.css packages/ui/src/styles-inline.ts
git commit -m "feat(ui): recording control bar, metadata trim screen and outcome bar

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `@reprojs/ui` — launcher menu, capture flow, gallery view

**Files:**
- Create: `packages/ui/src/menu.tsx` + `packages/ui/src/menu.test.ts`
- Create: `packages/ui/src/capture-flow.tsx` + `packages/ui/src/capture-flow.test.ts`
- Create: `packages/ui/src/gallery/gallery-view.tsx` + `packages/ui/src/gallery/gallery-view.test.ts`
- Modify: `packages/ui/src/styles.css` (+ regen)

**Interfaces:**
- Consumes: `StepAnnotate` (existing, props `{ bg, steps, currentStep, onSkip, onNext(blob), onCancel }`), `OutcomeBar` (Task 5), `GalleryStore`/`GalleryItem`/`makeThumbnail` (Task 4), `decodeImage` (existing), `formatBytes` (Task 2), `BlobImage` (existing `packages/ui/src/blob-image.tsx`).
- Produces (consumed by Task 8's mount rewrite):

```ts
// menu.tsx
export function LauncherMenu(props: {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  onCapture: () => void
  onRecord: () => void
  onReport: () => void
  onGallery: () => void
  onClose: () => void
}): JSX.Element

// capture-flow.tsx — capture → annotate → outcome
export function CaptureFlow(props: {
  onCapture: () => Promise<Blob | null>          // same capture fn the reporter used
  onDone: (outcome:
    | { action: "saved"; item: PendingMediaItem }
    | { action: "discarded" }
    | { action: "report"; item: PendingMediaItem }) => void
}): JSX.Element
export interface PendingMediaItem {
  kind: "image" | "video"
  blob: Blob
  mime: string
  durationMs?: number
  trim?: TrimRange
}

// gallery-view.tsx
export function GalleryView(props: {
  store: GalleryStore
  canShare: boolean                               // mint callback wired? (Task 15)
  onCopyLink: (item: GalleryItem) => Promise<{ url: string } | { error: string }>
  onReportWith: (item: GalleryItem) => void
  onClose: () => void
}): JSX.Element
```

`CaptureFlow` behavior: on mount calls `onCapture()`; null → `onDone({ action: "discarded" })` (denied dialog = silent exit, matching today's reporter). Decodes via `decodeImage`, shows `StepAnnotate` with `steps: ["Annotate"], currentStep: 0`; `onNext(annotatedBlob)` and `onSkip` (raw blob) both land on `OutcomeBar` with an image preview (`BlobImage`).

`GalleryView` behavior: loads `store.list()` on mount; grid of tiles (thumb via `BlobImage` when `thumb` present, generic 🎬/🖼 tile otherwise, duration + `formatBytes(sizeBytes)` caption); per-tile actions: preview (image → `BlobImage` large; video → objectURL `<video>` clamped to `trim` with the same CSP-fallback as TrimScreen), delete, **Copy link** (videos only, only when `canShare`; shows spinner → writes `navigator.clipboard.writeText(url)` → "Copied!"; error string rendered inline), **Report bug with this**.

- [ ] **Step 1: Write failing tests** — happy-dom render tests (bootstrap copied from `step-details.test.ts`):
  - `menu.test.ts`: renders three primary options with exact labels "Capture", "Record screen", "Report bug" plus a "Gallery" entry; each click fires its callback once and only once.
  - `capture-flow.test.ts`: with `onCapture: async () => null` it calls `onDone({ action: "discarded" })`; with a real PNG blob (`makePngBlob`-style helper — build a 1x1 PNG `Uint8Array` inline, see `decode-image.test.ts` for a valid fixture) it reaches the annotate stage (assert an element with class `ft-annotate` or the StepAnnotate root exists).
  - `gallery-view.test.ts`: seed a store (fake-indexeddb via Task 4's `openGallery`) with one image + one video; assert two tiles render; "Copy link" appears only on the video tile and only when `canShare: true`; delete removes the tile from the DOM after settling.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/ui && bun test src/menu.test.ts src/capture-flow.test.ts src/gallery/gallery-view.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the three components** per the interfaces above. Styling: `.ft-menu` is a small anchored popover above the launcher (`position: fixed`, placed by the same `.pos-*` classes the launcher uses), rows with icon + label + one-line hint ("Record screen" hint: "Up to 5 minutes"). `.ft-gallery` reuses `.ft-wizard` shell classes for the panel; tiles `.ft-gallery-tile`. Regenerate styles: `bun run packages/ui/build-css.ts`.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/menu.tsx packages/ui/src/menu.test.ts packages/ui/src/capture-flow.tsx packages/ui/src/capture-flow.test.ts packages/ui/src/gallery packages/ui/src/styles.css packages/ui/src/styles-inline.ts
git commit -m "feat(ui): launcher menu, capture flow with outcome bar, gallery view

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `@reprojs/ui` — 2-step report wizard with media picker

**Files:**
- Modify: `packages/ui/src/reporter.tsx` (drop the annotate step + auto-capture; 2 steps)
- Modify: `packages/ui/src/wizard/step-details.tsx` (add Media section)
- Create: `packages/ui/src/wizard/media-picker.tsx` + `packages/ui/src/wizard/media-picker.test.ts`
- Modify: `packages/ui/src/wizard/step-review.tsx` consumers (summary lines built in reporter)
- Test: update `packages/ui/src/reporter.test.ts` (if present) and `step-details.test.ts`

**Interfaces:**
- Consumes: `GalleryStore`, `GalleryItem` (Task 4); `validateMediaSelection`, `MEDIA_LIMITS` (Task 2); `PendingMediaItem` (Task 6).
- Produces — the NEW submit payload consumed by Task 8's mount/core wiring:

```ts
// reporter.tsx
interface ReporterProps {
  onClose: () => void
  onSubmit: (payload: {
    title: string
    description: string
    media: GalleryItem[]              // selected gallery items (replaces the old `screenshot` field)
    attachments: Attachment[]         // user files, unchanged
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  openedAt: number
  gallery: GalleryStore | null        // null = IndexedDB unavailable; picker hides gallery grid
  preselectedId?: string              // set when arriving via "Report bug with this"
  onCaptureNow: () => void            // mount switches to capture flow, returns with preselect
  onRecordNow: () => void
}

// media-picker.tsx
export function MediaPicker(props: {
  items: GalleryItem[]
  selectedIds: string[]
  errors: string[]
  onToggle: (id: string) => void
  onCaptureNow: () => void
  onRecordNow: () => void
}): JSX.Element
```

Reporter changes, exactly:
1. `STEPS = ["Details", "Review"] as const`, `STEP_INDEX = { details: 0, review: 1 }`; initial step `"details"`; delete `bg`/`annotatedBlob`/`rawScreenshot` state and the mount-capture `useEffect` (lines 48-80) and the `"Capturing…"` loading branch.
2. New state: `mediaItems: GalleryItem[]` (loaded from `props.gallery?.list()` in a mount effect), `selectedMediaIds: string[]` (seeded from `preselectedId`), `mediaErrors: string[]`.
3. Selection toggle runs `validateMediaSelection(chosen.map(i => ({ kind: i.kind, sizeBytes: i.sizeBytes })))` and blocks over-limit selections with the returned errors.
4. `handleSend()` passes `media: mediaItems.filter(i => selectedMediaIds.includes(i.id))` instead of `screenshot`.
5. Summary lines: replace the "Screenshot/Annotated" line with `Media — hint: "N selected"` (omit when 0); keep Console/network, Environment, Additional attachments lines.
6. The paste-to-attach effect and honeypot/dwell logic stay untouched.

`StepDetails` gains props `mediaItems: GalleryItem[]`, `selectedMediaIds: string[]`, `mediaErrors: string[]`, `onMediaToggle`, `onCaptureNow`, `onRecordNow` and renders `<MediaPicker>` between the description textarea and `AttachmentList`, replacing the old `annotatedBlob` preview block (delete the `annotatedBlob` prop).

- [ ] **Step 1: Write failing tests**
  - `media-picker.test.ts`: renders one chip per item with selected state; toggle fires; "Capture now" / "Record now" buttons fire callbacks; renders `errors` list.
  - Update `step-details.test.ts`: remove `annotatedBlob` prop usages; assert the media section heading renders and `AttachmentList` still renders.
  - Reporter-level: if `reporter.test.ts` exists, update its prop construction (`gallery: null, onCaptureNow: noop, onRecordNow: noop`, drop `onCapture`) and assert the first rendered step is Details (no "Capturing…" text ever appears).

- [ ] **Step 2: Run to verify failures**

Run: `cd packages/ui && bun test src/wizard/ src/reporter.test.ts`
Expected: FAIL (missing module + changed props).

- [ ] **Step 3: Implement** per the interface block above. MediaPicker chip: thumbnail (or icon) + kind badge + duration/size caption + checkmark overlay when selected; buttons row `Capture now` / `Record now` uses `SecondaryButton`.

- [ ] **Step 4: Run tests**

Run: `cd packages/ui && bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src
git commit -m "feat(ui): two-step report wizard fed by the gallery media picker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Mode-aware mount + core wiring + intake client media parts + hotkey + demo

**Files:**
- Modify: `packages/ui/src/mount.ts` (mode state machine), `packages/ui/src/index.ts` (new exports)
- Modify: `packages/core/src/index.ts`, `packages/core/src/config.ts`, `packages/core/src/intake-client.ts`
- Create: `packages/core/src/hotkey.ts` + `packages/core/src/hotkey.test.ts`
- Test: `packages/core/src/intake-client.test.ts` (extend), `packages/ui/src/mount.test.ts` (extend if present)
- Modify: `packages/ui/demo/index.html` (mention the menu; the `/csp` route already exercises strict-CSP — recording preview fallback is verified there manually)

**Interfaces:**
- Consumes: everything from Tasks 3-7.
- Produces:

```ts
// ui mount.ts — replaces boolean open state with a mode machine
export type WidgetMode = "closed" | "menu" | "capture" | "record" | "trim" | "gallery" | "report"
export interface MountOptions {
  config: { position: ...; launcher: boolean }
  capture: () => Promise<Blob | null>
  startRecording: (cb: {                        // wraps core startScreenRecording
    onTick: (elapsedMs: number) => void
    onEnd: (result: RecordingResult | null, reason: RecordingEndReason) => void
  }) => Promise<{ stop(): void; cancel(): void; snapshot(): RecordingResult | null } | null>
  mintShareLink?: (item: PendingShareInput) => Promise<{ url: string; expiresAt: string } | { error: string }>
  onSubmit: (payload: /* Task 7 payload */) => Promise<ReporterSubmitResult>
  onOpen?: () => void   // fired when mode leaves "closed" (pauses replay, as today)
  onClose?: () => void  // fired when mode returns to "closed"
}
export interface PendingShareInput { blob: Blob; mime: string; durationMs?: number; trim?: TrimRange }
// exports: mount, unmount, close (mode→closed), open() /* report mode, back-compat */,
//          openMenu(), openCapture(), openRecord(), openGallery()

// core index.ts — new top-level exports (all throw "Repro.<fn> called before init" when uninitialized)
export function openMenu(): void
export function capture(): void
export function record(): void
// core config.ts
export interface InitOptions { ...existing; hotkey?: string /* e.g. "ctrl+shift+b"; default undefined = off */ }

// core intake-client.ts — IntakeInput changes
export interface IntakeMediaItem { blob: Blob; mime: string; kind: "image" | "video"; durationMs?: number; trim?: TrimRange }
export interface IntakeInput { ...existing minus `screenshot`; media?: IntakeMediaItem[] }
// postReport appends, per item i: part `media[${i}]` as File `media-${i}.<ext>` (ext from mime map:
// png/jpeg/webp/webm/mp4), plus ONE part `mediaMeta` = JSON Blob of MediaMetaEntry[] aligned by index.
```

Core `init()` wiring changes (index.ts lines 47-95 region):
- `startRecording` calls `startScreenRecording({ onTick, onEnd })` from Task 3; while a recording is active, register a `pagehide` listener that calls `session.snapshot()` and best-effort-writes it to the gallery store (fire-and-forget; IndexedDB may not settle before unload — acceptable, spec says best-effort).
- `onSubmit` maps the Task 7 payload: `media: payload.media.map(g => ({ blob: g.blob, mime: g.mime, kind: g.kind, durationMs: g.durationMs, trim: g.trim }))`. The `screenshot` field of `IntakeInput` is REMOVED; the legacy `screenshot` multipart part is no longer sent (dashboard keeps accepting it from old SDKs — no server change needed for that).
- `mintShareLink` is stubbed as `undefined` in this task (Task 15 provides it) — `GalleryView` receives `canShare: false` until then.
- Hotkey: `hotkey.ts` exports `parseHotkey(spec: string): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } | null` and `attachHotkey(spec: string, onTrigger: () => void): () => void` (returns detach; ignores events with `event.target` inside editable elements — `input`, `textarea`, `[contenteditable]`). `init()` attaches it when `options.hotkey` is set, pointing at `openMenu`. Launcher click also routes to `openMenu()` (THE one intentional behavior change — old direct-open moves to `open()`).

- [ ] **Step 1: Write failing tests**
  - `hotkey.test.ts` (pure, no DOM for parse; happy-dom for attach): `parseHotkey("ctrl+shift+b")` → `{ ctrl: true, shift: true, alt: false, meta: false, key: "b" }`; `parseHotkey("")` → null; `attachHotkey` fires on a synthesized matching `keydown` on `window`, not on a non-matching one, and not when the target is a `<textarea>`; detach stops firing.
  - Extend `intake-client.test.ts`: build `IntakeInput` with two media items (one image with no trim, one video with `trim {startMs:1000,endMs:4000}` and `durationMs: 5000`); intercept `fetch` (existing test pattern — the file already stubs fetch; follow it), assert FormData contains parts `media[0]`, `media[1]`, and `mediaMeta` whose JSON parses to the aligned `MediaMetaEntry[]`, and does NOT contain a `screenshot` part.
  - Mode machine (in `mount.test.ts` or new): after `mount(...)`, `openMenu()` renders 3 options; `open()` renders the report wizard directly (back-compat); `close()` returns to closed and fires `onClose` exactly once.

- [ ] **Step 2: Run to verify failures**

Run: `cd packages/core && bun test src/hotkey.test.ts src/intake-client.test.ts && cd ../ui && bun test src/mount.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `mount.ts`: replace `_setOpenExternal` boolean bridge with `_setModeExternal: ((m: WidgetMode) => void) | null`; `App` holds `mode` state + `pendingReportPreselect: string | null` + an active-recording ref; `useEffect([mode])` fires `onOpen` when leaving `"closed"` and `onClose` when entering it (skip initial mount, same `mounted` ref trick as today). Mode renders: `menu` → `LauncherMenu`; `capture` → `CaptureFlow` (onDone: saved → write store + toast + closed; report → write store + set preselect + mode `report`; discarded → closed); `record` → start via `opts.startRecording`, render `RecordControlBar`, then on end (non-null result) render `TrimScreen` (mode `trim`), then `OutcomeBar`, same three outcomes (gallery writes include `makeThumbnail` + `durationMs` + confirmed `trim`; when `store.add` returns evicted items, show a toast naming the oldest dropped item, per spec); `gallery` → `GalleryView`; `report` → `Reporter` (Task 7 props; `onCaptureNow`/`onRecordNow` stash "return-to-report" and switch mode). Denied recording (`startRecording` → null) → toast "Screen recording unavailable" + back to `menu`.
  - `intake-client.ts`: after the existing `attachment[${i}]` loop, append media parts + `mediaMeta` JSON Blob (`application/json`); ext map `{ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4" }`, default `"bin"`.
  - `core/index.ts` + `config.ts` + `hotkey.ts` per interfaces above. `resolveConfig` passes `hotkey` through unvalidated (parse failure = silently off, fail-open).
  - `ui/src/index.ts`: export `openMenu, openCapture, openRecord, openGallery` alongside existing exports.
  - Demo: in `packages/ui/demo/index.html`, update the intro copy to name the three modes; no new route needed (`/csp` already exists for the strict-CSP manual pass).

- [ ] **Step 4: Run the full SDK test + build sweep**

Run: `bun run sdk:build && cd packages/core && bun test && cd ../ui && bun test && cd ../sdk-utils && bun test`
Expected: build succeeds (styles-inline regenerated, IIFE bundles), all tests PASS.

- [ ] **Step 5: Manual demo smoke**

Run: `bun run demo` then open `http://localhost:4000` — menu opens with 3 options; capture → annotate → save lands in gallery; record → stop → trim → save; report shows the 2-step wizard with the saved items. On `/csp`, confirm the trim preview shows the CSP fallback message instead of a broken player.

- [ ] **Step 6: Commit**

```bash
git add packages/core packages/ui
git commit -m "feat(sdk): 3-mode launcher menu, recording flow wiring, media intake parts and open-menu hotkey

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard schema migration (media kind, trim columns, share settings, shared_media)

**Files:**
- Modify: `apps/dashboard/server/db/schema/reports.ts` (kind enum array + CHECK at lines ~106-109; new columns)
- Modify: `apps/dashboard/server/db/schema/projects.ts` (two new columns)
- Create: `apps/dashboard/server/db/schema/shared-media.ts`
- Modify: the schema barrel (`apps/dashboard/server/db/schema/index.ts` — confirm the existing export pattern and add `export * from "./shared-media"`)
- Generated: new migration under `apps/dashboard/server/db/migrations/` via `bun run db:gen` (NEVER hand-written)

**Interfaces:**
- Produces (consumed by Tasks 10-18): `reportAttachments` columns `durationMs`, `trimStartMs`, `trimEndMs` (nullable integers); `projects.shareLinksEnabled` (boolean, notNull, default true), `projects.shareRetentionDays` (integer, notNull, default 30); table `sharedMedia` + types `SharedMedia`, `NewSharedMedia`.

- [ ] **Step 1: Edit `reports.ts`**

In the `report_attachments` `kind` column, add `"media"` to BOTH the `{ enum: [...] }` array and the `sql` CHECK constraint list (mirror how the 5 existing values appear — the constraint is named `report_attachments_kind_check`). Add below the scan columns:

```ts
  durationMs: integer("duration_ms"),
  trimStartMs: integer("trim_start_ms"),
  trimEndMs: integer("trim_end_ms"),
```

- [ ] **Step 2: Edit `projects.ts`** — after `replayEnabled`:

```ts
  shareLinksEnabled: boolean("share_links_enabled").notNull().default(true),
  shareRetentionDays: integer("share_retention_days").notNull().default(30),
```

- [ ] **Step 3: Create `shared-media.ts`**

```ts
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const sharedMedia = pgTable(
  "shared_media",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    kind: text("kind", { enum: ["video"] }).notNull(),
    mime: text("mime").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    trimStartMs: integer("trim_start_ms"),
    trimEndMs: integer("trim_end_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("shared_media_project_idx").on(t.projectId), index("shared_media_expires_idx").on(t.expiresAt)],
)

export type SharedMedia = typeof sharedMedia.$inferSelect
export type NewSharedMedia = typeof sharedMedia.$inferInsert
```

(Match the index-definition style of the existing schema files — if they use the object callback form `(t) => ({ ... })`, use that form instead. Note: `sizeBytes` as `integer` matches `report_attachments.sizeBytes`; 100 MB fits comfortably in int4. Drop the unused `boolean` import if oxlint flags it.)

- [ ] **Step 4: Generate + apply migration**

Run (repo root, Postgres up via `bun run dev:docker`):

```bash
bun run db:gen
bun run db:migrate
```

Expected: ONE new migration file appears; inspect it and confirm it contains exactly: the `report_attachments_kind_check` DROP+ADD (now including `'media'`), three `ADD COLUMN` on report_attachments, two `ADD COLUMN` on projects with defaults, and `CREATE TABLE "shared_media"` + its indexes + unique token constraint. `db:migrate` exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/db
git commit -m "feat(dashboard): schema for media attachments, share settings and shared_media

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Intake — accept `media[N]` + `mediaMeta` parts on report submission

**Files:**
- Modify: `apps/dashboard/server/api/intake/reports.ts`
- Modify: the env module (locate with `grep -rn "INTAKE_USER_FILE_MAX_BYTES" apps/dashboard/server/` — add the three new vars beside it, same zod/default pattern)
- Test: `apps/dashboard/tests/api/intake-media.test.ts` (model on `apps/dashboard/tests/api/intake-attachments.test.ts`)

**Interfaces:**
- Consumes: `MediaMetaInput`/`MediaMetaEntry` (Task 1), schema columns (Task 9).
- Produces: reports whose `report_attachments` rows have `kind: "media"`, `filename: media-<idx>.<ext>`, storage key `${report.id}/media/${idx}.<ext>`, and populated `durationMs`/`trimStartMs`/`trimEndMs`.
- New env vars (server-authoritative limits): `INTAKE_MEDIA_MAX_COUNT` (default 3), `INTAKE_MEDIA_IMAGE_MAX_BYTES` (default 10_485_760), `INTAKE_MEDIA_VIDEO_MAX_BYTES` (default 104_857_600). Also RAISE the `INTAKE_MAX_BYTES` default to 157_286_400 (150 MB) so one max video + report fits; keep the old value in `.env.example` comments if one exists.
- Allowed media mimes (constant in reports.ts): `image/png`, `image/jpeg`, `image/webp`, `video/webm`, `video/mp4`. Anything else → 415.
- ClamAV policy (explicit decision): media parts are scanned under the same `INTAKE_USER_FILE_SCAN_ENABLED` flag, but ONLY when `part.data.length <= 26_214_400` (25 MB — clamd's default StreamMaxLength); larger videos store `scanStatus: "skipped-size"`, `scannedAt: null`. The mime allowlist is the primary control for video parts. Rationale: fail-closed scanning of 100 MB blobs would reject every long recording against a default clamd.

- [ ] **Step 1: Write the failing integration test**

`apps/dashboard/tests/api/intake-media.test.ts` — copy the harness top of `intake-attachments.test.ts` (project seeding with `publicKey: "rp_pk_MEDIATEST1234567890abcd0"` padded to the 24-char regex, `allowedOrigins: ["https://example.com"]`, `truncateReports()` in beforeEach). Cases:

```ts
// 1. happy path: report + media[0] (png, no trim) + media[1] (webm, trim 1000..4000, durationMs 5000)
//    → 201; two report_attachments rows kind "media"; storageKey matches /\/media\/0\.png$/ and /\/media\/1\.webm$/;
//    row[1].trimStartMs === 1000, trimEndMs === 4000, durationMs === 5000
// 2. missing mediaMeta while media[0] present → 400
// 3. mediaMeta length mismatch (2 entries, 1 part) → 400
// 4. denied mime (media[0] as text/plain) → 415
// 5. count over INTAKE_MEDIA_MAX_COUNT (4 parts) → 413
// 6. old-SDK compat: report + legacy `screenshot` part, NO media parts → 201, screenshot attachment row as before
```

Build the FormData exactly like intake-attachments.test.ts does (a `report` Blob with `{ projectKey, title, context: { source: "web", ... }, _dwellMs: 5000, _hp: "" }`, `Origin: https://example.com` header), with media parts appended as `form.append("media[0]", new File([bytes], "media-0.png", { type: "image/png" }))` and `form.append("mediaMeta", new Blob([JSON.stringify(meta)], { type: "application/json" }))`.

- [ ] **Step 2: Run to verify failure** (dev server running)

Run: `cd apps/dashboard && bun test tests/api/intake-media.test.ts`
Expected: FAIL — media parts are silently ignored today, so the attachment-row assertions come back empty (case 1) and the 400/415/413 cases return 201.

- [ ] **Step 3: Implement in `reports.ts`**

Insert a media-collection block alongside the existing `attachment[N]` handling (BEFORE the report insert, same as user files — validation must 4xx before any row exists):

```ts
const MEDIA_PART_RE = /^media\[(\d+)\]$/
const ALLOWED_MEDIA_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "video/webm", "video/mp4"])
const MEDIA_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4",
}
const CLAMAV_STREAM_CEILING = 26_214_400
```

Collect parts into `mediaParts: { idx: number; data: Buffer; mime: string }[]`; parse the `mediaMeta` part with `MediaMetaInput` (JSON parse failure or zod failure → 400 "invalid mediaMeta"). Validate: `mediaParts.length !== meta.length` → 400; `mediaParts.length > env.INTAKE_MEDIA_MAX_COUNT` → 413; per item, mime must be in `ALLOWED_MEDIA_MIMES` AND equal `meta[idx].mime` → else 415; size cap by `meta[idx].kind` (image/video env caps) → 413; `trim.endMs > durationMs` when both present → 400. Scan: same loop shape as user files (existing `scanBytes` + fail-closed 503 / infected 422), skipped with `scanStatus = "skipped-size"` above `CLAMAV_STREAM_CEILING`.

After the report insert, persist next to the user-file block (reuse its `rollbackPuts` pattern and push keys into the same `writtenKeys` array):

```ts
for (const { idx, data, mime } of mediaParts) {
  const m = meta[idx]!
  const ext = MEDIA_EXT[mime] ?? "bin"
  const key = `${report.id}/media/${idx}.${ext}`
  await storage.put(key, new Uint8Array(data), mime)
  writtenKeys.push(key)
  await db.insert(reportAttachments).values({
    reportId: report.id, kind: "media", storageKey: key, contentType: mime,
    sizeBytes: data.length, filename: `media-${idx}.${ext}`,
    durationMs: m.durationMs ?? null, trimStartMs: m.trim?.startMs ?? null, trimEndMs: m.trim?.endMs ?? null,
    ...scanMetaFor(idx),
  })
}
```

(`scanMetaFor` = however the user-file block carries its per-index ScanMeta — reuse that exact mechanism. The sequential `await` inside the loop mirrors the existing user-file loop; keep the same `// eslint-disable` treatment the file already uses if oxlint complains.)

Env: add the three vars to the env module following the exact pattern of `INTAKE_USER_FILE_MAX_BYTES`, and bump the `INTAKE_MAX_BYTES` default.

- [ ] **Step 4: Run tests**

Run: `cd apps/dashboard && bun test tests/api/intake-media.test.ts && bun test tests/api/intake-attachments.test.ts`
Expected: PASS — including the untouched legacy attachment suite (compat case 6 proves old SDKs keep working).

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server apps/dashboard/tests/api/intake-media.test.ts
git commit -m "feat(intake): accept gallery media parts with trim metadata

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Storage adapter streaming (`getStream`) + Range helper

**Files:**
- Modify: `apps/dashboard/server/lib/storage/index.ts` (interface), `local-disk.ts`, `s3.ts`
- Create: `apps/dashboard/server/lib/range.ts` + `apps/dashboard/server/lib/range.test.ts`
- Test: `apps/dashboard/server/lib/storage/local-disk.test.ts` (extend existing if present, else create)

**Interfaces:**
- Produces (consumed by Tasks 13 & 16):

```ts
// storage/index.ts
export interface StorageStream {
  stream: ReadableStream<Uint8Array> | NodeJS.ReadableStream
  contentType: string
  totalBytes: number          // full object size, regardless of range
  start: number               // inclusive byte offset actually served
  end: number                 // inclusive
}
export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>
  getStream(key: string, range?: { start: number; end?: number }): Promise<StorageStream>
  delete(key: string): Promise<void>
}

// lib/range.ts
export function parseRangeHeader(header: string | undefined, totalBytes: number):
  | { start: number; end: number }   // satisfiable single range
  | "unsatisfiable"                  // → 416
  | null                             // absent/malformed/multi-range → serve full 200
```

- [ ] **Step 1: Write failing tests**

`range.test.ts`:

```ts
import { expect, test } from "bun:test"
import { parseRangeHeader } from "./range"

test("parses bytes=0-499", () => {
  expect(parseRangeHeader("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 })
})
test("open-ended and suffix ranges", () => {
  expect(parseRangeHeader("bytes=500-", 1000)).toEqual({ start: 500, end: 999 })
  expect(parseRangeHeader("bytes=-200", 1000)).toEqual({ start: 800, end: 999 })
})
test("clamps end to size", () => {
  expect(parseRangeHeader("bytes=0-99999", 1000)).toEqual({ start: 0, end: 999 })
})
test("unsatisfiable start", () => {
  expect(parseRangeHeader("bytes=1000-", 1000)).toBe("unsatisfiable")
})
test("absent, malformed, multi-range → null", () => {
  expect(parseRangeHeader(undefined, 1000)).toBeNull()
  expect(parseRangeHeader("bytes=abc", 1000)).toBeNull()
  expect(parseRangeHeader("bytes=0-1,5-9", 1000)).toBeNull()
})
```

`local-disk.test.ts` additions: `put` 10 bytes, `getStream(key, { start: 2, end: 5 })` → collect stream → exactly bytes 2..5, `totalBytes: 10`, `start: 2`, `end: 5`; `getStream(key)` (no range) → all 10 bytes, `start: 0, end: 9`. (Follow the existing local-disk test's temp-dir setup if the file exists; otherwise create one using the adapter's constructor/factory as exported — check `_setStorageForTesting` usage in tests for the construction pattern.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/dashboard && bun test server/lib/range.test.ts server/lib/storage/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`range.ts`:

```ts
const RANGE_RE = /^bytes=(\d*)-(\d*)$/

export function parseRangeHeader(
  header: string | undefined,
  totalBytes: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null
  const m = RANGE_RE.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === "" && rawEnd === "") return null
  if (rawStart === "") {
    const suffix = Number(rawEnd)
    if (suffix === 0) return "unsatisfiable"
    const start = Math.max(0, totalBytes - suffix)
    return totalBytes === 0 ? "unsatisfiable" : { start, end: totalBytes - 1 }
  }
  const start = Number(rawStart)
  if (start >= totalBytes) return "unsatisfiable"
  const end = rawEnd === "" ? totalBytes - 1 : Math.min(Number(rawEnd), totalBytes - 1)
  if (end < start) return "unsatisfiable"
  return { start, end }
}
```

`local-disk.ts` `getStream`: resolve key through the existing traversal guard (`resolveKey`), `const stat = await fs.promises.stat(path)`, read the `.contenttype` sidecar exactly like `get()` does, then `fs.createReadStream(path, { start, end })` where `start = range?.start ?? 0`, `end = range?.end ?? stat.size - 1`; return `{ stream, contentType, totalBytes: stat.size, start, end }`.

`s3.ts` `getStream`: `GetObjectCommand({ Bucket, Key, Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined })`; `totalBytes` from `ContentRange` (`/\/(\d+)$/`) when ranged, else `ContentLength`; `stream: res.Body.transformToWebStream()`; `start`/`end` from the request range (or `0`/`totalBytes-1`).

Fix any test fake registered via `_setStorageForTesting` to include a `getStream` (search: `grep -rn "_setStorageForTesting" apps/dashboard` and add a buffer-backed implementation to each fake).

- [ ] **Step 4: Run tests**

Run: `cd apps/dashboard && bun test server/lib/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server/lib
git commit -m "feat(storage): range-aware getStream on local-disk and s3 adapters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Share-link mint endpoint (`POST /api/intake/media`)

**Files:**
- Create: `apps/dashboard/server/api/intake/media.post.ts`
- Modify: env module (add `SHARE_MINTS_PER_MINUTE`, default 2), `apps/dashboard/server/lib/rate-limit.ts` (add memoized `getShareMintLimiter()` beside `getKeyLimiter()`)
- Modify: `apps/dashboard/nuxt.config.ts` — add ONE routeRules entry (minimal diff):

```ts
"/api/intake/media": {
  security: { corsHandler: false, xssValidator: false, requestSizeLimiter: false },
},
```

- Test: `apps/dashboard/tests/api/share-mint.test.ts`

**Interfaces:**
- Consumes: `sharedMedia` table (Task 9), `ShareMintResponse` (Task 1), intake CORS helpers (`applyIntakePreflightCors`, `applyIntakePostCors`, `isOriginAllowed` from `server/lib/intake-cors.ts`), `getStorage()`.
- Produces: `POST /api/intake/media` — multipart `file` (binary) + `meta` (JSON `{ projectKey, kind: "video", mime, durationMs?, trim? }`), responses: 201 `ShareMintResponse` / 401 bad key / 403 origin or share-links-disabled / 413 oversize / 415 mime / 429 rate. Storage key: `shared-media/${id}.<ext>`. Token: `randomBytes(32).toString("base64url")` from `node:crypto`. `expiresAt = new Date(Date.now() + project.shareRetentionDays * 86_400_000)`. `shareUrl = ${getRequestURL(event).origin}/s/${token}`.

- [ ] **Step 1: Write the failing test** — `share-mint.test.ts`, harness copied from intake-attachments.test.ts (seed project, truncate `shared_media` in beforeEach with a raw `db.execute(sql`TRUNCATE shared_media`)` or a `truncateSharedMedia()` helper added to `tests/helpers.ts`):

```ts
// 1. happy path: POST FormData { file: 1KB webm File, meta: { projectKey, kind:"video", mime:"video/webm", durationMs: 3000, trim:{startMs:0,endMs:2000} } }
//    Origin allowed → 201; body parses with ShareMintResponse; token.length >= 43;
//    DB row exists with expiresAt ≈ now + 30d (assert within ±5 min), trimStartMs 0 / trimEndMs 2000
// 2. share links disabled: UPDATE projects SET share_links_enabled=false → 403
// 3. wrong mime (image/png) → 415  (videos only in v1)
// 4. bad project key → 401; disallowed Origin → 403
// 5. GET /s/<token> page is NOT tested here (Task 14); assert only the mint response’s shareUrl ends with `/s/${token}`
```

- [ ] **Step 2: Run to verify failure** — `cd apps/dashboard && bun test tests/api/share-mint.test.ts` → FAIL (404 route).

- [ ] **Step 3: Implement `media.post.ts`** — skeleton mirrors `reports.ts` ordering: OPTIONS preflight → method check → origin resolution → `readMultipartFormData` → parse `meta` with a local zod schema:

```ts
const MintMeta = z.object({
  projectKey: z.string().regex(/^rp_pk_[A-Za-z0-9]{24}$/),
  kind: z.literal("video"),
  mime: z.enum(["video/webm", "video/mp4"]),
  durationMs: z.number().int().nonnegative().optional(),
  trim: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).optional(),
})
```

→ project lookup by `publicKey` (401) → `isOriginAllowed` (403, `applyIntakePostCors` after) → `project.shareLinksEnabled` check (403 "share links disabled") → rate limit `getShareMintLimiter().take(\`share:${project.id}\`)` (429 + Retry-After) → file size ≤ `env.INTAKE_MEDIA_VIDEO_MAX_BYTES` (413) → `storage.put` → insert `sharedMedia` row → 201 `{ id, token, shareUrl, expiresAt: expiresAt.toISOString() }`. On insert failure after put, `storage.delete(key)` best-effort (same rollback spirit as reports.ts).

- [ ] **Step 4: Run tests** — `bun test tests/api/share-mint.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server apps/dashboard/tests apps/dashboard/nuxt.config.ts
git commit -m "feat(dashboard): public share-link mint endpoint for gallery recordings

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Public share API — meta + Range-streaming blob routes

**Files:**
- Create: `apps/dashboard/server/api/shared/[token]/index.get.ts`
- Create: `apps/dashboard/server/api/shared/[token]/blob.get.ts`
- Modify: `apps/dashboard/nuxt.config.ts` — one routeRules entry:

```ts
"/api/shared/**": {
  headers: { "cache-control": "public, max-age=300" },  // 5-min ceiling: revoked links must die fast in shared caches (user decision 2026-07-17)
},
```

- Test: `apps/dashboard/tests/api/share-public.test.ts`

**Interfaces:**
- Consumes: Tasks 9, 11, 12.
- Produces:
  - `GET /api/shared/:token` → 200 `{ kind, mime, sizeBytes, durationMs, trimStartMs, trimEndMs, createdAt, expiresAt }` — NO project info leaked. Unknown, expired, and revoked tokens are indistinguishable: 404 `{ statusMessage: "Not found" }` for all three.
  - `GET /api/shared/:token/blob` → full 200 or partial 206 with `Content-Range: bytes start-end/total`, `Accept-Ranges: bytes`, `Content-Type` from row, `Content-Length` of the served slice, `X-Content-Type-Options: nosniff`; 416 with `Content-Range: bytes */total` when unsatisfiable; same uniform 404 rule.

- [ ] **Step 1: Write the failing test** — `share-public.test.ts`: seed a `shared_media` row directly via `db.insert(sharedMedia)` + `storage.put` of a known 32-byte buffer (get storage via the same import the server uses — call the real `getStorage()` from the test like existing tests reach into `db`). Cases: meta 200 shape; blob no-Range → 200 full body, `accept-ranges: bytes`; blob `Range: bytes=8-15` → 206, `content-range: bytes 8-15/32`, exactly 8 bytes; `Range: bytes=99-` → 416; expired row (`expiresAt` in the past) → 404 on BOTH routes; revoked row → 404 on both; garbage token → 404. Use raw `fetch` (not `apiFetch`) for the blob route to read `res.arrayBuffer()` and headers.

- [ ] **Step 2: Run to verify failure** — FAIL (404 handlers absent… note the 404-case tests will "pass" trivially; the 200/206 cases are the failing signal).

- [ ] **Step 3: Implement**

Shared lookup helper (top of `index.get.ts`, imported by both routes or duplicated — prefer a small `server/lib/shared-media.ts` with `findLiveSharedMedia(token: string)` returning the row or null when missing/expired/revoked):

```ts
export async function findLiveSharedMedia(token: string) {
  if (!token || token.length > 128) return null
  const [row] = await db.select().from(sharedMedia).where(eq(sharedMedia.token, token)).limit(1)
  if (!row) return null
  if (row.revokedAt) return null
  if (row.expiresAt.getTime() < Date.now()) return null
  return row
}
```

`blob.get.ts`:

```ts
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, "token") ?? ""
  const row = await findLiveSharedMedia(token)
  if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" })
  const storage = await getStorage()
  const range = parseRangeHeader(getHeader(event, "range"), row.sizeBytes)
  setHeader(event, "Accept-Ranges", "bytes")
  setHeader(event, "X-Content-Type-Options", "nosniff")
  setHeader(event, "Content-Type", row.mime)
  if (range === "unsatisfiable") {
    setHeader(event, "Content-Range", `bytes */${row.sizeBytes}`)
    throw createError({ statusCode: 416, statusMessage: "Range Not Satisfiable" })
  }
  const s = await storage.getStream(row.storageKey, range ?? undefined)
  if (range) {
    setResponseStatus(event, 206)
    setHeader(event, "Content-Range", `bytes ${s.start}-${s.end}/${s.totalBytes}`)
  }
  setHeader(event, "Content-Length", s.end - s.start + 1)
  return sendStream(event, s.stream)
})
```

(h3 imports: `defineEventHandler, getRouterParam, getHeader, setHeader, setResponseStatus, sendStream, createError` — match the import style of `attachment.get.ts`.)

- [ ] **Step 4: Run tests** — `bun test tests/api/share-public.test.ts` → PASS. Also re-run `tests/api/share-mint.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server apps/dashboard/tests apps/dashboard/nuxt.config.ts
git commit -m "feat(dashboard): public shared-media meta and range-streaming blob routes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Public share page `/s/:token` + security config

**Files:**
- Create: `apps/dashboard/app/pages/s/[token].vue`
- Modify: `apps/dashboard/app/middleware/auth.global.ts` — `publicPaths` becomes `["/auth/sign-in", "/s/"]` (keep the existing `startsWith` check; use `"/s/"` with trailing slash so `/settings` never matches)
- Modify: `apps/dashboard/nuxt.config.ts` — inside the existing `security.headers.contentSecurityPolicy` block, add `"media-src": ["'self'"]` next to the customized `img-src`

**Interfaces:**
- Consumes: `GET /api/shared/:token` + blob route (Task 13).
- Produces: a public, minimal, brand-light player page — no dashboard chrome, no session fetch.

- [ ] **Step 1: Implement the page**

```vue
<script setup lang="ts">
definePageMeta({ layout: false })
const route = useRoute()
const token = computed(() => String(route.params.token ?? ""))
const requestUrl = useRequestURL()
const blobUrl = computed(() => `/api/shared/${token.value}/blob`)

const { data: meta, error } = await useFetch<{
  kind: string; mime: string; sizeBytes: number; durationMs: number | null
  trimStartMs: number | null; trimEndMs: number | null; createdAt: string; expiresAt: string
}>(() => `/api/shared/${token.value}`)

useHead(() => ({
  title: "Repro — shared recording",
  meta: meta.value
    ? [
        { property: "og:title", content: "Repro screen recording" },
        { property: "og:type", content: "video.other" },
        { property: "og:video", content: `${requestUrl.origin}/api/shared/${token.value}/blob` },
        { property: "og:video:type", content: meta.value.mime },
        { name: "robots", content: "noindex" },
      ]
    : [{ name: "robots", content: "noindex" }],
}))

const video = ref<HTMLVideoElement | null>(null)
function clampToTrim() {
  const v = video.value
  const m = meta.value
  if (!v || !m) return
  const startS = (m.trimStartMs ?? 0) / 1000
  const endS = m.trimEndMs != null ? m.trimEndMs / 1000 : Number.POSITIVE_INFINITY
  if (v.currentTime < startS) v.currentTime = startS
  if (v.currentTime >= endS) { v.pause(); v.currentTime = startS }
}
</script>

<template>
  <div class="share-page">
    <template v-if="meta">
      <video ref="video" controls :src="blobUrl" @loadedmetadata="clampToTrim" @timeupdate="clampToTrim" />
      <footer>
        <span>Shared via Repro · expires {{ new Date(meta.expiresAt).toLocaleDateString() }}</span>
        <span v-if="meta.trimStartMs != null || meta.trimEndMs != null">Trimmed view — the raw file keeps full length</span>
      </footer>
    </template>
    <div v-else-if="error" class="share-missing">
      <h1>This link isn’t available</h1>
      <p>It may have expired, been revoked, or never existed.</p>
    </div>
  </div>
</template>
```

Style it minimally in a scoped block (dark backdrop, centered `max-width: 960px` video, muted footer) — match the dashboard's Tailwind-v4 usage if the page can use utility classes with `layout: false` (it can; use utilities instead of the scoped block if other pages do).

- [ ] **Step 2: Middleware + CSP edits** as listed under Files (both are one-line diffs — verify the exact current shape before editing, per the nuxt.config caution in Global Constraints).

- [ ] **Step 3: Manual verification (needs Task 12 + 13 running)**

With the dev server up: mint a row via the share-mint test (or `curl` the mint endpoint with a small webm), open `http://localhost:3000/s/<token>` in a logged-OUT browser window. Expected: page renders and plays WITHOUT redirect to sign-in; playback starts at the trim start; view-source shows the `og:video` tags. An expired/revoked token shows the "isn’t available" state.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app apps/dashboard/nuxt.config.ts
git commit -m "feat(dashboard): public /s/:token share page with trim-aware playback and OG tags

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: SDK share client + gallery copy-link wiring

**Files:**
- Create: `packages/core/src/share-client.ts` + `packages/core/src/share-client.test.ts`
- Modify: `packages/core/src/index.ts` (pass `mintShareLink` into `mount`)
- Modify: `packages/ui/src/mount.ts` (thread `mintShareLink` → `GalleryView` `canShare`/`onCopyLink`; persist `shareUrl`/`shareToken`/`shareExpiresAt` onto the gallery item after a successful mint)

**Interfaces:**
- Consumes: `POST /api/intake/media` contract (Task 12), `ShareMintResponse` (Task 1), `PendingShareInput` (Task 8).
- Produces:

```ts
// share-client.ts
export async function mintShareLink(
  config: ResolvedConfig,
  input: { blob: Blob; mime: string; durationMs?: number; trim?: TrimRange },
): Promise<{ ok: true; url: string; token: string; expiresAt: string } | { ok: false; message: string }>
// POSTs FormData { file, meta: JSON { projectKey: config.projectKey, kind: "video", mime, durationMs?, trim? } }
// to `${config.endpoint}/api/intake/media`, credentials "omit", 60s timeout (uploads are big).
// Status mapping: 404 → "This server does not support share links yet"
//                 403 → "Share links are disabled for this project"
//                 413 → "Recording is too large to share"
//                 429 → "Too many links minted — try again in a minute"
//                 other !ok → "Could not create link (HTTP <status>)"
```

- [ ] **Step 1: Write the failing test** — `share-client.test.ts` stubs `fetch` (same pattern as `intake-client.test.ts`): 201 with a valid `ShareMintResponse` body → `{ ok: true, url, token, expiresAt }` and the sent FormData contains `file` + `meta` with the projectKey; each of 404/403/413/429 → `{ ok: false }` with the exact message above.

- [ ] **Step 2: Run to verify failure** — `cd packages/core && bun test src/share-client.test.ts` → FAIL.

- [ ] **Step 3: Implement** `share-client.ts` per the contract; in `core/src/index.ts` build the `mintShareLink` MountOption:

```ts
mintShareLink: async (item) => {
  const r = await mintShareLink(cfg, item)
  return r.ok ? { url: r.url, expiresAt: r.expiresAt } : { error: r.message }
},
```

In `mount.ts`, `GalleryView` gets `canShare: Boolean(opts.mintShareLink)` and an `onCopyLink` that calls it with the item's blob/mime/duration/trim, then on success `store.update(item.id, { shareUrl, shareToken, shareExpiresAt })` and copies to clipboard (Task 6's GalleryView already owns the clipboard + inline error UX).

- [ ] **Step 4: Run tests** — `cd packages/core && bun test && cd ../ui && bun test` → PASS. Then `bun run sdk:build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/ui
git commit -m "feat(sdk): mint share links from the gallery with graceful old-server fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Report drawer — media attachments with trim-aware video player

**Files:**
- Create: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/media/[attachmentId].get.ts`
- Modify: `apps/dashboard/server/api/projects/[id]/reports/[reportId]/index.get.ts` (attachment DTO build: media URL branch + the three new trim/duration fields)
- Create: `apps/dashboard/app/components/report-drawer/trim-video.vue`
- Modify: `apps/dashboard/app/components/report-drawer/attachments-tab.vue` (media section)
- Modify: `apps/dashboard/app/pages/projects/[id]/reports/[reportId].vue` (attachments tab visibility count includes media)
- Test: `apps/dashboard/tests/api/report-media-stream.test.ts`

**Interfaces:**
- Consumes: Tasks 9-11; `AttachmentDTO` trim fields (Task 1); existing `requireProjectRole`.
- Produces:
  - `GET /api/projects/:id/reports/:reportId/media/:attachmentId` — session-authed (`requireProjectRole(event, id, "viewer")`), 404 unless the attachment row belongs to the report AND `kind === "media"`; Range-streaming semantics identical to Task 13's blob route (reuse `parseRangeHeader` + `getStream`); `Content-Type` allowlisted to the 5 media mimes with `application/octet-stream` fallback; `Content-Disposition: inline`; `Cache-Control: private, max-age=3600`.
  - Detail DTO: attachments of kind `media` get `url: /api/projects/${projectId}/reports/${reportId}/media/${a.id}` (other kinds unchanged) and carry `durationMs`/`trimStartMs`/`trimEndMs` from the row (null for other kinds).

- [ ] **Step 1: Write the failing test** — `report-media-stream.test.ts`: seed a report + a `kind:"media"` attachment row + storage bytes (reuse the intake-media test's happy path to create them via the real intake route — simplest and already covered); then as a signed-in viewer (`signIn` + membership seed helpers from `tests/helpers.ts`): no-Range GET → 200 full bytes; `Range: bytes=0-3` → 206 + `content-range`; a `user-file` attachment id on the media route → 404; signed-out → 401/302-equivalent per `requireProjectRole` behavior (assert non-200).

- [ ] **Step 2: Run to verify failure** — route 404s for everything → the 200/206 cases fail.

- [ ] **Step 3: Implement**

Route: clone the Task 13 blob handler's Range block, swapping `findLiveSharedMedia` for:

```ts
const { session } = await requireProjectRole(event, projectId, "viewer")
const [row] = await db
  .select()
  .from(reportAttachments)
  .where(and(eq(reportAttachments.id, attachmentId), eq(reportAttachments.reportId, reportId), eq(reportAttachments.kind, "media")))
  .limit(1)
if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" })
```

(and verify the report belongs to the project the way `attachment.get.ts` does — copy its report-ownership check.)

`trim-video.vue`:

```vue
<script setup lang="ts">
const props = defineProps<{ src: string; trimStartMs: number | null; trimEndMs: number | null; downloadName?: string }>()
const video = ref<HTMLVideoElement | null>(null)
function clamp() {
  const v = video.value
  if (!v) return
  const start = (props.trimStartMs ?? 0) / 1000
  const end = props.trimEndMs != null ? props.trimEndMs / 1000 : Number.POSITIVE_INFINITY
  if (v.currentTime < start) v.currentTime = start
  if (v.currentTime >= end) { v.pause(); v.currentTime = start }
}
</script>
<template>
  <div>
    <video ref="video" controls preload="metadata" :src="src" @loadedmetadata="clamp" @timeupdate="clamp" class="w-full rounded-lg" />
    <div class="mt-1 flex items-center justify-between text-xs text-mist-500">
      <span v-if="trimStartMs != null || trimEndMs != null">Trimmed view · full file via download</span>
      <a :href="src" :download="downloadName ?? 'recording'" class="underline">Download full recording</a>
    </div>
  </div>
</template>
```

(Adjust the muted-text class to whatever `attachments-tab.vue` already uses — copy its palette classes rather than inventing `text-mist-500` if it differs.)

`attachments-tab.vue`: add `const media = computed(() => props.attachments.filter(a => a.kind === "media"))`; images among media render like existing image attachments; videos render `<TrimVideo :src="m.url" :trim-start-ms="m.trimStartMs" :trim-end-ms="m.trimEndMs" />`. Keep the existing `user-file` sections untouched but note the tab's internal filter currently limits to `kind === "user-file"` — widen it to `["user-file", "media"]`. In the page (`[reportId].vue` lines ~89-109), widen the tab-visibility count the same way.

- [ ] **Step 4: Run tests** — `bun test tests/api/report-media-stream.test.ts` → PASS. Manual: submit a report with a trimmed recording from the demo SDK, open its detail page, confirm playback clamps and download link returns the full file.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): render report media attachments with trim-aware playback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 17: Project settings — Sharing tab, shared-media list + revoke, PATCH wiring

**Files:**
- Modify: `apps/dashboard/server/api/projects/[id]/index.patch.ts` (spread the two new fields; they're already in `UpdateProjectInput` since Task 1)
- Modify: the project DTO builder used by `apps/dashboard/server/api/projects/[id]/index.get.ts` (include `shareLinksEnabled`, `shareRetentionDays`)
- Create: `apps/dashboard/server/api/projects/[id]/shared-media/index.get.ts` (list, `requireProjectRole(event, id, "manager")`, newest first, maps rows → `SharedMediaDTO` with `shareUrl` built from `getRequestURL(event).origin`)
- Create: `apps/dashboard/server/api/projects/[id]/shared-media/[mediaId].delete.ts` (revoke: `requireProjectRole "manager"`, sets `revokedAt: new Date()` where `id` AND `projectId` match; 404 otherwise; idempotent — already-revoked returns 200)
- Modify: `apps/dashboard/app/pages/projects/[id]/settings.vue` — new `sharing` tab
- Test: `apps/dashboard/tests/api/shared-media-admin.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 9, 12. Role semantics per spec: `manager`+ can view/revoke links; the enable/disable toggle + retention input PATCH `projects` and therefore stay owner-gated (the PATCH route already requires `"owner"`).
- Produces: settings UX — Sharing tab with (a) enable toggle, (b) retention-days number input (1-365) with a "applies to new links" hint, (c) shared-links table: created date, size (`formatBytes`-equivalent inline), expiry, status chip (`active`/`expired`/`revoked`), copy-link button, revoke button (confirm dialog, disabled when already revoked/expired).

- [ ] **Step 1: Write the failing test** — `shared-media-admin.test.ts`: seed project + 2 shared rows (one live, one expired); owner cookie: GET list → 200, two DTOs, live row first-by-created; DELETE live row → 200 and `revoked_at` set in DB; DELETE again → 200 (idempotent); `viewer`-role member (seed via the members helper used in existing member tests) → 403 on both; PATCH `{ shareLinksEnabled: false, shareRetentionDays: 7 }` as owner → 200 and columns updated; PATCH as `manager` → 403 (existing owner gate).

- [ ] **Step 2: Run to verify failure** — routes 404 → FAIL.

- [ ] **Step 3: Implement** routes + PATCH spread (`...(input.shareLinksEnabled !== undefined ? { shareLinksEnabled: input.shareLinksEnabled } : {})`, same pattern as `replayEnabled`) + DTO fields. Settings tab: copy the structure of the existing `triage` tab's "Session replay" `UCard` (settings.vue lines ~236-255) for the toggle; table via the page's existing table primitives; fetches `GET .../shared-media` lazily when the tab activates.

- [ ] **Step 4: Run tests** — `bun test tests/api/shared-media-admin.test.ts` → PASS. Manual: toggle off → SDK "copy link" now returns the 403 message from Task 15.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard
git commit -m "feat(dashboard): sharing settings tab with shared-link list and revoke

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Retention purge task

**Files:**
- Create: `apps/dashboard/server/tasks/media/purge.ts`
- Create: `apps/dashboard/server/lib/shared-media-purge.ts` + `apps/dashboard/server/lib/shared-media-purge.test.ts` (pure selection/deletion logic, unit-testable without Nitro)
- Modify: `apps/dashboard/nuxt.config.ts` — add `"0 4 * * *": ["media:purge"]` to `nitro.scheduledTasks` (one line, beside the existing `"0 3 * * *"` cleanup entry)

**Interfaces:**
- Consumes: `sharedMedia` (Task 9), `getStorage()` (Task 11 interface).
- Produces:

```ts
// lib/shared-media-purge.ts
export async function purgeSharedMedia(now = new Date()): Promise<{ purged: number }>
// Selects rows WHERE expires_at < now OR (revoked_at IS NOT NULL AND revoked_at < now - 24h);
// for each: storage.delete(storageKey) (per-row try/catch — a missing blob must not block row deletion),
// then DELETE the row. Returns the count.
```

- [ ] **Step 1: Write the failing test** — `shared-media-purge.test.ts` (integration-style against the dev DB, like other lib tests that import `db`): insert 4 rows — live, expired, revoked-25h-ago, revoked-1h-ago — with `storage.put` bytes for each; `purgeSharedMedia()` → `{ purged: 2 }`; live + recently-revoked rows remain; purged rows' `storage.get(key)` now rejects.

- [ ] **Step 2: Run to verify failure** — module missing → FAIL.

- [ ] **Step 3: Implement** `purgeSharedMedia` per the contract, then the task wrapper:

```ts
import { defineTask } from "nitropack/runtime"
import { purgeSharedMedia } from "../../lib/shared-media-purge"

export default defineTask({
  meta: { name: "media:purge", description: "Delete expired and revoked shared media" },
  async run() {
    const { purged } = await purgeSharedMedia()
    return { result: "ok", purged }
  },
})
```

- [ ] **Step 4: Run tests** — `bun test server/lib/shared-media-purge.test.ts` → PASS. Manual: `curl -X POST http://localhost:3000/_nitro/tasks/media:purge` (Nitro dev task trigger) returns `{ result: "ok", ... }` — confirm the dev-trigger path exists the same way `github:sync` is exercised; if the project relies purely on the scheduler, skip the curl and assert via the unit test only.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/server apps/dashboard/nuxt.config.ts
git commit -m "feat(dashboard): nightly purge of expired and revoked shared media

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: Full-stack verification sweep

**Files:** none created — verification + fixups only.

- [ ] **Step 1: Static checks** — repo root: `bun run check` (oxfmt + oxlint@1.59.0) → clean (warnings pre-existing only, zero errors).

- [ ] **Step 2: Full test suites**

```bash
cd packages/shared && bun test && cd ../sdk-utils && bun test && cd ../recorder && bun test && cd ../core && bun test && cd ../ui && bun test
cd ../../apps/dashboard && bun test tests/   # dev server + Postgres running
```

Expected: all PASS.

- [ ] **Step 3: SDK build + demo end-to-end** — `bun run sdk:build && bun run demo`; walk the whole loop against the local dashboard (point the demo's `endpoint` at `http://localhost:3000` with a seeded project key):
  1. Menu → Capture → annotate → Save to gallery.
  2. Menu → Record → stop at ~10s → trim to the middle → Report bug with this → 2-step wizard → submit.
  3. Dashboard: open the report → attachments tab shows the recording, playback clamps to trim, download returns full file.
  4. Gallery → Copy link on the recording → paste the `/s/…` URL in a private window → plays, clamped, OG tags in source.
  5. Project settings → Sharing → link listed → revoke → private-window URL now shows "isn't available".
  6. `/csp` demo route: capture works, trim preview shows the fallback note.

- [ ] **Step 4: Extension Playwright smoke (spec §5.6/§8)** — in `apps/extension/tests`, add `widget-modes.spec.ts` following the existing spec files' fixture setup (built extension + test page). Launch context args must include `"--auto-select-desktop-capture-source=Entire screen"` and `"--use-fake-ui-for-media-stream"` so `getDisplayMedia` auto-accepts headlessly. Assertions: launcher click opens the menu with the three options; click "Record screen" → control bar appears → click Stop → trim screen appears → Confirm → outcome bar → Save to gallery → gallery shows one video tile. Run: `cd apps/extension && bun run test:e2e` (match the package.json script name) → PASS.

- [ ] **Step 5: Backward-compat spot check** — run the pre-existing `tests/api/intake-attachments.test.ts` and one legacy-SDK style POST (`report` + `screenshot` parts only) → 201; confirms old SDKs are unaffected.

- [ ] **Step 6: Commit any fixups**

```bash
git add -A && git commit -m "test: full-stack verification fixups for widget modes and share links

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Execution notes

- **Order matters:** Tasks 1-8 (SDK) and 9-14 (dashboard) are two mostly-parallel tracks — but Task 8's manual smoke and Task 15 need Tasks 10 & 12 deployed locally. Suggested serial order: 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 8, 15, 16, 17, 18, 19.
- **One intentional UX change** ships here: launcher click / hotkey opens the menu instead of the reporter (`open()` keeps the old behavior for programmatic callers). Call it out in the release changelog.
- **Deferred (per spec §10):** prefill/captureError APIs, GitHub upgrade sub-project, image share links, real video cutting.
