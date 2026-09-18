import { describe, expect, test } from "bun:test"
import { installLinkFor } from "./install-link"

describe("installLinkFor", () => {
  test("admins get the full install guide", () => {
    expect(installLinkFor(true, "p1")).toEqual({
      to: "/settings/install",
      label: "View install instructions",
    })
  })

  test("everyone else gets the project's own embed snippet, which they can open", () => {
    expect(installLinkFor(false, "p1")).toEqual({
      to: "/projects/p1/settings?tab=security",
      label: "View embed snippet",
    })
  })
})
