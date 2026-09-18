import { describe, expect, test } from "bun:test"
import { hasProjectRole } from "./project-role"

describe("hasProjectRole", () => {
  test("ranks owner > developer > manager > viewer, matching the server", () => {
    expect(hasProjectRole("owner", "owner")).toBe(true)
    expect(hasProjectRole("owner", "viewer")).toBe(true)
    expect(hasProjectRole("developer", "owner")).toBe(false)
    expect(hasProjectRole("developer", "developer")).toBe(true)
    expect(hasProjectRole("manager", "developer")).toBe(false)
    expect(hasProjectRole("manager", "manager")).toBe(true)
    expect(hasProjectRole("viewer", "manager")).toBe(false)
    expect(hasProjectRole("viewer", "viewer")).toBe(true)
  })

  test("denies when the role is unknown or not loaded yet", () => {
    expect(hasProjectRole(undefined, "viewer")).toBe(false)
    expect(hasProjectRole(null, "viewer")).toBe(false)
    expect(hasProjectRole("", "viewer")).toBe(false)
    expect(hasProjectRole("admin", "viewer")).toBe(false)
  })
})
