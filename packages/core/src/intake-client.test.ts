import { expect, test } from "bun:test"
import { postReport, type IntakeInput } from "./intake-client"
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

const fakeConfig: ResolvedConfig = {
  endpoint: "https://example.com",
  projectKey: "rp_pk_ABCDEF1234567890abcdef12",
  position: "bottom-right",
  launcher: true,
  metadata: undefined,
  replay: undefined,
  screenshot: undefined,
}

const fakeContext: IntakeInput["context"] = {
  source: "web",
  pageUrl: "https://example.com",
  userAgent: "test-agent",
  viewport: { w: 1280, h: 800 },
  timestamp: new Date().toISOString(),
}

test("postReport serializes attachments as attachment[N] parts", async () => {
  const fake = installFakeFetch({ status: 201, body: { id: "r1" } })
  try {
    const att = {
      id: "a",
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      filename: "foo.png",
      mime: "image/png",
      size: 3,
      isImage: true,
    }
    const result = await postReport(fakeConfig, {
      title: "t",
      description: "",
      context: fakeContext,
      attachments: [att],
    })
    expect(result.ok).toBe(true)
    const body = fake.calls[0]?.init?.body as FormData
    expect(body.has("attachment[0]")).toBe(true)
    const file = body.get("attachment[0]") as File
    expect(file.name).toBe("foo.png")
    expect(file.type).toBe("image/png")
  } finally {
    fake.restore()
  }
})

test("postReport without attachments produces a body without attachment[N] keys", async () => {
  const fake = installFakeFetch({ status: 201, body: { id: "r1" } })
  try {
    await postReport(fakeConfig, {
      title: "t",
      description: "",
      context: fakeContext,
    })
    const body = fake.calls[0]?.init?.body as FormData
    for (const key of body.keys()) expect(key).not.toMatch(/^attachment\[/)
  } finally {
    fake.restore()
  }
})

test("postReport serializes media as media[N] parts + an aligned mediaMeta and no screenshot part", async () => {
  const fake = installFakeFetch({ status: 201, body: { id: "r1" } })
  try {
    const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    const video = new Blob([new Uint8Array([4, 5, 6, 7])], { type: "video/webm" })
    const result = await postReport(fakeConfig, {
      title: "t",
      description: "",
      context: fakeContext,
      media: [
        { blob: image, mime: "image/png", kind: "image" },
        {
          blob: video,
          mime: "video/webm",
          kind: "video",
          durationMs: 5000,
          trim: { startMs: 1000, endMs: 4000 },
        },
      ],
    })
    expect(result.ok).toBe(true)
    const body = fake.calls[0]?.init?.body as FormData

    // No legacy screenshot part is emitted by the new client.
    expect(body.has("screenshot")).toBe(false)

    const m0 = body.get("media[0]") as File
    const m1 = body.get("media[1]") as File
    expect(m0).toBeInstanceOf(File)
    expect(m1).toBeInstanceOf(File)
    expect(m0.type).toBe("image/png")
    expect(m0.name).toBe("media-0.png")
    expect(m1.type).toBe("video/webm")
    expect(m1.name).toBe("media-1.webm")

    const metaBlob = body.get("mediaMeta") as Blob
    expect(metaBlob).toBeInstanceOf(Blob)
    const meta = JSON.parse(await metaBlob.text()) as unknown[]
    expect(meta).toEqual([
      { kind: "image", mime: "image/png" },
      {
        kind: "video",
        mime: "video/webm",
        durationMs: 5000,
        trim: { startMs: 1000, endMs: 4000 },
      },
    ])
  } finally {
    fake.restore()
  }
})
