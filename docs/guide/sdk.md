# SDK

The SDK is one package — `@reprojs/core` — that bundles the widget UI, recorder, and all shared types. No matter how your app is built (React, Vue, Svelte, Angular, Nuxt, Next, vanilla, …), the install is identical.

## Install

### `<script>` tag

```html
<script
  src="https://your-dashboard.example.com/sdk/repro.iife.js"
  async
  onload="Repro.init({
    projectKey: 'rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx',
    endpoint: 'https://your-dashboard.example.com',
  })"
></script>
```

The `/sdk/repro.iife.js` bundle is served by the dashboard itself, so you always load a version that matches your dashboard. The IIFE registers a single global: `window.Repro`.

::: warning Why the `onload` attribute?
A naive split — `<script async>` for the bundle + a separate inline `<script>` that calls `Repro.init(…)` — looks cleaner, but the `async` attribute lets the browser reorder execution. The inline script often runs _before_ the bundle has parsed, and you'll see `ReferenceError: Repro is not defined`. Putting the init call on `onload` ties it to the bundle's own load completion so the call is always safe.
:::

If you prefer to keep init inline, drop `async` — that reverts to synchronous in-order execution at the cost of a ~50 KB parse during page load:

```html
<script src="https://your-dashboard.example.com/sdk/repro.iife.js"></script>
<script>
  Repro.init({
    projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
    endpoint: "https://your-dashboard.example.com",
  })
</script>
```

### ESM / bundler

::: code-group

```sh [npm]
npm install @reprojs/core
```

```sh [pnpm]
pnpm add @reprojs/core
```

```sh [yarn]
yarn add @reprojs/core
```

```sh [bun]
bun add @reprojs/core
```

:::

```ts
import { init } from "@reprojs/core"

init({
  projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
  endpoint: "https://your-dashboard.example.com",
})
```

The example above assumes a browser-only entry point (Vite SPA, CRA, plain `<script type="module">`). If you're using **Next.js, Nuxt, Remix, SvelteKit, Astro, or any other SSR / React Server Components framework**, read the next section — calling `init()` at module scope will throw `ReferenceError: document is not defined` during server rendering.

## Using with SSR frameworks

The SDK touches `document` and `window` to mount the widget and start the replay recorder, so it must only run in the browser. SSR frameworks evaluate your modules on the server too, which means a top-level `init(...)` call — like you'd write in a pure SPA — will crash the server render.

The fix is the same shape everywhere: **defer `init()` until after the component has mounted in the browser.** Import is always safe; only the call needs to be client-side.

### <img src="/icons/nextdotjs.svg" class="fw-icon" alt="" /> Next.js — App Router (`app/`)

Create a tiny client component and render it once in your root layout.

```tsx
// app/repro-client.tsx
"use client"

import { useEffect } from "react"
import { init } from "@reprojs/core"

export function ReproClient() {
  useEffect(() => {
    init({
      projectKey: process.env.NEXT_PUBLIC_REPRO_PROJECT_KEY!,
      endpoint: process.env.NEXT_PUBLIC_REPRO_ENDPOINT!,
    })
  }, [])
  return null
}
```

```tsx
// app/layout.tsx
import { ReproClient } from "./repro-client"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        {children}
        <ReproClient />
      </body>
    </html>
  )
}
```

> Note: `'use client'` alone isn't enough — client components still pre-render on the server unless you also defer the browser API behind `useEffect` or lazy-load with `next/dynamic`. See the Pages Router recipe for the `dynamic` variant.

### <img src="/icons/nextdotjs.svg" class="fw-icon" alt="" /> Next.js — Pages Router (`pages/`)

Use `next/dynamic` with `ssr: false`, or call `init()` from `useEffect` in `pages/_app.tsx`.

```tsx
// pages/_app.tsx
import type { AppProps } from "next/app"
import { useEffect } from "react"

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    import("@reprojs/core").then(({ init }) => {
      init({
        projectKey: process.env.NEXT_PUBLIC_REPRO_PROJECT_KEY!,
        endpoint: process.env.NEXT_PUBLIC_REPRO_ENDPOINT!,
      })
    })
  }, [])
  return <Component {...pageProps} />
}
```

The dynamic `import()` keeps the SDK out of the server bundle entirely.

### <img src="/icons/nuxt.svg" class="fw-icon" alt="" /> Nuxt 3 / 4

Put the init call in a `.client.ts` plugin — Nuxt only runs these in the browser.

```ts
// plugins/repro.client.ts
import { init } from "@reprojs/core"

export default defineNuxtPlugin(() => {
  init({
    projectKey: useRuntimeConfig().public.reproProjectKey,
    endpoint: useRuntimeConfig().public.reproEndpoint,
  })
})
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      reproProjectKey: "",   // fed from NUXT_PUBLIC_REPRO_PROJECT_KEY
      reproEndpoint: "",     // fed from NUXT_PUBLIC_REPRO_ENDPOINT
    },
  },
})
```

Alternative: call `init()` inside `onMounted()` in `app.vue` or a layout `<script setup>` block.

### <img src="/icons/remix.svg" class="fw-icon" alt="" /> Remix / React Router v7 (framework mode)

Use a `.client.ts` module so the bundler strips it from the server build, or call from `useEffect` in the root route.

```tsx
// app/root.tsx
import { useEffect } from "react"

export default function App() {
  useEffect(() => {
    import("@reprojs/core").then(({ init }) => {
      init({
        projectKey: window.ENV.REPRO_PROJECT_KEY,
        endpoint: window.ENV.REPRO_ENDPOINT,
      })
    })
  }, [])
  // …rest of your root component
}
```

### <img src="/icons/svelte.svg" class="fw-icon" alt="" /> SvelteKit

Use `onMount` (SvelteKit guarantees it's browser-only) or gate on the `browser` constant from `$app/environment`.

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from "svelte"
  import { PUBLIC_REPRO_PROJECT_KEY, PUBLIC_REPRO_ENDPOINT } from "$env/static/public"

  onMount(async () => {
    const { init } = await import("@reprojs/core")
    init({
      projectKey: PUBLIC_REPRO_PROJECT_KEY,
      endpoint: PUBLIC_REPRO_ENDPOINT,
    })
  })
</script>

<slot />
```

### <img src="/icons/astro.svg" class="fw-icon" alt="" /> Astro

Put the init call in a `<script>` tag (Astro ships those to the client by default) or in a client-only island component.

```astro
---
// src/layouts/Base.astro
---
<html>
  <body>
    <slot />
    <script>
      import { init } from "@reprojs/core"
      init({
        projectKey: import.meta.env.PUBLIC_REPRO_PROJECT_KEY,
        endpoint: import.meta.env.PUBLIC_REPRO_ENDPOINT,
      })
    </script>
  </body>
</html>
```

### <img src="/icons/vite.svg" class="fw-icon" alt="" /> Vanilla SPA (Vite, CRA, Parcel, …)

No server rendering, no guards needed — the top-level call in the ESM example above works as-is.

### Troubleshooting

- **`ReferenceError: document is not defined`** — `init()` is running during server render. Move the call into a client-only hook/plugin as shown above.
- **Widget renders twice or collectors double up** — you're calling `init()` more than once (e.g. on every re-render). Keep it inside `useEffect(..., [])` / `onMounted` / `onMount` so it fires once per page load.
- **Works in dev but breaks in prod** — usually a prod-only minifier or bundler hoisting the import. Use the dynamic `import()` variant so the SDK never enters the server bundle.

## Where to get a project key

Sign in to your dashboard, create a project, open **Project → Settings**. Each project has:

- A **public key** (`rp_pk_` + 24 base62 chars), on the **Security** tab — safe to ship in your client JS. The tab also shows a ready-to-paste embed snippet with the key filled in.
- An **origin allowlist**, on the **General** tab — requests from any origin not on the list are rejected with 403 and no CORS oracle leaked

A new project has no key yet: the field reads **(not generated)** until a project owner clicks **Rotate key**. The owner can rotate the key again at any time.

Every project member can open the Security tab. On a project with no reports, the **View embed snippet** button on the project overview and the empty inbox goes straight to it. Install admins see **View install instructions** instead, which opens the full install guide at **Admin → Install**.

## API

### `init(options)`

Boots the widget. Call it once per page load, from a browser-only context (e.g. `useEffect` in React, `onMounted` in Vue, `onMount` in Svelte, or a `.client.ts` entry in Nuxt / Remix). See [Using with SSR frameworks](#using-with-ssr-frameworks) if you're on Next.js, Nuxt, Remix, SvelteKit, or Astro.

```ts
interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean // show the floating button? default true
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig // fine-grained per-collector opts
  replay?: {
    enabled?: boolean
    masking?: "strict" | "moderate" | "minimal"
    maskSelectors?: string[]
    blockSelectors?: string[]
    maxBytes?: number
  }
}
```

Returns a `FeedbackHandle` with `pauseReplay()` / `resumeReplay()` methods.

### `open()` / `close()`

Open or close the widget programmatically. Useful if you want your own button instead of the default launcher (`launcher: false` + your handler calling `open()`).

```ts
import { open, close } from "@reprojs/core"

button.addEventListener("click", () => open())
```

### `identify(reporter)`

Tell Repro who the current user is. Attached to any report submitted after.

```ts
import { identify } from "@reprojs/core"

identify({
  userId: "user_123",
  email: "alex@example.com",
  name: "Alex Example",
})

// On sign-out:
identify(null)
```

### `log(event, data?, level?)`

Drop a breadcrumb into the rolling session log. It appears on the report's **Console** tab, under **App events**, with a timestamp.

```ts
import { log } from "@reprojs/core"

log("checkout.started", { cart_id: "c_9f2", items: 3 })
log("payment.failed", { reason: "card_declined" }, "error")
```

Level is one of `"debug" | "info" | "warn" | "error"` (default `"info"`).

## Privacy

### Masking inputs

The replay recorder masks password fields and anything you tag with `data-repro-mask`:

```html
<input type="password" />                 <!-- always masked -->
<input data-repro-mask />                 <!-- opt-in mask -->
<div data-repro-block>secret widget</div> <!-- fully blocked -->
```

Tune with `replay.masking`:

- `"strict"` — mask all inputs + text
- `"moderate"` — default; mask sensitive inputs + `data-repro-mask`
- `"minimal"` — mask only password fields

### Denylisted cookies / headers

Operators configure a cookie/header denylist on the dashboard. Report payloads strip those keys before storage.

## Bundle size

`@reprojs/core@0.5.0`:

- **ESM**: ~243 KB uncompressed (`@reprojs/*` deps inlined)
- **IIFE** (minified): ~147 KB — the one your users download

Typical real-world transfer once your CDN gzips it: ~46 KB.
