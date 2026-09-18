import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { eq } from "drizzle-orm"
import { db } from "../../server/db"
import { appSettings } from "../../server/db/schema"
import { createUser, signIn, truncateDomain } from "../helpers"

setDefaultTimeout(30000)

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000"

// The Access page has to describe the rules sign-in actually enforces
// (server/lib/auth.ts): the domain allowlist applies whether or not the
// sign-up gate is on, and the gate requires an invite even for an allowlisted
// domain. It used to say the opposite of both, so admins configured it one
// way and users were refused another.
describe("/settings/access", () => {
  afterEach(async () => {
    await db
      .update(appSettings)
      .set({ signupGated: false, allowedEmailDomains: [] })
      .where(eq(appSettings.id, 1))
    await truncateDomain()
  })

  test("with the gate off, the allowlist is shown as enforced and stays editable", async () => {
    await db
      .update(appSettings)
      .set({ signupGated: false, allowedEmailDomains: ["example.com"] })
      .where(eq(appSettings.id, 1))
    await createUser("admin@example.com", "admin")
    const cookie = await signIn("admin@example.com")

    const res = await fetch(`${BASE_URL}/settings/access`, { headers: { cookie } })
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).not.toContain("Ignored while the gate is off")
    expect(html).not.toContain("bypass the invite requirement")
    expect(html).toContain("whether or not the sign-up gate is on")
    const textarea = html.match(/<textarea[^>]*>/)?.[0] ?? ""
    expect(textarea).not.toBe("")
    // The bare attribute, not the `disabled:` Tailwind variants in its class list.
    expect(textarea).not.toMatch(/\sdisabled[\s>]/)
  })
})
