// packages/ui/src/menu.tsx
import { h, type ComponentChildren } from "preact"

interface LauncherMenuProps {
  position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  onCapture: () => void
  onRecord: () => void
  onReport: () => void
  onGallery: () => void
  onClose: () => void
}

interface MenuRowProps {
  icon: ComponentChildren
  label: string
  hint?: string
  onClick: () => void
  className?: string
}

function MenuRow({ icon, label, hint, onClick, className }: MenuRowProps) {
  return h(
    "button",
    {
      type: "button",
      class: `ft-menu-row${className ? ` ${className}` : ""}`,
      onClick,
    },
    h("span", { class: "ft-menu-icon", "aria-hidden": "true" }, icon),
    h(
      "span",
      { class: "ft-menu-text" },
      h("span", { class: "ft-menu-label" }, label),
      hint ? h("span", { class: "ft-menu-hint" }, hint) : null,
    ),
  )
}

// A small anchored popover above the launcher button. The backdrop closes
// the menu on any click outside the popover itself; clicks inside stop
// propagation so they only ever fire the row's own callback.
export function LauncherMenu({
  position,
  onCapture,
  onRecord,
  onReport,
  onGallery,
  onClose,
}: LauncherMenuProps) {
  return h(
    "div",
    { class: "ft-menu-backdrop", onClick: onClose },
    h(
      "div",
      {
        class: `ft-menu pos-${position}`,
        onClick: (e: Event) => e.stopPropagation(),
      },
      h(MenuRow, { icon: "📷", label: "Capture", onClick: onCapture }),
      h(MenuRow, {
        icon: "🎥",
        label: "Record screen",
        hint: "Up to 5 minutes",
        onClick: onRecord,
      }),
      h(MenuRow, { icon: "🐛", label: "Report bug", onClick: onReport }),
      h("div", { class: "ft-menu-divider" }),
      h(MenuRow, {
        icon: "🖼",
        label: "Gallery",
        onClick: onGallery,
        className: "ft-menu-gallery",
      }),
    ),
  )
}
