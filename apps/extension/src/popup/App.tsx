import { useState } from "preact/hooks"
import { AddConfigForm } from "./AddConfigForm"
import { ConfigList } from "./ConfigList"
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "./styles.css"
import { useActiveTabOrigin } from "./useActiveTabOrigin"
import { useConfigs } from "./useConfigs"

type Mode = "list" | "add"

export function App() {
  const { items, add, remove, regrant, setRelatedIssueField, lastIntakeEndpoint } = useConfigs()
  const activeTabOrigin = useActiveTabOrigin()
  const [mode, setMode] = useState<Mode>("list")

  const originsMeta =
    items.length === 0 ? "empty" : `${items.length} ${items.length === 1 ? "origin" : "origins"}`

  async function handleAdd(
    input: Parameters<typeof add>[0],
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const result = await add(input)
    if (result.ok) {
      // Snap back to the list even though the native permission prompt may
      // close the popup before this paint. If reopened the list renders
      // with the new config (status: pending or granted depending on
      // whether the user accepted the prompt).
      setMode("list")
    }
    return result
  }

  return (
    <div class="app">
      <header class="mast">
        <span class="mast-brand">Repro Tester</span>
        <span class="mast-meta">{mode === "add" ? "new origin" : originsMeta}</span>
      </header>

      {mode === "list" ? (
        <>
          <div class="section-head">
            <span class="section-title">
              Origins
              {items.length > 0 && <span class="section-title-count">{items.length}</span>}
            </span>
            <button type="button" class="btn" onClick={() => setMode("add")}>
              + New origin
            </button>
          </div>
          <ConfigList
            configs={items}
            onRemove={remove}
            onRegrant={regrant}
            onToggleRelatedIssue={setRelatedIssueField}
          />
        </>
      ) : (
        <>
          <div class="section-head">
            <span class="section-title">New origin</span>
            <button type="button" class="btn btn-ghost" onClick={() => setMode("list")}>
              ← Back
            </button>
          </div>
          <AddConfigForm
            onSubmit={handleAdd}
            onCancel={() => setMode("list")}
            defaultIntakeEndpoint={lastIntakeEndpoint}
            defaultOrigin={activeTabOrigin ?? ""}
          />
        </>
      )}
    </div>
  )
}
