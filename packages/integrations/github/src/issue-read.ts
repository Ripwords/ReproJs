// packages/integrations/github/src/issue-read.ts
// Read-only lookups used by the dashboard's "attach report to an existing
// issue" flow: verify one issue before linking, and list/search issues for
// the picker. Pull requests share the issues endpoint on GitHub; both helpers
// drop them because a report can only be attached to an issue.
import type { Octokit } from "@octokit/rest"

export type IssueSummary = {
  number: number
  nodeId: string
  title: string
  state: "open" | "closed"
  url: string
  labels: string[]
  updatedAt: string
}

export type ListIssuesInput = {
  owner: string
  repo: string
  state?: "open" | "closed" | "all"
  /** Free-text search; when set the Search API is used instead of the list endpoint. */
  q?: string
  page?: number
  perPage?: number
}

type RawLabel = string | { name?: string | null }

function labelNames(labels: readonly RawLabel[] | undefined): string[] {
  return (labels ?? [])
    .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
    .filter((name) => name.length > 0)
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: unknown }).status === 404
  )
}

/**
 * Fetch one issue. Returns null when the number does not exist in the repo
 * or names a pull request, so callers treat both the same way (404).
 */
export async function getIssueSummary(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueSummary | null> {
  let data
  try {
    const res = await client.rest.issues.get({ owner, repo, issue_number: issueNumber })
    data = res.data
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  if (data.pull_request) return null
  return {
    number: data.number,
    nodeId: data.node_id,
    title: data.title,
    state: data.state === "closed" ? "closed" : "open",
    url: data.html_url,
    labels: labelNames(data.labels),
    updatedAt: data.updated_at,
  }
}

const SEARCH_QUALIFIER = /[:"]/g

/**
 * List issues for the picker. Without `q` this pages through
 * `issues.listForRepo` (newest first); with `q` it runs a repo-scoped
 * `is:issue` search so matching works on title and body.
 */
export async function listIssues(client: Octokit, input: ListIssuesInput): Promise<IssueSummary[]> {
  const state = input.state ?? "open"
  const page = input.page ?? 1
  const perPage = input.perPage ?? 30
  const q = input.q?.trim() ?? ""

  if (q.length === 0) {
    const res = await client.rest.issues.listForRepo({
      owner: input.owner,
      repo: input.repo,
      state,
      sort: "updated",
      direction: "desc",
      page,
      per_page: perPage,
    })
    return res.data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        number: i.number,
        nodeId: i.node_id,
        title: i.title,
        state: i.state === "closed" ? "closed" : "open",
        url: i.html_url,
        labels: labelNames(i.labels),
        updatedAt: i.updated_at,
      }))
  }

  // Strip qualifier syntax so a typed `label:bug` or quote cannot escape the
  // repo scope we pin here.
  const text = q.replace(SEARCH_QUALIFIER, " ").trim()
  const stateQualifier = state === "all" ? "" : ` is:${state}`
  const res = await client.rest.search.issuesAndPullRequests({
    q: `repo:${input.owner}/${input.repo} is:issue${stateQualifier} ${text}`,
    sort: "updated",
    order: "desc",
    page,
    per_page: perPage,
    advanced_search: "true",
  })
  return res.data.items
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      nodeId: i.node_id,
      title: i.title,
      state: i.state === "closed" ? "closed" : "open",
      url: i.html_url,
      labels: labelNames(i.labels),
      updatedAt: i.updated_at,
    }))
}
