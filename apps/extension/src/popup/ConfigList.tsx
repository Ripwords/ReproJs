import { useMemo } from "preact/hooks"
import type { ConfigWithStatus } from "./useConfigs"

type Props = {
  configs: readonly ConfigWithStatus[]
  onRemove: (id: string) => void
  onRegrant: (id: string) => void
  onToggleRelatedIssue: (id: string, enabled: boolean) => void
}

export function ConfigList({ configs, onRemove, onRegrant, onToggleRelatedIssue }: Props) {
  if (configs.length === 0) {
    return (
      <div class="list-empty">
        No origins configured yet.
        <div class="list-empty-hint">Click "New origin" to add one.</div>
      </div>
    )
  }
  return (
    <div class="list">
      {configs.map((c) => (
        <ConfigItem
          key={c.id}
          config={c}
          onRemove={onRemove}
          onRegrant={onRegrant}
          onToggleRelatedIssue={onToggleRelatedIssue}
        />
      ))}
    </div>
  )
}

type ItemProps = {
  config: ConfigWithStatus
  onRemove: (id: string) => void
  onRegrant: (id: string) => void
  onToggleRelatedIssue: (id: string, enabled: boolean) => void
}

function ConfigItem({ config, onRemove, onRegrant, onToggleRelatedIssue }: ItemProps) {
  const destHost = useMemo(() => {
    try {
      return new URL(config.intakeEndpoint).host
    } catch {
      return config.intakeEndpoint
    }
  }, [config.intakeEndpoint])

  return (
    <article class="cfg" data-permission={config.permission}>
      <span class="cfg-stripe" aria-hidden="true" />
      <div class="cfg-body">
        <div class="cfg-label">{config.label}</div>
        <div class="cfg-origin" title={config.origin}>
          {config.origin}
        </div>
        <div class="cfg-dest" title={config.intakeEndpoint}>
          {destHost}
        </div>
        <label class="check check-inline">
          <input
            type="checkbox"
            checked={config.relatedIssueField}
            onChange={(e) =>
              onToggleRelatedIssue(config.id, (e.target as HTMLInputElement).checked)
            }
          />
          <span>Show 'Related GitHub issue' field</span>
        </label>
      </div>
      <div class="cfg-actions">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-danger"
          onClick={() => onRemove(config.id)}
          aria-label={`Remove ${config.label}`}
        >
          Remove
        </button>
      </div>
      {config.permission === "pending" && (
        <div class="cfg-warn" role="status">
          <span>Host permission needed — the widget won't load until granted.</span>
          <button type="button" class="btn btn-xs btn-warn" onClick={() => onRegrant(config.id)}>
            Grant
          </button>
        </div>
      )}
    </article>
  )
}
