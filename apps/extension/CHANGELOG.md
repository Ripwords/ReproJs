# Changelog

## extension-v0.1.4

[compare changes](https://github.com/Ripwords/ReproJs/compare/extension-v0.1.3...extension-v0.1.4)

### 🩹 Fixes

- **sdk-ui:** Decode screenshots via createImageBitmap so host CSPs can't block capture ([00c23a6](https://github.com/Ripwords/ReproJs/commit/00c23a6))

### ✅ Tests

- **sdk-ui:** Add a strict-CSP route to the demo playground ([b57883a](https://github.com/Ripwords/ReproJs/commit/b57883a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## extension-v0.1.3

[compare changes](https://github.com/Ripwords/ReproJs/compare/extension-v0.1.2...extension-v0.1.3)

### 🚀 Enhancements

- **shared:** Add volume series to AdminOverviewDTO ([c0e3a70](https://github.com/Ripwords/ReproJs/commit/c0e3a70))

### 🩹 Fixes

- **release:** Scope each package's CHANGELOG to its own paths ([b1bb22c](https://github.com/Ripwords/ReproJs/commit/b1bb22c))
- **sdk-ui:** Stop annotation shortcuts firing while typing text labels ([4ff661f](https://github.com/Ripwords/ReproJs/commit/4ff661f))

### 💅 Refactors

- **comments:** Move CreateCommentBody schema to @reprojs/shared ([0d14acd](https://github.com/Ripwords/ReproJs/commit/0d14acd))

### 🏡 Chore

- **release:** Sdk-v0.4.1 ([6524efc](https://github.com/Ripwords/ReproJs/commit/6524efc))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## extension-v0.1.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/extension-v0.1.1...extension-v0.1.2)

### 🚀 Enhancements

- **shared:** Add AdminOverviewDTO for admin overview dashboard ([f76efdb](https://github.com/Ripwords/ReproJs/commit/f76efdb))
- **shared:** Add 'manager' to ProjectRole enum ([2996a41](https://github.com/Ripwords/ReproJs/commit/2996a41))
- **shared:** Add source discriminator and mobile device fields to ReportContext/SystemInfo ([2f6effc](https://github.com/Ripwords/ReproJs/commit/2f6effc))
- **shared:** Add source and devicePlatform to ReportSummaryDTO ([95ed429](https://github.com/Ripwords/ReproJs/commit/95ed429))
- **expo:** Config normalizer and internal context shape ([50e2018](https://github.com/Ripwords/ReproJs/commit/50e2018))
- **shared:** ReportSummaryDTO.assignees (array); TriagePatchInput.assigneeIds ([572ae66](https://github.com/Ripwords/ReproJs/commit/572ae66))
- **shared:** Add milestone + githubAssigneeLogins to reports DTOs ([4c64078](https://github.com/Ripwords/ReproJs/commit/4c64078))
- **integrations:** PushOnEdit UI toggle for GitHub integration ([dfd32b2](https://github.com/Ripwords/ReproJs/commit/dfd32b2))
- **integration-api:** Expose autoCreateOnIntake toggle ([1574a7d](https://github.com/Ripwords/ReproJs/commit/1574a7d))
- **shared:** Comment DTOs ([2485a18](https://github.com/Ripwords/ReproJs/commit/2485a18))
- **github:** Create custom labels in linked repo from the picker ([18ad810](https://github.com/Ripwords/ReproJs/commit/18ad810))
- **sdk-utils:** Add canonical theme tokens shared by web and expo SDKs ([989d8e3](https://github.com/Ripwords/ReproJs/commit/989d8e3))
- **sdk-utils:** Add Attachment shape and validateAttachments helper ([a6c8159](https://github.com/Ripwords/ReproJs/commit/a6c8159))
- **ui:** Add themeToCssVars helper that emits flame/mist tokens as CSS vars ([1a2e692](https://github.com/Ripwords/ReproJs/commit/1a2e692))
- **ui:** Inject flame/mist CSS vars into shadow root at mount ([91a883b](https://github.com/Ripwords/ReproJs/commit/91a883b))
- **ui:** Add PrimaryButton, SecondaryButton, FieldLabel, StepIndicator, WizardHeader ([61404b5](https://github.com/Ripwords/ReproJs/commit/61404b5))
- **ui:** Add StepDetails (replaces step-describe in 3-step wizard) ([1077c55](https://github.com/Ripwords/ReproJs/commit/1077c55))
- **ui:** Add StepReview with 'Included in this report' summary ([da15040](https://github.com/Ripwords/ReproJs/commit/da15040))
- **ui:** Replace 2-step wizard with annotate → details → review flow ([25c916f](https://github.com/Ripwords/ReproJs/commit/25c916f))
- **ui:** Add AttachmentList with hybrid thumbnail + chip rendering ([b8070d6](https://github.com/Ripwords/ReproJs/commit/b8070d6))
- **sdk-web:** Add user attachments end-to-end ([46af0bb](https://github.com/Ripwords/ReproJs/commit/46af0bb))
- **shared:** Add user-file kind and filename field to AttachmentDTO ([dd715e5](https://github.com/Ripwords/ReproJs/commit/dd715e5))
- **ui:** Side-by-side details layout + paste-to-attach screenshots ([4452729](https://github.com/Ripwords/ReproJs/commit/4452729))
- **ui:** Inflight toast + clamav scan visibility ([23b9349](https://github.com/Ripwords/ReproJs/commit/23b9349))
- **dashboard:** Show clamav scan report on user-file attachments ([368d63b](https://github.com/Ripwords/ReproJs/commit/368d63b))
- **expo:** Pick attachments from Photos / Files / Clipboard ([0cc0bf5](https://github.com/Ripwords/ReproJs/commit/0cc0bf5))
- **extension:** Retheme popup + options to flame/mist tokens ([2708f72](https://github.com/Ripwords/ReproJs/commit/2708f72))

### 🩹 Fixes

- **docs:** Update URLs after repo rename to ReproJs ([ee6ff03](https://github.com/Ripwords/ReproJs/commit/ee6ff03))
- **sdk-utils:** Hermes-safe newShapeId — fall back when crypto.randomUUID missing ([a3c218b](https://github.com/Ripwords/ReproJs/commit/a3c218b))
- **github:** Subscribe to issue_comment/label/milestone/member events + activity feed tag rendering ([40e160c](https://github.com/Ripwords/ReproJs/commit/40e160c))

### 💅 Refactors

- **sdk-utils:** Extract ring-buffer from @reprojs/ui ([998a4e1](https://github.com/Ripwords/ReproJs/commit/998a4e1))
- **sdk-utils:** Extract redact from @reprojs/ui ([0b1406b](https://github.com/Ripwords/ReproJs/commit/0b1406b))
- **sdk-utils:** Extract breadcrumbs from @reprojs/ui ([eceb072](https://github.com/Ripwords/ReproJs/commit/eceb072))
- **sdk-utils:** Extract annotation tool geometry from @reprojs/ui ([bac4449](https://github.com/Ripwords/ReproJs/commit/bac4449))
- **dev:** Move hardcoded tunnel host + demo endpoint out of tracked files ([17ae31c](https://github.com/Ripwords/ReproJs/commit/17ae31c))
- **assignees:** Github-only, drop dashboard-user linking ([557d2d6](https://github.com/Ripwords/ReproJs/commit/557d2d6))
- **ui:** Switch styles to CSS custom properties from sdk-utils tokens ([ede8899](https://github.com/Ripwords/ReproJs/commit/ede8899))

### 🏡 Chore

- **sdk-utils:** Scaffold package ([abd9d08](https://github.com/Ripwords/ReproJs/commit/abd9d08))
- **github-app:** Default auto_create_on_intake to true for new installs ([a7fbab1](https://github.com/Ripwords/ReproJs/commit/a7fbab1))
- **release:** Sdk-v0.4.0 ([5868b7e](https://github.com/Ripwords/ReproJs/commit/5868b7e))

### ✅ Tests

- **shared:** Align ReportSummaryDTO test with new assignees/milestone shape ([9dca620](https://github.com/Ripwords/ReproJs/commit/9dca620))
- **extension:** Rename Playwright e2e spec to .e2e.ts so bun test skips it ([11149b5](https://github.com/Ripwords/ReproJs/commit/11149b5))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
- Jer-tan ([@jer-tan](https://github.com/jer-tan))

## extension-v0.1.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/4e19da84f9e333ee5690834a005a91bdaa00766b...extension-v0.1.1)

### 🚀 Enhancements

- **shared:** Add zod schemas and DTOs for projects, users, settings ([705e1be](https://github.com/Ripwords/ReproJs/commit/705e1be))
- **shared:** Add report context, intake input, and viewer DTOs ([d6a934e](https://github.com/Ripwords/ReproJs/commit/d6a934e))
- **dashboard:** Add reports viewer page and embed-key management in settings ([da7aaf5](https://github.com/Ripwords/ReproJs/commit/da7aaf5))
- **sdk:** Add config resolution with tests ([29228d6](https://github.com/Ripwords/ReproJs/commit/29228d6))
- **sdk:** Add context gatherer with tests ([93347dd](https://github.com/Ripwords/ReproJs/commit/93347dd))
- **sdk:** Add screenshot wrapper with tests ([27df685](https://github.com/Ripwords/ReproJs/commit/27df685))
- **sdk:** Add intake client and public init/open/close/identify API ([b19a4b5](https://github.com/Ripwords/ReproJs/commit/b19a4b5))
- **sdk-ui:** Add Launcher and Reporter Preact components with scoped styles ([189e175](https://github.com/Ripwords/ReproJs/commit/189e175))
- **sdk-ui:** Wire UI mount, static import from core, CSS inlined as text ([8000003](https://github.com/Ripwords/ReproJs/commit/8000003))
- **sdk-ui:** Add demo playground served by Bun on :4000 ([0d81746](https://github.com/Ripwords/ReproJs/commit/0d81746))
- **sdk-ui:** Add annotation types and install @preact/signals ([cd2e627](https://github.com/Ripwords/ReproJs/commit/cd2e627))
- **sdk-ui:** Add remappable shortcut map with tests ([a04dc29](https://github.com/Ripwords/ReproJs/commit/a04dc29))
- **sdk-ui:** Add viewport transform helpers with tests ([61bd3d5](https://github.com/Ripwords/ReproJs/commit/61bd3d5))
- **sdk-ui:** Add annotation store with undo/redo via Preact signals ([ea619e1](https://github.com/Ripwords/ReproJs/commit/ea619e1))
- **sdk-ui:** Add deterministic word-wrap with tests ([a3a4e6f](https://github.com/Ripwords/ReproJs/commit/a3a4e6f))
- **sdk-ui:** Add pure render function with per-shape drawing and tests ([393fdcf](https://github.com/Ripwords/ReproJs/commit/393fdcf))
- **sdk-ui:** Add flatten(bg, shapes) for submit-time rasterization ([8eaf66d](https://github.com/Ripwords/ReproJs/commit/8eaf66d))
- **sdk-ui:** Add ToolHandler interface and arrow tool with tests ([fb1b07c](https://github.com/Ripwords/ReproJs/commit/fb1b07c))
- **sdk-ui:** Add rect tool with normalization and tests ([968dd89](https://github.com/Ripwords/ReproJs/commit/968dd89))
- **sdk-ui:** Add pen tool with pressure-aware downsampling and tests ([6904ee5](https://github.com/Ripwords/ReproJs/commit/6904ee5))
- **sdk-ui:** Add highlight tool with tests ([5cd7f35](https://github.com/Ripwords/ReproJs/commit/5cd7f35))
- **sdk-ui:** Add text tool drag-rect phase with tests ([8f3dab1](https://github.com/Ripwords/ReproJs/commit/8f3dab1))
- **sdk-ui:** Add interactive Canvas with Pointer Events, pan, zoom, and text input overlay ([4a7d3e4](https://github.com/Ripwords/ReproJs/commit/4a7d3e4))
- **sdk-ui:** Add tool picker (tools + palette + stroke + undo/redo/clear) ([4633948](https://github.com/Ripwords/ReproJs/commit/4633948))
- **sdk-ui:** Add wizard step 2 (describe + annotated preview) ([4b9463d](https://github.com/Ripwords/ReproJs/commit/4b9463d))
- **sdk-ui:** Add wizard step 1 (annotation canvas + tool picker + shortcuts) ([3e00855](https://github.com/Ripwords/ReproJs/commit/3e00855))
- **sdk-ui:** Replace Reporter with two-step wizard; widen onSubmit with screenshot ([8a48b9b](https://github.com/Ripwords/ReproJs/commit/8a48b9b))
- **sdk-ui:** Add bounded RingBuffer for collectors ([35fb23c](https://github.com/Ripwords/ReproJs/commit/35fb23c))
- **sdk-ui:** Add safe serializer with truncation + default string redactors ([7d4add2](https://github.com/Ripwords/ReproJs/commit/7d4add2))
- **sdk-ui:** Add redaction engine (cookies, headers, URL params, bodies) ([54e2802](https://github.com/Ripwords/ReproJs/commit/54e2802))
- **sdk-ui:** Add systemInfo snapshot with inline type (swapped in Task 11) ([a8efc20](https://github.com/Ripwords/ReproJs/commit/a8efc20))
- **sdk-ui:** Add cookies collector with redaction ([ffb5148](https://github.com/Ripwords/ReproJs/commit/ffb5148))
- **sdk-ui:** Add breadcrumbs collector backing feedback.log() ([4866dd2](https://github.com/Ripwords/ReproJs/commit/4866dd2))
- **sdk-ui:** Add console collector (log/info/warn/error/debug) with stack on warn+error ([3ceb50c](https://github.com/Ripwords/ReproJs/commit/3ceb50c))
- **sdk-ui:** Add network collector (fetch + XHR) with body/header/URL redaction ([aab1f1b](https://github.com/Ripwords/ReproJs/commit/aab1f1b))
- **sdk-ui:** Add registerAllCollectors orchestration with beforeSend sandbox ([9d35872](https://github.com/Ripwords/ReproJs/commit/9d35872))
- **shared:** Add SystemInfo/CookieEntry/LogsAttachment + extend ReportContext ([80e524e](https://github.com/Ripwords/ReproJs/commit/80e524e))
- **sdk:** Wire collectors into init, expose feedback.log(), send logs multipart ([2cb48b7](https://github.com/Ripwords/ReproJs/commit/2cb48b7))
- **sdk-ui:** Capture uncaught window errors + unhandled rejections as error entries ([4bfaa84](https://github.com/Ripwords/ReproJs/commit/4bfaa84))
- **sdk-ui:** Enrich captured fetch metadata (body descriptors, Content-Length size, Request headers) ([215d307](https://github.com/Ripwords/ReproJs/commit/215d307))
- **sdk-ui:** Deep-inspect request bodies + demo harness for full capture ([f7df3a0](https://github.com/Ripwords/ReproJs/commit/f7df3a0))
- **shared:** Add triage enums + Event/Patch/Bulk DTOs; extend ReportSummaryDTO ([8b4123c](https://github.com/Ripwords/ReproJs/commit/8b4123c))
- **db:** Add github_issue_* columns on reports + github_unlinked event kind ([e65fce3](https://github.com/Ripwords/ReproJs/commit/e65fce3))
- **shared:** Add GitHub integration Zod DTOs ([badd95b](https://github.com/Ripwords/ReproJs/commit/badd95b))
- **dashboard:** Drawer GitHub row — linked/unlinked/unlink dialog + DTO extension ([2679168](https://github.com/Ripwords/ReproJs/commit/2679168))
- **dashboard:** Project overview page + drop project slug ([273a177](https://github.com/Ripwords/ReproJs/commit/273a177))
- **auth:** Email domain sign-up gate; drop install-name setting ([69a08aa](https://github.com/Ripwords/ReproJs/commit/69a08aa))
- **shared:** Anti-abuse fields on intake + daily cap on projects ([817f821](https://github.com/Ripwords/ReproJs/commit/817f821))
- **sdk:** Honeypot input + dwell tracking ([cb41a6c](https://github.com/Ripwords/ReproJs/commit/cb41a6c))
- **recorder:** Scaffold package ([8859019](https://github.com/Ripwords/ReproJs/commit/8859019))
- **recorder:** Rrweb-compatible event type definitions ([735657a](https://github.com/Ripwords/ReproJs/commit/735657a))
- **recorder:** Size+time-bounded event buffer with eviction ([3b0a61e](https://github.com/Ripwords/ReproJs/commit/3b0a61e))
- **recorder:** Masking predicate with strict/moderate/minimal modes ([23a2ad3](https://github.com/Ripwords/ReproJs/commit/23a2ad3))
- **recorder:** Gzip events with truncate-and-retry for size cap ([6a013bb](https://github.com/Ripwords/ReproJs/commit/6a013bb))
- **recorder:** Two-way DOM-node id map ([9521502](https://github.com/Ripwords/ReproJs/commit/9521502))
- **recorder:** Serialize DOM nodes to rrweb-compatible shape with masking ([04b4920](https://github.com/Ripwords/ReproJs/commit/04b4920))
- **recorder:** Full-snapshot emitter (Meta + FullSnapshot events) ([84900d5](https://github.com/Ripwords/ReproJs/commit/84900d5))
- **recorder:** MutationObserver wrapper with masking on newly-added nodes ([839e599](https://github.com/Ripwords/ReproJs/commit/839e599))
- **recorder:** Input, mouse-interaction, scroll, viewport observers ([39c1262](https://github.com/Ripwords/ReproJs/commit/39c1262))
- **recorder:** Orchestrator + public API (start/stop/pause/resume/flushGzipped) ([aa7ebe7](https://github.com/Ripwords/ReproJs/commit/aa7ebe7))
- **sdk:** Replay collector adapter; wire into registerAllCollectors ([530a9d2](https://github.com/Ripwords/ReproJs/commit/530a9d2))
- **shared:** IntakeResponse schema with replayStored/replayDisabled flags ([f399f49](https://github.com/Ripwords/ReproJs/commit/f399f49))
- **sdk:** Core submit path attaches replay part; honors replayDisabled response ([6c1346a](https://github.com/Ripwords/ReproJs/commit/6c1346a))
- **dashboard:** Project settings toggle for replay ([2265eb1](https://github.com/Ripwords/ReproJs/commit/2265eb1))
- **dashboard:** Replace native confirm() with in-app confirm dialogs ([f587750](https://github.com/Ripwords/ReproJs/commit/f587750))
- **sdk-core:** Pixel-perfect screen-capture path via getDisplayMedia ([a93a239](https://github.com/Ripwords/ReproJs/commit/a93a239))
- **sdk:** Pause replay buffer while the report wizard is open ([bd64ef3](https://github.com/Ripwords/ReproJs/commit/bd64ef3))
- **shared:** Project invitation DTOs and inputs ([f7f38e3](https://github.com/Ripwords/ReproJs/commit/f7f38e3))
- **extension:** Scaffold apps/extension MV3 + crxjs skeleton ([62a36a5](https://github.com/Ripwords/ReproJs/commit/62a36a5))
- **extension:** Add chrome.storage.local config wrapper ([9a03d07](https://github.com/Ripwords/ReproJs/commit/9a03d07))
- **extension:** Add origin matching utility ([b9fd648](https://github.com/Ripwords/ReproJs/commit/b9fd648))
- **extension:** Add chrome.permissions helpers ([e1b166e](https://github.com/Ripwords/ReproJs/commit/e1b166e))
- **extension:** Add SDK sync script ([1d940b8](https://github.com/Ripwords/ReproJs/commit/1d940b8))
- **extension:** Inject SDK via chrome.scripting on tab load ([5384731](https://github.com/Ripwords/ReproJs/commit/5384731))
- **extension:** Popup shell + config list component ([1720e78](https://github.com/Ripwords/ReproJs/commit/1720e78))
- **extension:** Add-config form with permission request ([282f7ce](https://github.com/Ripwords/ReproJs/commit/282f7ce))
- **extension:** Sync icons from dashboard SVG at build time ([613f82b](https://github.com/Ripwords/ReproJs/commit/613f82b))
- **extension:** Proxy SDK fetch through the service worker ([ff40433](https://github.com/Ripwords/ReproJs/commit/ff40433))
- **extension:** Redesign popup/options + fix first-add race ([318666d](https://github.com/Ripwords/ReproJs/commit/318666d))
- **extension:** Remember last intake endpoint in Add form ([e9f7b91](https://github.com/Ripwords/ReproJs/commit/e9f7b91))
- **extension:** Pre-fill Add form with active tab's origin ([ef78c25](https://github.com/Ripwords/ReproJs/commit/ef78c25))

### 🩹 Fixes

- **sdk-ui:** Inline CSS into IIFE bundle via generated string module ([31a1789](https://github.com/Ripwords/ReproJs/commit/31a1789))
- **sdk-ui:** Render draft text-box outline + stop shortcuts leaking into textarea ([2c7dbb2](https://github.com/Ripwords/ReproJs/commit/2c7dbb2))
- **sdk-ui:** Render bg and shapes at the same transform; honor DPR ([e812f3b](https://github.com/Ripwords/ReproJs/commit/e812f3b))
- **sdk-ui:** Use navigator.userAgentData.platform to avoid MacIntel on Apple Silicon ([b436a57](https://github.com/Ripwords/ReproJs/commit/b436a57))
- **sdk-ui:** Submit via button onClick instead of native form submit ([7044f93](https://github.com/Ripwords/ReproJs/commit/7044f93))
- **sdk-ui:** Remove <form> from describe step to stop navigation on submit ([4521d91](https://github.com/Ripwords/ReproJs/commit/4521d91))
- **sdk-ui:** Demo form submit preventDefault + real fetch + breadcrumb ([0f0b783](https://github.com/Ripwords/ReproJs/commit/0f0b783))
- **sdk-ui:** URL-encode demo cookie values so space-bearing ones actually land ([385fd4f](https://github.com/Ripwords/ReproJs/commit/385fd4f))
- **sdk:** Widget shadow root now closed mode (host scripts cannot reach in) ([b00b7d2](https://github.com/Ripwords/ReproJs/commit/b00b7d2))
- **sdk:** RingBuffer.drain() actually clears the buffer after snapshot ([3f42d49](https://github.com/Ripwords/ReproJs/commit/3f42d49))
- **recorder:** Restore Date.now default clock; inject fixed `now` in tests ([849bf33](https://github.com/Ripwords/ReproJs/commit/849bf33))
- **recorder,dashboard:** Address 8 final-review findings for session replay ([4c084fd](https://github.com/Ripwords/ReproJs/commit/4c084fd))
- **dashboard:** Shiki JS engine (no WASM), kbd SSR hydration ([9be43d8](https://github.com/Ripwords/ReproJs/commit/9be43d8))
- **security:** Rate-limit invites, cap pagination offset, guard redact all:true ([b5830e6](https://github.com/Ripwords/ReproJs/commit/b5830e6))
- **sdk:** IIFE bundle was broken — regex didn't match @reprokit scope ([8f11a52](https://github.com/Ripwords/ReproJs/commit/8f11a52))
- **core:** Make init() a no-op under SSR ([1fe9289](https://github.com/Ripwords/ReproJs/commit/1fe9289))
- **sdk-core:** Exclude widget host via filter callback instead of hiding it ([3c5853c](https://github.com/Ripwords/ReproJs/commit/3c5853c))
- **sdk-core:** Skip <nextjs-portal> and add excludeSelectors to capture ([e5145f5](https://github.com/Ripwords/ReproJs/commit/e5145f5))
- **recorder:** Extract CSSOM rules and absolutize URLs in full snapshot ([ad8e527](https://github.com/Ripwords/ReproJs/commit/ad8e527))
- **sdk:** Close lifecycle gaps in pause/resume, capture, and reporter ([dce4455](https://github.com/Ripwords/ReproJs/commit/dce4455))
- **shared:** Allow null inviterEmail in InvitationDetailDTO ([9e672e2](https://github.com/Ripwords/ReproJs/commit/9e672e2))
- **extension:** Tsconfig types reference "bun" not "bun-types" ([682a979](https://github.com/Ripwords/ReproJs/commit/682a979))
- **extension:** Guard against double SDK injection ([6de3900](https://github.com/Ripwords/ReproJs/commit/6de3900))
- **extension:** Close the double-inject race properly ([f077804](https://github.com/Ripwords/ReproJs/commit/f077804))
- **core:** Remove DOM fallback from screenshot auto mode ([a4ec71b](https://github.com/Ripwords/ReproJs/commit/a4ec71b))
- **ui:** Cancelling the capture prompt closes the reporter ([3f3a7b7](https://github.com/Ripwords/ReproJs/commit/3f3a7b7))
- **extension:** Harden bootRepro + add proxy diagnostics ([81367ac](https://github.com/Ripwords/ReproJs/commit/81367ac))
- **intake:** Accept X-Repro-Origin from extension SW proxy ([84a683d](https://github.com/Ripwords/ReproJs/commit/84a683d))
- **extension:** ⚠️  Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/ReproJs/commit/1bded3e))
- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/ReproJs/commit/1f7b72a))
- **core:** Prevent screenshot hang and broken-image glyphs ([0f9f684](https://github.com/Ripwords/ReproJs/commit/0f9f684))
- **recorder:** Align event pipeline with rrweb-player expectations ([b51ae61](https://github.com/Ripwords/ReproJs/commit/b51ae61))
- **extension:** Re-inject SDK on page refresh ([b5f9db4](https://github.com/Ripwords/ReproJs/commit/b5f9db4))

### 💅 Refactors

- Drop redundant/loose type casts ([afbb44e](https://github.com/Ripwords/ReproJs/commit/afbb44e))
- **auth:** Simplify invite flow — first sign-in promotes invited → active ([f9c0088](https://github.com/Ripwords/ReproJs/commit/f9c0088))
- **shared:** Z.string().email() → z.email() for Zod 4 ([e6408dc](https://github.com/Ripwords/ReproJs/commit/e6408dc))
- **ts-hygiene:** Tighten unsafe casts, drop unneeded ones, share Member type ([851a464](https://github.com/Ripwords/ReproJs/commit/851a464))
- **dashboard:** Extract priorityColor + relativeTime; drop ProjectMemberRole alias ([52c7004](https://github.com/Ripwords/ReproJs/commit/52c7004))
- **recorder:** Drop unjustified \`as unknown as\` on stylesheet read ([4889dcd](https://github.com/Ripwords/ReproJs/commit/4889dcd))

### 📖 Documentation

- Close open question #2 (recorder format); recorder package no longer pending ([#2](https://github.com/Ripwords/ReproJs/issues/2))
- **spec:** Sub-project F — dashboard frontend overhaul design ([d13c716](https://github.com/Ripwords/ReproJs/commit/d13c716))

### 📦 Build

- **sdk:** Make @reprokit/core a self-contained publishable package ([95d8992](https://github.com/Ripwords/ReproJs/commit/95d8992))

### 🏡 Chore

- Add packages/shared placeholder ([a96c8fe](https://github.com/Ripwords/ReproJs/commit/a96c8fe))
- **sdk:** Scaffold @feedback-tool/sdk package with tsdown dual build ([550b7cf](https://github.com/Ripwords/ReproJs/commit/550b7cf))
- **sdk-ui:** Scaffold @feedback-tool/ui with Shadow DOM host helper ([30e4690](https://github.com/Ripwords/ReproJs/commit/30e4690))
- **demo:** Set real project key for local testing ([17d49fb](https://github.com/Ripwords/ReproJs/commit/17d49fb))
- **dashboard:** App icons (viewfinder + dot) + PWA manifest ([e6e6077](https://github.com/Ripwords/ReproJs/commit/e6e6077))
- **lint:** Clear all 48 oxlint warnings ([08d5745](https://github.com/Ripwords/ReproJs/commit/08d5745))
- Remove dead/redundant code — audit round 5 (hygiene) ([4cee560](https://github.com/Ripwords/ReproJs/commit/4cee560))
- Update deps and scripts ([27ba9d3](https://github.com/Ripwords/ReproJs/commit/27ba9d3))
- **recorder:** Align package config with core — ES2020, bun-types, esModuleInterop ([c009473](https://github.com/Ripwords/ReproJs/commit/c009473))
- Update z.string().uuid() to z.uuid() ([996c4aa](https://github.com/Ripwords/ReproJs/commit/996c4aa))
- **brand:** Rename feedback-tool → repro ([3d38dcc](https://github.com/Ripwords/ReproJs/commit/3d38dcc))
- **brand:** Publish under @reprokit scope ([b73ef50](https://github.com/Ripwords/ReproJs/commit/b73ef50))
- **release:** V0.1.0 — infra for changelogen + CI + docs ([095da26](https://github.com/Ripwords/ReproJs/commit/095da26))
- **release:** V0.1.1 ([a704e7c](https://github.com/Ripwords/ReproJs/commit/a704e7c))
- **brand:** Rename @reprokit → @reprojs across npm + Docker + GitHub ([cdd9dc7](https://github.com/Ripwords/ReproJs/commit/cdd9dc7))
- **release:** V0.1.3 ([a9ee679](https://github.com/Ripwords/ReproJs/commit/a9ee679))
- **release:** Sdk-v0.1.4 ([2d92295](https://github.com/Ripwords/ReproJs/commit/2d92295))
- **release:** Sdk-v0.1.5 ([048daa7](https://github.com/Ripwords/ReproJs/commit/048daa7))
- **release:** Sdk-v0.1.6 ([033c128](https://github.com/Ripwords/ReproJs/commit/033c128))
- **release:** Sdk-v0.2.0 ([320cfad](https://github.com/Ripwords/ReproJs/commit/320cfad))
- **release:** Sdk-v0.2.1 ([73414c3](https://github.com/Ripwords/ReproJs/commit/73414c3))
- **release:** Sdk-v0.3.0 ([0a88ed6](https://github.com/Ripwords/ReproJs/commit/0a88ed6))
- **release:** Extension changelog config + fix SDK repo casing ([34aa3bc](https://github.com/Ripwords/ReproJs/commit/34aa3bc))

### ✅ Tests

- **sdk-ui:** Add pointer-flow integration tests for each annotation tool ([2a493a4](https://github.com/Ripwords/ReproJs/commit/2a493a4))
- **extension:** Playwright MV3 injection coverage ([2b3cbfd](https://github.com/Ripwords/ReproJs/commit/2b3cbfd))

### 🤖 CI

- **sdk-release:** Generate CHANGELOG and GitHub Release for @reprojs/core ([5603973](https://github.com/Ripwords/ReproJs/commit/5603973))

#### ⚠️ Breaking Changes

- **extension:** ⚠️  Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/ReproJs/commit/1bded3e))
- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/ReproJs/commit/1f7b72a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
