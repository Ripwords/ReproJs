import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { addConfig, deleteConfig, listConfigs, updateConfig } from "./storage"
import type { Config } from "../types"

type Shape = { configs?: Config[] }
const stubChromeStorage = () => {
  const state: Shape = {}
  const mock = {
    storage: {
      local: {
        get: (keys: string[] | null) => {
          if (keys === null) return Promise.resolve({ ...state })
          const out: Record<string, unknown> = {}
          for (const k of keys) if (k in state) out[k] = (state as Record<string, unknown>)[k]
          return Promise.resolve(out)
        },
        set: (partial: Shape) => {
          Object.assign(state, partial)
          return Promise.resolve()
        },
      },
    },
  }
  ;(globalThis as unknown as { chrome: typeof mock }).chrome = mock
  return state
}

describe("storage", () => {
  beforeEach(() => stubChromeStorage())
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  test("listConfigs returns empty array when unset", async () => {
    expect(await listConfigs()).toEqual([])
  })

  test("addConfig appends with a generated id and createdAt", async () => {
    const c = await addConfig({
      label: "staging",
      origin: "https://staging.acme.com",
      projectKey: "rp_pk_abcdefghijklmnopqrstuvwx",
      intakeEndpoint: "https://repro.example.com",
      relatedIssueField: false,
    })
    expect(c.id).toMatch(/[0-9a-f-]{36}/)
    expect(c.createdAt).toBeGreaterThan(0)
    expect(await listConfigs()).toHaveLength(1)
  })

  test("updateConfig replaces a matching entry by id", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
      relatedIssueField: true,
    })
    await updateConfig(c.id, { label: "a-renamed" })
    const [updated] = await listConfigs()
    expect(updated?.label).toBe("a-renamed")
  })

  test("updateConfig can turn the related-issue field off and on again", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
      relatedIssueField: true,
    })
    await updateConfig(c.id, { relatedIssueField: false })
    expect((await listConfigs())[0]?.relatedIssueField).toBe(false)
    await updateConfig(c.id, { relatedIssueField: true })
    expect((await listConfigs())[0]?.relatedIssueField).toBe(true)
  })

  // Configs saved by older extension builds have no relatedIssueField key.
  // Testers are the audience, so the field is on for them unless they turn
  // it off — and that must be decided in one place (storage), not by every
  // reader of a Config.
  test("configs stored before relatedIssueField existed read back as enabled", async () => {
    const state = stubChromeStorage()
    state.configs = [
      {
        id: "legacy-1",
        label: "legacy",
        origin: "https://legacy.example",
        projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
        intakeEndpoint: "https://repro.example.com",
        createdAt: 1,
      } as unknown as Config,
    ]
    const [legacy] = await listConfigs()
    expect(legacy?.relatedIssueField).toBe(true)
    // And an explicit false survives the same read path.
    await updateConfig("legacy-1", { relatedIssueField: false })
    expect((await listConfigs())[0]?.relatedIssueField).toBe(false)
  })

  test("deleteConfig removes the matching entry", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
      relatedIssueField: true,
    })
    await deleteConfig(c.id)
    expect(await listConfigs()).toEqual([])
  })
})
