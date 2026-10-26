import { setup } from "../nuxt-setup"
import { afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { reportAttachments } from "../../server/db/schema"
import { createUser, seedProject, truncateDomain, truncateReports } from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(15000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_ATTCHTEST1234567890abcde"
const ORIGIN = "https://example.com"

async function postReportWithFiles(
  files: { name: string; type: string; bytes: Uint8Array }[],
): Promise<{ res: Response; reportId: string | null }> {
  const form = new FormData()
  form.append(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title: "with files",
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
    ),
  )
  files.forEach((f, i) => {
    form.append(`attachment[${i}]`, new File([f.bytes], f.name, { type: f.type }))
  })
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

describe("POST /api/intake/reports — user attachments", () => {
  beforeAll(async () => {
    // Hard-reset users/projects so re-runs against a non-truncated DB don't
    // collide on the admin email's unique constraint.
    await truncateDomain()
    const admin = await createUser("attch-admin@example.com", "admin")
    await seedProject({
      name: "Attachment Test Project",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
  })

  afterEach(async () => {
    await truncateReports()
  })

  // Use a separate afterAll-level teardown to not interfere with the project seed
  // We only truncate domain (users/projects) at end of entire suite.

  test("accepts up to 5 user files and persists them as kind='user-file'", async () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      name: `file-${i}.png`,
      type: "image/png",
      bytes: new Uint8Array([i + 1, 2, 3, 4]),
    }))
    const { res, reportId } = await postReportWithFiles(files)
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    const userFiles = rows.filter((r) => r.kind === "user-file")
    expect(userFiles).toHaveLength(5)
    expect(userFiles.map((r) => r.filename).toSorted()).toEqual([
      "file-0.png",
      "file-1.png",
      "file-2.png",
      "file-3.png",
      "file-4.png",
    ])
    expect(userFiles.every((r) => r.storageKey.includes("/user/"))).toBe(true)
  })

  test("rejects when more than 5 files are sent", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({
      name: `f${i}.png`,
      type: "image/png",
      bytes: new Uint8Array([1]),
    }))
    const { res } = await postReportWithFiles(files)
    expect(res.status).toBe(413)
  })

  test("rejects per-file > cap", async () => {
    const big = new Uint8Array(11 * 1024 * 1024)
    const { res } = await postReportWithFiles([{ name: "big.png", type: "image/png", bytes: big }])
    expect(res.status).toBe(413)
  })

  test("rejects denylisted mime", async () => {
    const { res } = await postReportWithFiles([
      { name: "evil.exe", type: "application/x-msdownload", bytes: new Uint8Array([1]) },
    ])
    expect(res.status).toBe(415)
  })

  test("sanitizes filenames", async () => {
    const { res, reportId } = await postReportWithFiles([
      { name: "../../etc/passwd", type: "text/plain", bytes: new Uint8Array([1, 2, 3]) },
    ])
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    const userFile = rows.find((r) => r.kind === "user-file")
    expect(userFile?.filename).toBe("etcpasswd")
    expect(userFile?.storageKey.endsWith("/user/0-etcpasswd")).toBe(true)
  })

  // Note: virus-scan behavior (clean / infected / fail-closed / disabled) is
  // covered by the unit-tests in `apps/dashboard/server/lib/clamav.test.ts`.
  // It cannot be driven from this integration suite because the helper hits
  // a separately-running `bun run dev` server: env mutations and
  // _setClientForTesting() calls in the test process don't reach it.

  test("intake without attachment[N] parts behaves identically to today (regression guard)", async () => {
    const { res, reportId } = await postReportWithFiles([])
    expect(res.status).toBe(201)
    expect(reportId).toBeString()
    const rows = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, reportId as string))
    expect(rows.filter((r) => r.kind === "user-file")).toHaveLength(0)
  })
})
