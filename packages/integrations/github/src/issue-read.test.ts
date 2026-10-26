// packages/integrations/github/src/issue-read.test.ts
//
// The issue picker forwards manager-typed text into a GitHub Search query
// that is pinned to the project's repo with `repo:owner/name`. The search
// grammar (advanced_search) lets OR/AND/NOT, parentheses and qualifiers
// change precedence, so untrusted text could widen the query to every repo
// the installation can see. These tests pin the sanitiser and the result
// scope filter that close that hole.
import { describe, expect, test } from "bun:test"
import type { Octokit } from "@octokit/rest"
import { isInRepo, listIssues, sanitizeSearchText } from "./issue-read"

describe("sanitizeSearchText", () => {
  test("keeps ordinary words and numbers", () => {
    expect(sanitizeSearchText("checkout button 42")).toBe("checkout button 42")
  })

  test("drops boolean operators as whole words, any case", () => {
    expect(sanitizeSearchText("safari OR repo:acme/other")).toBe("safari repo acme/other")
    expect(sanitizeSearchText("a and b Not c")).toBe("a b c")
    expect(sanitizeSearchText("(ORANGE) NOTE")).toBe("ORANGE NOTE")
  })

  test("strips grouping, escaping, quoting and qualifier syntax", () => {
    expect(sanitizeSearchText('(label:"bug") OR \\ -is:closed')).toBe("label bug is closed")
  })

  test("collapses whitespace and handles empty input", () => {
    expect(sanitizeSearchText("   ")).toBe("")
    expect(sanitizeSearchText("  a   b  ")).toBe("a b")
  })
})

describe("isInRepo", () => {
  test("matches the repository_url for the pinned repo, case-insensitively", () => {
    expect(isInRepo("https://api.github.com/repos/Acme/Frontend", "acme", "frontend")).toBe(true)
    expect(isInRepo("https://api.github.com/repos/acme/frontend-v2", "acme", "frontend")).toBe(
      false,
    )
    expect(isInRepo("https://api.github.com/repos/other/frontend", "acme", "frontend")).toBe(false)
    expect(isInRepo(undefined, "acme", "frontend")).toBe(false)
  })
})

const issue = (n: number, repoUrl: string, extra: Record<string, unknown> = {}) => ({
  number: n,
  node_id: `N${n}`,
  title: `Issue ${n}`,
  state: "open",
  html_url: `${repoUrl}/issues/${n}`,
  labels: [],
  updated_at: "2026-10-20T10:00:00Z",
  repository_url: repoUrl,
  ...extra,
})

describe("listIssues search scope", () => {
  function fakeOctokit(items: unknown[]) {
    const seen: { q?: string } = {}
    const octokit = {
      rest: {
        issues: { listForRepo: async () => ({ data: [] }) },
        search: {
          issuesAndPullRequests: async (args: { q: string }) => {
            seen.q = args.q
            return { data: { items } }
          },
        },
      },
    } as unknown as Octokit
    return { octokit, seen }
  }

  test("sanitises the query and drops results from other repos and pull requests", async () => {
    const { octokit, seen } = fakeOctokit([
      issue(1, "https://api.github.com/repos/acme/frontend"),
      issue(2, "https://api.github.com/repos/acme/secret-repo"),
      issue(3, "https://api.github.com/repos/acme/frontend", { pull_request: { url: "x" } }),
    ])
    const out = await listIssues(octokit, {
      owner: "acme",
      repo: "frontend",
      q: "login) OR repo:acme/secret-repo",
    })
    // `-` is also dropped: it is the negation prefix (`-is:closed`).
    expect(seen.q).toBe("repo:acme/frontend is:issue is:open login repo acme/secret repo")
    expect(out.map((i) => i.number)).toEqual([1])
  })
})
