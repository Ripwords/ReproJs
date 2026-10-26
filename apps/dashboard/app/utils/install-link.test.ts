import { describe, expect, test } from "bun:test"
import { installLinkFor } from "./install-link"

describe("installLinkFor", () => {
  test("admins get the full install guide, preselected on this project", () => {
    expect(installLinkFor(true, "p1")).toEqual({
      to: "/settings/install?project=p1",
      label: "View install instructions",
    })
  })

  test("everyone else gets the project's own embed snippet, which they can open", () => {
    expect(installLinkFor(false, "p1")).toEqual({
      to: "/projects/p1/settings?tab=security",
      label: "View embed snippet",
    })
  })

  test("project ids are URL-encoded in both links", () => {
    expect(installLinkFor(true, "a b").to).toBe("/settings/install?project=a%20b")
    expect(installLinkFor(false, "a b").to).toBe("/projects/a%20b/settings?tab=security")
  })
})
