import { test, expect } from "bun:test"
import { createIntakeClient } from "./intake-client"

test("POSTs to intakeUrl/reports with multipart body and Idempotency-Key header", async () => {
  let capturedUrl = ""
  let capturedHeaders: Record<string, string> = {}
  const mockFetch = (async (input: unknown, init: unknown) => {
    capturedUrl = typeof input === "string" ? input : (input as Request).url
    capturedHeaders = Object.fromEntries(
      new Headers((init as RequestInit | undefined)?.headers).entries(),
    )
    return new Response(JSON.stringify({ id: "server-id" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: mockFetch,
  })
  const res = await client.submit({
    idempotencyKey: "idem-1",
    input: {
      projectKey: "rp_pk_" + "a".repeat(24),
      title: "t",
      context: {
        source: "expo",
        pageUrl: "myapp://x",
        userAgent: "u",
        viewport: { w: 1, h: 1 },
        timestamp: new Date().toISOString(),
      },
    } as never,
    attachments: [],
  })
  expect(capturedUrl).toBe("https://ex.com/api/intake/reports")
  expect(capturedHeaders["idempotency-key"]).toBe("idem-1")
  expect(res.id).toBe("server-id")
})

const mockServerErrorFetch = (async () =>
  new Response("boom", { status: 503 })) as unknown as typeof fetch

test("surfaces 5xx errors to the caller", async () => {
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: mockServerErrorFetch,
  })
  await expect(
    client.submit({
      idempotencyKey: "k",
      input: { projectKey: "rp_pk_" + "a".repeat(24), title: "t", context: {} as never } as never,
      attachments: [],
    }),
  ).rejects.toMatchObject({ status: 503 })
})

test("submits user-file attachments as attachment[N] parts", async () => {
  const calls: { body: FormData }[] = []
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    calls.push({ body: init?.body as FormData })
    return new Response(JSON.stringify({ id: "x" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch
  const client = createIntakeClient({
    intakeUrl: "https://x",
    fetchImpl: fakeFetch,
    // Attachments are now read into real Blobs; inject the reader since
    // XMLHttpRequest / file:// do not exist under bun test.
    blobFromUri: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
  })
  await client.submit({
    idempotencyKey: "k",
    input: {
      projectKey: "p",
      title: "t",
      context: { source: "expo" },
    } as never,
    attachments: [
      {
        kind: "user-file",
        uri: "file:///a.png",
        bytes: 10,
        contentType: "image/png",
        filename: "a.png",
      },
      {
        kind: "user-file",
        uri: "file:///b.pdf",
        bytes: 20,
        contentType: "application/pdf",
        filename: "b.pdf",
      },
    ],
  })
  const body = calls[0]?.body
  expect(body?.has("attachment[0]")).toBe(true)
  expect(body?.has("attachment[1]")).toBe(true)
})

// ── Regression guards for the Expo SDK >=56 attachment outage ───────────────
// Expo replaces globalThis.fetch with its WinterCG implementation from SDK 56
// (`install('fetch', ...)` in expo/src/winter/runtime.native.ts, opt out with
// EXPO_PUBLIC_USE_RN_FETCH=1). Its convertFormDataAsync accepts only a string,
// a real Blob, or an object exposing `bytes()` — its own doc comment states
// "`uri` is not supported for React Native's FormData". The old
// `{ uri, name, type } as unknown as Blob` shorthand therefore threw
// "Unsupported FormDataPart implementation". That throw carries no HTTP status,
// so flush.ts read status 0, treated it as retryable, burned all 10 attempts
// and discarded the report while the wizard reported success.

function collectParts(store: Array<[string, unknown]>) {
  return (async (_i: unknown, init: unknown) => {
    const body = (init as { body: FormData }).body
    for (const [k, v] of (
      body as unknown as { entries: () => Iterable<[string, unknown]> }
    ).entries()) {
      store.push([k, v])
    }
    return new Response(JSON.stringify({ id: "x" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
}

const ATTACHMENT = {
  kind: "screenshot",
  uri: "file:///tmp/a.png",
  bytes: 3,
  contentType: "image/png",
} as never

// React Native's fetch streams the file from `uri`. Passing a Blob here is the
// dangerous case: FormData.getParts() spreads it via `{...value}`, losing the
// bytes, so the attachment vanishes while intake still answers 201.
test("uses the RN { uri } shorthand when fetch is React Native's", async () => {
  const parts: Array<[string, unknown]> = []
  let reads = 0
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: collectParts(parts),
    blobFromUri: async () => {
      reads += 1
      return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    },
  })
  await client.submit({ idempotencyKey: "i", input: {} as never, attachments: [ATTACHMENT] })
  // The RN path hands the uri to the native layer and must NOT pull the file
  // into JS memory. (The part itself is not inspectable here: the standard
  // FormData in this test runtime coerces a non-Blob value to a string,
  // whereas React Native's FormData stores the object verbatim.)
  expect(reads).toBe(0)
  expect(parts.find(([k]) => k === "screenshot")).toBeDefined()
})

// Expo's WinterCG fetch rejects the uri shorthand outright, so it must receive
// real bytes instead. Expo tags its installed globals with Symbol.for('expo.builtin').
test("uses real Blob parts when fetch is Expo's WinterCG implementation", async () => {
  const parts: Array<[string, unknown]> = []
  const expoFetch = collectParts(parts)
  Object.defineProperty(expoFetch, Symbol.for("expo.builtin"), { value: true })
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: expoFetch,
    blobFromUri: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  })
  await client.submit({ idempotencyKey: "i", input: {} as never, attachments: [ATTACHMENT] })
  const value = parts.find(([k]) => k === "screenshot")?.[1]
  expect(value instanceof Blob).toBe(true)
  expect((value as { uri?: string }).uri).toBeUndefined()
})

// Safety net if detection is ever wrong in the loud direction.
test("retries with Blob parts when the runtime rejects the uri shorthand", async () => {
  let calls = 0
  const parts: Array<[string, unknown]> = []
  const pickyFetch = (async (_i: unknown, init: unknown) => {
    calls += 1
    if (calls === 1) throw new Error("Unsupported FormDataPart implementation")
    const body = (init as { body: FormData }).body
    for (const [k, v] of (
      body as unknown as { entries: () => Iterable<[string, unknown]> }
    ).entries()) {
      parts.push([k, v])
    }
    return new Response(JSON.stringify({ id: "x" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: pickyFetch,
    blobFromUri: async () => new Blob([new Uint8Array([9])], { type: "image/png" }),
  })
  const out = await client.submit({
    idempotencyKey: "i",
    input: {} as never,
    attachments: [ATTACHMENT],
  })
  expect(calls).toBe(2)
  expect(out.id).toBe("x")
  expect((parts.find(([k]) => k === "screenshot")?.[1] as Blob) instanceof Blob).toBe(true)
})

test("a non-JSON response is a fatal misconfiguration, not a retry", async () => {
  const mockFetch = (async () =>
    new Response("<!DOCTYPE html><html>login</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof fetch
  const client = createIntakeClient({ intakeUrl: "https://ex.com", fetchImpl: mockFetch })
  const err = await client
    .submit({ idempotencyKey: "i", input: {} as never, attachments: [] })
    .then(() => null)
    .catch((e: unknown) => e as { fatal?: boolean; retryable?: boolean; message: string })
  expect(err?.fatal).toBe(true)
  expect(err?.retryable).toBe(false)
  expect(err?.message).toContain("/api/intake")
})

test("a real 4xx stays a non-fatal client error", async () => {
  const mockFetch = (async () =>
    new Response('{"error":true}', {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
  const client = createIntakeClient({
    intakeUrl: "https://ex.com/api/intake",
    fetchImpl: mockFetch,
  })
  const err = await client
    .submit({ idempotencyKey: "i", input: {} as never, attachments: [] })
    .then(() => null)
    .catch((e: unknown) => e as { fatal?: boolean; status?: number })
  expect(err?.status).toBe(400)
  expect(err?.fatal).toBe(false)
})
