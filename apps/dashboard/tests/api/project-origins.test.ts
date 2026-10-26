// Regression tests for audit 2026-10-26 §4 high #1: the allow-list was an
// exact string compare against whatever the owner typed, while browsers send
// a canonical `Origin` (lower-case, no trailing slash, no path). A project
// configured as "https://App.Example.com/" rejected every real report.
import { setup } from "../nuxt-setup"
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { ProjectDTO } from "@reprojs/shared"
import {
  apiFetch,
  createUser,
  makePngBlob,
  seedProject,
  signIn,
  truncateDomain,
  truncateReports,
} from "../helpers"

await setup({ server: true, port: 3000, host: "localhost" })
setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"
const PK = "rp_pk_ORIGINS1234567890abcdef0"

function reportForm(): FormData {
  const fd = new FormData()
  fd.set(
    "report",
    new Blob(
      [
        JSON.stringify({
          projectKey: PK,
          title: "origin check",
          description: "d",
          context: {
            pageUrl: "https://app.example.com/p",
            userAgent: "UA",
            viewport: { w: 1000, h: 800 },
            timestamp: new Date().toISOString(),
          },
          _dwellMs: 2000,
        }),
      ],
      { type: "application/json" },
    ),
  )
  fd.set("screenshot", makePngBlob(), "s.png")
  return fd
}

async function postIntake(origin: string) {
  return fetch(`${BASE_URL}/api/intake/reports`, {
    method: "POST",
    headers: { Origin: origin },
    body: reportForm(),
  })
}

describe("allowed origins", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("PATCH stores canonical origins and rejects entries without a host", async () => {
    const admin = await createUser("admin-origins@example.com", "admin")
    const pid = await seedProject({ name: "o", publicKey: PK, createdBy: admin })
    const cookie = await signIn("admin-origins@example.com")

    const ok = await apiFetch<ProjectDTO>(`/api/projects/${pid}`, {
      method: "PATCH",
      headers: { cookie },
      body: {
        allowedOrigins: [
          "HTTPS://App.Example.com/dashboard/",
          "https://app.example.com:443",
          "http://localhost:4000/",
        ],
      },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.allowedOrigins).toEqual([
      "https://app.example.com",
      "https://app.example.com",
      "http://localhost:4000",
    ])

    const bad = await apiFetch(`/api/projects/${pid}`, {
      method: "PATCH",
      headers: { cookie },
      body: { allowedOrigins: ["app.example.com"] },
    })
    expect(bad.status).toBe(400)
  })

  test("intake accepts a browser Origin against a legacy un-normalised allow-list entry", async () => {
    const admin = await createUser("admin-origins2@example.com", "admin")
    // Written directly, bypassing the PATCH normalisation — the shape existing
    // installs have in the database today.
    await seedProject({
      name: "o",
      publicKey: PK,
      allowedOrigins: ["https://App.Example.com/"],
      createdBy: admin,
    })

    const accepted = await postIntake("https://app.example.com")
    expect(accepted.status).toBe(201)
    expect(accepted.headers.get("access-control-allow-origin")).toBe("https://app.example.com")

    // Still exact: a different host or scheme is not a match.
    expect((await postIntake("https://evil.example.com")).status).toBe(403)
    expect((await postIntake("http://app.example.com")).status).toBe(403)
  })
})
