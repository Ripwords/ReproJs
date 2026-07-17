import { expect, test } from "bun:test"
import { mintShareLink } from "./share-client"
import type { ResolvedConfig } from "./config"

interface FakeRequest {
  url: string
  init: RequestInit | undefined
}

function installFakeFetch(response: { status: number; body: unknown }): {
  calls: FakeRequest[]
  restore: () => void
} {
  const calls: FakeRequest[] = []
  const original = globalThis.fetch
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify(response.body), { status: response.status })
  }
  globalThis.fetch = fakeFetch as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function installThrowingFetch(err: Error): { restore: () => void } {
  const original = globalThis.fetch
  const throwingFetch = async (
    _input: RequestInfo | URL,
    _init?: RequestInit,
  ): Promise<Response> => {
    throw err
  }
  globalThis.fetch = throwingFetch as typeof fetch
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const fakeConfig: ResolvedConfig = {
  endpoint: "https://example.com",
  projectKey: "rp_pk_ABCDEF1234567890abcdef12",
  position: "bottom-right",
  launcher: true,
  metadata: undefined,
  replay: undefined,
  screenshot: undefined,
  hotkey: undefined,
}

const fakeInput = {
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" }),
  mime: "video/webm",
  durationMs: 12_000,
  trim: { startMs: 1_000, endMs: 5_000 },
}

test("mintShareLink returns ok + url/token/expiresAt on 201, sending file + meta with projectKey", async () => {
  const fake = installFakeFetch({
    status: 201,
    body: {
      id: "11111111-1111-1111-1111-111111111111",
      token: "t".repeat(43),
      shareUrl: "https://example.com/s/abc",
      expiresAt: "2026-08-01T00:00:00.000Z",
    },
  })
  try {
    const result = await mintShareLink(fakeConfig, fakeInput)
    expect(result).toEqual({
      ok: true,
      url: "https://example.com/s/abc",
      token: "t".repeat(43),
      expiresAt: "2026-08-01T00:00:00.000Z",
    })

    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]!
    expect(call.url).toBe("https://example.com/api/intake/media")
    expect(call.init?.credentials).toBe("omit")
    expect(call.init?.method).toBe("POST")

    const body = call.init?.body as FormData
    expect(body.has("file")).toBe(true)
    const file = body.get("file") as File
    expect(file.type).toBe("video/webm")

    const metaPart = body.get("meta") as Blob
    const metaText = await metaPart.text()
    const meta = JSON.parse(metaText) as Record<string, unknown>
    expect(meta.projectKey).toBe(fakeConfig.projectKey)
    expect(meta.kind).toBe("video")
    expect(meta.mime).toBe("video/webm")
    expect(meta.durationMs).toBe(12_000)
    expect(meta.trim).toEqual({ startMs: 1_000, endMs: 5_000 })
  } finally {
    fake.restore()
  }
})

test("mintShareLink omits durationMs/trim from meta when absent", async () => {
  const fake = installFakeFetch({
    status: 201,
    body: {
      id: "11111111-1111-1111-1111-111111111111",
      token: "t".repeat(43),
      shareUrl: "https://example.com/s/abc",
      expiresAt: "2026-08-01T00:00:00.000Z",
    },
  })
  try {
    await mintShareLink(fakeConfig, { blob: fakeInput.blob, mime: "video/webm" })
    const call = fake.calls[0]!
    const body = call.init?.body as FormData
    const metaPart = body.get("meta") as Blob
    const meta = JSON.parse(await metaPart.text()) as Record<string, unknown>
    expect("durationMs" in meta).toBe(false)
    expect("trim" in meta).toBe(false)
  } finally {
    fake.restore()
  }
})

const statusCases: Array<[number, string]> = [
  [404, "This server does not support share links yet"],
  [403, "Share links are disabled for this project"],
  [413, "Recording is too large to share"],
  [429, "Too many links minted — try again in a minute"],
  [500, "Could not create link (HTTP 500)"],
]

for (const [status, message] of statusCases) {
  test(`mintShareLink maps HTTP ${status} to "${message}"`, async () => {
    const fake = installFakeFetch({ status, body: { statusMessage: "server detail" } })
    try {
      const result = await mintShareLink(fakeConfig, fakeInput)
      expect(result).toEqual({ ok: false, message })
    } finally {
      fake.restore()
    }
  })
}

test("mintShareLink returns ok:false on network throw", async () => {
  const fake = installThrowingFetch(new TypeError("Failed to fetch"))
  try {
    const result = await mintShareLink(fakeConfig, fakeInput)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(typeof result.message).toBe("string")
      expect(result.message.length).toBeGreaterThan(0)
    }
  } finally {
    fake.restore()
  }
})

test("mintShareLink uses a 60s abort timeout", async () => {
  const fake = installFakeFetch({
    status: 201,
    body: {
      id: "11111111-1111-1111-1111-111111111111",
      token: "t".repeat(43),
      shareUrl: "https://example.com/s/abc",
      expiresAt: "2026-08-01T00:00:00.000Z",
    },
  })
  try {
    await mintShareLink(fakeConfig, fakeInput)
    const call = fake.calls[0]!
    expect(call.init?.signal).toBeDefined()
  } finally {
    fake.restore()
  }
})
