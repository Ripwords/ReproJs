import { test, expect } from "bun:test"
import { AttachmentKind, MediaMetaInput, ShareMintResponse, SharedMediaDTO } from "./index"

test("AttachmentKind accepts media", () => {
  expect(AttachmentKind.parse("media")).toBe("media")
})

test("MediaMetaInput enforces max 3 entries and trim shape", () => {
  const good = MediaMetaInput.parse([
    { kind: "video", mime: "video/webm", durationMs: 12_000, trim: { startMs: 1000, endMs: 9000 } },
    { kind: "image", mime: "image/png" },
  ])
  expect(good).toHaveLength(2)
  expect(() =>
    MediaMetaInput.parse([
      { kind: "video", mime: "video/webm" },
      { kind: "video", mime: "video/webm" },
      { kind: "video", mime: "video/webm" },
      { kind: "video", mime: "video/webm" },
    ]),
  ).toThrow()
  expect(() => MediaMetaInput.parse([{ kind: "gif", mime: "image/gif" }])).toThrow()
})

test("ShareMintResponse roundtrip", () => {
  const r = ShareMintResponse.parse({
    id: "e48d797c-1af8-4b16-95df-a99b78277c1c",
    token: "a".repeat(43),
    shareUrl: "https://feedback.example.com/s/" + "a".repeat(43),
    expiresAt: "2026-08-16T00:00:00.000Z",
  })
  expect(r.token.length).toBeGreaterThanOrEqual(43)
})

test("SharedMediaDTO parses a revoked row", () => {
  const dto = SharedMediaDTO.parse({
    id: "e48d797c-1af8-4b16-95df-a99b78277c1c",
    kind: "video",
    mime: "video/webm",
    sizeBytes: 1024,
    durationMs: 5000,
    createdAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-08-16T00:00:00.000Z",
    revokedAt: "2026-07-18T00:00:00.000Z",
    shareUrl: "https://feedback.example.com/s/tok",
  })
  expect(dto.revokedAt).not.toBeNull()
})
