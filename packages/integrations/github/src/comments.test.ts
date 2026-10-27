// packages/integrations/github/src/comments.test.ts
import { describe, test, expect, mock } from "bun:test"
import {
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  listIssueComments,
} from "./comments"
import type { Octokit } from "@octokit/rest"

function makeComment(id: number, body: string) {
  return {
    id,
    body,
    user: { id: 42, login: "test-user", avatar_url: "https://example.com/avatar.png" },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  }
}

describe("createIssueComment", () => {
  test("returns normalized shape from API response", async () => {
    const createComment = mock(async () => ({ data: makeComment(100, "Hello!") }))
    const client = {
      rest: { issues: { createComment } },
    } as unknown as Octokit

    const result = await createIssueComment(client, "owner", "repo", 5, "Hello!")

    expect(createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 5,
      body: "Hello!",
    })
    expect(result).toEqual({
      id: 100,
      body: "Hello!",
      user: {
        id: 42,
        login: "test-user",
        avatar_url: "https://example.com/avatar.png",
        type: null,
      },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    })
  })

  test("handles null user gracefully", async () => {
    const createComment = mock(async () => ({
      data: {
        id: 200,
        body: "test",
        user: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    }))
    const client = {
      rest: { issues: { createComment } },
    } as unknown as Octokit

    const result = await createIssueComment(client, "owner", "repo", 1, "test")
    expect(result.user).toEqual({ id: 0, login: "", avatar_url: null, type: null })
  })
})

describe("updateIssueComment", () => {
  test("calls updateComment with comment_id + body", async () => {
    const updateComment = mock(async () => ({ data: {} }))
    const client = {
      rest: { issues: { updateComment } },
    } as unknown as Octokit

    await updateIssueComment(client, "owner", "repo", 999, "New body")

    expect(updateComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      comment_id: 999,
      body: "New body",
    })
  })
})

describe("deleteIssueComment", () => {
  test("calls deleteComment with comment_id", async () => {
    const deleteComment = mock(async () => ({ data: {} }))
    const client = {
      rest: { issues: { deleteComment } },
    } as unknown as Octokit

    await deleteIssueComment(client, "owner", "repo", 888)

    expect(deleteComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      comment_id: 888,
    })
  })
})

describe("listIssueComments", () => {
  test("flattens paginated results", async () => {
    const page1 = [makeComment(1, "First"), makeComment(2, "Second")]
    const page2 = [makeComment(3, "Third")]

    // Build an async iterator that yields two pages
    const pages = [{ data: page1 }, { data: page2 }]
    let pageIdx = 0
    const asyncIterator = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (pageIdx < pages.length) {
              return { value: pages[pageIdx++], done: false }
            }
            return { value: undefined, done: true }
          },
        }
      },
    }

    const paginateIterator = mock(() => asyncIterator)
    const listComments = mock(async () => ({ data: [] }))
    const client = {
      rest: { issues: { listComments } },
      paginate: { iterator: paginateIterator },
    } as unknown as Octokit

    const results = await listIssueComments(client, "owner", "repo", 7)

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe(1)
    expect(results[1].id).toBe(2)
    expect(results[2].id).toBe(3)
    expect(paginateIterator).toHaveBeenCalledWith(listComments, {
      owner: "owner",
      repo: "repo",
      issue_number: 7,
      per_page: 100,
    })
  })

  test("returns empty array when no comments", async () => {
    const asyncIterator = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return { value: undefined, done: true }
          },
        }
      },
    }

    const paginateIterator = mock(() => asyncIterator)
    const listComments = mock(async () => ({ data: [] }))
    const client = {
      rest: { issues: { listComments } },
      paginate: { iterator: paginateIterator },
    } as unknown as Octokit

    const results = await listIssueComments(client, "owner", "repo", 1)
    expect(results).toHaveLength(0)
  })
})
