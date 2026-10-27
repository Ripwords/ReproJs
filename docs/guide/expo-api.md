# Expo SDK — API reference

All public exports from `@reprojs/expo`.

## `<ReproProvider>`

The provider normalizes config, starts all collectors, manages the offline queue, and renders the wizard modal when triggered.

```tsx
import { ReproProvider } from "@reprojs/expo"

<ReproProvider config={config}>
  <App />
</ReproProvider>
```

### `config: ReproConfigInput`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `projectKey` | `string` | — | Your project's public key (`rp_pk_…`). Empty string = silent disable. |
| `intakeUrl` | `string` | — | `https://your-dashboard.example.com/api/intake`. Empty = silent disable. |
| `reporter` | `{ userId?: string, email?: string, name?: string }` | `null` | Pre-fill the reporter identity. `useRepro().identify(...)` overrides at runtime. |
| `fields.relatedIssue` | `boolean` | `false` | Show an optional **Related GitHub issue** input on the details step. See [below](#fields-relatedissue). |
| `collectors.console` | `boolean` | `true` | Patch `console.*` and buffer the last 200 entries. |
| `collectors.network.enabled` | `boolean` | `true` | Patch `globalThis.fetch` and buffer the last 100 calls. |
| `collectors.network.captureBodies` | `boolean` | `false` | Reserved for v1.1; currently ignored. |
| `collectors.breadcrumbs` | `boolean` | `true` | Enable the `useRepro().log(event, data)` buffer. |
| `collectors.systemInfo` | `boolean` | `true` | Attach device + env info at submit time. |
| `queue.maxReports` | `number` | `5` | Max queued reports before oldest is evicted. |
| `queue.maxBytes` | `number` | `33_554_432` (32 MB) | Byte cap across all queued attachments. Keep it above the 25 MB the form lets a reporter attach plus the screenshot; a single report that exceeds it is refused at submit time with a visible error, never queued and never dropped. |
| `queue.backoffMs` | `number[]` | `[1000, 5000, 30000, 120000]` | Retry delays per attempt. |
| `queue.maxAttempts` | `number` | `10` | Retries before a report is given up on. |
| `queue.submitTimeoutMs` | `number` | `60_000` | Abort one upload attempt after this long; the report is retried on the next flush. |
| `redact.headerDenylist` | `string[]` | `["authorization", "cookie", "x-api-key"]` | Case-insensitive header names that get `[redacted]` in the network entry. |
| `redact.bodyRedactKeys` | `string[]` | `["password", "token", "secret"]` | Reserved for v1.1 body capture. |
| `theme.accent` | `string` | `"#6366f1"` | Reserved; v1 UI uses the flame accent internally. |
| `theme.mode` | `"auto" \| "light" \| "dark"` | `"auto"` | Reserved for v1.1. |
| `metadata` | `Record<string, string \| number \| boolean>` | `{}` | Attached to every report. |

## `<ReproLauncher>`

Opt-in floating bug-report button. Tap opens the wizard; drag relocates to any of the four corners.

```tsx
<ReproLauncher
  position="bottom-right"
  offset={{ bottom: 24, right: 24 }}
  icon={<CustomBugIcon />}
  hideWhen={() => someAtom.value}
  draggable
/>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Initial corner. Overridden by the persisted choice if the user has dragged. |
| `offset` | `{ top?, bottom?, left?, right? }` | `24` each | Distance from the edge. |
| `icon` | `React.ReactNode` | `🐞` | Replace the default emoji. |
| `hideWhen` | `() => boolean` | — | Called on every render; return `true` to hide (e.g. on specific routes). |
| `draggable` | `boolean` | `true` | When `false`, pinned to `position` and ignores the persisted choice. |

The launcher returns `null` when the provider is in silent-disable mode, so it's always safe to render unconditionally.

### `fields.relatedIssue`

Off by default. When on, the details step gets an optional input, **Related GitHub issue**, under the description. It is meant for testers who re-test a known bug and already know which issue it belongs to.

```tsx
<ReproProvider
  config={{
    projectKey: "rp_pk_…",
    intakeUrl: "https://feedback.example.com/api/intake",
    fields: { relatedIssue: true },
  }}
>
```

Accepted formats: `42`, `#42`, `owner/repo#42`, `GH-42`, or the issue URL (`https://github.com/owner/repo/issues/42`). Pull-request links are rejected. Text that is not an issue reference blocks **Continue** with an inline hint until it is fixed or cleared. The review step lists the parsed number as "Related issue #42".

The value is sent with the report as a plain-text **hint** (`relatedIssue`) and nothing more:

- The app never fetches or lists issues and never writes to GitHub. It is not told whether the number exists, so a guessed number reveals nothing.
- The dashboard shows the hint as "Reporter referenced #42" and a manager confirms the link there. Reports carrying a hint are skipped by auto-create, so a wrong number can never open a stray issue.

The same option exists on the web SDK as [`fields.relatedIssue`](/guide/sdk#fields-relatedissue).

## `useRepro()`

React hook returning a `ReproHandle` for the nearest provider.

```ts
interface ReproHandle {
  disabled: boolean
  open: (opts?: { initialTitle?: string; initialDescription?: string }) => void
  close: () => void
  identify: (reporter: ReporterIdentity | null) => void
  log: (event: string, data?: Record<string, string | number | boolean | null>) => void
  setMetadata: (patch: Record<string, string | number | boolean>) => void
  queue: {
    pending: number
    lastError: string | null
    flush: () => Promise<void>
  }
}
```

### `disabled: boolean`

`true` when the provider rendered but config was empty (silent disable). All other methods are no-ops in that state. Use for branching UI:

```tsx
const repro = useRepro()
if (!repro.disabled) {
  // feature-gate a "Report a bug" menu item
}
```

### `open(opts?)` / `close()`

Open / dismiss the wizard programmatically. `initialTitle` / `initialDescription` pre-fill the form step.

### `identify(reporter)`

Set or clear the reporter's identity. `null` clears.

```tsx
repro.identify({ userId: user.id, email: user.email, name: user.name })
```

### `log(event, data?)`

Emit a breadcrumb. The last 50 breadcrumbs ship with the next submitted report.

```tsx
repro.log("checkout.failed", { cartId: "abc", total: 42.50 })
```

### `setMetadata(patch)`

Shallow-merge host-supplied metadata that ships with every report.

```tsx
repro.setMetadata({ appVersion: "1.2.3", buildChannel: "staging" })
```

### `queue`

Read-only view of the offline queue + a manual flush trigger.

```tsx
if (repro.queue.pending > 0) {
  await repro.queue.flush()
}
```

## `Repro` singleton

Non-React callsites (analytics wrappers, error handlers, class components) can use the module-level singleton.

```ts
import { Repro } from "@reprojs/expo"

Repro.open()
Repro.log("purchase.clicked", { sku: "pro-annual" })
Repro.identify({ userId: "u_123" })
Repro.close()
await Repro.flush()
```

It proxies to the currently-mounted provider. When no provider is mounted (or the provider is silently disabled), every call is a no-op — safe to sprinkle anywhere.

## Type exports

```ts
import type { ReproConfigInput, ReproHandle } from "@reprojs/expo"
```

`ReproConfigInput` matches the config shape accepted by `<ReproProvider>`. `ReproHandle` matches what `useRepro()` returns. `ReporterIdentity` is re-exported from [`@reprojs/shared`](../development/).

## Imperative config plugin (advanced)

The `@reprojs/expo` config plugin is loaded via `app.json`'s `plugins` array. It's a no-op in v1 but participates in the Expo build chain so future releases can add Info.plist / AndroidManifest patches without requiring consumers to rewire their config.

If you want to manually compose multiple plugins without relying on the `plugins` array:

```ts
// app.config.ts
import withRepro from "@reprojs/expo/app.plugin.js"

export default ({ config }) => withRepro(config)
```
