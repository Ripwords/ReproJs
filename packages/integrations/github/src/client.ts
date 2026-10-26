// packages/integrations/github/src/client.ts
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"

// Re-exported so server-side dashboard code can mint installation tokens for
// raw HTTP calls (e.g. proxying user-attachment images) without taking a
// direct dep on @octokit/auth-app.
export { createAppAuth }
import type {
  CloseIssueInput,
  CreateIssueInput,
  FindIssueByMarkerInput,
  GitHubInstallationClient,
  GitHubIssueRef,
  InstallationClientOptions,
  InstallationRepository,
  IssueStateInput,
  UpdateLabelsInput,
} from "./types"
import { listRepoLabels, listAssignableUsers, listMilestones, createLabel } from "./repo-read"
import type { CreateLabelInput } from "./repo-read"
import { getIssueSummary, listIssues } from "./issue-read"
import type { ListIssuesInput } from "./issue-read"
export { getIssueSummary, listIssues } from "./issue-read"
export {
  updateIssueTitle,
  updateIssueMilestone,
  addAssignees,
  removeAssignees,
  updateIssueState,
  checkUserCanBeAssigned,
} from "./issue-writes"
export type { IssueStateUpdate } from "./issue-writes"
export {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  listIssueComments,
} from "./comments"
export type { GithubComment } from "./comments"

export function createInstallationClient(
  opts: InstallationClientOptions,
): GitHubInstallationClient {
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: opts.appId,
      privateKey: opts.privateKey,
      installationId: opts.installationId,
    },
    request: {
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    },
    // Suppress the known false-positive Octokit warning that treats GitHub's
    // `deprecation` response header as endpoint-level removal. In the
    // 2026-03-10 API version the only deprecation affecting our issue-creation
    // path is the singular `assignee` field — we already send `assignees` as
    // an array, so the request is compliant. @octokit/request prints a generic
    // "endpoint scheduled to be removed" warning on every matching call which
    // floods logs. Pass-through all other warnings.
    // https://docs.github.com/en/rest/about-the-rest-api/breaking-changes?apiVersion=2026-03-10
    log: {
      debug: () => {},
      info: () => {},
      warn: (msg: string) => {
        if (/is deprecated\. It is scheduled to be removed on/.test(msg)) return
        console.warn(msg)
      },
      error: (msg: string) => {
        console.error(msg)
      },
    },
  })

  return {
    async createIssue(input: CreateIssueInput): Promise<GitHubIssueRef> {
      const res = await octokit.issues.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        body: input.body,
        labels: input.labels ? [...input.labels] : undefined,
        assignees: input.assignees ? [...input.assignees] : undefined,
      })
      return {
        number: res.data.number,
        nodeId: res.data.node_id,
        url: res.data.html_url,
      }
    },

    async getIssue(input: IssueStateInput) {
      const res = await octokit.issues.get({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
      })
      return {
        state: res.data.state === "closed" ? "closed" : ("open" as const),
        labels: res.data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
      }
    },

    async closeIssue(input: CloseIssueInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "closed",
        ...(input.reason !== undefined ? { state_reason: input.reason } : {}),
      })
    },

    async reopenIssue(input: IssueStateInput): Promise<void> {
      await octokit.issues.update({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        state: "open",
      })
    },

    async updateIssueLabels(input: UpdateLabelsInput): Promise<void> {
      await octokit.issues.setLabels({
        owner: input.owner,
        repo: input.repo,
        issue_number: input.number,
        labels: [...input.labels],
      })
    },

    async listInstallationRepositories(): Promise<InstallationRepository[]> {
      const repos = await octokit.paginate(octokit.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      })
      return repos.map((r) => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
      }))
    },

    async findIssueByMarker(input: FindIssueByMarkerInput): Promise<GitHubIssueRef | null> {
      // Use Search API — indexed across issue bodies. Trailing quoting guards
      // against markers with special characters being parsed as qualifiers.
      const q = `repo:${input.owner}/${input.repo} in:body "${input.marker}"`
      try {
        const res = await octokit.search.issuesAndPullRequests({
          q,
          per_page: 5,
          advanced_search: "true",
        })
        const hit = res.data.items.find((i) => !i.pull_request && i.body?.includes(input.marker))
        if (!hit) return null
        return { number: hit.number, nodeId: hit.node_id, url: hit.html_url }
      } catch {
        // Search index may be cold or the endpoint unavailable. Return null and
        // let the caller CREATE — worst case is a rare duplicate on retry.
        return null
      }
    },

    listRepoLabels: (owner: string, repo: string) => listRepoLabels(octokit, owner, repo),
    listAssignableUsers: (owner: string, repo: string) => listAssignableUsers(octokit, owner, repo),
    listMilestones: (owner: string, repo: string, state?: "open" | "all") =>
      listMilestones(octokit, owner, repo, state),
    createLabel: (owner: string, repo: string, input: CreateLabelInput) =>
      createLabel(octokit, owner, repo, input),
    getIssueSummary: (owner: string, repo: string, issueNumber: number) =>
      getIssueSummary(octokit, owner, repo, issueNumber),
    listIssues: (input: ListIssuesInput) => listIssues(octokit, input),
  }
}
