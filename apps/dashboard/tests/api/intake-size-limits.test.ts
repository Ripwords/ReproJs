import { beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import net from "node:net"
import { seedProject, truncateDomain, truncateReports } from "../helpers"

setDefaultTimeout(30_000)

// Regression test for field bug: a report with a video attachment inside the
// client-advertised limits (DEFAULT_ATTACHMENT_LIMITS: 10 MB/file, 25 MB total)
// was rejected with 413. Two ceilings sat below the client limits:
//   - env INTAKE_MAX_BYTES defaulted to 5 MB for the whole multipart request
//   - nuxt-security's requestSizeLimiter (~8 MB multipart) ran before the handler
// The server must accept anything the SDK's own validation allows.
const PK = "rp_pk_sizelimits000000000000001".slice(0, 30)
const ORIGIN = "https://example.com"
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000"

beforeAll(async () => {
  await truncateDomain()
  await truncateReports()
  await seedProject({
    name: "size-limits",
    publicKey: PK,
    allowedOrigins: [ORIGIN],
    createdBy: "test",
  })
})

function reportForm(attachments: { name: string; bytes: number; type: string }[]): FormData {
  const f = new FormData()
  f.append(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title: "video within client limits",
          description: "size regression",
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
  attachments.forEach((a, i) => {
    f.append(`attachment[${i}]`, new File([new Uint8Array(a.bytes)], a.name, { type: a.type }))
  })
  return f
}

// Send a raw HTTP request with a forged Content-Length so we can advertise a
// huge body while only writing a few bytes. `fetch` recomputes Content-Length
// from the actual body and won't let us forge it, so we go down to a TCP
// socket. Before the pre-buffer gate, the handler would call
// readMultipartFormData and block waiting for the (never-arriving) full body —
// the test would time out with status 0. With the gate, the handler rejects on
// the header alone and responds 413 immediately.
function rawForgedRequest(
  path: string,
  forgedContentLength: number,
  timeoutMs = 5000,
): Promise<{ status: number }> {
  const url = new URL(BASE)
  const port = Number(url.port || 80)
  return new Promise((resolve, reject) => {
    const body = "--X\r\n(not a real body)\r\n"
    const socket = net.connect(port, url.hostname, () => {
      const head =
        [
          `POST ${path} HTTP/1.1`,
          `Host: ${url.host}`,
          `Origin: ${ORIGIN}`,
          "Content-Type: multipart/form-data; boundary=X",
          `Content-Length: ${forgedContentLength}`,
          "Connection: close",
          "",
          "",
        ].join("\r\n") + body
      socket.write(head)
    })
    let data = ""
    socket.setTimeout(timeoutMs)
    socket.on("data", (c) => {
      data += c.toString()
    })
    socket.on("timeout", () => {
      socket.destroy()
      resolve({ status: 0 }) // no response arrived — pre-fix behaviour
    })
    socket.on("close", () => {
      const m = data.match(/^HTTP\/1\.1 (\d+)/)
      resolve({ status: m ? Number(m[1]) : 0 })
    })
    socket.on("error", reject)
  })
}

test("forged Content-Length above the ceiling → 413 before buffering the body", async () => {
  const { status } = await rawForgedRequest("/api/intake/reports", 200_000_000)
  expect(status).toBe(413)
})

test("accepts a 9MB video attachment (single file within client limits)", async () => {
  const res = await fetch(`${BASE}/api/intake/reports`, {
    method: "POST",
    body: reportForm([{ name: "clip.mp4", bytes: 9 * 1024 * 1024, type: "video/mp4" }]),
    headers: { Origin: ORIGIN },
  })
  expect(res.status).toBe(201)
})

test("accepts attachments near the 25MB advertised total", async () => {
  const res = await fetch(`${BASE}/api/intake/reports`, {
    method: "POST",
    body: reportForm([
      { name: "clip-a.mp4", bytes: 10 * 1024 * 1024, type: "video/mp4" },
      { name: "clip-b.webm", bytes: 10 * 1024 * 1024, type: "video/webm" },
      { name: "notes.json", bytes: 4 * 1024 * 1024, type: "application/json" },
    ]),
    headers: { Origin: ORIGIN },
  })
  expect(res.status).toBe(201)
})

test("still rejects a request over the raised server ceiling", async () => {
  // Server stays authoritative: a single part over INTAKE_MAX_BYTES (40 MB) is 413.
  const res = await fetch(`${BASE}/api/intake/reports`, {
    method: "POST",
    body: reportForm([{ name: "huge.mp4", bytes: 41 * 1024 * 1024, type: "video/mp4" }]),
    headers: { Origin: ORIGIN },
  })
  expect(res.status).toBe(413)
})
