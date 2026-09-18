import { describe, expect, test } from "bun:test"
import { emailDomain, isEmailDomainOnAllowlist } from "./email-domain"

describe("isEmailDomainOnAllowlist", () => {
  test("an empty allowlist allows every domain", () => {
    expect(isEmailDomainOnAllowlist("anyone@anywhere.io", [])).toBe(true)
  })

  test("allows a listed domain and refuses an unlisted one", () => {
    expect(isEmailDomainOnAllowlist("alice@work.com", ["work.com"])).toBe(true)
    expect(isEmailDomainOnAllowlist("alice@personal.com", ["work.com"])).toBe(false)
  })

  test("compares the domain case-insensitively", () => {
    expect(isEmailDomainOnAllowlist("Alice@WORK.com", ["work.com"])).toBe(true)
  })

  test("does not treat a subdomain as the listed domain", () => {
    expect(isEmailDomainOnAllowlist("alice@eu.work.com", ["work.com"])).toBe(false)
  })

  test("refuses an address with no domain", () => {
    expect(emailDomain("no-at-sign")).toBe("")
    expect(isEmailDomainOnAllowlist("no-at-sign", ["work.com"])).toBe(false)
  })
})
