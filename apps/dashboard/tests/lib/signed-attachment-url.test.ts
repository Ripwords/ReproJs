import { describe, expect, test } from "bun:test"
import {
  signAttachmentToken,
  verifyAttachmentToken,
  verifyAttachmentTokenAny,
} from "../../server/lib/signed-attachment-url"

const SECRET = "test-secret-0123456789abcdef"

describe("signed-attachment-url", () => {
  test("token round-trips with matching secret", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(true)
  })

  test("tampered token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r2",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("wrong secret rejected", () => {
    const expires = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: "other-secret",
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })

  test("expired token rejected", () => {
    const expires = Math.floor(Date.now() / 1000) - 10
    const token = signAttachmentToken({
      secret: SECRET,
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      expiresAt: expires,
    })
    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt: expires,
        token,
      }),
    ).toBe(false)
  })
})

describe("verifyAttachmentTokenAny (secret rotation)", () => {
  const OLD = "retired-secret-0123456789abcdef"
  const base = { projectId: "p1", reportId: "r1", kind: "screenshot" }

  test("a link signed with a retired secret still verifies after rotation", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({ secret: OLD, ...base, expiresAt })
    expect(verifyAttachmentTokenAny({ secrets: [SECRET, OLD], ...base, expiresAt, token })).toBe(
      true,
    )
  })

  test("a secret that was never configured is rejected even with retired ones present", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({ secret: "leaked-and-dropped", ...base, expiresAt })
    expect(verifyAttachmentTokenAny({ secrets: [SECRET, OLD], ...base, expiresAt, token })).toBe(
      false,
    )
  })

  test("an empty secret list verifies nothing", () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const token = signAttachmentToken({ secret: SECRET, ...base, expiresAt })
    expect(verifyAttachmentTokenAny({ secrets: [], ...base, expiresAt, token })).toBe(false)
  })
})
