import type { Config, ConfigInput } from "../types"

const KEY = "configs"
const LAST_INTAKE_KEY = "lastIntakeEndpoint"

// What older extension builds wrote: every current key except the ones
// added later, which are optional here and normalised on read.
type StoredConfig = Omit<Config, "relatedIssueField"> & { relatedIssueField?: boolean }

// The single place a stored config becomes a Config. Testers are the
// audience, so a config that predates the related-issue toggle gets it on.
function normalise(stored: StoredConfig): Config {
  return { ...stored, relatedIssueField: stored.relatedIssueField ?? true }
}

async function readAll(): Promise<Config[]> {
  const result = await chrome.storage.local.get([KEY])
  const value = (result as { configs?: StoredConfig[] }).configs
  return (value ?? []).map(normalise)
}

async function writeAll(configs: Config[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: configs })
}

export async function listConfigs(): Promise<Config[]> {
  return readAll()
}

export async function addConfig(input: ConfigInput): Promise<Config> {
  const config: Config = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  const all = await readAll()
  await writeAll([...all, config])
  return config
}

export async function updateConfig(id: string, patch: Partial<ConfigInput>): Promise<void> {
  const all = await readAll()
  const next = all.map((c) => (c.id === id ? { ...c, ...patch } : c))
  await writeAll(next)
}

export async function deleteConfig(id: string): Promise<void> {
  const all = await readAll()
  await writeAll(all.filter((c) => c.id !== id))
}

// Remembers the intake endpoint the user last typed into the Add form so the
// next Add can pre-fill it. Most testers point every config at the same
// dashboard — this saves retyping. Only written when the user explicitly
// saves a config, never on keystroke.
export async function getLastIntakeEndpoint(): Promise<string> {
  const result = await chrome.storage.local.get([LAST_INTAKE_KEY])
  const value = (result as { lastIntakeEndpoint?: string }).lastIntakeEndpoint
  return typeof value === "string" ? value : ""
}

export async function setLastIntakeEndpoint(endpoint: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_INTAKE_KEY]: endpoint })
}
