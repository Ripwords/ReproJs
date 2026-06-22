// apps/dashboard/tests/lib/github-helpers.test.ts
import { describe, expect, test } from "bun:test"
import {
  buildIssueBody,
  computeBackoff,
  GITHUB_EMBED_SCREENSHOT_TTL_SECONDS,
  labelsFor,
} from "../../server/lib/github-helpers"
import {
  buildSignedAttachmentUrl,
  verifyAttachmentToken,
} from "../../server/lib/signed-attachment-url"

describe("GITHUB_EMBED_SCREENSHOT_TTL_SECONDS", () => {
  const FIFTY_YEARS_SECONDS = 50 * 365 * 24 * 60 * 60

  test("is effectively permanent (GitHub issues never expire)", () => {
    // Regression: a 7-day TTL meant every issue older than a week rendered a
    // broken image once GitHub's Camo proxy re-fetched the screenshot.
    expect(GITHUB_EMBED_SCREENSHOT_TTL_SECONDS).toBeGreaterThanOrEqual(FIFTY_YEARS_SECONDS)
  })

  test("a token minted with it stays valid far beyond the old 7-day window", () => {
    const SECRET = "test-secret-0123456789abcdef"
    const url = buildSignedAttachmentUrl({
      baseUrl: "https://dash.example.com",
      projectId: "p1",
      reportId: "r1",
      kind: "screenshot",
      secret: SECRET,
      ttlSeconds: GITHUB_EMBED_SCREENSHOT_TTL_SECONDS,
    })
    const expiresAt = Number(new URL(url).searchParams.get("expires"))
    const token = new URL(url).searchParams.get("token") ?? ""

    // Expiry must land well past a week from now.
    const eightDays = Math.floor(Date.now() / 1000) + 8 * 24 * 60 * 60
    expect(expiresAt).toBeGreaterThan(eightDays)

    expect(
      verifyAttachmentToken({
        secret: SECRET,
        projectId: "p1",
        reportId: "r1",
        kind: "screenshot",
        expiresAt,
        token,
      }),
    ).toBe(true)
  })
})

describe("computeBackoff", () => {
  test("attempt 1 → 10 seconds", () => {
    expect(computeBackoff(1)).toBe(10_000)
  })
  test("attempt 2 → 30 seconds", () => {
    expect(computeBackoff(2)).toBe(30_000)
  })
  test("attempt 3 → 2 minutes", () => {
    expect(computeBackoff(3)).toBe(120_000)
  })
  test("attempt 4 → 10 minutes", () => {
    expect(computeBackoff(4)).toBe(600_000)
  })
  test("attempt 5 → 1 hour", () => {
    expect(computeBackoff(5)).toBe(3_600_000)
  })
  test("attempts > 5 cap at 1 hour", () => {
    expect(computeBackoff(99)).toBe(3_600_000)
  })
  test("attempts < 1 treated as 1", () => {
    expect(computeBackoff(0)).toBe(10_000)
  })
})

describe("labelsFor", () => {
  test("combines defaults + priority prefix + tags verbatim, sorted", () => {
    const result = labelsFor(
      { priority: "urgent", tags: ["mobile", "checkout"] },
      { defaultLabels: ["feedback", "needs-triage"] },
    )
    expect(result).toEqual(["checkout", "feedback", "mobile", "needs-triage", "priority:urgent"])
  })
  test("dedupes when a tag clashes with a default label", () => {
    expect(
      labelsFor({ priority: "normal", tags: ["feedback"] }, { defaultLabels: ["feedback"] }),
    ).toEqual(["feedback", "priority:normal"])
  })
  test("empty tags + empty defaults still includes priority", () => {
    expect(labelsFor({ priority: "low", tags: [] }, { defaultLabels: [] })).toEqual([
      "priority:low",
    ])
  })
})

describe("buildIssueBody", () => {
  const minimal = {
    id: "rid1",
    title: "Checkout crash",
    description: "it crashed on pay",
    pageUrl: "https://app.example.com/checkout",
    reporterEmail: "reporter@example.com",
    createdAt: new Date("2026-04-18T10:42:00Z"),
    screenshotUrl:
      "https://dash.example.com/api/projects/p1/reports/rid1/attachment?kind=screenshot&token=abc&expires=1",
    dashboardUrl: "https://dash.example.com/projects/p1/reports/rid1",
  }

  test("full body contains reporter, page, description, screenshot, footer", () => {
    const body = buildIssueBody(minimal)
    expect(body).toContain("reporter@example.com")
    expect(body).toContain("https://app.example.com/checkout")
    expect(body).toContain("it crashed on pay")
    expect(body).toContain("![Screenshot]")
    expect(body).toContain(minimal.screenshotUrl)
    expect(body).toContain(minimal.dashboardUrl)
  })
  test("no reporter → 'anonymous'", () => {
    const body = buildIssueBody({ ...minimal, reporterEmail: null })
    expect(body).toContain("anonymous")
    expect(body).not.toContain("**anonymous**")
  })
  test("no screenshot → no img tag", () => {
    const body = buildIssueBody({ ...minimal, screenshotUrl: null })
    expect(body).not.toContain("![Screenshot]")
  })
  test("no pageUrl → page line omitted", () => {
    const body = buildIssueBody({ ...minimal, pageUrl: "" })
    expect(body).not.toContain("Page:")
  })
  test("description empty string renders empty description section header", () => {
    const body = buildIssueBody({ ...minimal, description: "" })
    expect(body).toContain("## Description")
  })
})
