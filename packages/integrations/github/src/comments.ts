// packages/integrations/github/src/comments.ts
// Octokit wrappers for GitHub issue comments.
import type { Octokit } from "@octokit/rest"

export type GithubComment = {
  id: number
  body: string
  user: { id: number; login: string; avatar_url: string | null; type: string | null }
  createdAt: string
  updatedAt: string
}

export async function createIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<GithubComment> {
  const res = await client.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  })
  const c = res.data
  return {
    id: c.id,
    body: c.body ?? "",
    user: {
      id: c.user?.id ?? 0,
      login: c.user?.login ?? "",
      avatar_url: c.user?.avatar_url ?? null,
      type: c.user?.type ?? null,
    },
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

export async function updateIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<void> {
  await client.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  })
}

export async function deleteIssueComment(
  client: Octokit,
  owner: string,
  repo: string,
  commentId: number,
): Promise<void> {
  await client.rest.issues.deleteComment({
    owner,
    repo,
    comment_id: commentId,
  })
}

export async function listIssueComments(
  client: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubComment[]> {
  const items: GithubComment[] = []
  const iterator = client.paginate.iterator(client.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  for await (const { data } of iterator) {
    for (const c of data) {
      items.push({
        id: c.id,
        body: c.body ?? "",
        user: {
          id: c.user?.id ?? 0,
          login: c.user?.login ?? "",
          avatar_url: c.user?.avatar_url ?? null,
          type: c.user?.type ?? null,
        },
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })
    }
  }
  return items
}
