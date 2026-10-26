import { useEffect, useState } from "preact/hooks"
import type { ConfigInput } from "../types"

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

type Props = {
  onSubmit: (input: ConfigInput) => Promise<{ ok: true } | { ok: false; message: string }>
  onCancel?: () => void
  submitLabel?: string
  /** Pre-fills the intake endpoint field — typically the user's last saved value. */
  defaultIntakeEndpoint?: string
  /**
   * Pre-fills the origin field — typically the active tab's origin. Leave
   * undefined/empty in contexts without a tab (options page).
   */
  defaultOrigin?: string
}

function validate(input: ConfigInput): string | null {
  if (input.label.trim().length === 0) return "Label is required."
  if (!KEY_RE.test(input.projectKey)) {
    return "Project key must match rp_pk_ followed by 24 letters or digits."
  }
  let originUrl: URL
  try {
    originUrl = new URL(input.origin)
  } catch {
    return "Origin must be a valid URL (e.g. https://staging.acme.com)."
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return "Origin must use http or https."
  }
  if (`${originUrl.origin}` !== input.origin) {
    return "Origin must be scheme + host (+ port) only, with no path."
  }
  try {
    // oxlint-disable-next-line no-new
    new URL(input.intakeEndpoint)
  } catch {
    return "Intake endpoint must be a valid absolute URL."
  }
  return null
}

export function AddConfigForm({
  onSubmit,
  onCancel,
  submitLabel = "Add origin",
  defaultIntakeEndpoint = "",
  defaultOrigin = "",
}: Props) {
  const [label, setLabel] = useState("")
  // Lazy init so the prop value at mount time becomes initial state. The
  // popup's Add mode remounts this form each time the user opens it, so
  // the active-tab origin captured on entry is always the current one.
  const [origin, setOrigin] = useState(() => defaultOrigin)
  const [projectKey, setProjectKey] = useState("")
  // Lazy init so the prop value at mount time becomes the initial state;
  // subsequent re-renders won't clobber the user's edits. The form remounts
  // each time the user switches to Add mode, so a newly-saved last value
  // will show up on the next visit.
  const [intakeEndpoint, setIntakeEndpoint] = useState(() => defaultIntakeEndpoint)
  // On by default: testers re-testing a known bug are exactly who should be
  // able to name the issue a report belongs to.
  const [relatedIssueField, setRelatedIssueField] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // chrome.tabs.query can resolve after the first paint. If it does, adopt
  // the tab origin into the input — but only if the user hasn't typed
  // anything yet. Once they start editing, their input wins.
  useEffect(() => {
    if (defaultOrigin && origin === "") setOrigin(defaultOrigin)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to defaultOrigin arriving; intentionally don't re-run on origin edits.
  }, [defaultOrigin])

  async function handleSubmit(e: Event) {
    e.preventDefault()
    const input: ConfigInput = {
      label: label.trim(),
      origin: origin.trim(),
      projectKey: projectKey.trim(),
      intakeEndpoint: intakeEndpoint.trim(),
      relatedIssueField,
    }
    const err = validate(input)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await onSubmit(input)
    setSubmitting(false)
    if (result.ok) {
      setLabel("")
      setOrigin("")
      setProjectKey("")
      // Preserve the intake endpoint so a tester adding several configs in a
      // row on the options page doesn't retype their dashboard URL each time.
      setIntakeEndpoint(input.intakeEndpoint)
    } else {
      setError(result.message)
    }
  }

  return (
    <form class="form" onSubmit={handleSubmit} noValidate>
      <div class="hint-bar">
        After saving, Chrome will ask for permission on the site origin and the intake endpoint. If
        the popup closes mid-prompt, your config is already saved — you can <strong>Grant</strong>{" "}
        it from the list.
      </div>

      <div class="field">
        <label for="label">Label</label>
        <input
          id="label"
          value={label}
          placeholder="staging"
          onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <label for="origin">Origin</label>
        <input
          id="origin"
          placeholder="https://staging.acme.com"
          value={origin}
          spellcheck={false}
          onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
        />
        <div class="field-hint">scheme + host + optional port — no path</div>
      </div>

      <div class="field">
        <label for="projectKey">Project key</label>
        <input
          id="projectKey"
          placeholder="rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx"
          value={projectKey}
          spellcheck={false}
          onInput={(e) => setProjectKey((e.target as HTMLInputElement).value)}
        />
      </div>

      <div class="field">
        <label for="intakeEndpoint">Intake endpoint</label>
        <input
          id="intakeEndpoint"
          placeholder="https://feedback.example.com"
          value={intakeEndpoint}
          spellcheck={false}
          onInput={(e) => setIntakeEndpoint((e.target as HTMLInputElement).value)}
        />
        <div class="field-hint">the dashboard URL — SDK posts to this host</div>
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={relatedIssueField}
          onChange={(e) => setRelatedIssueField((e.target as HTMLInputElement).checked)}
        />
        <span>
          Show 'Related GitHub issue' field
          <span class="check-hint">
            lets a tester type the issue number a report belongs to — a hint the dashboard confirms
          </span>
        </span>
      </label>

      {error ? <div class="error-bar">{error}</div> : null}

      <div class="form-actions">
        {onCancel ? (
          <button type="button" class="btn" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        ) : null}
        <button type="submit" class="btn btn-primary" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  )
}
