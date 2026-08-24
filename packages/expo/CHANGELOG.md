# Changelog

## expo-v0.3.3

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.3.2...expo-v0.3.3)

### 🩹 Fixes

- **expo:** Send attachments in the shape the active fetch supports ([c4fb89a](https://github.com/Ripwords/ReproJs/commit/c4fb89a))

  **Symptom.** Every report carrying a screenshot was silently lost on Expo SDK >= 56.
  The launcher appeared, the wizard reported success, and nothing arrived — with no
  server-side trace, because the request never reached the server. iOS and Android
  alike. Reports with *no* attachment were unaffected, which made it read as an
  intermittent backend fault.

  **Cause.** From SDK 56 Expo installs its WinterCG `fetch` as the global `fetch`
  (`install('fetch', ...)` in `expo/src/winter/runtime.native.ts`; opt out with
  `EXPO_PUBLIC_USE_RN_FETCH=1`). Its `convertFormDataAsync` accepts only a string, a
  real `Blob`, or an object exposing `bytes()` — its own doc comment states *"`uri` is
  not supported for React Native's FormData"* — so this SDK's `{ uri, name, type }`
  shorthand threw `Unsupported FormDataPart implementation`. Being a throw rather than
  a response it carried no HTTP status, so the queue flusher read `status: 0`, judged
  it transient, retried 10x and discarded the report.

  **Why not simply switch to Blob.** The two runtimes need opposite shapes and fail in
  opposite ways:

  | Runtime                   | Correct part          | Wrong part fails as                          |
  | ------------------------- | --------------------- | -------------------------------------------- |
  | Expo WinterCG (SDK >= 56) | real `Blob`           | loud throw                                    |
  | React Native (SDK <= 55)  | `{ uri, name, type }` | **silent** — `{...value}` in `getParts()` loses the bytes; the attachment vanishes and intake still answers 201 |

  A Blob-everywhere fix would trade a loud bug on SDK >= 56 for a silent one on <= 55.
  The runtime is therefore detected via `Symbol.for('expo.builtin')`, which Expo stamps
  on every global it installs, and the body built accordingly — with a one-shot retry
  using Blob parts if the loud direction is ever mis-detected.

  A `Blob` is used rather than a `File` deliberately: Expo's `installFormDataPatch`
  assigns `value.name` when `Object.getOwnPropertyDescriptor(value, 'name')` is
  undefined, and `File.name` is a prototype getter, so that assignment throws
  `Cannot assign to property 'name' which has only a getter`.

  Verified on an iOS simulator against a live dashboard under **both** runtimes: an
  identical 204,454-byte screenshot captured, uploaded and persisted each time.

  **Workaround** without upgrading: set `EXPO_PUBLIC_USE_RN_FETCH=1` and rebuild.

- **expo:** Fail fast on a misconfigured `intakeUrl` instead of 10 silent retries ([c4fb89a](https://github.com/Ripwords/ReproJs/commit/c4fb89a))

  An `intakeUrl` missing the `/api/intake` path hits the dashboard's auth redirect.
  `fetch` follows 3xx by default, so the SDK received a `200` HTML login page, passed
  the `status >= 400` check, and only failed inside `res.json()` with a `SyntaxError`
  carrying no status — again 10 retries, then silent loss. Redirects and non-JSON
  responses are now rejected as fatal with a message naming the likely cause, as is an
  unreadable attachment.

  Fatal is an explicit flag rather than treating `status === 0` as fatal, so a genuine
  network failure while offline stays retryable and the offline queue keeps working.

- **expo:** Raise the submit dwell floor to match the server default ([b02088f](https://github.com/Ripwords/ReproJs/commit/b02088f))

  The fallback clamped `_dwellMs` to 1000 when the wizard-open timestamp was missing,
  but intake rejects anything below `INTAKE_MIN_DWELL_MS`, whose default is **1500** —
  so the guard meant to survive clock skew produced a value the server could never
  accept. The in-code comment claiming "1000 by default" was wrong.

- **expo:** Warn in dev when the SDK silently disables itself ([f84c9df](https://github.com/Ripwords/ReproJs/commit/f84c9df))

  Empty `projectKey`/`intakeUrl` disables the SDK by design, but it previously emitted
  nothing at all: no launcher and no diagnostic, indistinguishable from a broken SDK.
  Since `EXPO_PUBLIC_*` values are inlined at build time, the usual cause is a variable
  missing from the EAS environment that the build profile declares. Warned in `__DEV__`
  only, so production opt-outs stay quiet.

### 📖 Documentation

- **expo:** Document the SDK 56 attachment outage and EAS env scoping ([f439ba0](https://github.com/Ripwords/ReproJs/commit/f439ba0))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## expo-v0.3.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.3.1...expo-v0.3.2)

### 🚀 Enhancements

- **shared:** Media attachment kind, media-meta contract, share-link DTOs ([128ad93](https://github.com/Ripwords/ReproJs/commit/128ad93))
- **sdk-utils:** Shared formatBytes and media selection limits ([6e5eb6e](https://github.com/Ripwords/ReproJs/commit/6e5eb6e))

### 🩹 Fixes

- Close media validation and widget re-entry gaps from final review ([1c1c1cf](https://github.com/Ripwords/ReproJs/commit/1c1c1cf))
- **expo:** Serialize console args to strings so intake stops rejecting reports ([fc639e8](https://github.com/Ripwords/ReproJs/commit/fc639e8))
- **intake:** Keep the report when the logs part is invalid ([1433286](https://github.com/Ripwords/ReproJs/commit/1433286))
- **expo:** Retry queued reports on a backoff timer and surface failures ([a3e3ae1](https://github.com/Ripwords/ReproJs/commit/a3e3ae1))
- **sdk-utils:** Make the JWT redactor linear on adversarial input ([3ac6637](https://github.com/Ripwords/ReproJs/commit/3ac6637))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## expo-v0.3.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.3.0...expo-v0.3.1)

### 🚀 Enhancements

- **shared:** Add volume series to AdminOverviewDTO ([c0e3a70](https://github.com/Ripwords/ReproJs/commit/c0e3a70))

### 🩹 Fixes

- **changelog:** Restore history eroded by the path filter ([a0a5b91](https://github.com/Ripwords/ReproJs/commit/a0a5b91))

### 💅 Refactors

- **comments:** Move CreateCommentBody schema to @reprojs/shared ([0d14acd](https://github.com/Ripwords/ReproJs/commit/0d14acd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## expo-v0.3.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.2.0...expo-v0.3.0)

### 🚀 Enhancements

- **expo:** AssistiveTouch-style edge-snap drag for the launcher ([96e23f0](https://github.com/Ripwords/ReproJs/commit/96e23f0))

### 🩹 Fixes

- **release:** Scope each package's CHANGELOG to its own paths ([b1bb22c](https://github.com/Ripwords/ReproJs/commit/b1bb22c))

### 📖 Documentation

- **expo:** Add expo-document-picker + expo-image-picker to install snippet ([d7aad2e](https://github.com/Ripwords/ReproJs/commit/d7aad2e))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## expo-v0.2.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.1.1...expo-v0.2.0)

### 🚀 Enhancements

- **shared:** ReportSummaryDTO.assignees (array); TriagePatchInput.assigneeIds ([572ae66](https://github.com/Ripwords/ReproJs/commit/572ae66))
- **shared:** Add milestone + githubAssigneeLogins to reports DTOs ([4c64078](https://github.com/Ripwords/ReproJs/commit/4c64078))
- **integrations:** PushOnEdit UI toggle for GitHub integration ([dfd32b2](https://github.com/Ripwords/ReproJs/commit/dfd32b2))
- **integration-api:** Expose autoCreateOnIntake toggle ([1574a7d](https://github.com/Ripwords/ReproJs/commit/1574a7d))
- **shared:** Comment DTOs ([2485a18](https://github.com/Ripwords/ReproJs/commit/2485a18))
- **github:** Create custom labels in linked repo from the picker ([18ad810](https://github.com/Ripwords/ReproJs/commit/18ad810))
- **sdk-utils:** Add canonical theme tokens shared by web and expo SDKs ([989d8e3](https://github.com/Ripwords/ReproJs/commit/989d8e3))
- **sdk-utils:** Add Attachment shape and validateAttachments helper ([a6c8159](https://github.com/Ripwords/ReproJs/commit/a6c8159))
- **shared:** Add user-file kind and filename field to AttachmentDTO ([dd715e5](https://github.com/Ripwords/ReproJs/commit/dd715e5))
- **expo:** Add pickFiles wrapper over expo-document-picker ([d664505](https://github.com/Ripwords/ReproJs/commit/d664505))
- **expo:** Add AttachmentList for the mobile wizard ([b2162d3](https://github.com/Ripwords/ReproJs/commit/b2162d3))
- **expo:** Add attachments to the wizard's Details step ([9e64cea](https://github.com/Ripwords/ReproJs/commit/9e64cea))
- **expo:** Submit user-file attachments as attachment[N] multipart parts ([716d4b6](https://github.com/Ripwords/ReproJs/commit/716d4b6))
- **dashboard:** Show clamav scan report on user-file attachments ([368d63b](https://github.com/Ripwords/ReproJs/commit/368d63b))
- **expo:** Pick attachments from Photos / Files / Clipboard ([0cc0bf5](https://github.com/Ripwords/ReproJs/commit/0cc0bf5))

### 🩹 Fixes

- **expo:** Make clipboard paste actually work ([641faad](https://github.com/Ripwords/ReproJs/commit/641faad))

### 💅 Refactors

- **assignees:** Github-only, drop dashboard-user linking ([557d2d6](https://github.com/Ripwords/ReproJs/commit/557d2d6))
- **expo:** Re-export shared theme tokens from sdk-utils ([9ddc528](https://github.com/Ripwords/ReproJs/commit/9ddc528))

### ✅ Tests

- **shared:** Align ReportSummaryDTO test with new assignees/milestone shape ([9dca620](https://github.com/Ripwords/ReproJs/commit/9dca620))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
- Jer-tan ([@jer-tan](https://github.com/jer-tan))

## expo-v0.1.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/expo-v0.1.0...expo-v0.1.1)

### 🩹 Fixes

- **expo:** Resolve @reprojs/* at build time so published package installs ([428a937](https://github.com/Ripwords/ReproJs/commit/428a937))

### 🏡 Chore

- **expo:** Silence intentional no-await-in-loop in FIFO queue test ([b39575c](https://github.com/Ripwords/ReproJs/commit/b39575c))
- **expo:** Add changelogen config so release:expo tags as expo-v* ([a6dce39](https://github.com/Ripwords/ReproJs/commit/a6dce39))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
