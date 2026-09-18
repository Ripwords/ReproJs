import { describe, expect, test } from "bun:test"
import { installRoleChangeConfirm, projectRoleChangeConfirm } from "./role-change-confirm"

describe("installRoleChangeConfirm", () => {
  test("promoting to admin spells out that admins own every project", () => {
    const o = installRoleChangeConfirm({ email: "a@x.io", to: "admin", isSelf: false })
    expect(o.title).toBe("Make a@x.io an admin?")
    expect(o.description).toContain("owner of every project")
    expect(o.confirmLabel).toBe("Make admin")
    expect(o.confirmColor).toBe("warning")
  })

  test("demoting yourself warns that only another admin can undo it", () => {
    const o = installRoleChangeConfirm({ email: "me@x.io", to: "member", isSelf: true })
    expect(o.title).toBe("Remove your own admin access?")
    expect(o.description).toContain("Only another admin can give it back")
    expect(o.confirmColor).toBe("error")
  })

  test("demoting someone else says what they keep", () => {
    const o = installRoleChangeConfirm({ email: "b@x.io", to: "member", isSelf: false })
    expect(o.title).toBe("Remove admin access from b@x.io?")
    expect(o.description).toContain("projects they're a member of")
    expect(o.confirmLabel).toBe("Change to member")
  })
})

describe("projectRoleChangeConfirm", () => {
  test("names the person, the new role and what that role can do", () => {
    const o = projectRoleChangeConfirm({
      email: "c@x.io",
      to: "viewer",
      isSelf: false,
      selfIsAdmin: false,
    })
    expect(o.title).toBe("Change c@x.io to viewer?")
    expect(o.description).toContain("read reports")
    expect(o.confirmLabel).toBe("Change role")
  })

  test("promoting to owner calls out member and settings control", () => {
    const o = projectRoleChangeConfirm({
      email: "c@x.io",
      to: "owner",
      isSelf: false,
      selfIsAdmin: false,
    })
    expect(o.title).toBe("Make c@x.io an owner?")
    expect(o.description).toContain("manage members")
    expect(o.confirmColor).toBe("warning")
  })

  test("an owner demoting themselves is told they lose control of the project", () => {
    const o = projectRoleChangeConfirm({
      email: "me@x.io",
      to: "developer",
      isSelf: true,
      selfIsAdmin: false,
    })
    expect(o.title).toBe("Change your own role to developer?")
    expect(o.description).toContain("no longer be able to manage members")
    expect(o.description).toContain("Only another owner can give it back")
    expect(o.confirmColor).toBe("error")
  })

  test("an install admin changing their own row keeps owner access, and is told so", () => {
    const o = projectRoleChangeConfirm({
      email: "me@x.io",
      to: "viewer",
      isSelf: true,
      selfIsAdmin: true,
    })
    expect(o.title).toBe("Change your own role to viewer?")
    expect(o.description).toContain("install admin")
    expect(o.confirmColor).toBe("primary")
  })
})
