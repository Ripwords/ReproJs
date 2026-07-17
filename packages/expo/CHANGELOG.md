# Changelog

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
