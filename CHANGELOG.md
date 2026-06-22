# Changelog

## v0.6.3

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.6.2...v0.6.3)

### 🩹 Fixes

- **github:** Embed issue screenshots with a non-expiring signed URL ([66a44a2](https://github.com/Ripwords/ReproJs/commit/66a44a2))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.6.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.6.1...v0.6.2)

### 🩹 Fixes

- **mcp:** Point OAuth loginPage at the real /auth/sign-in route ([96823c3](https://github.com/Ripwords/ReproJs/commit/96823c3))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.6.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.6.0...v0.6.1)

### 🩹 Fixes

- **dashboard:** Correct horizontal bar axis + donut segment slivers ([0009331](https://github.com/Ripwords/ReproJs/commit/0009331))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.6.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.5.2...v0.6.0)

### 🚀 Enhancements

- **mcp:** Add MCP_ENABLED + tunable env vars ([2a56bb0](https://github.com/Ripwords/ReproJs/commit/2a56bb0))
- **mcp:** Scaffold replay transcript reducer ([0efdc09](https://github.com/Ripwords/ReproJs/commit/0efdc09))
- **mcp:** Build DOM map from FullSnapshot for selector resolution ([2c3567c](https://github.com/Ripwords/ReproJs/commit/2c3567c))
- **mcp:** Emit navigation, coalesced inputs, console.error ([26f859f](https://github.com/Ripwords/ReproJs/commit/26f859f))
- **mcp:** Cap transcript size with middle truncation ([0384931](https://github.com/Ripwords/ReproJs/commit/0384931))
- **auth:** Add requireProjectRoleByUser for non-H3 callers ([db1b076](https://github.com/Ripwords/ReproJs/commit/db1b076))
- **mcp:** Wire oauth-provider + jwt plugins behind MCP_ENABLED ([c3a29ba](https://github.com/Ripwords/ReproJs/commit/c3a29ba))
- **mcp:** Add OAuth consent page + decision endpoint ([f8583b6](https://github.com/Ripwords/ReproJs/commit/f8583b6))
- **mcp:** Add McpToolError + helper ([400c570](https://github.com/Ripwords/ReproJs/commit/400c570))
- **mcp:** Add JWT → request context builder ([439314e](https://github.com/Ripwords/ReproJs/commit/439314e))
- **mcp:** Add repro_list_projects tool ([41239b5](https://github.com/Ripwords/ReproJs/commit/41239b5))
- **mcp:** Add repro_get_ticket tool with inline replay transcript ([b9e6a8d](https://github.com/Ripwords/ReproJs/commit/b9e6a8d))
- **mcp:** Per-request McpServer factory with both tools ([f1cc067](https://github.com/Ripwords/ReproJs/commit/f1cc067))
- **mcp:** Add Streamable HTTP /api/mcp routes (POST/GET/DELETE) ([3759a76](https://github.com/Ripwords/ReproJs/commit/3759a76))
- **mcp:** Add cursor encode/decode helper for pagination ([ef962e7](https://github.com/Ripwords/ReproJs/commit/ef962e7))
- **mcp:** Add repro_list_tickets with filters + cursor pagination ([5f42bf7](https://github.com/Ripwords/ReproJs/commit/5f42bf7))
- **mcp:** Add repro_list_ticket_comments with cursor pagination ([68b5e14](https://github.com/Ripwords/ReproJs/commit/68b5e14))
- **mcp:** Add repro_list_project_members ([60e7459](https://github.com/Ripwords/ReproJs/commit/60e7459))
- **mcp:** Add repro_get_screenshot tool ([106e998](https://github.com/Ripwords/ReproJs/commit/106e998))
- **mcp:** Add repro_get_replay_transcript tool ([d5389b9](https://github.com/Ripwords/ReproJs/commit/d5389b9))
- **mcp:** Add repro_get_replay_raw with 200KB acknowledgeSize cap ([7e5577f](https://github.com/Ripwords/ReproJs/commit/7e5577f))
- **mcp:** Add repro_get_ticket_cookies (opt-in cookies surface) ([761f62c](https://github.com/Ripwords/ReproJs/commit/761f62c))
- **mcp:** Register Phase 2 tools in McpServer factory ([0f219f4](https://github.com/Ripwords/ReproJs/commit/0f219f4))
- **db:** Add actor_client_id audit column + github_linked event kind ([27d1662](https://github.com/Ripwords/ReproJs/commit/27d1662))
- **mcp:** Add 4 write tools (update/comment/link/unlink) ([eddac03](https://github.com/Ripwords/ReproJs/commit/eddac03))
- **mcp:** Register Phase 3 write tools in McpServer factory ([89dda29](https://github.com/Ripwords/ReproJs/commit/89dda29))
- **mcp:** Add /api/me/mcp-connections list + revoke endpoints ([d68b8a7](https://github.com/Ripwords/ReproJs/commit/d68b8a7))
- **mcp:** Add /settings/mcp page (connect snippets + connected apps) ([9836a5d](https://github.com/Ripwords/ReproJs/commit/9836a5d))
- **mcp:** Flip MCP_ENABLED default to true ([9483645](https://github.com/Ripwords/ReproJs/commit/9483645))
- **mcp:** Add per-request access check (status + allowlist) ([8720976](https://github.com/Ripwords/ReproJs/commit/8720976))
- **mcp:** Add per-user rate limiter to access checker ([8261c62](https://github.com/Ripwords/ReproJs/commit/8261c62))
- **mcp:** Wire access check into Streamable HTTP routes ([a2c3d14](https://github.com/Ripwords/ReproJs/commit/a2c3d14))
- **mcp:** Add RFC 9728 protected-resource metadata endpoint ([2a7f509](https://github.com/Ripwords/ReproJs/commit/2a7f509))
- **shared:** Add volume series to AdminOverviewDTO ([c0e3a70](https://github.com/Ripwords/ReproJs/commit/c0e3a70))
- **dashboard:** Add 30-day report volume series to admin overview ([9723bd1](https://github.com/Ripwords/ReproJs/commit/9723bd1))
- **dashboard:** Add insight charts to admin overview ([9f50c84](https://github.com/Ripwords/ReproJs/commit/9f50c84))
- **dashboard:** Add pure pollUntil helper ([b954f5b](https://github.com/Ripwords/ReproJs/commit/b954f5b))

### 🔥 Performance

- **mcp:** Fold last-used lookup into single grouped query ([43c3804](https://github.com/Ripwords/ReproJs/commit/43c3804))

### 🩹 Fixes

- **mcp:** Use env.BETTER_AUTH_URL not request headers for OAuth metadata URL ([babb73a](https://github.com/Ripwords/ReproJs/commit/babb73a))
- **mcp:** Filter out soft-deleted projects in repro_list_projects ([4a117bf](https://github.com/Ripwords/ReproJs/commit/4a117bf))
- **mcp:** Coerce raw body to Buffer before Uint8Array conversion ([1784c96](https://github.com/Ripwords/ReproJs/commit/1784c96))
- **mcp:** Correct JWT issuer and consent response parsing ([9270e52](https://github.com/Ripwords/ReproJs/commit/9270e52))
- **dashboard:** Type BarChart orientation via Orientation enum ([437eadf](https://github.com/Ripwords/ReproJs/commit/437eadf))
- **dashboard:** Refetch projects list after deleting a project ([4b4de3d](https://github.com/Ripwords/ReproJs/commit/4b4de3d))
- **dashboard:** Poll for github issue link before refetching in triage sidebar ([3158026](https://github.com/Ripwords/ReproJs/commit/3158026))
- **dashboard:** Abort github-sync poll on triage drawer unmount ([eb7533e](https://github.com/Ripwords/ReproJs/commit/eb7533e))
- Use workspace-local node_modules paths in db/auth scripts ([3db3926](https://github.com/Ripwords/ReproJs/commit/3db3926))
- **ci:** Align db scripts to workspace .bin form; set MCP_ENABLED in ci ([0d19c31](https://github.com/Ripwords/ReproJs/commit/0d19c31))
- **test:** Isolate every SDK test file in its own bun process ([d98e510](https://github.com/Ripwords/ReproJs/commit/d98e510))

### 💅 Refactors

- **triage:** Extract applyTicketTriagePatch service function ([5ba753b](https://github.com/Ripwords/ReproJs/commit/5ba753b))
- **comments:** Extract addReportComment service function ([4ae056c](https://github.com/Ripwords/ReproJs/commit/4ae056c))
- **github:** Extract link/unlink service functions ([217d4c2](https://github.com/Ripwords/ReproJs/commit/217d4c2))
- **comments:** Move CreateCommentBody schema to @reprojs/shared ([0d14acd](https://github.com/Ripwords/ReproJs/commit/0d14acd))
- **dashboard:** Harden volume query groupBy and test anchoring ([a978fc8](https://github.com/Ripwords/ReproJs/commit/a978fc8))
- **dashboard:** Clarify chart formatters and declare @unovis/ts dep ([615b5cc](https://github.com/Ripwords/ReproJs/commit/615b5cc))
- **dashboard:** Share projects-list cache key constant and regroup test ([3418bfe](https://github.com/Ripwords/ReproJs/commit/3418bfe))

### 📖 Documentation

- Trim filing-reports guide and add SVG illustrations ([97cede5](https://github.com/Ripwords/ReproJs/commit/97cede5))
- **spec:** MCP OAuth server design ([3c3318d](https://github.com/Ripwords/ReproJs/commit/3c3318d))
- **plan:** MCP OAuth server — Phase 1 ([4635ffd](https://github.com/Ripwords/ReproJs/commit/4635ffd))
- **plan:** MCP OAuth server — Phase 2 ([3829a2b](https://github.com/Ripwords/ReproJs/commit/3829a2b))
- **plan:** MCP OAuth server — Phase 3 ([2b786f4](https://github.com/Ripwords/ReproJs/commit/2b786f4))
- **plan:** MCP OAuth server — Phase 4 ([5493949](https://github.com/Ripwords/ReproJs/commit/5493949))
- **mcp:** Add user guide for connecting AI assistants ([564941e](https://github.com/Ripwords/ReproJs/commit/564941e))
- **mcp:** Add self-hosting / operator guide ([db85bbe](https://github.com/Ripwords/ReproJs/commit/db85bbe))
- **mcp:** Add MCP pages to VitePress sidebar ([f0627f2](https://github.com/Ripwords/ReproJs/commit/f0627f2))
- **plan:** MCP OAuth server — Phase 5 ([46ad998](https://github.com/Ripwords/ReproJs/commit/46ad998))
- Spec for admin overview charts + project-delete and github-sync refetch fixes ([e8b414d](https://github.com/Ripwords/ReproJs/commit/e8b414d))
- Implementation plan for admin charts + refetch fixes ([16d4fd0](https://github.com/Ripwords/ReproJs/commit/16d4fd0))
- **mcp:** Add precise tool reference to the AI assistants guide ([30473c4](https://github.com/Ripwords/ReproJs/commit/30473c4))

### 🏡 Chore

- **mcp:** Add @better-auth/oauth-provider + @modelcontextprotocol/sdk ([de0e2c0](https://github.com/Ripwords/ReproJs/commit/de0e2c0))
- Pin oxlint to 1.59.0 ([617cc92](https://github.com/Ripwords/ReproJs/commit/617cc92))
- **db:** Regenerate OAuth tables migration after rebase ([3c42538](https://github.com/Ripwords/ReproJs/commit/3c42538))
- **dashboard:** Add nuxt-charts module ([d435c35](https://github.com/Ripwords/ReproJs/commit/d435c35))
- Gitignore .cursor/ IDE workspace dir ([4d2c727](https://github.com/Ripwords/ReproJs/commit/4d2c727))

### ✅ Tests

- **mcp:** Integration — full OAuth + tools/call roundtrip ([94222c5](https://github.com/Ripwords/ReproJs/commit/94222c5))
- **mcp:** Integration tests for Phase 2 read tools ([27c5180](https://github.com/Ripwords/ReproJs/commit/27c5180))
- **mcp:** Integration tests for Phase 3 write tools ([1aecf79](https://github.com/Ripwords/ReproJs/commit/1aecf79))
- **mcp:** Unfreeze Phase 1 tool-list assertion ([a3c0062](https://github.com/Ripwords/ReproJs/commit/a3c0062))
- **mcp:** Add negative permissions/access integration suite ([fbf39bc](https://github.com/Ripwords/ReproJs/commit/fbf39bc))

### 🤖 CI

- Bump pinned bun 1.3.12 -> 1.3.13 ([146ec43](https://github.com/Ripwords/ReproJs/commit/146ec43))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.5.1...v0.5.2)

### 🚀 Enhancements

- **dashboard:** Redirect GitHub install to integrations page with toast ([b965ccb](https://github.com/Ripwords/ReproJs/commit/b965ccb))

### 🩹 Fixes

- **dashboard:** Add space between actor name and event description in activity feed ([0e54097](https://github.com/Ripwords/ReproJs/commit/0e54097))

### 📖 Documentation

- Add non-technical "Filing a bug report" guide ([a5370e3](https://github.com/Ripwords/ReproJs/commit/a5370e3))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.5.0...v0.5.1)

### 🚀 Enhancements

- **expo:** AssistiveTouch-style edge-snap drag for the launcher ([96e23f0](https://github.com/Ripwords/ReproJs/commit/96e23f0))
- **dashboard:** Proxy GitHub user-attachment images ([b7e4a34](https://github.com/Ripwords/ReproJs/commit/b7e4a34))
- **dashboard:** Redesign report overview tab to Figma spec ([8695fd5](https://github.com/Ripwords/ReproJs/commit/8695fd5))
- **dashboard:** Chat-style comments with paste-to-attach images ([d79f674](https://github.com/Ripwords/ReproJs/commit/d79f674))

### 🩹 Fixes

- **release:** Scope each package's CHANGELOG to its own paths ([b1bb22c](https://github.com/Ripwords/ReproJs/commit/b1bb22c))
- **deploy:** Dashboard runs drizzle-kit migrate on every start ([11bc9b3](https://github.com/Ripwords/ReproJs/commit/11bc9b3))
- **db:** Correct out-of-order when timestamp on migration 0012 ([e5a3764](https://github.com/Ripwords/ReproJs/commit/e5a3764))
- **dashboard:** Show actor/event separator in activity feed ([b3d5fbd](https://github.com/Ripwords/ReproJs/commit/b3d5fbd))

### 📖 Documentation

- **expo:** Add expo-document-picker + expo-image-picker to install snippet ([d7aad2e](https://github.com/Ripwords/ReproJs/commit/d7aad2e))
- **site:** Add expo-document-picker + expo-image-picker to Expo install guide ([02e6e0d](https://github.com/Ripwords/ReproJs/commit/02e6e0d))
- Update compat docs ([e9c45ba](https://github.com/Ripwords/ReproJs/commit/e9c45ba))

### 🏡 Chore

- **release:** Expo-v0.3.0 ([0dc692a](https://github.com/Ripwords/ReproJs/commit/0dc692a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.5.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.4.2...v0.5.0)

### 🚀 Enhancements

- **sdk-utils:** Add canonical theme tokens shared by web and expo SDKs ([989d8e3](https://github.com/Ripwords/ReproJs/commit/989d8e3))
- **sdk-utils:** Add Attachment shape and validateAttachments helper ([a6c8159](https://github.com/Ripwords/ReproJs/commit/a6c8159))
- **ui:** Add themeToCssVars helper that emits flame/mist tokens as CSS vars ([1a2e692](https://github.com/Ripwords/ReproJs/commit/1a2e692))
- **ui:** Inject flame/mist CSS vars into shadow root at mount ([91a883b](https://github.com/Ripwords/ReproJs/commit/91a883b))
- **ui:** Add PrimaryButton, SecondaryButton, FieldLabel, StepIndicator, WizardHeader ([61404b5](https://github.com/Ripwords/ReproJs/commit/61404b5))
- **ui:** Add StepDetails (replaces step-describe in 3-step wizard) ([1077c55](https://github.com/Ripwords/ReproJs/commit/1077c55))
- **ui:** Add StepReview with 'Included in this report' summary ([da15040](https://github.com/Ripwords/ReproJs/commit/da15040))
- **ui:** Replace 2-step wizard with annotate → details → review flow ([25c916f](https://github.com/Ripwords/ReproJs/commit/25c916f))
- **db:** Add report_attachments.filename and user-file kind ([9fd59b1](https://github.com/Ripwords/ReproJs/commit/9fd59b1))
- **env:** Add user-file intake size budgets ([01c0f9e](https://github.com/Ripwords/ReproJs/commit/01c0f9e))
- **server:** Add sanitizeFilename + rollbackPuts helpers ([f4bc566](https://github.com/Ripwords/ReproJs/commit/f4bc566))
- **intake:** Accept attachment[N] parts as user-file attachments ([bceae0b](https://github.com/Ripwords/ReproJs/commit/bceae0b))
- **ui:** Add AttachmentList with hybrid thumbnail + chip rendering ([b8070d6](https://github.com/Ripwords/ReproJs/commit/b8070d6))
- **sdk-web:** Add user attachments end-to-end ([46af0bb](https://github.com/Ripwords/ReproJs/commit/46af0bb))
- **shared:** Add user-file kind and filename field to AttachmentDTO ([dd715e5](https://github.com/Ripwords/ReproJs/commit/dd715e5))
- **dashboard:** Include user-file filename in report detail response ([4242d52](https://github.com/Ripwords/ReproJs/commit/4242d52))
- **dashboard:** Add AttachmentsTab for user-file attachments ([f046de2](https://github.com/Ripwords/ReproJs/commit/f046de2))
- **dashboard:** Expose user-file attachments tab in report drawer ([125760a](https://github.com/Ripwords/ReproJs/commit/125760a))
- **expo:** Add pickFiles wrapper over expo-document-picker ([d664505](https://github.com/Ripwords/ReproJs/commit/d664505))
- **expo:** Add AttachmentList for the mobile wizard ([b2162d3](https://github.com/Ripwords/ReproJs/commit/b2162d3))
- **expo:** Add attachments to the wizard's Details step ([9e64cea](https://github.com/Ripwords/ReproJs/commit/9e64cea))
- **expo:** Submit user-file attachments as attachment[N] multipart parts ([716d4b6](https://github.com/Ripwords/ReproJs/commit/716d4b6))
- **ui:** Side-by-side details layout + paste-to-attach screenshots ([4452729](https://github.com/Ripwords/ReproJs/commit/4452729))
- **intake:** Virus-scan user attachments via ClamAV sidecar ([53f97a3](https://github.com/Ripwords/ReproJs/commit/53f97a3))
- **ui:** Inflight toast + clamav scan visibility ([23b9349](https://github.com/Ripwords/ReproJs/commit/23b9349))
- **dashboard:** Show clamav scan report on user-file attachments ([368d63b](https://github.com/Ripwords/ReproJs/commit/368d63b))
- **expo:** Pick attachments from Photos / Files / Clipboard ([0cc0bf5](https://github.com/Ripwords/ReproJs/commit/0cc0bf5))
- **extension:** Retheme popup + options to flame/mist tokens ([2708f72](https://github.com/Ripwords/ReproJs/commit/2708f72))
- **deploy:** Add clamav sidecar to production compose.yaml ([3690065](https://github.com/Ripwords/ReproJs/commit/3690065))

### 🩹 Fixes

- **dashboard:** Reject ?id= when authed via signed token ([2485200](https://github.com/Ripwords/ReproJs/commit/2485200))
- **docker:** Pin clamav sidecar to linux/amd64 ([7971214](https://github.com/Ripwords/ReproJs/commit/7971214))
- **expo:** Make clipboard paste actually work ([641faad](https://github.com/Ripwords/ReproJs/commit/641faad))
- **intake:** Scan user-files BEFORE inserting the report row ([67f0dbf](https://github.com/Ripwords/ReproJs/commit/67f0dbf))
- **ci:** Isolate SDK tests per-package to prevent globalThis pollution ([d829cc2](https://github.com/Ripwords/ReproJs/commit/d829cc2))
- **build:** Bump expo:build heap to 6GB ([dadcb27](https://github.com/Ripwords/ReproJs/commit/dadcb27))

### 💅 Refactors

- **ui:** Switch styles to CSS custom properties from sdk-utils tokens ([ede8899](https://github.com/Ripwords/ReproJs/commit/ede8899))
- **expo:** Re-export shared theme tokens from sdk-utils ([9ddc528](https://github.com/Ripwords/ReproJs/commit/9ddc528))

### 📖 Documentation

- **specs:** Add SDK wizard redesign + user attachments design ([d8a9b2e](https://github.com/Ripwords/ReproJs/commit/d8a9b2e))
- **plans:** Add SDK wizard redesign + user attachments implementation plan ([6327f12](https://github.com/Ripwords/ReproJs/commit/6327f12))

### 🏡 Chore

- Refresh bun.lock after clamav + expo peer-dep churn ([50c4cec](https://github.com/Ripwords/ReproJs/commit/50c4cec))
- **release:** Sdk-v0.4.0 ([5868b7e](https://github.com/Ripwords/ReproJs/commit/5868b7e))
- **release:** Expo-v0.2.0 ([df0f75e](https://github.com/Ripwords/ReproJs/commit/df0f75e))
- **release:** Extension-v0.1.2 ([693a0a3](https://github.com/Ripwords/ReproJs/commit/693a0a3))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.4.2

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.4.1...v0.4.2)

### 🚀 Enhancements

- **sync:** In-process trigger + shared outbox runner ([4b59420](https://github.com/Ripwords/ReproJs/commit/4b59420))
- **github:** Create custom labels in linked repo from the picker ([18ad810](https://github.com/Ripwords/ReproJs/commit/18ad810))

### 🩹 Fixes

- **github:** Gate test-only reconcile shim on __hasClientOverride ([cc3b0e8](https://github.com/Ripwords/ReproJs/commit/cc3b0e8))

### 📖 Documentation

- **sdk:** Fix the <script async> init race ([10a3dc3](https://github.com/Ripwords/ReproJs/commit/10a3dc3))

### ✅ Tests

- Wait for in-process sync trigger to settle before asserting ([29489d0](https://github.com/Ripwords/ReproJs/commit/29489d0))

### 🎨 Styles

- **triage:** Redesign sidebar with divided sections + cleaner chips ([03661ae](https://github.com/Ripwords/ReproJs/commit/03661ae))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.4.1

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.4.0...v0.4.1)

### 🚀 Enhancements

- **dashboard:** Render reporter description in overview tab ([4f621a3](https://github.com/Ripwords/ReproJs/commit/4f621a3))

### 🩹 Fixes

- **github:** Warn when GitHub silently drops assignees ([7c6f178](https://github.com/Ripwords/ReproJs/commit/7c6f178))
- **docker:** Bundle SDK iife in the published image ([cb9f80c](https://github.com/Ripwords/ReproJs/commit/cb9f80c))
- **api:** Cache-Control private, no-store on /api/** ([65d5309](https://github.com/Ripwords/ReproJs/commit/65d5309))
- **github:** Pre-flight check before assigning users to an issue ([c6393f7](https://github.com/Ripwords/ReproJs/commit/c6393f7))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.4.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.3.0...v0.4.0)

### 💅 Refactors

- **assignees:** Github-only, drop dashboard-user linking ([557d2d6](https://github.com/Ripwords/ReproJs/commit/557d2d6))

### 🤖 CI

- **docker:** Don't fail release on flaky GHA cache export ([76221d2](https://github.com/Ripwords/ReproJs/commit/76221d2))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.3.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- ✨  Add two way sync for github issue labels ([89d3d9e](https://github.com/Ripwords/ReproJs/commit/89d3d9e))
- **webhook:** Add size cap helper for github webhooks ([8886440](https://github.com/Ripwords/ReproJs/commit/8886440))
- **db:** Add github_webhook_deliveries table for replay protection ([f210471](https://github.com/Ripwords/ReproJs/commit/f210471))
- **webhook:** Add delivery dedupe for replay protection ([f91987b](https://github.com/Ripwords/ReproJs/commit/f91987b))
- **webhook:** Check installation id against known integrations ([f1ad47e](https://github.com/Ripwords/ReproJs/commit/f1ad47e))
- **webhook:** Enforce size cap, replay dedupe, installation allowlist ([3865559](https://github.com/Ripwords/ReproJs/commit/3865559))
- **db:** Add user_identities table (github provider) ([63cd11d](https://github.com/Ripwords/ReproJs/commit/63cd11d))
- **db:** Add github_write_locks table for loop avoidance ([e16f5c5](https://github.com/Ripwords/ReproJs/commit/e16f5c5))
- **db:** Add report_comments table (not yet wired) ([80cb4d4](https://github.com/Ripwords/ReproJs/commit/80cb4d4))
- **db:** Add milestone, sync timestamps, and toggle columns ([964601e](https://github.com/Ripwords/ReproJs/commit/964601e))
- **db:** Extend report_event_kind enum for assignees/comments/milestone ([fcc4a8b](https://github.com/Ripwords/ReproJs/commit/fcc4a8b))
- **identities:** Signed oauth state helper for link flow ([e416b4d](https://github.com/Ripwords/ReproJs/commit/e416b4d))
- **identities:** Resolver + upsert + unlink helpers ([c5796b2](https://github.com/Ripwords/ReproJs/commit/c5796b2))
- **identities:** GET /api/me/identities ([3d1211b](https://github.com/Ripwords/ReproJs/commit/3d1211b))
- **identities:** POST start endpoint generates signed oauth url ([dddb5f9](https://github.com/Ripwords/ReproJs/commit/dddb5f9))
- **identities:** Callback exchanges code and upserts identity ([2d1527e](https://github.com/Ripwords/ReproJs/commit/2d1527e))
- **identities:** DELETE endpoint unlinks the identity ([855bcc5](https://github.com/Ripwords/ReproJs/commit/855bcc5))
- **identities:** Backfill user_identities from better-auth account rows ([c511746](https://github.com/Ripwords/ReproJs/commit/c511746))
- **identities:** /settings/identities page with connect/disconnect ([c52520f](https://github.com/Ripwords/ReproJs/commit/c52520f))
- **db:** Report_assignees schema + backfill migration (unapplied) ([44299e0](https://github.com/Ripwords/ReproJs/commit/44299e0))
- **shared:** ReportSummaryDTO.assignees (array); TriagePatchInput.assigneeIds ([572ae66](https://github.com/Ripwords/ReproJs/commit/572ae66))
- **github-cache:** Generic per-repo cache with TTL + SWR + single-flight ([4ad1071](https://github.com/Ripwords/ReproJs/commit/4ad1071))
- **github-adapter:** List labels, assignees, milestones ([367f0aa](https://github.com/Ripwords/ReproJs/commit/367f0aa))
- **api:** GET repo labels for a project ([2e615b4](https://github.com/Ripwords/ReproJs/commit/2e615b4))
- **api:** GET assignable users with linkedUser resolution ([fb19d2c](https://github.com/Ripwords/ReproJs/commit/fb19d2c))
- **api:** GET repo milestones ([091d610](https://github.com/Ripwords/ReproJs/commit/091d610))
- **webhook:** Invalidate picker caches on label/milestone/member events ([69cfba2](https://github.com/Ripwords/ReproJs/commit/69cfba2))
- **ui:** Composable exposing github integration state per project ([fbc29c3](https://github.com/Ripwords/ReproJs/commit/fbc29c3))
- **shared:** Add milestone + githubAssigneeLogins to reports DTOs ([4c64078](https://github.com/Ripwords/ReproJs/commit/4c64078))
- **triage:** PATCH + read endpoints support milestone + github-only assignees ([a278a30](https://github.com/Ripwords/ReproJs/commit/a278a30))
- **ui:** Labels picker backed by repo label set ([9374bcc](https://github.com/Ripwords/ReproJs/commit/9374bcc))
- **ui:** Assignees picker — dashboard-linked and github-only in one list ([52269e7](https://github.com/Ripwords/ReproJs/commit/52269e7))
- **ui:** Milestone picker ([db4f968](https://github.com/Ripwords/ReproJs/commit/db4f968))
- **triage:** Wire live pickers into drawer for linked projects ([56848b0](https://github.com/Ripwords/ReproJs/commit/56848b0))
- **github-adapter:** Issue-write helpers (title, milestone, assignees, state) ([0e3f571](https://github.com/Ripwords/ReproJs/commit/0e3f571))
- **github-diff:** Signature + assignee-diff helpers for write-locks ([09da9bc](https://github.com/Ripwords/ReproJs/commit/09da9bc))
- **write-locks:** Record/consume/cleanup helpers ([c94dd5d](https://github.com/Ripwords/ReproJs/commit/c94dd5d))
- **tasks:** Daily cleanup of expired github_write_locks ([57190e1](https://github.com/Ripwords/ReproJs/commit/57190e1))
- **reconcile:** Diff + push title, labels, state, assignees, milestone with write-locks ([91e4768](https://github.com/Ripwords/ReproJs/commit/91e4768))
- **triage:** Enqueue github sync on qualifying PATCH when push_on_edit=true ([a673712](https://github.com/Ripwords/ReproJs/commit/a673712))
- **webhook:** Assigned/milestoned/edited branches + write-lock echo skip ([9cfddd6](https://github.com/Ripwords/ReproJs/commit/9cfddd6))
- **integrations:** PushOnEdit UI toggle for GitHub integration ([dfd32b2](https://github.com/Ripwords/ReproJs/commit/dfd32b2))
- **integration-api:** Expose autoCreateOnIntake toggle ([1574a7d](https://github.com/Ripwords/ReproJs/commit/1574a7d))
- **integration-ui:** AutoCreateOnIntake toggle ([51fc8b7](https://github.com/Ripwords/ReproJs/commit/51fc8b7))
- **intake:** Auto-create github issue on new report when toggle is on ([30b7674](https://github.com/Ripwords/ReproJs/commit/30b7674))
- **github-adapter:** Issue-comment wrappers (create/update/delete/list) ([f395f3d](https://github.com/Ripwords/ReproJs/commit/f395f3d))
- **comments:** Bot-footer serialize/strip/detect helpers ([9364473](https://github.com/Ripwords/ReproJs/commit/9364473))
- **github-diff:** SignCommentUpsert + signCommentDelete ([e664a1d](https://github.com/Ripwords/ReproJs/commit/e664a1d))
- **sync-jobs:** Carry comment-sync payloads ([021a0f7](https://github.com/Ripwords/ReproJs/commit/021a0f7))
- **api:** GET/POST/PATCH/DELETE report comment endpoints ([76e6fb1](https://github.com/Ripwords/ReproJs/commit/76e6fb1))
- **shared:** Comment DTOs ([2485a18](https://github.com/Ripwords/ReproJs/commit/2485a18))
- **reconcile:** Handle comment_upsert and comment_delete job kinds + backfill on first link ([7514d3c](https://github.com/Ripwords/ReproJs/commit/7514d3c))
- **webhook:** Issue_comment branches with write-lock echo skip ([2ce422e](https://github.com/Ripwords/ReproJs/commit/2ce422e))
- **dashboard:** Add marked dependency and use-markdown composable ([aa39cf9](https://github.com/Ripwords/ReproJs/commit/aa39cf9))
- **dashboard:** Add Comments tab to report detail page ([1b8a7a2](https://github.com/Ripwords/ReproJs/commit/1b8a7a2))
- **dashboard:** Live report stream via SSE with memory-safe lifecycle ([92e6a2f](https://github.com/Ripwords/ReproJs/commit/92e6a2f))
- **security:** XSS-safe markdown rendering with DOMPurify ([d43df70](https://github.com/Ripwords/ReproJs/commit/d43df70))

### 🩹 Fixes

- **ci/expo:** Gate npm publish on tag push so workflow_dispatch is a clean smoke test ([8a02e4f](https://github.com/Ripwords/ReproJs/commit/8a02e4f))
- **expo:** Resolve @reprojs/* at build time so published package installs ([428a937](https://github.com/Ripwords/ReproJs/commit/428a937))
- Update paths for drizzle-kit commands in package.json ([893bfdf](https://github.com/Ripwords/ReproJs/commit/893bfdf))
- **reports:** Use drizzle exists/notExists for assignee filter subqueries ([00c9fb7](https://github.com/Ripwords/ReproJs/commit/00c9fb7))
- **dashboard:** Test suite fixes for Phase 3 comment sync ([f91f617](https://github.com/Ripwords/ReproJs/commit/f91f617))
- **github-app:** Drop in-process credentials cache for cross-process consistency ([9b77abf](https://github.com/Ripwords/ReproJs/commit/9b77abf))
- **github-app:** Mark webhook active in manifest when baseUrl is public ([5a159e0](https://github.com/Ripwords/ReproJs/commit/5a159e0))
- **github:** Subscribe to issue_comment/label/milestone/member events + activity feed tag rendering ([40e160c](https://github.com/Ripwords/ReproJs/commit/40e160c))
- **webhook+ui:** Label sync publishes SSE events + assignee avatars render ([a8f8672](https://github.com/Ripwords/ReproJs/commit/a8f8672))
- **csp:** Allow https: in img-src so github avatars render ([67f569a](https://github.com/Ripwords/ReproJs/commit/67f569a))
- **github:** HMAC-sign bot footer, consolidate cache, extract test shims ([854089e](https://github.com/Ripwords/ReproJs/commit/854089e))
- **api:** SSE cleanup-before-subscribe + defer post-commit side effects ([7c174fa](https://github.com/Ripwords/ReproJs/commit/7c174fa))
- **test:** Seed github_app row for cross-process webhook-signing tests ([0731805](https://github.com/Ripwords/ReproJs/commit/0731805))
- **github-app:** Require OAuth pair in envComplete + CI-safe state secret read ([4214368](https://github.com/Ripwords/ReproJs/commit/4214368))

### 💅 Refactors

- **reports:** List endpoint reads assignees from report_assignees ([f32fec0](https://github.com/Ripwords/ReproJs/commit/f32fec0))
- **reports:** Detail endpoint reads assignees from report_assignees ([81bb184](https://github.com/Ripwords/ReproJs/commit/81bb184))
- **triage:** Write assignees to report_assignees with diff + events ([dfa9ee3](https://github.com/Ripwords/ReproJs/commit/dfa9ee3))
- **bulk-update:** Write assignees via diff into report_assignees ([058a6c1](https://github.com/Ripwords/ReproJs/commit/058a6c1))
- **ui:** Bind assignee UI to assignees[0] (single-select preserved) ([4e4fa9b](https://github.com/Ripwords/ReproJs/commit/4e4fa9b))
- **dev:** Move hardcoded tunnel host + demo endpoint out of tracked files ([17ae31c](https://github.com/Ripwords/ReproJs/commit/17ae31c))
- **github:** Per-signature sync-job dedup with composite PK ([6eca61c](https://github.com/Ripwords/ReproJs/commit/6eca61c))

### 📖 Documentation

- Add Buy Me a Coffee link to README and docs site ([4b8bd1e](https://github.com/Ripwords/ReproJs/commit/4b8bd1e))
- **spec:** Deeper github integration design ([76b241a](https://github.com/Ripwords/ReproJs/commit/76b241a))
- **plan:** Deeper github integration — phase 0 (backbone) ([233a93f](https://github.com/Ripwords/ReproJs/commit/233a93f))
- Webhook rotation + reserved phase-N toggle columns ([e541088](https://github.com/Ripwords/ReproJs/commit/e541088))
- **plan:** Deeper github integration — phase 1 (live pickers) ([2322dba](https://github.com/Ripwords/ReproJs/commit/2322dba))
- **plan:** Deeper github integration — phase 2 (push-on-edit) ([8f88ec3](https://github.com/Ripwords/ReproJs/commit/8f88ec3))
- **plan:** Deeper github integration — phase 3 (comments two-way) ([2207954](https://github.com/Ripwords/ReproJs/commit/2207954))
- **env:** Document test-friendly GitHub App + rate-limiter env defaults ([b496fd4](https://github.com/Ripwords/ReproJs/commit/b496fd4))

### 🏡 Chore

- **expo:** Silence intentional no-await-in-loop in FIFO queue test ([b39575c](https://github.com/Ripwords/ReproJs/commit/b39575c))
- **expo:** Add changelogen config so release:expo tags as expo-v* ([a6dce39](https://github.com/Ripwords/ReproJs/commit/a6dce39))
- **release:** Expo-v0.1.1 ([14ea5dd](https://github.com/Ripwords/ReproJs/commit/14ea5dd))
- Fixups from phase-0 verification ([0dbf409](https://github.com/Ripwords/ReproJs/commit/0dbf409))
- **github-app:** Manifest default_events: add sub_issues, drop member ([7d9a90c](https://github.com/Ripwords/ReproJs/commit/7d9a90c))
- **github-app:** Default auto_create_on_intake to true for new installs ([a7fbab1](https://github.com/Ripwords/ReproJs/commit/a7fbab1))
- **sse:** Strip diagnostics + revert to useEventSource from vueuse ([5d78dbd](https://github.com/Ripwords/ReproJs/commit/5d78dbd))
- **repo:** Drop stray top-level server/ migration artifacts ([0fdd5a0](https://github.com/Ripwords/ReproJs/commit/0fdd5a0))
- **security:** Gate nuxt-security rate-limiter opt-out on non-production ([f91164e](https://github.com/Ripwords/ReproJs/commit/f91164e))

### ✅ Tests

- **webhook:** Integration tests for hardened auth stack ([688bb19](https://github.com/Ripwords/ReproJs/commit/688bb19))
- Rewrite assignee assertions for report_assignees shape ([0917b75](https://github.com/Ripwords/ReproJs/commit/0917b75))
- **assignees:** Multi-assignee persistence, clearing, role guard, cap ([ed2ed59](https://github.com/Ripwords/ReproJs/commit/ed2ed59))
- **webhook:** Raise timeout for oversized-body transfer ([b077006](https://github.com/Ripwords/ReproJs/commit/b077006))
- **api:** Github picker endpoints ([0e3ecf1](https://github.com/Ripwords/ReproJs/commit/0e3ecf1))
- **github:** End-to-end push-on-edit roundtrip integration test ([8fe5b60](https://github.com/Ripwords/ReproJs/commit/8fe5b60))
- **github:** Align webhook secret across tests with env config ([45eb032](https://github.com/Ripwords/ReproJs/commit/45eb032))
- **intake:** Auto-create on intake respects toggle ([049b233](https://github.com/Ripwords/ReproJs/commit/049b233))
- **comments:** API endpoint coverage ([8dc9ee8](https://github.com/Ripwords/ReproJs/commit/8dc9ee8))
- **dashboard:** Add comment roundtrip integration tests ([e837753](https://github.com/Ripwords/ReproJs/commit/e837753))
- **shared:** Align ReportSummaryDTO test with new assignees/milestone shape ([9dca620](https://github.com/Ripwords/ReproJs/commit/9dca620))
- **dashboard:** Route setup() through local no-op shim + env-agnostic safeHref ([216c5e6](https://github.com/Ripwords/ReproJs/commit/216c5e6))
- **extension:** Rename Playwright e2e spec to .e2e.ts so bun test skips it ([11149b5](https://github.com/Ripwords/ReproJs/commit/11149b5))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>
- Jer-tan ([@jer-tan](https://github.com/jer-tan))

## v0.2.0

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.1.18...v0.2.0)

### 🚀 Enhancements

- **shared:** Add source discriminator and mobile device fields to ReportContext/SystemInfo ([2f6effc](https://github.com/Ripwords/ReproJs/commit/2f6effc))
- **shared:** Add source and devicePlatform to ReportSummaryDTO ([95ed429](https://github.com/Ripwords/ReproJs/commit/95ed429))
- **dashboard:** Add source, device_platform, idempotency_key to reports ([d863a1a](https://github.com/Ripwords/ReproJs/commit/d863a1a))
- **dashboard:** Idempotency key + source/device persistence in intake ([f98d672](https://github.com/Ripwords/ReproJs/commit/f98d672))
- **dashboard:** Populate source and devicePlatform in report DTOs ([36c5774](https://github.com/Ripwords/ReproJs/commit/36c5774))
- **dashboard:** Source filter and facets on reports list ([50ac717](https://github.com/Ripwords/ReproJs/commit/50ac717))
- **dashboard:** Inbox query supports source facet ([fe4fde3](https://github.com/Ripwords/ReproJs/commit/fe4fde3))
- **dashboard:** Source facet in the inbox sidebar ([b0d6c55](https://github.com/Ripwords/ReproJs/commit/b0d6c55))
- **dashboard:** Platform pill in the inbox row ([8c9cf5f](https://github.com/Ripwords/ReproJs/commit/8c9cf5f))
- **dashboard:** Mobile-aware detail drawer (hide replay, show device card) ([119a8f8](https://github.com/Ripwords/ReproJs/commit/119a8f8))
- **expo:** Config normalizer and internal context shape ([50e2018](https://github.com/Ripwords/ReproJs/commit/50e2018))
- **expo:** Console collector with sentinel-guarded patching ([9da4569](https://github.com/Ripwords/ReproJs/commit/9da4569))
- **expo:** Fetch network collector with header redaction ([13b44f1](https://github.com/Ripwords/ReproJs/commit/13b44f1))
- **expo:** System info collector assembling mobile device context ([b139522](https://github.com/Ripwords/ReproJs/commit/b139522))
- **expo:** Persistent queue storage with size + count caps ([beb368a](https://github.com/Ripwords/ReproJs/commit/beb368a))
- **expo:** Intake client with idempotency-key header ([5f89742](https://github.com/Ripwords/ReproJs/commit/5f89742))
- **expo:** Queue flusher and netinfo connectivity listener ([921c4e3](https://github.com/Ripwords/ReproJs/commit/921c4e3))
- **expo:** View-shot capture and SVG-based annotation flatten ([46c1073](https://github.com/Ripwords/ReproJs/commit/46c1073))
- **expo:** Annotation store and gesture-based canvas (pen tool v1) ([715e63f](https://github.com/Ripwords/ReproJs/commit/715e63f))
- **expo:** Wizard sheet with form, annotate, and submit steps ([a8c898c](https://github.com/Ripwords/ReproJs/commit/a8c898c))
- **expo:** Provider, useRepro hook, launcher, and module singleton ([2c84d23](https://github.com/Ripwords/ReproJs/commit/2c84d23))
- **expo:** Mobile-polished annotation UX — icons, color+stroke pickers, live previews, text input ([6551cc2](https://github.com/Ripwords/ReproJs/commit/6551cc2))
- **expo:** Attach logs (console + network + breadcrumbs) to intake ([2a89ada](https://github.com/Ripwords/ReproJs/commit/2a89ada))
- **expo:** Redesign wizard UI + match dashboard flame palette + fix annotation submission ([9688803](https://github.com/Ripwords/ReproJs/commit/9688803))
- **expo:** Draggable launcher snaps to nearest of 4 corners with persisted choice ([674c638](https://github.com/Ripwords/ReproJs/commit/674c638))
- **expo:** Silent-disable when projectKey or intakeUrl is empty ([1ae196a](https://github.com/Ripwords/ReproJs/commit/1ae196a))

### 🩹 Fixes

- **dashboard:** Remove non-null assertion in source filter clause ([90a31b6](https://github.com/Ripwords/ReproJs/commit/90a31b6))
- **expo:** Typecheck cleanup across network, intake, flush tests ([97a0ae9](https://github.com/Ripwords/ReproJs/commit/97a0ae9))
- **expo:** Align build output extensions with package.json and plugin shim ([50db4a0](https://github.com/Ripwords/ReproJs/commit/50db4a0))
- **expo:** Export "./app.plugin.js" with extension so Expo plugin resolver works ([ab2df64](https://github.com/Ripwords/ReproJs/commit/ab2df64))
- **expo:** KeyboardAvoidingView uses "height" on Android so modal stays above keyboard ([aaf83b5](https://github.com/Ripwords/ReproJs/commit/aaf83b5))
- **expo:** Render screenshot in annotate step + fall back when capture fails ([80efaae](https://github.com/Ripwords/ReproJs/commit/80efaae))
- **expo:** RunOnJS gesture callbacks + compact toolbar row 2 ([20143b2](https://github.com/Ripwords/ReproJs/commit/20143b2))
- **sdk-utils:** Hermes-safe newShapeId — fall back when crypto.randomUUID missing ([a3c218b](https://github.com/Ripwords/ReproJs/commit/a3c218b))
- **expo:** Annotate step fills available space + flatten uses measured canvas size ([84b3e59](https://github.com/Ripwords/ReproJs/commit/84b3e59))
- **expo:** Send report as string multipart part — RN FormData drops Blob bodies ([f18a7a6](https://github.com/Ripwords/ReproJs/commit/f18a7a6))
- **expo:** Drop expo-file-system getInfoAsync call — threw on SDK 54 legacy deprecation ([04d2db5](https://github.com/Ripwords/ReproJs/commit/04d2db5))
- **expo:** Send _dwellMs (wizard-open-to-submit) to satisfy intake anti-abuse gate ([243ffce](https://github.com/Ripwords/ReproJs/commit/243ffce))
- **expo:** Render arrow with actual arrowhead, not just a line ([9b1d986](https://github.com/Ripwords/ReproJs/commit/9b1d986))
- **dashboard:** Cap report screenshot at 60vh with letterbox so tall portrait screenshots don't dominate the page ([e26dbbc](https://github.com/Ripwords/ReproJs/commit/e26dbbc))
- **expo:** Flatten view uses resizeMode=contain to match preview aspect ([45d1e82](https://github.com/Ripwords/ReproJs/commit/45d1e82))
- **expo:** Flatten PNG uses transparent letterbox bars (alpha preserved) ([9174b49](https://github.com/Ripwords/ReproJs/commit/9174b49))
- **docs:** Taller phone frames (240x480) + unsquish review card labels ([14d06fb](https://github.com/Ripwords/ReproJs/commit/14d06fb))
- **dashboard:** Copy new workspace packages (sdk-utils, expo) in Dockerfile ([e4bf0b4](https://github.com/Ripwords/ReproJs/commit/e4bf0b4))
- **ci,docs:** Fix broken paths + bump SDK build heap to 6 GB ([a72fbc5](https://github.com/Ripwords/ReproJs/commit/a72fbc5))
- **sdk:build:** Bake in --max-old-space-size=6144 so local + CI both succeed ([795bbc1](https://github.com/Ripwords/ReproJs/commit/795bbc1))

### 💅 Refactors

- **sdk-utils:** Extract ring-buffer from @reprojs/ui ([998a4e1](https://github.com/Ripwords/ReproJs/commit/998a4e1))
- **sdk-utils:** Extract redact from @reprojs/ui ([0b1406b](https://github.com/Ripwords/ReproJs/commit/0b1406b))
- **sdk-utils:** Extract breadcrumbs from @reprojs/ui ([eceb072](https://github.com/Ripwords/ReproJs/commit/eceb072))
- **sdk-utils:** Extract annotation tool geometry from @reprojs/ui ([bac4449](https://github.com/Ripwords/ReproJs/commit/bac4449))

### 📖 Documentation

- Add Expo SDK design spec ([fdbef8c](https://github.com/Ripwords/ReproJs/commit/fdbef8c))
- Add Expo SDK implementation plan ([5ab2dc1](https://github.com/Ripwords/ReproJs/commit/5ab2dc1))
- @reprojs/expo release notes and repo docs ([75b9101](https://github.com/Ripwords/ReproJs/commit/75b9101))

### 🏡 Chore

- **sdk-utils:** Scaffold package ([abd9d08](https://github.com/Ripwords/ReproJs/commit/abd9d08))
- **expo:** Scaffold @reprojs/expo package ([6676e8a](https://github.com/Ripwords/ReproJs/commit/6676e8a))
- Root script to build @reprojs/expo ([f5c05b7](https://github.com/Ripwords/ReproJs/commit/f5c05b7))
- Sync bun.lock with expo workspace ([af81274](https://github.com/Ripwords/ReproJs/commit/af81274))
- Expo:pack script — bundle @reprojs/expo for local install ([a4aeb15](https://github.com/Ripwords/ReproJs/commit/a4aeb15))
- **intake:** Log zod validation issues on 400 to aid SDK debugging ([7dbc389](https://github.com/Ripwords/ReproJs/commit/7dbc389))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## Unreleased

### Added
- `@reprojs/expo` — Expo SDK for Repro. Submit annotated screenshots, logs, and device context from Expo apps. No session replay in v1.
- `@reprojs/sdk-utils` — shared pure helpers (ring-buffer, redact, breadcrumbs, annotation geometry) between web and mobile SDKs.
- Dashboard: web vs Expo mobile reports are now distinguished with a platform pill, a Source filter in the inbox sidebar, and a mobile device card in the detail drawer.
- Intake contract: additive `ReportContext.source`, optional `SystemInfo.devicePlatform` / `appVersion` / `appBuild` / `deviceModel` / `osVersion`. `Idempotency-Key` header enables mobile offline-queue retries.

## v0.1.18

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.1.17...v0.1.18)

### 🚀 Enhancements

- **shared:** Add AdminOverviewDTO for admin overview dashboard ([f76efdb](https://github.com/Ripwords/ReproJs/commit/f76efdb))
- **api:** GET /api/admin/overview aggregates across all projects ([b17e400](https://github.com/Ripwords/ReproJs/commit/b17e400))
- **ui:** /admin overview page with tiles, activity, per-project list ([8719c9b](https://github.com/Ripwords/ReproJs/commit/8719c9b))
- **ui:** Add Overview to admin sidebar section ([5603c5c](https://github.com/Ripwords/ReproJs/commit/5603c5c))
- **shared:** Add 'manager' to ProjectRole enum ([2996a41](https://github.com/Ripwords/ReproJs/commit/2996a41))
- **perms:** Slot manager between viewer and developer in rank ([c355fdf](https://github.com/Ripwords/ReproJs/commit/c355fdf))
- **api:** Lower triage-endpoint minimum from developer to manager ([bc76e5e](https://github.com/Ripwords/ReproJs/commit/bc76e5e))
- **ui:** Surface manager role in members page and invite default ([4bd7dc1](https://github.com/Ripwords/ReproJs/commit/4bd7dc1))

### 💅 Refactors

- **api:** Drop role-specific wording from triage-guard comments ([b83a359](https://github.com/Ripwords/ReproJs/commit/b83a359))
- **manager:** Widen stale role casts + cover github-sync/unlink ([1768002](https://github.com/Ripwords/ReproJs/commit/1768002))

### 📖 Documentation

- Add manager to CLAUDE.md project-roles list ([2da9a21](https://github.com/Ripwords/ReproJs/commit/2da9a21))

### ✅ Tests

- **api:** Failing tests for GET /api/admin/overview ([5a18a17](https://github.com/Ripwords/ReproJs/commit/5a18a17))
- **api:** Manager role permission boundary coverage ([1b27ac2](https://github.com/Ripwords/ReproJs/commit/1b27ac2))
- **api:** Defense-in-depth beforeAll in viewer regression describe ([508043e](https://github.com/Ripwords/ReproJs/commit/508043e))
- **api:** Seed reports via db.insert instead of intake ([d967f9d](https://github.com/Ripwords/ReproJs/commit/d967f9d))
- **ci:** Relax rate limits in test env to unblock full-suite runs ([31f2812](https://github.com/Ripwords/ReproJs/commit/31f2812))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.17

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.1.16...v0.1.17)

### 🩹 Fixes

- **dashboard:** Stop auto-promoting invited members to admin on first sign-in ([28d3e71](https://github.com/Ripwords/ReproJs/commit/28d3e71))
- **dashboard:** Stop domain-allowlist tightening from deleting existing users ([60a7199](https://github.com/Ripwords/ReproJs/commit/60a7199))
- **dashboard:** Lowercase email in admin invite endpoint ([60c8550](https://github.com/Ripwords/ReproJs/commit/60c8550))
- **dashboard:** Fail-closed when app_settings row is missing ([d9b952c](https://github.com/Ripwords/ReproJs/commit/d9b952c))

### ✅ Tests

- **dashboard:** Verify /magic-link/verify rate limit (token-probe defense) ([e029ae0](https://github.com/Ripwords/ReproJs/commit/e029ae0))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.16

[compare changes](https://github.com/Ripwords/ReproJs/compare/v0.1.15...v0.1.16)

### 🩹 Fixes

- **docs:** Update URLs after repo rename to ReproJs ([ee6ff03](https://github.com/Ripwords/ReproJs/commit/ee6ff03))
- **dashboard:** Signup gate deletes existing users on sign-in ([6ae40df](https://github.com/Ripwords/ReproJs/commit/6ae40df))

### 📖 Documentation

- **spec:** Admin overview + manager role design ([32f8851](https://github.com/Ripwords/ReproJs/commit/32f8851))
- **plans:** Manager role + admin overview implementation plans ([656f630](https://github.com/Ripwords/ReproJs/commit/656f630))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.15

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.14...v0.1.15)

### 🚀 Enhancements

- **dashboard:** Replay fullscreen toggle + hide ineffective controls ([fa95c16](https://github.com/Ripwords/reprojs/commit/fa95c16))

### 🩹 Fixes

- **core:** Prevent screenshot hang and broken-image glyphs ([0f9f684](https://github.com/Ripwords/reprojs/commit/0f9f684))
- **recorder:** Align event pipeline with rrweb-player expectations ([b51ae61](https://github.com/Ripwords/reprojs/commit/b51ae61))
- **extension:** Re-inject SDK on page refresh ([b5f9db4](https://github.com/Ripwords/reprojs/commit/b5f9db4))

### 📖 Documentation

- Surface tester Chrome extension in overview docs ([f73840a](https://github.com/Ripwords/reprojs/commit/f73840a))

### 🏡 Chore

- Ignore zip artifacts ([5b3900a](https://github.com/Ripwords/reprojs/commit/5b3900a))
- **ci:** Scannable release titles per track on GitHub Releases ([6d15fa1](https://github.com/Ripwords/reprojs/commit/6d15fa1))
- **release:** Sdk-v0.3.0 ([0a88ed6](https://github.com/Ripwords/reprojs/commit/0a88ed6))
- **release:** Extension changelog config + fix SDK repo casing ([34aa3bc](https://github.com/Ripwords/reprojs/commit/34aa3bc))
- **release:** Extension-v0.1.1 ([36b1ee3](https://github.com/Ripwords/reprojs/commit/36b1ee3))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.14

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.13...v0.1.14)

### 🚀 Enhancements

- **dashboard:** Pending-invitations page + fix stale list after accept ([b7ffeac](https://github.com/Ripwords/reprojs/commit/b7ffeac))

### 🩹 Fixes

- **dashboard:** Invitations page 500s on SSR due to cookie forwarding ([3bd3c66](https://github.com/Ripwords/reprojs/commit/3bd3c66))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.13

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.12...v0.1.13)

### 🚀 Enhancements

- **extension:** Pre-fill Add form with active tab's origin ([ef78c25](https://github.com/Ripwords/reprojs/commit/ef78c25))

### 🩹 Fixes

- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))

### 📖 Documentation

- Add tester Chrome extension guide ([e8d3c58](https://github.com/Ripwords/reprojs/commit/e8d3c58))

### 🏡 Chore

- **ci:** Exempt CHANGELOG files from oxfmt ([0b7dae0](https://github.com/Ripwords/reprojs/commit/0b7dae0))

### 🤖 CI

- **docker:** Create GitHub Release as part of publish workflow ([2514731](https://github.com/Ripwords/reprojs/commit/2514731))

#### ⚠️ Breaking Changes

- **security:** ⚠️  Close H1/H2/M2/M3/M4 from pre-publish audit ([1f7b72a](https://github.com/Ripwords/reprojs/commit/1f7b72a))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.12

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.11...v0.1.12)

### 🩹 Fixes

- **extension:** ⚠️ Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️ Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))
- **dashboard:** Copy apps/extension/package.json in Docker build ([88b29f5](https://github.com/Ripwords/reprojs/commit/88b29f5))

### 🏡 Chore

- **ci:** Smoke-build dashboard image + gate release scripts on CI ([85fb50c](https://github.com/Ripwords/reprojs/commit/85fb50c))

#### ⚠️ Breaking Changes

- **extension:** ⚠️ Harden SW proxy (security review F1/F3/F6/F7) ([1bded3e](https://github.com/Ripwords/reprojs/commit/1bded3e))
- **dashboard:** ⚠️ Pin Docker base image to bun 1.3 ([eec6980](https://github.com/Ripwords/reprojs/commit/eec6980))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.11

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.10...v0.1.11)

### 🚀 Enhancements

- **extension:** Scaffold apps/extension MV3 + crxjs skeleton ([62a36a5](https://github.com/Ripwords/reprojs/commit/62a36a5))
- **extension:** Add chrome.storage.local config wrapper ([9a03d07](https://github.com/Ripwords/reprojs/commit/9a03d07))
- **extension:** Add origin matching utility ([b9fd648](https://github.com/Ripwords/reprojs/commit/b9fd648))
- **extension:** Add chrome.permissions helpers ([e1b166e](https://github.com/Ripwords/reprojs/commit/e1b166e))
- **extension:** Add SDK sync script ([1d940b8](https://github.com/Ripwords/reprojs/commit/1d940b8))
- **extension:** Inject SDK via chrome.scripting on tab load ([5384731](https://github.com/Ripwords/reprojs/commit/5384731))
- **extension:** Popup shell + config list component ([1720e78](https://github.com/Ripwords/reprojs/commit/1720e78))
- **extension:** Add-config form with permission request ([282f7ce](https://github.com/Ripwords/reprojs/commit/282f7ce))
- **ci:** Add chrome web store publishing workflow ([030669b](https://github.com/Ripwords/reprojs/commit/030669b))
- **extension:** Sync icons from dashboard SVG at build time ([613f82b](https://github.com/Ripwords/reprojs/commit/613f82b))
- **extension:** Proxy SDK fetch through the service worker ([ff40433](https://github.com/Ripwords/reprojs/commit/ff40433))
- **extension:** Redesign popup/options + fix first-add race ([318666d](https://github.com/Ripwords/reprojs/commit/318666d))
- **extension:** Remember last intake endpoint in Add form ([e9f7b91](https://github.com/Ripwords/reprojs/commit/e9f7b91))

### 🩹 Fixes

- **github:** Drop env-source guard from disconnect endpoint ([7e3e04c](https://github.com/Ripwords/reprojs/commit/7e3e04c))
- **extension:** Tsconfig types reference "bun" not "bun-types" ([682a979](https://github.com/Ripwords/reprojs/commit/682a979))
- **extension:** Guard against double SDK injection ([6de3900](https://github.com/Ripwords/reprojs/commit/6de3900))
- **extension:** Close the double-inject race properly ([f077804](https://github.com/Ripwords/reprojs/commit/f077804))
- **core:** Remove DOM fallback from screenshot auto mode ([a4ec71b](https://github.com/Ripwords/reprojs/commit/a4ec71b))
- **ui:** Cancelling the capture prompt closes the reporter ([3f3a7b7](https://github.com/Ripwords/reprojs/commit/3f3a7b7))
- **extension:** Harden bootRepro + add proxy diagnostics ([81367ac](https://github.com/Ripwords/reprojs/commit/81367ac))
- **intake:** Accept X-Repro-Origin from extension SW proxy ([84a683d](https://github.com/Ripwords/reprojs/commit/84a683d))

### 📖 Documentation

- Add tester chrome extension design spec ([8ec9f10](https://github.com/Ripwords/reprojs/commit/8ec9f10))
- Add tester chrome extension implementation plan ([0af8870](https://github.com/Ripwords/reprojs/commit/0af8870))
- **plan:** Use dedicated e2e manifest for playwright injection test ([12c3181](https://github.com/Ripwords/reprojs/commit/12c3181))
- Note apps/extension in repo layout ([72f3d13](https://github.com/Ripwords/reprojs/commit/72f3d13))
- Add privacy policy page ([8af07a9](https://github.com/Ripwords/reprojs/commit/8af07a9))

### 🏡 Chore

- **extension:** Add ext:\* scripts to root ([7aba1b9](https://github.com/Ripwords/reprojs/commit/7aba1b9))

### ✅ Tests

- **extension:** Playwright MV3 injection coverage ([2b3cbfd](https://github.com/Ripwords/reprojs/commit/2b3cbfd))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.10

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.9...v0.1.10)

### 🚀 Enhancements

- **dashboard:** Disconnect GitHub App from settings ([63b1b98](https://github.com/Ripwords/reprojs/commit/63b1b98))

### 🩹 Fixes

- **ci:** Provide ENCRYPTION_KEY to dashboard test job ([43e240d](https://github.com/Ripwords/reprojs/commit/43e240d))
- **github:** Manifest sets public:true + emails:read for sign-in ([380c62b](https://github.com/Ripwords/reprojs/commit/380c62b))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.9

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.8...v0.1.9)

### 🩹 Fixes

- **dashboard:** Auto-redirect to sign-in after sign-out ([f946968](https://github.com/Ripwords/reprojs/commit/f946968))
- **github:** Manifest OAuth callback points at better-auth social route ([d38ad91](https://github.com/Ripwords/reprojs/commit/d38ad91))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.8

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.7...v0.1.8)

### 🚀 Enhancements

- **dashboard:** Paginate + cache GitHub installation repos endpoint ([074d199](https://github.com/Ripwords/reprojs/commit/074d199))
- **dashboard:** Infinite-scroll GitHub repo picker with server search ([1243947](https://github.com/Ripwords/reprojs/commit/1243947))
- **shared:** Project invitation DTOs and inputs ([f7f38e3](https://github.com/Ripwords/reprojs/commit/f7f38e3))
- **dashboard:** Project_invitations table and migration ([c4c84a8](https://github.com/Ripwords/reprojs/commit/c4c84a8))
- **dashboard:** Project invite email template ([2acf89b](https://github.com/Ripwords/reprojs/commit/2acf89b))
- **dashboard:** POST /api/projects/:id/invitations ([0225c8f](https://github.com/Ripwords/reprojs/commit/0225c8f))
- **dashboard:** GET /api/projects/:id/invitations ([42f0899](https://github.com/Ripwords/reprojs/commit/42f0899))
- **dashboard:** Revoke pending project invitation ([3de73f7](https://github.com/Ripwords/reprojs/commit/3de73f7))
- **dashboard:** Resend project invitation ([a6d2677](https://github.com/Ripwords/reprojs/commit/a6d2677))
- **dashboard:** GET /api/invitations/:token ([f570397](https://github.com/Ripwords/reprojs/commit/f570397))
- **dashboard:** Accept project invitation ([6016ebd](https://github.com/Ripwords/reprojs/commit/6016ebd))
- **dashboard:** Decline project invitation ([375e659](https://github.com/Ripwords/reprojs/commit/375e659))
- **dashboard:** Invitation accept page ([5b7ddd2](https://github.com/Ripwords/reprojs/commit/5b7ddd2))
- **dashboard:** Pending invites on project members page ([8e641af](https://github.com/Ripwords/reprojs/commit/8e641af))
- **dashboard:** GET /api/invitations/:token returns 409 for non-pending states ([cf254da](https://github.com/Ripwords/reprojs/commit/cf254da))
- **dashboard:** Admin endpoint to reveal GitHub OAuth client_id/secret ([250712e](https://github.com/Ripwords/reprojs/commit/250712e))
- **dashboard:** Include clientId in github app-status response ([e12ee33](https://github.com/Ripwords/reprojs/commit/e12ee33))
- **dashboard:** Reveal GitHub OAuth credentials on settings page ([ce07893](https://github.com/Ripwords/reprojs/commit/ce07893))

### 🩹 Fixes

- **release:** Bypass changelogen's 0.x bump downgrade in dashboard release ([bdb37e7](https://github.com/Ripwords/reprojs/commit/bdb37e7))
- **shared:** Allow null inviterEmail in InvitationDetailDTO ([9e672e2](https://github.com/Ripwords/reprojs/commit/9e672e2))
- **dashboard:** Enforce email match on GET /api/invitations/:token ([053bc4b](https://github.com/Ripwords/reprojs/commit/053bc4b))
- **dashboard:** Add aria-labels to credentials-panel action buttons ([8ec43a1](https://github.com/Ripwords/reprojs/commit/8ec43a1))
- **dashboard:** Use inviter display name in invite email ([93f6f65](https://github.com/Ripwords/reprojs/commit/93f6f65))

### 📖 Documentation

- Add GitHub OAuth credential reveal design ([1e11c92](https://github.com/Ripwords/reprojs/commit/1e11c92))
- Add project member auto-invite design ([3fae443](https://github.com/Ripwords/reprojs/commit/3fae443))
- Add implementation plan for GitHub OAuth credential reveal ([e4ca7ee](https://github.com/Ripwords/reprojs/commit/e4ca7ee))
- Add project member auto-invite implementation plan ([8408ec2](https://github.com/Ripwords/reprojs/commit/8408ec2))
- Clarify audit semantics — clientId via app-status, secret via reveal ([261df44](https://github.com/Ripwords/reprojs/commit/261df44))
- Clarify audit semantics — clientId via app-status, secret via reveal ([2d0a6df](https://github.com/Ripwords/reprojs/commit/2d0a6df))
- Add GitHub OAuth credential reveal design ([cbfd149](https://github.com/Ripwords/reprojs/commit/cbfd149))
- Add implementation plan for GitHub OAuth credential reveal ([31b4003](https://github.com/Ripwords/reprojs/commit/31b4003))
- Clarify audit semantics — clientId via app-status, secret via reveal ([fb54340](https://github.com/Ripwords/reprojs/commit/fb54340))
- **dashboard:** Clarify clientId is plaintext; note apiFetch deviation ([e06b6b1](https://github.com/Ripwords/reprojs/commit/e06b6b1))
- **self-hosting:** Note GitHub App credentials can power sign-in ([49bb0e2](https://github.com/Ripwords/reprojs/commit/49bb0e2))

### 🏡 Chore

- Update docs link ([a58e278](https://github.com/Ripwords/reprojs/commit/a58e278))
- Ignore .worktrees/ directory ([f27282c](https://github.com/Ripwords/reprojs/commit/f27282c))

### ✅ Tests

- Add truncateGithubApp helper for manifest-install tests ([f51dbf6](https://github.com/Ripwords/reprojs/commit/f51dbf6))
- Add failing tests for GitHub OAuth credential reveal endpoint ([a0eefbd](https://github.com/Ripwords/reprojs/commit/a0eefbd))
- Drop cross-process spy assertion on audit log ([4a44809](https://github.com/Ripwords/reprojs/commit/4a44809))
- **dashboard:** Decline rejects mismatched session email ([feb597d](https://github.com/Ripwords/reprojs/commit/feb597d))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.7

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.6...v0.1.7)

### 🚀 Enhancements

- **sdk-core:** Pixel-perfect screen-capture path via getDisplayMedia ([a93a239](https://github.com/Ripwords/reprojs/commit/a93a239))
- **sdk:** Pause replay buffer while the report wizard is open ([bd64ef3](https://github.com/Ripwords/reprojs/commit/bd64ef3))
- **dashboard:** Collapsible triage panel + per-section toggles ([6cd9abb](https://github.com/Ripwords/reprojs/commit/6cd9abb))
- **dashboard:** Page titles via useHead + global titleTemplate ([93b1027](https://github.com/Ripwords/reprojs/commit/93b1027))

### 🩹 Fixes

- **recorder:** Extract CSSOM rules and absolutize URLs in full snapshot ([ad8e527](https://github.com/Ripwords/reprojs/commit/ad8e527))
- **release:** Pin changelogen --from to prefix-matched tag ([0c68bcd](https://github.com/Ripwords/reprojs/commit/0c68bcd))
- **sdk:** Close lifecycle gaps in pause/resume, capture, and reporter ([dce4455](https://github.com/Ripwords/reprojs/commit/dce4455))
- **dashboard:** Static-import rrweb-player CSS + theme controller to dashboard ([a70598d](https://github.com/Ripwords/reprojs/commit/a70598d))
- **docs:** Drop /reprojs prefix from favicon path ([eb45504](https://github.com/Ripwords/reprojs/commit/eb45504))

### 💅 Refactors

- **recorder:** Drop unjustified \`as unknown as\` on stylesheet read ([4889dcd](https://github.com/Ripwords/reprojs/commit/4889dcd))

### 🏡 Chore

- **release:** Sdk-v0.2.0 ([320cfad](https://github.com/Ripwords/reprojs/commit/320cfad))
- **release:** Sdk-v0.2.1 ([73414c3](https://github.com/Ripwords/reprojs/commit/73414c3))

### 🤖 CI

- **sdk-release:** Generate CHANGELOG and GitHub Release for @reprojs/core ([5603973](https://github.com/Ripwords/reprojs/commit/5603973))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.6

[compare changes](https://github.com/Ripwords/reprojs/compare/sdk-v0.1.6...v0.1.6)

### 🩹 Fixes

- **dashboard:** Pre-create /data/attachments owned by non-root user ([379cd13](https://github.com/Ripwords/reprojs/commit/379cd13))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.5

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.4...v0.1.5)

### 🩹 Fixes

- **dashboard:** Resolve runtime env at request time, not build time ([b02c894](https://github.com/Ripwords/reprojs/commit/b02c894))

### 🤖 CI

- **publish-docker:** Gate image build on a verify job ([32a9b00](https://github.com/Ripwords/reprojs/commit/32a9b00))
- **publish-npm:** Add npm publish workflow with provenance + release:sdk helper ([5104bf4](https://github.com/Ripwords/reprojs/commit/5104bf4))
- **publish-npm:** Switch to npm trusted publishing (OIDC) — drop NPM_TOKEN ([1c26993](https://github.com/Ripwords/reprojs/commit/1c26993))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.4

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.3...v0.1.4)

### 🚀 Enhancements

- **dashboard:** Encryption foundation — AES-256-GCM helper + encryptedText column ([8f9d128](https://github.com/Ripwords/reprojs/commit/8f9d128))
- **dashboard:** Github_app singleton table + credential resolver with env→db fallback ([82e6f0b](https://github.com/Ripwords/reprojs/commit/82e6f0b))
- **github-integration:** Shared buildGithubAppManifest ([f7dff95](https://github.com/Ripwords/reprojs/commit/f7dff95))
- **dashboard:** GitHub App manifest wizard — start/callback routes, status API, admin UI ([170a2d9](https://github.com/Ripwords/reprojs/commit/170a2d9))

### 💅 Refactors

- **dashboard:** Make github.ts helpers async via credential resolver ([1bc0789](https://github.com/Ripwords/reprojs/commit/1bc0789))

### 📖 Documentation

- **self-hosting:** Document in-app GitHub App manifest wizard ([8dfdfee](https://github.com/Ripwords/reprojs/commit/8dfdfee))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.3

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.2...v0.1.3)

### 🏡 Chore

- **brand:** Rename @reprokit → @reprojs across npm + Docker + GitHub ([cdd9dc7](https://github.com/Ripwords/reprojs/commit/cdd9dc7))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.2

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.1...v0.1.2)

### 🤖 CI

- **docker:** Migrate from GHCR to Docker Hub (ripwords/reprojs-dashboard) ([54ffb9c](https://github.com/Ripwords/reprojs/commit/54ffb9c))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.1

[compare changes](https://github.com/Ripwords/reprojs/compare/v0.1.0...v0.1.1)

### 🚀 Enhancements

- **dashboard:** Add session environment card to report overview ([83dc70d](https://github.com/Ripwords/reprojs/commit/83dc70d))
- **deploy:** One-file self-host via Docker + GHCR ([fa6adcb](https://github.com/Ripwords/reprojs/commit/fa6adcb))
- **docs:** Logo + flame/mist brand theming ([7253e6d](https://github.com/Ripwords/reprojs/commit/7253e6d))

### 🩹 Fixes

- **deploy:** Ship server/emails/ in the Docker image ([1611933](https://github.com/Ripwords/reprojs/commit/1611933))

### 📖 Documentation

- Update wiki + clone URLs to Ripwords/reprojs ([e9bffbb](https://github.com/Ripwords/reprojs/commit/e9bffbb))
- Update README ([904b78d](https://github.com/Ripwords/reprojs/commit/904b78d))
- VitePress site at ripwords.github.io/reprojs ([35a1eaa](https://github.com/Ripwords/reprojs/commit/35a1eaa))

### 📦 Build

- **sdk:** Make @reprojs/core a self-contained publishable package ([95d8992](https://github.com/Ripwords/reprojs/commit/95d8992))
- **deploy:** Healthcheck script in the image instead of inline shell ([a77a113](https://github.com/Ripwords/reprojs/commit/a77a113))

### 🤖 CI

- Wire dummy GitHub App env vars for webhook signature tests ([c2c5646](https://github.com/Ripwords/reprojs/commit/c2c5646))
- **docs:** Auto-enable Pages on first deploy ([24db132](https://github.com/Ripwords/reprojs/commit/24db132))

### ❤️ Contributors

- JJ <teohjjteoh@gmail.com>

## v0.1.0

Initial public release of Repro — the framework-agnostic embeddable feedback SDK plus self-hostable triage dashboard, published under the `@reprojs/*` npm scope.

### 🚀 Features

- **SDK** (`@reprojs/core`) — framework-agnostic init API, Shadow-DOM-isolated widget, keyboard shortcut, programmatic `open` / `close` / `identify` / `log`.
- **Screenshot capture + annotation canvas** — freehand pen, line, arrow, rectangle, text; undo / redo; flattened to PNG on submit.
- **30s rolling session replay** (`@reprojs/recorder`) — rrweb-compatible event stream, privacy masking (password fields, `data-repro-mask`).
- **Diagnostic context bundle** — console + network logs, cookies (denylisted), system info, custom breadcrumbs.
- **Dashboard** (`apps/dashboard`, Nuxt 4) — project management, ticket inbox with filters + facets, report triage drawer with replay player, assignee + priority + tags + status.
- **Intake API** — multipart upload, per-project origin allowlist, per-key + per-IP rate limits, honeypot + dwell-time anti-abuse, daily report cap.
- **Auth** — better-auth with magic-link + GitHub / Google OAuth; admin signup-gating.
- **GitHub Issues sync** (`@reprojs/integrations-github`) — GitHub App with one-click issue creation, two-way status sync via webhooks, background retry queue.
- **Blob storage** — pluggable adapter: local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage).
- **CI** — GitHub Actions gate: lint + format check, SDK tests, SDK IIFE build sanity check, dashboard integration tests against a real Postgres.

### 📦 Published packages

- `@reprojs/core` — SDK entry
- `@reprojs/ui` — widget UI (Preact + Shadow DOM)
- `@reprojs/recorder` — 30s rolling DOM replay buffer
- `@reprojs/shared` — contract types + Zod schemas
- `@reprojs/integrations-github` — GitHub Issues adapter

### 🔒 Security posture

- Origin allowlist enforced on every intake request; cross-origin scripts cannot read error bodies as an enumeration oracle for valid project keys.
- Session tokens validated server-side; auth endpoints rate-limited.
- HTTP response headers set via nuxt-security (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`).
- Sensitive-input masking on by default in the recorder.

### 🙏 Contributors

- JJ Teoh
