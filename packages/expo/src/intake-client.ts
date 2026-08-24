import type { ReportIntakeInput, IntakeResponse } from "@reprojs/shared"
import type { QueueItemAttachment } from "./queue/storage"

export interface IntakeSubmitArgs {
  idempotencyKey: string
  input: ReportIntakeInput
  attachments: Array<QueueItemAttachment & { contentType: string }>
  logs?: string
}

export class IntakeError extends Error {
  status: number
  retryable: boolean
  /**
   * A client-side defect that retrying can never resolve — a misconfigured
   * `intakeUrl`, or a local file that cannot be read. Distinct from a plain
   * network failure (offline), which carries no status and MUST stay
   * retryable so the offline queue keeps working.
   */
  fatal: boolean
  constructor(status: number, message: string, opts?: { fatal?: boolean }) {
    super(message)
    this.status = status
    this.fatal = opts?.fatal ?? false
    this.retryable = !this.fatal && (status >= 500 || status === 429)
  }
}

export interface IntakeClient {
  submit: (args: IntakeSubmitArgs) => Promise<IntakeResponse>
}

/**
 * Read a local `file://` URI into a real Blob.
 *
 * Uses XMLHttpRequest rather than `fetch` deliberately: XHR is always React
 * Native's own implementation, whereas `globalThis.fetch` is replaced by Expo's
 * WinterCG fetch from SDK 56 onward, and that one does not read `file://`.
 */
function xhrBlobFromUri(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.responseType = "blob"
    xhr.addEventListener("load", () => resolve(xhr.response as Blob))
    xhr.addEventListener("error", () => reject(new Error(`could not read attachment at ${uri}`)))
    xhr.open("GET", uri)
    xhr.send()
  })
}

/**
 * True when `f` is Expo's WinterCG fetch rather than React Native's.
 *
 * Expo tags every global it installs with `Symbol.for('expo.builtin')`
 * (see expo/src/winter/installGlobal.ts). This matters because the two
 * implementations need *different* multipart shapes, and picking the wrong one
 * fails in opposite ways:
 *
 *  - Expo's fetch rejects RN's `{ uri, name, type }` shorthand loudly
 *    ("Unsupported FormDataPart implementation").
 *  - React Native's fetch accepts a Blob but serializes it via
 *    `{...value}` in FormData.getParts(), which yields no file bytes — so the
 *    attachment is dropped *silently* and the report still returns 201.
 *
 * The silent direction is the dangerous one, hence explicit detection rather
 * than try/catch alone.
 */
function isExpoWinterFetch(f: unknown): boolean {
  try {
    return (f as Record<symbol, unknown> | null)?.[Symbol.for("expo.builtin")] === true
  } catch {
    return false
  }
}

export function createIntakeClient(opts: {
  intakeUrl: string
  fetchImpl?: typeof fetch
  /** Injectable for tests; defaults to an XHR read of the local file. */
  blobFromUri?: (uri: string) => Promise<Blob>
}): IntakeClient {
  const f = opts.fetchImpl ?? fetch
  const readBlob = opts.blobFromUri ?? xhrBlobFromUri

  return {
    async submit({ idempotencyKey, input, attachments, logs }) {
      // The two fetch implementations require different multipart shapes for
      // file parts, so build the body per runtime. See isExpoWinterFetch.
      async function buildForm(useBlobParts: boolean): Promise<FormData> {
        const form = new FormData()
        // Both runtimes serialize a plain string part correctly. React Native's
        // FormData does NOT support Blob parts for JSON — it drops them or sends
        // empty bytes — so the report/logs JSON always goes as a string.
        form.append("report", JSON.stringify(input))
        if (logs) {
          form.append("logs", logs)
        }
        let userFileIdx = 0
        for (const a of attachments) {
          const filename =
            a.filename ?? `${a.kind}.${a.contentType === "image/png" ? "png" : "bin"}`
          const field = a.kind === "user-file" ? `attachment[${userFileIdx}]` : a.kind
          if (useBlobParts) {
            // Expo's WinterCG fetch: needs real bytes. A plain Blob, never a
            // File — Expo's installFormDataPatch does `value.name = filename`
            // when `getOwnPropertyDescriptor(value, 'name')` is undefined, and
            // `File.name` is a prototype getter, so that assignment throws
            // "Cannot assign to property 'name' which has only a getter".
            // A Blob has no `name`, so the patch adds one, which is exactly
            // what convertFormDataAsync reads back for the filename.
            let blob: Blob
            try {
              // eslint-disable-next-line no-await-in-loop
              blob = await readBlob(a.uri)
            } catch (err) {
              throw new IntakeError(
                0,
                `attachment unreadable (${filename}): ${(err as Error).message}`,
                { fatal: true },
              )
            }
            form.append(field, blob, filename)
          } else {
            // React Native's fetch: its native layer streams the file from the
            // uri. A Blob here would be spread via `{...value}` in
            // FormData.getParts(), losing the bytes and dropping the attachment
            // silently while still returning 201.
            const part = { uri: a.uri, name: filename, type: a.contentType }
            form.append(field, part as unknown as Blob)
          }
          if (a.kind === "user-file") userFileIdx += 1
        }
        return form
      }

      const preferBlobParts = isExpoWinterFetch(f)
      const post = (form: FormData) =>
        f(`${opts.intakeUrl}/reports`, {
          method: "POST",
          body: form as unknown as BodyInit,
          headers: { "idempotency-key": idempotencyKey },
        })

      let res: Response
      try {
        res = await post(await buildForm(preferBlobParts))
      } catch (err) {
        // Self-healing safety net for the detectable direction: if the runtime
        // turns out to be Expo's fetch after all, it rejects the uri shorthand
        // loudly during body conversion, before any network I/O. Rebuild with
        // Blob parts and retry once. (The reverse mistake is silent, which is
        // why detection — not this catch — carries the real weight.)
        const message = (err as Error)?.message ?? ""
        if (!preferBlobParts && message.includes("Unsupported FormDataPart")) {
          res = await post(await buildForm(true))
        } else {
          throw err
        }
      }
      // A 3xx means `intakeUrl` does not point at the intake API — typically the
      // dashboard's auth redirect. Most fetch implementations follow it to a 200
      // HTML login page, so without this the failure surfaced much later as a
      // JSON parse error with no status attached.
      if (res.status >= 300 && res.status < 400) {
        throw new IntakeError(
          res.status,
          `intakeUrl redirected (HTTP ${res.status}) — it must end in /api/intake; the SDK appends /reports`,
          { fatal: true },
        )
      }
      if (res.status >= 400) {
        const body = await res.text().catch(() => "")
        throw new IntakeError(res.status, body || res.statusText)
      }
      const contentType = res.headers.get("content-type") ?? ""
      if (!contentType.includes("json")) {
        const body = await res.text().catch(() => "")
        throw new IntakeError(
          res.status,
          `intakeUrl did not return JSON (content-type: ${contentType || "none"}) — it must end in /api/intake. Got: ${body.slice(0, 120)}`,
          { fatal: true },
        )
      }
      return (await res.json()) as IntakeResponse
    },
  }
}
