# Changelog

## sdk-v0.4.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/sdk-v0.4.1...sdk-v0.4.2)

### 🩹 Fixes

- **sdk-ui:** Decode screenshots via createImageBitmap so host CSPs can't block capture ([00c23a6](https://github.com/Ripwords/ReproJs/commit/00c23a6))

### ✅ Tests

- **sdk-ui:** Add a strict-CSP route to the demo playground ([b57883a](https://github.com/Ripwords/ReproJs/commit/b57883a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.4.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/sdk-v0.4.0...sdk-v0.4.1)

### 🚀 Enhancements

- **shared:** Add volume series to AdminOverviewDTO ([c0e3a70](https://github.com/Ripwords/ReproJs/commit/c0e3a70))

### 🩹 Fixes

- **release:** Scope each package's CHANGELOG to its own paths ([b1bb22c](https://github.com/Ripwords/ReproJs/commit/b1bb22c))
- **sdk-ui:** Stop annotation shortcuts firing while typing text labels ([4ff661f](https://github.com/Ripwords/ReproJs/commit/4ff661f))

### 💅 Refactors

- **comments:** Move CreateCommentBody schema to @reprojs/shared ([0d14acd](https://github.com/Ripwords/ReproJs/commit/0d14acd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.4.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/sdk-v0.3.0...sdk-v0.4.0)

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

- **release:** Extension changelog config + fix SDK repo casing ([34aa3bc](https://github.com/Ripwords/ReproJs/commit/34aa3bc))
- **sdk-utils:** Scaffold package ([abd9d08](https://github.com/Ripwords/ReproJs/commit/abd9d08))
- **github-app:** Default auto_create_on_intake to true for new installs ([a7fbab1](https://github.com/Ripwords/ReproJs/commit/a7fbab1))

### ✅ Tests

- **shared:** Align ReportSummaryDTO test with new assignees/milestone shape ([9dca620](https://github.com/Ripwords/ReproJs/commit/9dca620))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
- Jer-tan ([@jer-tan](https://github.com/jer-tan))

## sdk-v0.3.0

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.2.1...sdk-v0.3.0)

### 🚀 Enhancements

- **shared:** Project invitation DTOs and inputs ([f7f38e3](https://github.com/Ripwords/reprojs/commit/f7f38e3))

### 🩹 Fixes

- **shared:** Allow null inviterEmail in InvitationDetailDTO ([9e672e2](https://github.com/Ripwords/reprojs/commit/9e672e2))
- **core:** Remove DOM fallback from screenshot auto mode ([a4ec71b](https://github.com/Ripwords/reprojs/commit/a4ec71b))
- **ui:** Cancelling the capture prompt closes the reporter ([3f3a7b7](https://github.com/Ripwords/reprojs/commit/3f3a7b7))
- **core:** Prevent screenshot hang and broken-image glyphs ([0f9f684](https://github.com/Ripwords/reprojs/commit/0f9f684))
- **recorder:** Align event pipeline with rrweb-player expectations ([b51ae61](https://github.com/Ripwords/reprojs/commit/b51ae61))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.2.1

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.2.0...sdk-v0.2.1)

### 🚀 Enhancements

- **sdk:** Pause replay buffer while the report wizard is open ([bd64ef3](https://github.com/Ripwords/reprojs/commit/bd64ef3))

### 🩹 Fixes

- **sdk:** Close lifecycle gaps in pause/resume, capture, and reporter ([dce4455](https://github.com/Ripwords/reprojs/commit/dce4455))

### 💅 Refactors

- **recorder:** Drop unjustified \`as unknown as\` on stylesheet read ([4889dcd](https://github.com/Ripwords/reprojs/commit/4889dcd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## sdk-v0.2.0

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.1.6...sdk-v0.2.0)

### 🚀 Enhancements

- **sdk-core:** Pixel-perfect screen-capture path via getDisplayMedia ([a93a239](https://github.com/Ripwords/reprojs/commit/a93a239))

### 🩹 Fixes

- **recorder:** Extract CSSOM rules and absolutize URLs in full snapshot ([ad8e527](https://github.com/Ripwords/reprojs/commit/ad8e527))

### 🤖 CI

- **sdk-release:** Generate CHANGELOG and GitHub Release for @reprojs/core ([5603973](https://github.com/Ripwords/reprojs/commit/5603973))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
