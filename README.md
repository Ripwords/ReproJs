<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/dashboard/public/icon-dark.svg">
    <img src="apps/dashboard/public/icon-light.svg" alt="Repro logo" width="128">
  </picture>

  <h1>Repro</h1>

  <p><strong>Framework-agnostic embeddable feedback SDK + self-hostable triage dashboard.</strong></p>

  <p>
    <a href="https://ripwords.github.io/ReproJs/"><strong>Docs</strong></a> ·
    <a href="https://ripwords.github.io/ReproJs/self-hosting/"><strong>Self-host</strong></a> ·
    <a href="https://ripwords.github.io/ReproJs/guide/sdk"><strong>SDK</strong></a> ·
    <a href="https://ripwords.github.io/ReproJs/guide/extension"><strong>Tester extension</strong></a>
  </p>

  <p>
    <a href="https://buymeacoffee.com/ripwords" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174"></a>
  </p>
</div>

---

Repro gives end users of any web app a one-click way to report bugs from the page — with an annotated screenshot, the last 30 seconds of session replay, and rich diagnostic context (console, network, cookies, system info) attached. Reports land in a self-hostable Nuxt dashboard where your team triages them, and optionally syncs them to GitHub Issues.

---

## Why Repro

- **Framework-agnostic SDK** — drop-in widget for vanilla JS, React, Vue, Svelte, Angular, Nuxt, Next.js. No peer-dependency on the host's framework.
- **Zero-config embed** — single `<script>` tag or `import { init } from "@reprojs/core"`. UI renders inside a Shadow DOM root so host styles can't leak in and vice-versa.
- **Rich context, collected automatically** — every report bundles an annotated screenshot, rrweb-style DOM replay of the last 30s, console + network logs, cookies, and system info.
- **Self-hostable end to end** — SDK, dashboard, and Postgres all run locally via Docker. Blob storage is a pluggable adapter (local disk by default; S3-compatible for AWS S3, R2, B2, Hetzner, MinIO, etc.).
- **GitHub-Issues sync** — one-click "create issue" on a report, with two-way status sync via GitHub App webhooks.

---

## Architecture

```
┌──────────────────────┐                 ┌────────────────────────────────┐
│   Host web app       │                 │   Repro Dashboard              │
│                      │   POST report   │   (Nuxt 4: Vue UI + Nitro API) │
│  ┌────────────────┐  │ ──────────────► │                                │
│  │ @reprojs/core  │  │    multipart    │  /api/intake/*   (SDK ingress) │
│  │   SDK widget   │  │                 │  /api/tickets/*  (triage)      │
│  └────────────────┘  │                 │  /api/auth/*     (better-auth) │
└──────────────────────┘                 │  /api/integrations/github/*    │
                                         │                                │
                                         │  Postgres 17 ── Drizzle ORM    │
                                         │  Blob storage (local / S3)     │
                                         └────────────────────────────────┘
                                                         │
                                                         ▼
                                              GitHub Issues (optional)
```

Three first-class deliverables in one repo:

| Component | What it is | Who uses it |
| --- | --- | --- |
| **SDK** (`packages/*`) | Embeddable widget + framework-agnostic SDK | End users of whatever web app embeds Repro |
| **Dashboard** (`apps/dashboard`) | Admin / triage UI + intake API | Your team |
| **Tester extension** (`apps/extension`) | Chrome MV3 extension that injects the SDK into any page, with an intake proxy that bypasses strict CSPs | Internal QA on sites you don't control |

---

## Quick start (SDK)

> **Note**: packages are not yet published to npm. The examples below reflect the intended v0.1.0 install path.

### `<script>` tag

```html
<script src="https://your-dashboard.example.com/sdk/repro.iife.js" async></script>
<script>
  Repro.init({
    projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
    endpoint: "https://your-dashboard.example.com",
  })
</script>
```

### ESM / bundler

```bash
npm install @reprojs/core
```

```ts
import { init } from "@reprojs/core"

init({
  projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
  endpoint: "https://your-dashboard.example.com",
})
```

### Optional: identify the reporter

```ts
import { identify } from "@reprojs/core"

identify({
  userId: "user_123",
  email: "alex@example.com",
  name: "Alex Example",
})
```

Project keys are issued from the dashboard's project settings page. Each project has an origin allowlist — requests from any other origin are rejected and no CORS oracle is leaked.

---

## Tester Chrome extension

**Repro Tester** is a Chrome MV3 extension for internal QA teams that need to file reports from sites they don't control (a staging build owned by another team, a vendor preview, etc.). It bundles the same `@reprojs/core` SDK, and its service worker proxies the intake POST so CSP-strict hosts don't block submission.

Install: grab `repro-tester-vX.Y.Z.zip` from the [releases page](https://github.com/Ripwords/ReproJs/releases), unzip somewhere stable, and load it via `chrome://extensions → Load unpacked`. Full guide: [Tester extension docs](https://ripwords.github.io/ReproJs/guide/extension).

The extension is **not** a replacement for the `<script>` embed — real users on customer sites always get the SDK via the embed. The extension is for internal testers only.

---

## Quick start (self-host)

Prerequisites: Bun, Docker.

```bash
git clone https://github.com/Ripwords/ReproJs.git
cd repro
bun install

# 1. Copy env template
cp .env.example .env
# Edit .env — at minimum set BETTER_AUTH_SECRET and ATTACHMENT_URL_SECRET
# (generate with `openssl rand -hex 32`)

# 2. Start Postgres
bun run dev:docker

# 3. Push the schema
bun run db:push

# 4. Start the dashboard
bun run dev
```

Dashboard is now at `http://localhost:3000`. Sign in with a magic link (prints to stdout when `MAIL_PROVIDER=console`), create a project, and you'll see a project key + embed snippets in **Project → Settings**.

For production deployment (Docker Compose with Caddy / Nginx reverse proxy, S3-compatible storage), see `docs/self-hosting/`.

---

## Monorepo layout

```
repro/
├── apps/
│   ├── dashboard/              # Nuxt 4 — admin UI + intake API
│   └── extension/              # @reprojs/extension — Chrome MV3 tester extension (Preact + Vite + CRXJS)
├── packages/
│   ├── core/                   # @reprojs/core — SDK entry (init / open / identify)
│   ├── ui/                     # @reprojs/ui — widget UI (Preact + Shadow DOM)
│   ├── recorder/               # @reprojs/recorder — 30s rolling DOM replay
│   ├── shared/                 # @reprojs/shared — contract types + Zod schemas
│   └── integrations/
│       └── github/             # @reprojs/integrations-github — GitHub App adapter
├── scripts/
├── docs/
└── .github/workflows/          # CI
```

---

## Tech stack

| Concern | Choice |
| --- | --- |
| SDK runtime | TypeScript + Preact (tiny, React-like DX) inside Shadow DOM |
| SDK bundler | [tsdown](https://tsdown.dev) (ESM + IIFE) |
| Session replay | Hand-written rrweb-compatible event subset; dashboard replays via `rrweb-player` |
| Dashboard | Nuxt 4 (Vue 3 + Nitro server) |
| Database | PostgreSQL 17 + [Drizzle ORM](https://orm.drizzle.team) |
| Auth | [better-auth](https://better-auth.com) with magic-link + GitHub / Google OAuth |
| Blob storage | Pluggable — local disk (default) or any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage) |
| Runtime / package manager | [Bun](https://bun.sh) |
| Lint + format | [oxlint](https://oxc.rs) + [oxfmt](https://oxc.rs) |

---

## Development

```bash
bun install               # install workspace
bun run dev:docker        # start Postgres
bun run db:push           # create schema
bun run dev               # start dashboard on :3000
bun run sdk:build         # build @reprojs/core IIFE + ESM bundles
bun run demo              # run the SDK demo playground on :4000
bun run ext:dev           # run the tester extension in Vite dev mode
bun run ext:build         # build the extension (syncs the SDK + icons first)
bun run ext:test          # run the extension unit tests
bun run check             # oxfmt --check + oxlint
bun run test              # run all tests (SDK + dashboard)
bun run test:sdk          # SDK tests only (no Postgres required)
```

### Releasing

Releases are driven by [changelogen](https://github.com/unjs/changelogen) from Conventional Commits.

One command releases everything affected by what's on `main`:

```bash
bun run release             # patch every affected artifact
bun run release --minor     # level applies to all affected
bun run release --dry-run   # print the plan, change nothing
bun run release --only sdk  # restrict (comma-separated); --skip is the inverse
```

It works out which artifacts are affected by asking what each one is *built from* — including the SDK bundle that the dashboard bakes into its image and the extension syncs at build time. So a `packages/ui` fix releases the SDK, dashboard **and** extension together, while a dashboard-only change releases just the dashboard. It shows the plan, asks once, then makes a single commit, tags each artifact, and pushes.

Version lines stay independent (`sdk-v0.4.2` / `v0.6.5` / `extension-v0.1.4`), so a dashboard change never forces a churn republish of `@reprojs/core`.

Mixed bump levels compose with `--only`:

```bash
bun run release --minor --only sdk
bun run release --only dashboard,extension
```

The command runs lint, format:check, SDK build and SDK tests itself, and refuses to tag unless CI is already green on `main`. CI runs the full gate (including the dashboard integration tests against a real Postgres) on every PR and push to `main`.

---

## Status

Repro is pre-1.0 and under active development. v0.1.0 marks the initial cut of the rebranded monorepo with a working end-to-end flow: SDK → intake API → dashboard triage → (optional) GitHub Issues sync.

No deployed production instance yet; the packages are not yet published on npm.

---

## License

MIT — see [LICENSE](./LICENSE).
