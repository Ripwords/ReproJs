import { expect, test } from "@playwright/test"
import type { CDPSession, Page } from "@playwright/test"
import type { IncomingMessage, ServerResponse } from "node:http"
import { attrOf, click, hasClass, textOf, waitForButton, waitForNode } from "./cdp"
import { launch, type Harness } from "./harness"

// The per-origin "Show 'Related GitHub issue' field" toggle, end to end:
// extension storage → service worker → __REPRO_CONFIG__ → Repro.init
// fields.relatedIssue → the widget's Details step → the proxied intake POST.
// The intake endpoint is the fixture server, so the assertion is on the
// multipart body the dashboard would actually receive.

const RELATED_PLACEHOLDER = "#123 or issue URL"
const TITLE_PLACEHOLDER = "What went wrong?"

type IntakeCapture = {
  requests: Array<{ viaProxy: boolean; report: Record<string, unknown> }>
  handler: (req: IncomingMessage, res: ServerResponse) => boolean
}

/** Pulls the JSON out of the `report` part of the multipart intake body. The
 * SDK sends it as a Blob part (see packages/core/src/intake-client.ts), so
 * the part has its own headers followed by a blank line and the payload. */
function extractReportPart(body: string): Record<string, unknown> {
  const match = /name="report"[^]*?\r\n\r\n([^]*?)\r\n--/.exec(body)
  if (!match?.[1]) throw new Error(`no "report" part in intake body:\n${body.slice(0, 500)}`)
  return JSON.parse(match[1]) as Record<string, unknown>
}

function captureIntake(): IntakeCapture {
  const requests: IntakeCapture["requests"] = []
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url?.startsWith("/api/intake/")) return false
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      requests.push({
        viaProxy: typeof req.headers["x-repro-origin"] === "string",
        report: extractReportPart(body),
      })
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ id: "11111111-2222-4333-8444-555555555555" }))
    })
    return true
  }
  return { requests, handler }
}

async function openReportForm(h: Harness): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await h.context.newPage()
  const cdp = await h.context.newCDPSession(page)
  await cdp.send("DOM.enable")
  await page.goto(h.testOrigin)
  await expect(page.locator("#repro-host")).toBeAttached({ timeout: 10_000 })

  const launcher = await waitForNode(cdp, (n) => hasClass(n, "ft-launcher"), {
    label: "launcher button",
  })
  await click(cdp, page, launcher)
  const reportRow = await waitForNode(
    cdp,
    (n, all) => hasClass(n, "ft-menu-row") && textOf(all, n).includes("Report bug"),
    { label: "Report bug menu row" },
  )
  await click(cdp, page, reportRow)
  await waitForNode(cdp, (n) => attrOf(n, "placeholder") === TITLE_PLACEHOLDER, {
    label: "title input",
  })
  return { page, cdp }
}

async function typeInto(cdp: CDPSession, page: Page, placeholder: string, text: string) {
  const input = await waitForNode(cdp, (n) => attrOf(n, "placeholder") === placeholder, {
    label: `input "${placeholder}"`,
  })
  await click(cdp, page, input)
  await page.keyboard.type(text)
}

test("a tester's related-issue reference travels with the proxied report", async () => {
  test.setTimeout(60_000)
  const intake = captureIntake()
  const h = await launch({ handler: intake.handler })
  try {
    await h.configure({ intakeEndpoint: h.testOrigin, relatedIssueField: true })
    const { page, cdp } = await openReportForm(h)

    await typeInto(cdp, page, TITLE_PLACEHOLDER, "Login button unresponsive again")
    // A typo first: a pull-request link is not an issue reference, so the
    // widget must refuse to continue and say why — without asking GitHub.
    await typeInto(cdp, page, RELATED_PLACEHOLDER, "https://github.com/acme/app/pull/42")
    await waitForNode(cdp, (n) => hasClass(n, "ft-field-error"), { label: "inline hint" })
    expect(attrOf(await waitForButton(cdp, "Continue"), "disabled")).toBeDefined()
    await page.screenshot({ path: test.info().outputPath("details-invalid.png") })

    // Fix it to the shorthand testers actually type.
    await page.keyboard.press("ControlOrMeta+A")
    await page.keyboard.type("#42")
    const cont = await waitForNode(
      cdp,
      (n, all) =>
        n.nodeName === "BUTTON" &&
        textOf(all, n).trim() === "Continue" &&
        attrOf(n, "disabled") === undefined,
      { label: "Continue enabled" },
    )
    await page.screenshot({ path: test.info().outputPath("details-filled.png") })
    await click(cdp, page, cont)

    // Review step lists the reference as a summary line. Text is read from
    // the same DOM snapshot the node came from — CDP node ids are not
    // guaranteed stable across getFlattenedDocument calls.
    await waitForNode(
      cdp,
      (n, all) => {
        if (!hasClass(n, "ft-summary")) return false
        const text = textOf(all, n)
        return text.includes("Related issue") && text.includes("#42")
      },
      { label: 'summary line "Related issue · #42"' },
    )
    await page.screenshot({ path: test.info().outputPath("review.png") })

    await click(cdp, page, await waitForButton(cdp, "Send report"))
    await expect.poll(() => intake.requests.length, { timeout: 20_000 }).toBe(1)
    await page.screenshot({ path: test.info().outputPath("sent.png") })

    const [req] = intake.requests
    expect(req?.viaProxy).toBe(true)
    expect(req?.report.title).toBe("Login button unresponsive again")
    expect(req?.report.relatedIssue).toBe("#42")
    expect(req?.report.projectKey).toBe("rp_pk_" + "a".repeat(24))
  } finally {
    await h.close()
  }
})

test("with the toggle off the widget has no related-issue field and sends no hint", async () => {
  test.setTimeout(60_000)
  const intake = captureIntake()
  const h = await launch({ handler: intake.handler })
  try {
    await h.configure({ intakeEndpoint: h.testOrigin, relatedIssueField: false })
    const { page, cdp } = await openReportForm(h)

    const nodes = await cdp
      .send("DOM.getFlattenedDocument", { depth: -1, pierce: true })
      .then((d) => d.nodes)
    expect(nodes.some((n) => attrOf(n, "placeholder") === RELATED_PLACEHOLDER)).toBe(false)
    const form = nodes.find((n) => hasClass(n, "ft-wizard-details-form"))
    if (!form) throw new Error("details form not found")
    expect(textOf(nodes, form)).not.toContain("Related GitHub issue")
    await page.screenshot({ path: test.info().outputPath("details-no-field.png") })

    await typeInto(cdp, page, TITLE_PLACEHOLDER, "Plain report")
    await click(cdp, page, await waitForButton(cdp, "Continue"))
    await click(cdp, page, await waitForButton(cdp, "Send report"))
    await expect.poll(() => intake.requests.length, { timeout: 20_000 }).toBe(1)

    const [req] = intake.requests
    expect(req?.report.title).toBe("Plain report")
    expect("relatedIssue" in (req?.report ?? {})).toBe(false)
  } finally {
    await h.close()
  }
})
