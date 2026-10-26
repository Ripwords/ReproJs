// packages/integrations/github/src/types.ts
export interface InstallationClientOptions {
  appId: string
  privateKey: string
  installationId: number
}

export interface GitHubIssueRef {
  number: number
  nodeId: string
  url: string
}

export interface CreateIssueInput {
  owner: string
  repo: string
  title: string
  body: string
  labels?: readonly string[]
  assignees?: readonly string[]
}

export interface IssueStateInput {
  owner: string
  repo: string
  number: number
}

export interface CloseIssueInput extends IssueStateInput {
  reason?: "completed" | "not_planned"
}

export interface UpdateLabelsInput extends IssueStateInput {
  labels: readonly string[]
}

export interface InstallationRepository {
  id: number
  owner: string
  name: string
  fullName: string
}

export interface FindIssueByMarkerInput {
  owner: string
  repo: string
  marker: string
}

import type { RepoLabel, AssignableUser, RepoMilestone, CreateLabelInput } from "./repo-read"
import type { IssueSummary, ListIssuesInput } from "./issue-read"
export type { RepoLabel, AssignableUser, RepoMilestone, CreateLabelInput }
export type { IssueSummary, ListIssuesInput }

export interface GitHubInstallationClient {
  createIssue(input: CreateIssueInput): Promise<GitHubIssueRef>
  getIssue(input: IssueStateInput): Promise<{ state: "open" | "closed"; labels: string[] }>
  closeIssue(input: CloseIssueInput): Promise<void>
  reopenIssue(input: IssueStateInput): Promise<void>
  updateIssueLabels(input: UpdateLabelsInput): Promise<void>
  listInstallationRepositories(): Promise<InstallationRepository[]>
  findIssueByMarker(input: FindIssueByMarkerInput): Promise<GitHubIssueRef | null>
  listRepoLabels(owner: string, repo: string): Promise<RepoLabel[]>
  listAssignableUsers(owner: string, repo: string): Promise<AssignableUser[]>
  listMilestones(owner: string, repo: string, state?: "open" | "all"): Promise<RepoMilestone[]>
  createLabel(owner: string, repo: string, input: CreateLabelInput): Promise<RepoLabel>
  /** One issue, or null when it does not exist or is a pull request. */
  getIssueSummary(owner: string, repo: string, issueNumber: number): Promise<IssueSummary | null>
  listIssues(input: ListIssuesInput): Promise<IssueSummary[]>
}
