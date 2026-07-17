import { test, expect } from "bun:test"
import {
  ReportContext,
  ReportSource,
  DevicePlatform,
  SystemInfo,
  ReportIntakeInput,
  ReportSummaryDTO,
  AttachmentKind,
  AttachmentDTO,
} from "./index"

test("ReportSource accepts web and expo", () => {
  expect(ReportSource.parse("web")).toBe("web")
  expect(ReportSource.parse("expo")).toBe("expo")
  expect(ReportSource.safeParse("android").success).toBe(false)
})

test("DevicePlatform accepts ios and android only", () => {
  expect(DevicePlatform.parse("ios")).toBe("ios")
  expect(DevicePlatform.parse("android")).toBe("android")
  expect(DevicePlatform.safeParse("web").success).toBe(false)
})

test("ReportContext.source defaults to web for backward compat", () => {
  const parsed = ReportContext.parse({
    pageUrl: "https://example.com/app",
    userAgent: "Mozilla/5.0",
    viewport: { w: 1024, h: 768 },
    timestamp: "2026-04-20T00:00:00Z",
  })
  expect(parsed.source).toBe("web")
})

test("ReportContext accepts source=expo", () => {
  const parsed = ReportContext.parse({
    source: "expo",
    pageUrl: "myapp://home/profile",
    userAgent: "Expo/53",
    viewport: { w: 390, h: 844 },
    timestamp: "2026-04-20T00:00:00Z",
  })
  expect(parsed.source).toBe("expo")
})

test("ReportContext.pageUrl accepts non-http schemes (mobile routes)", () => {
  const parsed = ReportContext.parse({
    source: "expo",
    pageUrl: "myapp://settings/profile",
    userAgent: "Expo/53",
    viewport: { w: 390, h: 844 },
    timestamp: "2026-04-20T00:00:00Z",
  })
  expect(parsed.pageUrl).toBe("myapp://settings/profile")
})

test("SystemInfo accepts optional mobile device fields", () => {
  const parsed = SystemInfo.parse({
    userAgent: "Expo/53",
    platform: "ios",
    devicePlatform: "ios",
    appVersion: "1.2.3",
    appBuild: "42",
    deviceModel: "iPhone 15",
    osVersion: "17.4",
    language: "en-US",
    timezone: "UTC",
    timezoneOffset: 0,
    viewport: { w: 390, h: 844 },
    screen: { w: 390, h: 844 },
    dpr: 3,
    online: true,
    pageUrl: "myapp://home",
    timestamp: "2026-04-20T00:00:00Z",
  })
  expect(parsed.devicePlatform).toBe("ios")
  expect(parsed.appVersion).toBe("1.2.3")
  expect(parsed.deviceModel).toBe("iPhone 15")
})

test("SystemInfo works unchanged for web (no new fields required)", () => {
  const parsed = SystemInfo.parse({
    userAgent: "Mozilla/5.0",
    platform: "MacIntel",
    language: "en-US",
    timezone: "UTC",
    timezoneOffset: 0,
    viewport: { w: 1024, h: 768 },
    screen: { w: 1920, h: 1080 },
    dpr: 2,
    online: true,
    pageUrl: "https://example.com",
    timestamp: "2026-04-20T00:00:00Z",
  })
  expect(parsed.devicePlatform).toBeUndefined()
  expect(parsed.appVersion).toBeUndefined()
})

test("ReportIntakeInput preserves backward compatibility (no source supplied)", () => {
  const parsed = ReportIntakeInput.parse({
    projectKey: "rp_pk_" + "a".repeat(24),
    title: "Bug",
    context: {
      pageUrl: "https://example.com",
      userAgent: "Mozilla/5.0",
      viewport: { w: 1024, h: 768 },
      timestamp: "2026-04-20T00:00:00Z",
    },
  })
  expect(parsed.context.source).toBe("web")
})

test("ReportSummaryDTO requires source and allows nullable devicePlatform", () => {
  const base = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "t",
    description: null,
    context: {
      source: "web" as const,
      pageUrl: "https://x",
      userAgent: "u",
      viewport: { w: 1, h: 1 },
      timestamp: "2026-04-20T00:00:00Z",
    },
    reporterEmail: null,
    pageUrl: "https://x",
    thumbnailUrl: null,
    hasReplay: false,
    receivedAt: "2026-04-20T00:00:00Z",
    updatedAt: "2026-04-20T00:00:00Z",
    status: "open" as const,
    priority: "normal" as const,
    tags: [],
    githubIssueNumber: null,
    githubIssueUrl: null,
    assignees: [],
    milestoneNumber: null,
    milestoneTitle: null,
  }

  const web = ReportSummaryDTO.parse({ ...base, source: "web", devicePlatform: null })
  expect(web.source).toBe("web")
  expect(web.devicePlatform).toBeNull()

  const ios = ReportSummaryDTO.parse({ ...base, source: "expo", devicePlatform: "ios" })
  expect(ios.source).toBe("expo")
  expect(ios.devicePlatform).toBe("ios")

  const missing = ReportSummaryDTO.safeParse({ ...base })
  expect(missing.success).toBe(false)
})

test("AttachmentKind accepts user-file", () => {
  expect(AttachmentKind.safeParse("user-file").success).toBe(true)
  expect(AttachmentKind.safeParse("screenshot").success).toBe(true)
  expect(AttachmentKind.safeParse("unknown-kind").success).toBe(false)
})

test("AttachmentDTO.filename accepts string and null", () => {
  const base = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    kind: "user-file" as const,
    url: "/api/projects/p/reports/r/attachment?id=550e8400-e29b-41d4-a716-446655440000",
    contentType: "application/pdf",
    sizeBytes: 12345,
    scannedAt: null,
    scanStatus: null,
    scanEngine: null,
    scanDurationMs: null,
    durationMs: null,
    trimStartMs: null,
    trimEndMs: null,
  }

  const withFilename = AttachmentDTO.parse({ ...base, filename: "report.pdf" })
  expect(withFilename.filename).toBe("report.pdf")
  expect(withFilename.kind).toBe("user-file")

  const withNull = AttachmentDTO.parse({ ...base, filename: null })
  expect(withNull.filename).toBeNull()
})

test("AttachmentDTO.scan* fields accept clean-scan metadata", () => {
  const parsed = AttachmentDTO.parse({
    id: "550e8400-e29b-41d4-a716-446655440000",
    kind: "user-file" as const,
    url: "/x",
    contentType: "application/pdf",
    sizeBytes: 12345,
    filename: "report.pdf",
    scannedAt: "2026-04-28T10:00:00.000Z",
    scanStatus: "clean",
    scanEngine: "ClamAV",
    scanDurationMs: 23,
    durationMs: null,
    trimStartMs: null,
    trimEndMs: null,
  })
  expect(parsed.scanStatus).toBe("clean")
  expect(parsed.scanEngine).toBe("ClamAV")
  expect(parsed.scanDurationMs).toBe(23)
})
