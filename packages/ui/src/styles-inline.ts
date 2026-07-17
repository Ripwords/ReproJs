// Auto-generated from styles.css by build-css.ts. Do not edit by hand.
// Run `bun run packages/ui/build-css.ts` after editing styles.css.

export default String.raw`:host,
* {
  box-sizing: border-box;
}
.ft-launcher {
  position: fixed;
  width: 56px;
  height: 56px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 2147483640;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-launcher:hover {
  background: color-mix(in oklch, var(--ft-color-text) 90%, black);
}
.ft-launcher.pos-bottom-right {
  right: 24px;
  bottom: 24px;
}
.ft-launcher.pos-bottom-left {
  left: 24px;
  bottom: 24px;
}
.ft-launcher.pos-top-right {
  right: 24px;
  top: 24px;
}
.ft-launcher.pos-top-left {
  left: 24px;
  top: 24px;
}

.ft-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Wizard shell === */
.ft-wizard {
  position: fixed;
  inset: 0;
  z-index: 2147483641;
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  display: flex;
  flex-direction: column;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-wizard-header {
  display: grid;
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  padding: 14px 20px 12px;
  background: var(--ft-color-bg);
  border-bottom: 1px solid var(--ft-color-border);
  gap: 8px;
}
.ft-wizard-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ft-color-primary);
  margin: 0 0 2px;
}
.ft-wizard-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--ft-color-text);
}
.ft-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  border: 0;
  color: var(--ft-color-text-muted);
  cursor: pointer;
}
.ft-icon-btn:hover {
  background: var(--ft-color-surface-soft);
  color: var(--ft-color-text);
}

.ft-wizard-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ft-wizard-annotate {
  background: var(--ft-color-surface-soft);
}

/* Review uses a centered column. */
.ft-wizard-step {
  flex: 1;
  overflow: auto;
  padding: 24px;
}
.ft-wizard-step-inner {
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Details is a single stacked column now that the annotate step (and its
   sticky screenshot preview) is gone — title, description, media, and
   attachments all live in one form column. */
.ft-wizard-details-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.ft-wizard-footer {
  background: var(--ft-color-bg);
  border-top: 1px solid var(--ft-color-border);
  padding: 14px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.ft-wizard-loading {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.75);
  color: var(--ft-color-bg);
  z-index: 2147483641;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}

/* === Buttons === */
.ft-btn-primary {
  background: var(--ft-color-primary);
  color: #ffffff;
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 24px;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  cursor: pointer;
  min-height: 44px;
  box-shadow:
    0 6px 14px -6px color-mix(in oklch, var(--ft-color-primary) 60%, transparent),
    0 0 0 1px color-mix(in oklch, var(--ft-color-primary) 30%, transparent);
}
.ft-btn-primary:hover:not(:disabled) {
  background: var(--ft-color-primary-pressed);
}
.ft-btn-primary:disabled {
  background: var(--ft-color-primary-disabled);
  box-shadow: none;
  cursor: not-allowed;
}
.ft-btn-secondary {
  background: transparent;
  color: var(--ft-color-text-muted);
  border: 0;
  border-radius: var(--ft-radius-md);
  padding: 14px 20px;
  font: inherit;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  min-height: 44px;
}
.ft-btn-secondary:hover:not(:disabled) {
  color: var(--ft-color-text);
  background: var(--ft-color-surface);
}
.ft-btn-secondary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* === Step indicator === */
.ft-stepper {
  display: flex;
  align-items: flex-start;
  margin-top: 18px;
}
.ft-stepper-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 64px;
}
.ft-stepper-dot {
  width: 24px;
  height: 24px;
  border-radius: var(--ft-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--ft-color-surface);
  color: var(--ft-color-text-faint);
  font-size: 11px;
  font-weight: 700;
}
.ft-stepper-dot.active,
.ft-stepper-dot.done {
  background: var(--ft-color-primary);
  color: #ffffff;
}
.ft-stepper-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--ft-color-text-faint);
  letter-spacing: 0.2px;
}
.ft-stepper-label.active {
  color: var(--ft-color-text);
  font-weight: 600;
}
.ft-stepper-label.done {
  color: var(--ft-color-text-muted);
}
.ft-stepper-bar {
  flex: 1;
  height: 2px;
  background: var(--ft-color-border);
  margin: 11px 6px 0;
  border-radius: 1px;
}
.ft-stepper-bar.done {
  background: var(--ft-color-primary);
}

/* === Field labels + inputs === */
.ft-field-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--ft-color-text);
}
.ft-field-label-optional {
  font-style: italic;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  font-size: 11px;
  color: var(--ft-color-text-faint);
}
.ft-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ft-field input,
.ft-field textarea {
  width: 100%;
  padding: 14px;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  font: inherit;
  font-size: 15px;
  color: var(--ft-color-text);
}
.ft-field textarea {
  min-height: 140px;
  resize: vertical;
}
.ft-field input:focus,
.ft-field textarea:focus {
  outline: none;
  border-color: var(--ft-color-primary);
}

/* === Review summary card === */
.ft-summary {
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-lg);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ft-summary-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--ft-color-text-muted);
}
.ft-summary-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ft-summary-bullet {
  width: 5px;
  height: 5px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-primary);
}
.ft-summary-label {
  flex: 1;
  font-size: 14px;
  color: var(--ft-color-text);
}
.ft-summary-hint {
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* === Submit toast === */
.ft-toast {
  position: absolute;
  top: 100px;
  right: 24px;
  background: var(--ft-color-bg);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.18);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 260px;
  max-width: 320px;
  z-index: 2;
  animation: ft-toast-in 200ms ease-out;
}
@keyframes ft-toast-in {
  from {
    transform: translateY(-8px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
.ft-toast-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ft-color-text);
  line-height: 1.3;
}
.ft-toast-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.ft-toast-progress {
  height: 4px;
  background: var(--ft-color-surface);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}
.ft-toast-progress::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 35%;
  background: var(--ft-color-primary);
  border-radius: 2px;
  animation: ft-toast-stripe 1.2s ease-in-out infinite;
}
@keyframes ft-toast-stripe {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(286%);
  }
}

/* === Inline messages === */
.ft-msg {
  font-size: 12px;
  margin-top: 8px;
}
.ft-msg.err {
  color: var(--ft-color-danger);
}
.ft-msg.ok {
  color: color-mix(in oklch, var(--ft-color-primary) 60%, var(--ft-color-text));
}
.ft-error-card {
  background: var(--ft-color-danger-soft);
  border: 1px solid var(--ft-color-danger-border);
  border-radius: var(--ft-radius-md);
  padding: 14px;
  color: var(--ft-color-danger);
  font-size: 14px;
}

/* === Tool picker === */
.ft-tool-picker {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.ft-tool-group {
  display: flex;
  gap: 4px;
  align-items: center;
}
.ft-tool {
  width: 36px;
  height: 36px;
  border: 1px solid var(--ft-color-border);
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  border-radius: var(--ft-radius-md);
  cursor: pointer;
  font-size: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ft-tool:hover {
  background: var(--ft-color-surface);
}
.ft-tool.active {
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border-color: var(--ft-color-text);
}
.ft-tool[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}
.ft-swatch {
  width: 22px;
  height: 22px;
  border-radius: var(--ft-radius-pill);
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
}
.ft-swatch.active {
  border-color: var(--ft-color-text);
  transform: scale(1.1);
}
.ft-stroke {
  background: var(--ft-color-bg);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 0 6px;
  height: 36px;
}
.ft-stroke-dot {
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  color: var(--ft-color-text-muted);
}
.ft-stroke-dot.active {
  color: var(--ft-color-text);
}

/* === Canvas container === */
.ft-canvas-container canvas {
  cursor: crosshair;
  touch-action: none;
}
.ft-text-input {
  box-sizing: border-box;
}
.ft-preview-full {
  max-width: 100%;
  max-height: 80vh;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
}
.ft-attach {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ft-attach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.ft-attach-item {
  position: relative;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ft-color-text);
  word-break: break-word;
}
.ft-attach-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--ft-radius-sm);
  background: var(--ft-color-surface);
}
.ft-attach-icon {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--ft-radius-sm);
  background: var(--ft-color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ft-color-text-muted);
  font-size: 22px;
}
.ft-attach-name {
  font-size: 12px;
  color: var(--ft-color-text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-attach-meta {
  font-size: 11px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-attach-remove {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-bg);
  color: var(--ft-color-text-muted);
  border: 1px solid var(--ft-color-border);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.ft-attach-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 20px;
  background: var(--ft-color-bg);
  border: 1px dashed var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  color: var(--ft-color-text-muted);
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  transition:
    border-color 120ms,
    background 120ms,
    color 120ms;
  font-family: inherit;
  width: 100%;
}
.ft-attach-dropzone:hover:not(:disabled),
.ft-attach-dropzone:focus-visible {
  color: var(--ft-color-text);
  border-color: var(--ft-color-primary);
  background: var(--ft-color-primary-soft);
  outline: none;
}
.ft-attach-dropzone[data-dragover="true"] {
  color: var(--ft-color-text);
  border-color: var(--ft-color-primary);
  background: var(--ft-color-primary-soft);
}
.ft-attach-dropzone:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ft-attach-dropzone-shortcut {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--ft-color-surface);
  color: var(--ft-color-text);
  border: 1px solid var(--ft-color-border);
}
.ft-attach-status {
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-attach-error {
  font-size: 12px;
  color: var(--ft-color-danger);
}

/* === Media picker (Details step) — mirrors .ft-attach-*'s layout, but
   chips are togglable selections from the gallery rather than an upload
   list, so each chip is a <button aria-pressed> instead of a static item
   with a separate remove control. */
.ft-media {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ft-media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}
.ft-media-item {
  position: relative;
  background: var(--ft-color-surface-soft);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ft-color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ft-media-item.selected {
  border-color: var(--ft-color-primary);
  background: var(--ft-color-primary-soft);
}
.ft-media-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--ft-radius-sm);
  background: var(--ft-color-surface);
  overflow: hidden;
}
.ft-media-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ft-media-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.ft-media-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-primary);
  color: #ffffff;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ft-media-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ft-color-text-muted);
}
.ft-media-caption {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-media-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border: 1px dashed var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  color: var(--ft-color-text-faint);
  font-size: 13px;
  background: var(--ft-color-surface-soft);
}
.ft-media-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ft-media-error {
  font-size: 12px;
  color: var(--ft-color-danger);
}

/* === Recording control bar === */
.ft-rec-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 2147483641;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.35);
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.ft-rec-dot {
  width: 10px;
  height: 10px;
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-danger);
  animation: ft-rec-pulse 1.4s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes ft-rec-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.ft-rec-time {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 13px;
  letter-spacing: 0.2px;
}
.ft-rec-stop,
.ft-rec-cancel {
  border: 0;
  border-radius: var(--ft-radius-pill);
  padding: 8px 16px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.ft-rec-stop {
  background: var(--ft-color-danger);
  color: #ffffff;
}
.ft-rec-stop:hover {
  background: color-mix(in oklch, var(--ft-color-danger) 85%, black);
}
.ft-rec-cancel {
  background: transparent;
  color: var(--ft-color-bg);
  opacity: 0.7;
}
.ft-rec-cancel:hover {
  opacity: 1;
}

/* === Trim screen === */
.ft-trim {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  max-width: 640px;
  margin: 0 auto;
  width: 100%;
}
.ft-trim-video {
  width: 100%;
  max-height: 50vh;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  background: #000; /* letterbox black — intentional, not a theme token */
}
.ft-trim-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
  border: 1px dashed var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  background: var(--ft-color-surface-soft);
  color: var(--ft-color-text-muted);
  font-size: 13px;
}
.ft-trim-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ft-trim-row {
  display: grid;
  grid-template-columns: 44px 1fr 64px;
  align-items: center;
  gap: 12px;
}
.ft-trim-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: var(--ft-color-text-muted);
}
.ft-trim-slider {
  width: 100%;
  accent-color: var(--ft-color-primary);
}
.ft-trim-clock {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--ft-color-text);
  text-align: right;
}
.ft-trim-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* === Outcome bar === */
.ft-outcome-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  background: var(--ft-color-bg);
  border-top: 1px solid var(--ft-color-border);
}
.ft-outcome-discard {
  background: transparent;
  border: 0;
  color: var(--ft-color-text-faint);
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  padding: 14px 16px;
  cursor: pointer;
  margin-right: auto;
}
.ft-outcome-discard:hover {
  color: var(--ft-color-danger);
}
.ft-outcome-body {
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--ft-color-surface-soft);
}
.ft-outcome-preview {
  max-width: 100%;
  max-height: calc(100vh - 220px);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  background: var(--ft-color-surface-soft);
}

/* === Launcher menu === */
.ft-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483641;
  background: transparent;
}
.ft-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  padding: 8px;
  gap: 2px;
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-lg);
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.25);
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
/* Anchored above/aside the launcher — same corner the launcher itself sits
   in, offset by its 56px + margin so the popover never overlaps it. */
.ft-menu.pos-bottom-right {
  right: 24px;
  bottom: 92px;
}
.ft-menu.pos-bottom-left {
  left: 24px;
  bottom: 92px;
}
.ft-menu.pos-top-right {
  right: 24px;
  top: 92px;
}
.ft-menu.pos-top-left {
  left: 24px;
  top: 92px;
}
.ft-menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--ft-radius-md);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ft-menu-row:hover {
  background: var(--ft-color-surface-soft);
}
.ft-menu-icon {
  flex: none;
  width: 24px;
  text-align: center;
  font-size: 16px;
  line-height: 1;
}
.ft-menu-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ft-menu-label {
  font-size: 14px;
  font-weight: 600;
}
.ft-menu-hint {
  font-size: 12px;
  color: var(--ft-color-text-muted);
}
.ft-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: var(--ft-color-border);
}

/* === Gallery === */
.ft-gallery-header {
  justify-content: space-between;
}
.ft-gallery-body {
  flex-direction: column;
  overflow: auto;
  padding: 20px;
}
.ft-gallery-loading,
.ft-gallery-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--ft-color-text-faint);
  font-size: 14px;
}
.ft-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  align-content: start;
}
.ft-gallery-tile {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-lg);
  background: var(--ft-color-surface);
}
.ft-gallery-thumb {
  aspect-ratio: 16 / 10;
  border-radius: var(--ft-radius-md);
  overflow: hidden;
  background: var(--ft-color-surface-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ft-gallery-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ft-gallery-thumb-placeholder {
  font-size: 28px;
}
.ft-gallery-caption {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ft-color-text-muted);
  font-variant-numeric: tabular-nums;
}
.ft-gallery-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ft-gallery-action {
  padding: 6px 10px;
  border: 1px solid var(--ft-color-border);
  border-radius: var(--ft-radius-pill);
  background: var(--ft-color-bg);
  color: var(--ft-color-text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ft-gallery-action:hover {
  background: var(--ft-color-surface-soft);
}
.ft-gallery-action:disabled {
  opacity: 0.6;
  cursor: default;
}
.ft-gallery-action-primary {
  background: var(--ft-color-primary);
  color: var(--ft-color-bg);
  border-color: transparent;
  margin-left: auto;
}
.ft-gallery-action-primary:hover {
  background: color-mix(in oklch, var(--ft-color-primary) 85%, black);
}
.ft-gallery-copy-error {
  color: var(--ft-color-danger);
  font-size: 12px;
}
.ft-gallery-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-radius: var(--ft-radius-md);
  background: var(--ft-color-surface-soft);
}
.ft-gallery-preview-image,
.ft-gallery-preview-video {
  max-width: 100%;
  max-height: 320px;
  border-radius: var(--ft-radius-md);
}
.ft-gallery-preview-video {
  background: #000; /* letterbox black — intentional, not a theme token, matches .ft-trim-video */
}
.ft-gallery-preview-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  border: 1px dashed var(--ft-color-border);
  border-radius: var(--ft-radius-md);
  background: var(--ft-color-surface-soft);
  color: var(--ft-color-text-muted);
  font-size: 13px;
}

/* === Mode toast === */
/* Transient status message anchored bottom-center of the widget layer:
   eviction notices, "Saved to gallery", "Screen recording unavailable". */
.ft-mode-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: 360px;
  padding: 10px 16px;
  background: var(--ft-color-text);
  color: var(--ft-color-bg);
  border-radius: var(--ft-radius-md);
  box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.35);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  text-align: center;
  z-index: 2147483647;
  animation: ft-mode-toast-in 180ms ease-out;
}
@keyframes ft-mode-toast-in {
  from {
    transform: translate(-50%, 8px);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0);
    opacity: 1;
  }
}
`
