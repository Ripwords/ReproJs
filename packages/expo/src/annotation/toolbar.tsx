import React from "react"
import { Pressable, View } from "react-native"
import { PALETTE, STROKE_WIDTHS } from "@reprojs/sdk-utils"
import type { CanvasMode } from "./mode"
import type { AnnotationStore } from "./store"
import {
  CursorIcon,
  PenIcon,
  ArrowIcon,
  RectIcon,
  HighlightIcon,
  TextIcon,
  UndoIcon,
  RedoIcon,
  TrashIcon,
} from "./icons"
import { useAnnotationShapes } from "./use-shapes"

interface Props {
  mode: CanvasMode
  onModeChange: (m: CanvasMode) => void
  color: string
  onColorChange: (c: string) => void
  strokeWidth: number
  onStrokeWidthChange: (w: number) => void
  store: AnnotationStore
}

interface ToolButton {
  key: CanvasMode
  label: string
  Icon: React.ComponentType<{ size?: number; color?: string }>
}

// `select` sits last so the drawing tools keep the positions reporters already
// know.
const TOOLS: ToolButton[] = [
  { key: "pen", label: "Pen", Icon: PenIcon },
  { key: "arrow", label: "Arrow", Icon: ArrowIcon },
  { key: "rect", label: "Rectangle", Icon: RectIcon },
  { key: "highlight", label: "Highlight", Icon: HighlightIcon },
  { key: "text", label: "Text", Icon: TextIcon },
  { key: "select", label: "Select and move", Icon: CursorIcon },
]

const ACTIVE_BG = "#ff9b51"
const INACTIVE_BG = "#f3f4f6"
const ACTIVE_ICON = "#ffffff"
const INACTIVE_ICON = "#111827"
const DISABLED_OPACITY = 0.35
const HIT_SIZE = 44
/**
 * Nine 44pt buttons plus gaps need ~416pt, which overflows a 375pt phone.
 * Yoga defaults flexShrink to 0, so without this the row would not shrink —
 * it would run off the edge and take the trash button with it.
 */
const MIN_HIT_SIZE = 34

export function AnnotationToolbar({
  mode,
  onModeChange,
  color,
  onColorChange,
  strokeWidth,
  onStrokeWidthChange,
  store,
}: Props) {
  // Subscribe to store so canUndo/canRedo trigger re-render
  useAnnotationShapes(store)

  const canUndo = store.canUndo()
  const canRedo = store.canRedo()

  return (
    <View style={{ backgroundColor: "#ffffff", paddingHorizontal: 8, paddingVertical: 4, gap: 4 }}>
      {/* Row 1: tool buttons + undo/redo/trash */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {TOOLS.map(({ key, label, Icon }) => {
          const active = key === mode
          return (
            <Pressable
              key={key}
              onPress={() => onModeChange(key)}
              accessibilityLabel={label}
              accessibilityRole="button"
              style={{
                width: HIT_SIZE,
                minWidth: MIN_HIT_SIZE,
                flexShrink: 1,
                height: HIT_SIZE,
                borderRadius: 8,
                backgroundColor: active ? ACTIVE_BG : INACTIVE_BG,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={22} color={active ? ACTIVE_ICON : INACTIVE_ICON} />
            </Pressable>
          )
        })}

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Undo */}
        <Pressable
          onPress={() => store.undo()}
          disabled={!canUndo}
          accessibilityLabel="Undo"
          accessibilityRole="button"
          style={{
            width: HIT_SIZE,
            minWidth: MIN_HIT_SIZE,
            flexShrink: 1,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
            opacity: canUndo ? 1 : DISABLED_OPACITY,
          }}
        >
          <UndoIcon size={22} color={INACTIVE_ICON} />
        </Pressable>

        {/* Redo */}
        <Pressable
          onPress={() => store.redo()}
          disabled={!canRedo}
          accessibilityLabel="Redo"
          accessibilityRole="button"
          style={{
            width: HIT_SIZE,
            minWidth: MIN_HIT_SIZE,
            flexShrink: 1,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
            opacity: canRedo ? 1 : DISABLED_OPACITY,
          }}
        >
          <RedoIcon size={22} color={INACTIVE_ICON} />
        </Pressable>

        {/* Trash / clear */}
        <Pressable
          onPress={() => store.clear()}
          accessibilityLabel="Clear all annotations"
          accessibilityRole="button"
          style={{
            width: HIT_SIZE,
            minWidth: MIN_HIT_SIZE,
            flexShrink: 1,
            height: HIT_SIZE,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <TrashIcon size={22} color={INACTIVE_ICON} />
        </Pressable>
      </View>

      {/* Row 2: color swatches + stroke widths */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingVertical: 4,
        }}
      >
        {/* Color swatches */}
        <View style={{ flexDirection: "row" }}>
          {PALETTE.map((swatch) => {
            const active = swatch === color
            return (
              <Pressable
                key={swatch}
                onPress={() => onColorChange(swatch)}
                hitSlop={4}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    backgroundColor: swatch,
                    borderWidth: active ? 2 : 0,
                    borderColor: "#ff9b51",
                  }}
                />
              </Pressable>
            )
          })}
        </View>

        {/* Stroke width dots */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {STROKE_WIDTHS.map((w) => {
            const active = w === strokeWidth
            const dotSize = Math.min(w * 2 + 4, 16)
            return (
              <Pressable
                key={w}
                onPress={() => onStrokeWidthChange(w)}
                hitSlop={4}
                style={{
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: dotSize,
                    height: dotSize,
                    borderRadius: dotSize / 2,
                    backgroundColor: active ? "#ff9b51" : "#111827",
                  }}
                />
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}
