import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"
import { createUser, seedProject, truncateDomain, truncateReports } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_MEDIATEST1234567890abcd0"
const ORIGIN = "https://example.com"

function reportBlob(): Blob {
  return new Blob(
    [
      JSON.stringify({
        projectKey: PK,
        title: "with media",
        description: "x",
        context: {
          source: "web",
          url: "https://example.com/page",
          pageUrl: "https://example.com/page",
          userAgent: "Mozilla/5.0 Test",
          viewport: { w: 1440, h: 900 },
          timestamp: new Date().toISOString(),
        },
        _dwellMs: 5000,
        _hp: "",
      }),
    ],
    { type: "application/json" },
  )
}

async function postReportWithMedia(opts: {
  media?: { name: string; type: string; bytes: Uint8Array }[]
  mediaMeta?: unknown
  includeMediaMeta?: boolean
  screenshot?: { name: string; type: string; bytes: Uint8Array }
}): Promise<{ res: Response; reportId: string | null }> {
  const form = new FormData()
  form.append("report", reportBlob())
  ;(opts.media ?? []).forEach((m, i) => {
    form.append(`media[${i}]`, new File([m.bytes], m.name, { type: m.type }))
  })
  const includeMediaMeta = opts.includeMediaMeta ?? opts.mediaMeta !== undefined
  if (includeMediaMeta) {
    form.append(
      "mediaMeta",
      new Blob([JSON.stringify(opts.mediaMeta ?? [])], { type: "application/json" }),
    )
  }
  if (opts.screenshot) {
    form.append(
      "screenshot",
      new File([opts.screenshot.bytes], opts.screenshot.name, { type: opts.screenshot.type }),
    )
  }
  const res = await fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: ORIGIN },
    body: form,
  })
  let reportId: string | null = null
  if (res.status === 201) {
    const body = (await res.clone().json()) as { id: string }
    reportId = body.id
  }
  return { res, reportId }
}

describe("POST /api/intake/reports — gallery media", () => {
  beforeAll(async () => {
    await truncateDomain()
    const admin = await createUser("media-admin@example.com", "admin")
    await seedProject({
      name: "Media Test Project",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateReports()
  })

  test("1: happy path — image + trimmed video persist as kind='media' with trim metadata", async () => {
    const { res, reportId } = await postReportWithMedia({
      media: [
        { name: "media-0.png", type: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) },
        { name: "media-1.webm", type: "video/webm", bytes: new Uint8Array([5, 6, 7, 8]) },
      ],
      mediaMeta: [
        { kind: "image", mime: "image/png" },
        {
          kind: "video",
          mime: "video/webm",
          durationMs: 5000,
          trim: { startMs: 1000, endMs: 4000 },
        },
      ],
    })
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    const mediaRows = rows.filter((r) => r.kind === "media")
    expect(mediaRows).toHaveLength(2)
    const row0 = mediaRows.find((r) => r.storageKey.endsWith("/media/0.png"))
    const row1 = mediaRows.find((r) => r.storageKey.endsWith("/media/1.webm"))
    expect(row0).toBeDefined()
    expect(row1).toBeDefined()
    expect(row1?.trimStartMs).toBe(1000)
    expect(row1?.trimEndMs).toBe(4000)
    expect(row1?.durationMs).toBe(5000)
  })

  test("2: missing mediaMeta while media[0] present → 400", async () => {
    const { res } = await postReportWithMedia({
      media: [{ name: "media-0.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
      includeMediaMeta: false,
    })
    expect(res.status).toBe(400)
  })

  test("3: mediaMeta length mismatch (2 entries, 1 part) → 400", async () => {
    const { res } = await postReportWithMedia({
      media: [{ name: "media-0.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
      mediaMeta: [
        { kind: "image", mime: "image/png" },
        { kind: "image", mime: "image/png" },
      ],
    })
    expect(res.status).toBe(400)
  })

  test("4: denied mime (media[0] as text/plain) → 415", async () => {
    const { res } = await postReportWithMedia({
      media: [{ name: "media-0.txt", type: "text/plain", bytes: new Uint8Array([1, 2, 3]) }],
      mediaMeta: [{ kind: "image", mime: "text/plain" }],
    })
    expect(res.status).toBe(415)
  })

  test("5: count over INTAKE_MEDIA_MAX_COUNT (4 parts) → 413", async () => {
    const media = Array.from({ length: 4 }, (_, i) => ({
      name: `media-${i}.png`,
      type: "image/png",
      bytes: new Uint8Array([i + 1]),
    }))
    const mediaMeta = Array.from({ length: 4 }, () => ({ kind: "image", mime: "image/png" }))
    const { res } = await postReportWithMedia({ media, mediaMeta })
    expect(res.status).toBe(413)
  })

  test("6: old-SDK compat — legacy screenshot part, no media parts → 201, screenshot row as before", async () => {
    const { res, reportId } = await postReportWithMedia({
      screenshot: { name: "screenshot.png", type: "image/png", bytes: new Uint8Array([9, 9, 9]) },
    })
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    expect(rows.filter((r) => r.kind === "media")).toHaveLength(0)
    const screenshotRow = rows.find((r) => r.kind === "screenshot")
    expect(screenshotRow).toBeDefined()
    expect(screenshotRow?.storageKey.endsWith("/screenshot.png")).toBe(true)
  })

  test("8: parameterized codec mime (video/webm;codecs=vp9) → 201, stored contentType is bare", async () => {
    const { res, reportId } = await postReportWithMedia({
      media: [
        { name: "clip.webm", type: "video/webm;codecs=vp9", bytes: new Uint8Array([1, 2, 3, 4]) },
      ],
      mediaMeta: [{ kind: "video", mime: "video/webm;codecs=vp9", durationMs: 3000 }],
    })
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    const mediaRow = rows.find((r) => r.kind === "media")
    expect(mediaRow).toBeDefined()
    expect(mediaRow?.contentType).toBe("video/webm")
    expect(mediaRow?.storageKey.endsWith("/media/0.webm")).toBe(true)
  })

  test("9: image mime declared as kind='video' → 400 (kind/mime family mismatch)", async () => {
    const { res } = await postReportWithMedia({
      media: [{ name: "media-0.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) }],
      mediaMeta: [{ kind: "video", mime: "image/png" }],
    })
    expect(res.status).toBe(400)
  })

  test("7: duplicate media[0] indices (two parts, same slot) → 400, no rows persisted", async () => {
    const form = new FormData()
    form.append("report", reportBlob())
    // Two parts both claim index 0, with divergent byte lengths — the
    // second `storage.put` would silently overwrite the first blob at
    // `${report.id}/media/0.<ext>` if this weren't rejected up front.
    form.append(
      "media[0]",
      new File([new Uint8Array([1, 2, 3])], "media-0-a.png", { type: "image/png" }),
    )
    form.append(
      "media[0]",
      new File([new Uint8Array([4, 5, 6, 7, 8, 9])], "media-0-b.png", { type: "image/png" }),
    )
    form.append(
      "mediaMeta",
      new Blob(
        [
          JSON.stringify([
            { kind: "image", mime: "image/png" },
            { kind: "image", mime: "image/png" },
          ]),
        ],
        { type: "application/json" },
      ),
    )
    const res = await fetch(`${BASE_URL}/api/intake/reports`, {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: form,
    })
    expect(res.status).toBe(400)
    // Validation must precede the report insert entirely — not just the
    // media attachment writes.
    const allReports = await db.select().from(reports)
    const allAttachments = await db.select().from(reportAttachments)
    expect(allReports).toHaveLength(0)
    expect(allAttachments).toHaveLength(0)
  })
})
