import React, { useRef, useState } from "react"
import { View } from "react-native"
import { GestureDetector, Gesture } from "react-native-gesture-handler"
import Svg, { Rect } from "react-native-svg"
import type { AnnotationStore } from "./store"
import type { Shape, PenPoint } from "@reprojs/sdk-utils"
import {
  clampTranslation,
  hitTest,
  newShapeId,
  shapeBounds,
  translateShape,
} from "@reprojs/sdk-utils"
import type { CanvasMode } from "./mode"
import { useAnnotationShapes } from "./use-shapes"
import { renderShape } from "./render-shape"

interface Props {
  width: number
  height: number
  mode: CanvasMode
  color: string
  strokeWidth: number
  store: AnnotationStore
  selectedId: string | null
  onSelectedIdChange: (id: string | null) => void
  onTextTap?: (point: { x: number; y: number }) => void
}

const DRAFT_ID = "__draft__"

/** Selection chrome. Deliberately near-black so it reads as UI rather than
 *  ink — every drawing colour in the palette is a saturated hue. */
const SELECTION_COLOR = "#111827"
const SELECTION_PAD = 6

export function AnnotationCanvas({
  width,
  height,
  mode,
  color,
  strokeWidth,
  store,
  selectedId,
  onSelectedIdChange,
  onTextTap,
}: Props) {
  const shapes = useAnnotationShapes(store)
  const [draftPoints, setDraftPoints] = useState<PenPoint[]>([])
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(
    null,
  )

  // In-flight gesture state is mirrored into refs. The gesture callbacks below
  // are captured when the gesture is built, so reading React state inside them
  // can see a value from before the stroke started; a ref is always current.
  // State still exists because only state re-renders the preview.
  const draftRef = useRef<PenPoint[]>([])
  const dragIdRef = useRef<string | null>(null)

  function pushDraftPoint(point: PenPoint) {
    draftRef.current = [...draftRef.current, point]
    setDraftPoints(draftRef.current)
  }

  function resetDraft() {
    draftRef.current = []
    setDraftPoints([])
  }

  function shapeById(id: string): Shape | null {
    return store.snapshot().find((s) => s.id === id) ?? null
  }

  function beginDrag(x: number, y: number) {
    const hit = hitTest(store.snapshot(), { x, y })
    dragIdRef.current = hit?.id ?? null
    setDragPreview(hit === null ? null : { id: hit.id, dx: 0, dy: 0 })
    if (hit !== null) onSelectedIdChange(hit.id)
  }

  function updateDrag(translationX: number, translationY: number) {
    const id = dragIdRef.current
    if (id === null) return
    const shape = shapeById(id)
    if (shape === null) return
    const offset = clampTranslation(shape, translationX, translationY, { w: width, h: height })
    setDragPreview({ id, ...offset })
  }

  function endDrag(translationX: number, translationY: number) {
    const id = dragIdRef.current
    dragIdRef.current = null
    setDragPreview(null)
    if (id === null) return
    const shape = shapeById(id)
    if (shape === null) return
    // Committed from the gesture's total translation rather than the preview
    // offset, so the stored position is exactly what the reporter released at
    // and the whole drag lands as a single undo step.
    const offset = clampTranslation(shape, translationX, translationY, { w: width, h: height })
    store.moveShape(id, offset.dx, offset.dy)
  }

  // runOnJS(true) forces callbacks to the JS thread. Without it, callbacks run
  // as worklets on the UI thread when react-native-reanimated is present, and
  // any React state setter (setDraftPoints) crashes the worklet.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(2)
    .onStart((e) => {
      if (mode === "select") {
        beginDrag(e.x, e.y)
        return
      }
      if (mode === "text") return
      resetDraft()
      pushDraftPoint({ x: e.x, y: e.y, p: 1 })
    })
    .onUpdate((e) => {
      if (mode === "select") {
        updateDrag(e.translationX, e.translationY)
        return
      }
      if (mode === "text") return
      pushDraftPoint({ x: e.x, y: e.y, p: 1 })
    })
    .onEnd((e) => {
      if (mode === "select") {
        endDrag(e.translationX, e.translationY)
        return
      }
      if (mode === "text") return
      const points = draftRef.current
      resetDraft()
      if (points.length === 0) return
      const shape = buildShape(mode, points, color, strokeWidth, newShapeId())
      if (shape) store.addShape(shape)
    })

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      if (mode === "select") {
        onSelectedIdChange(hitTest(store.snapshot(), { x: e.x, y: e.y })?.id ?? null)
        return
      }
      if (mode !== "text") return
      onTextTap?.({ x: e.x, y: e.y })
    })

  const gesture = Gesture.Race(pan, tap)

  // The shape under the finger is previewed at its new position without being
  // written to the store, so a drag costs one history entry instead of one per
  // frame.
  const painted =
    dragPreview === null
      ? shapes
      : shapes.map((s) =>
          s.id === dragPreview.id ? translateShape(s, dragPreview.dx, dragPreview.dy) : s,
        )

  const selected =
    mode === "select" && selectedId !== null
      ? (painted.find((s) => s.id === selectedId) ?? null)
      : null

  const draftShape = buildShape(mode, draftPoints, color, strokeWidth, DRAFT_ID)

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height }}>
        <Svg width={width} height={height}>
          {painted.map((s, i) => renderShape(s, i))}
          {draftShape !== null ? renderShape(draftShape, "draft") : null}
          {/* Selection chrome lives here and nowhere else. FlattenView renders
              shapes through renderShape, which knows nothing about selection,
              so the outline can never bake into the submitted PNG. */}
          {selected !== null ? <SelectionOutline shape={selected} /> : null}
        </Svg>
      </View>
    </GestureDetector>
  )
}

function SelectionOutline({ shape }: { shape: Shape }) {
  const b = shapeBounds(shape)
  return (
    <Rect
      x={b.x - SELECTION_PAD}
      y={b.y - SELECTION_PAD}
      width={b.w + SELECTION_PAD * 2}
      height={b.h + SELECTION_PAD * 2}
      stroke={SELECTION_COLOR}
      strokeWidth={1.5}
      strokeDasharray={[5, 4]}
      fill="none"
    />
  )
}

/**
 * Turns a drag into a shape. Returns null for modes that don't draw from a
 * drag (`text` is placed by a tap, `select` moves what's already there) and
 * for a drag with no points yet.
 */
function buildShape(
  mode: CanvasMode,
  points: PenPoint[],
  color: string,
  strokeWidth: number,
  id: string,
): Shape | null {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  if (mode === "pen") return { kind: "pen", id, color, strokeWidth, points }
  if (mode === "arrow") {
    return {
      kind: "arrow",
      id,
      color,
      strokeWidth,
      x1: first.x,
      y1: first.y,
      x2: last.x,
      y2: last.y,
    }
  }
  if (mode === "rect" || mode === "highlight") {
    return {
      kind: mode,
      id,
      color,
      strokeWidth,
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      w: Math.abs(last.x - first.x),
      h: Math.abs(last.y - first.y),
    }
  }
  return null
}
