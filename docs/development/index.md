# Development

Contributor guide for working in the `reprojs` monorepo.

## Prereqs

- [Bun](https://bun.sh) 1.3+
- Docker + Docker Compose (for dev Postgres)
- Node is not required — bun is the runtime.

## First-time setup

```bash
git clone https://github.com/Ripwords/ReproJs.git
cd reprojs
bun install
cp .env.example .env
# Uncomment the LOCAL DEVELOPMENT line and point DATABASE_URL at the dev Postgres:
# DATABASE_URL=postgres://postgres:postgres@localhost:5436/repro
```

Fill in the four required secrets in `.env` (see [Configuration](/self-hosting/configuration#required)). For local dev, `BETTER_AUTH_URL=http://localhost:3000` and `MAIL_PROVIDER=console` are fine.

## Starting the dev loop

```bash
bun run dev:docker   # starts the dev Postgres on :5436
bun run db:push      # syncs the schema from TS (dev uses push, not migrate)
bun run dev          # starts the dashboard on :3000 with HMR
```

The dashboard runs on `localhost:3000` with hot module reload. Magic-link URLs print to the terminal when `MAIL_PROVIDER=console`.

To stop Postgres without dropping data: `bun run dev:stop`. To reset the DB: `docker compose -f apps/dashboard/docker/docker-compose.dev.yml down -v` then `bun run db:push`.

## SDK development

```bash
bun run sdk:build    # builds packages/core — ESM + IIFE + .d.ts
bun run sdk:watch    # watches for SDK source changes
bun run demo         # runs the demo playground on :4000
```

The demo loads the freshly-built IIFE so you can exercise the widget against a real dashboard. Point it at your dev instance by editing `packages/ui/demo/index.html`'s `Repro.init({...})` call.

## Tester extension development

```bash
bun run ext:dev      # Vite dev mode — HMR for popup/options, rebuilds MV3 bundles on save
bun run ext:build    # one-off production build → apps/extension/dist/
bun run ext:test     # unit tests (bun test, src/)
```

`ext:build` calls `scripts/sync-sdk.ts` first, which copies the freshly-built `@reprojs/core` IIFE into the extension's `public/` directory so the service worker ships the same SDK the embed uses. Run `bun run sdk:build` first (or `bun run ext:build` which chains it).

To load the extension locally: open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and point it at `apps/extension/dist/`. For `ext:dev`'s HMR bundle use `apps/extension/dist/` the same way — CRXJS writes there continuously.

End-to-end tests run against a built extension via Playwright:

```bash
bun run --filter @reprojs/extension test:e2e
```

That builds with `vite.config.e2e.ts` (extra test hooks) then runs the Playwright suite in `apps/extension/tests/`.

## Useful scripts

| Script              | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `bun run dev`       | Dev server (Nuxt + HMR) on `:3000`                               |
| `bun run build`     | Production Nuxt build → `apps/dashboard/.output/`                |
| `bun run sdk:build` | Build the SDK bundles (ESM + IIFE + `.d.ts`)                     |
| `bun run demo`      | SDK demo playground on `:4000`                                   |
| `bun run ext:dev`   | Vite dev mode for the tester Chrome extension                    |
| `bun run ext:build` | Production build for the tester extension → `apps/extension/dist/`|
| `bun run ext:test`  | Extension unit tests                                             |
| `bun run check`     | `oxfmt --check` + `oxlint` — runs in CI                          |
| `bun run lint`      | oxlint only                                                      |
| `bun run fmt`       | oxfmt write                                                      |
| `bun run fix`       | `oxfmt --write` + `oxlint --fix`                                 |
| `bun run test`      | Full test suite (SDK + dashboard — needs dev server up)          |
| `bun run test:sdk`  | SDK tests only — no Postgres / dev server required               |
| `bun run db:gen`    | Regenerate Drizzle migrations from schema changes                |
| `bun run db:push`   | Sync schema directly (dev only — prod uses `migrate`)            |
| `bun run docs:dev`  | VitePress docs dev server                                        |

## Testing

- **SDK tests** (`packages/*/*.test.ts`) — pure-JS, `bun test packages/`, no DB.
- **Dashboard tests** (`apps/dashboard/tests/`) — integration tests that POST to a real dev server + real Postgres. Start `bun run dev` in another terminal first, then `cd apps/dashboard && bun test tests/`.
- **Extension tests** — unit tests live next to source under `apps/extension/src/` (`bun run ext:test`); Playwright E2E lives in `apps/extension/tests/` and runs against a built extension via `bun run --filter @reprojs/extension test:e2e`.

The full `bun run test` runs both, so you need the dev server running.

### TDD convention

Write the failing test first, then the implementation. The project uses `bun:test` everywhere — no jest, no vitest for unit tests.

## Project conventions

- **TypeScript strict**. No `any` to silence a type error. `as unknown as X` only when strictly necessary and justified inline.
- **Conventional Commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`. One concern per commit.
- **Contract types single-sourced** from `@reprojs/shared` — the SDK and dashboard UI both import from there rather than redeclaring.
- **No React/Vue/Svelte imports in SDK packages** — the widget is framework-agnostic. Only Preact inside a Shadow DOM.
- **Privacy-first replay** — masking defaults on; `data-repro-mask` / `data-repro-block` attributes on sensitive DOM nodes.

## Monorepo layout

```
reprojs/
├── apps/
│   ├── dashboard/              # Nuxt 4 — admin UI + intake API
│   └── extension/              # Chrome MV3 tester extension (Preact + Vite + CRXJS)
├── packages/
│   ├── core/                   # @reprojs/core — the published SDK
│   ├── ui/                     # widget UI (Preact + Shadow DOM)
│   ├── recorder/               # 30s rolling DOM replay
│   ├── shared/                 # contract types + Zod schemas
│   └── integrations/
│       └── github/             # GitHub App adapter
├── docs/                       # this site (VitePress)
├── .github/workflows/          # CI + Docker image publishing + docs deploy
└── compose.yaml                # self-host entry point
```

`@reprojs/core` bundles every `packages/*` workspace package at build time. The others stay private and exist as build inputs only — they're never published standalone. `apps/extension` is also private: it ships as a zip on the GitHub releases page and (after review) the Chrome Web Store, not as an npm package.

## Releases

Releases are driven by [changelogen](https://github.com/unjs/changelogen) from Conventional Commits. Dashboard, SDK, and the tester extension release on independent tag prefixes so they can version independently.

```bash
bun run release             # patch every affected artifact
bun run release --minor     # level applies to all affected
bun run release --dry-run   # print the plan, change nothing
bun run release --only sdk  # restrict (comma-separated); --skip is the inverse
bun run release --yes       # skip the confirm prompt
```

`scripts/release.sh` decides what's affected from what each artifact is *built from*, including bundled workspace packages:

| Artifact | Tag prefix | Built from |
| --- | --- | --- |
| sdk | `sdk-v` | `packages/{core,ui,sdk-utils,shared,recorder}` |
| dashboard | `v` | `apps/dashboard`, `packages/integrations` **+ bundles the SDK** |
| extension | `extension-v` | `apps/extension` **+ bundles the SDK** |
| expo | `expo-v` | `packages/expo`, `packages/{sdk-utils,shared}` |

Propagation needs no special rule: the dashboard bakes the SDK IIFE into its image and the extension syncs it via `sync-sdk.ts`, so listing the SDK as a source is what makes a `packages/ui` fix release all three. Expo deliberately omits `packages/ui` — it ships its own React Native UI. Release commits are excluded from detection, otherwise a release's own version bump would make the next one look necessary forever.

Everything lands in **one commit** with one tag per artifact, gated once on green CI. Tags are annotated — lightweight tags are silently skipped by `git push --follow-tags`, which previously meant a tag never reached the remote and its publish workflow never fired. Tags are pushed one at a time because GitHub won't start workflow runs for tags beyond the third in a single push.

Pushing a `v*.*.*` tag triggers `publish-docker` which builds the multi-arch image and pushes to `ripwords/reprojs-dashboard`. Pushing an `sdk-v*.*.*` tag triggers `publish-npm` which publishes `@reprojs/core` with provenance. Pushing an `extension-v*.*.*` tag triggers `publish-extension` which uploads to the Chrome Web Store **and** creates a GitHub Release with the `repro-tester.zip` attached (what testers install unpacked while Web Store review is pending).

## Where to file bugs / ideas

[github.com/Ripwords/ReproJs/issues](https://github.com/Ripwords/ReproJs/issues). PRs welcome.
