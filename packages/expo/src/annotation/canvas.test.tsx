import { describe, expect, test } from "bun:test"
import React from "react"
import { act, create, type ReactTestInstance } from "react-test-renderer"
import {
  fireGesture,
  gestureOfKind,
  hostType,
  installNativeMocks,
} from "../test-support/native-mocks"
import type { CanvasMode } from "./mode"

installNativeMocks()

const CANVAS = { width: 300, height: 500 }

function rect(id: string, x: number, y: number) {
  return { kind: "rect", id, color: "#e53935", strokeWidth: 4, x, y, w: 60, h: 40 }
}

async function mountCanvas(mode: CanvasMode, shapes: unknown[] = []) {
  const { AnnotationCanvas } = await import("./canvas")
  const { createAnnotationStore } = await import("./store")
  const store = createAnnotationStore()
  for (const shape of shapes) {
    // The harness feeds in fully-formed shapes; the store only stores them.
    store.addShape(shape as Parameters<typeof store.addShape>[0])
  }

  const selections: Array<string | null> = []
  const textTaps: Array<{ x: number; y: number }> = []

  // selectedId has to be real state, or the canvas would never re-render with
  // a selection and the outline assertion would pass vacuously.
  function Harness() {
    const [selectedId, setSelectedId] = React.useState<string | null>(null)
    return (
      <AnnotationCanvas
        width={CANVAS.width}
        height={CANVAS.height}
        mode={mode}
        color="#e53935"
        strokeWidth={4}
        store={store}
        selectedId={selectedId}
        onSelectedIdChange={(id) => {
          selections.push(id)
          setSelectedId(id)
        }}
        onTextTap={(point) => textTaps.push(point)}
      />
    )
  }

  let tree: ReturnType<typeof create> | null = null
  act(() => {
    tree = create(<Harness />)
  })
  if (tree === null) throw new Error("canvas did not mount")
  const mounted: ReturnType<typeof create> = tree
  return {
    detector: mounted.root.findByType(hostType("GestureDetector")),
    /** Last id handed to onSelectedIdChange, or undefined if never called. */
    selection: () => selections[selections.length - 1],
    textTaps,
    store,
    rectCount: () => mounted.root.findAllByType(hostType("Rect")).length,
  }
}

function drag(
  detector: ReactTestInstance,
  from: { x: number; y: number },
  by: { x: number; y: number },
) {
  const pan = gestureOfKind(detector.props.gesture, "pan")
  const at = (dx: number, dy: number) => ({
    x: from.x + dx,
    y: from.y + dy,
    translationX: dx,
    translationY: dy,
  })
  act(() => {
    fireGesture(pan, "onStart", at(0, 0))
  })
  act(() => {
    fireGesture(pan, "onUpdate", at(by.x, by.y))
  })
  act(() => {
    fireGesture(pan, "onEnd", at(by.x, by.y))
  })
}

function tap(detector: ReactTestInstance, at: { x: number; y: number }) {
  const gesture = gestureOfKind(detector.props.gesture, "tap")
  act(() => {
    fireGesture(gesture, "onEnd", at)
  })
}

describe("AnnotationCanvas select mode", () => {
  test("tapping a shape selects it", async () => {
    const { detector, selection } = await mountCanvas("select", [rect("r1", 20, 20)])
    tap(detector, { x: 40, y: 30 })
    expect(selection()).toBe("r1")
  })

  test("tapping empty canvas clears the selection", async () => {
    const { detector, selection } = await mountCanvas("select", [rect("r1", 20, 20)])
    tap(detector, { x: 40, y: 30 })
    tap(detector, { x: 280, y: 480 })
    expect(selection()).toBeNull()
  })

  test("dragging a shape commits the move to the store", async () => {
    const { detector, store } = await mountCanvas("select", [rect("r1", 20, 20)])
    drag(detector, { x: 40, y: 30 }, { x: 50, y: 60 })
    expect(store.snapshot()[0]).toMatchObject({ id: "r1", x: 70, y: 80 })
  })

  test("a drag is one undo step, and undo restores the original position", async () => {
    const { detector, store } = await mountCanvas("select", [rect("r1", 20, 20)])
    drag(detector, { x: 40, y: 30 }, { x: 50, y: 60 })
    act(() => {
      store.undo()
    })
    expect(store.snapshot()[0]).toMatchObject({ id: "r1", x: 20, y: 20 })
  })

  test("a drag past the edge is clamped so the shape stays reachable", async () => {
    const { detector, store } = await mountCanvas("select", [rect("r1", 20, 20)])
    drag(detector, { x: 40, y: 30 }, { x: -999, y: -999 })
    expect(store.snapshot()[0]).toMatchObject({ id: "r1", x: 0, y: 0 })
  })

  test("dragging from empty space moves nothing", async () => {
    const { detector, store } = await mountCanvas("select", [rect("r1", 20, 20)])
    drag(detector, { x: 250, y: 450 }, { x: -30, y: -30 })
    expect(store.snapshot()[0]).toMatchObject({ id: "r1", x: 20, y: 20 })
    // No history step was recorded, so the only undo available is still the
    // one that removes the seeded shape.
    act(() => {
      store.undo()
    })
    expect(store.snapshot()).toHaveLength(0)
  })

  test("select mode never adds a shape", async () => {
    const { detector, store } = await mountCanvas("select")
    drag(detector, { x: 10, y: 10 }, { x: 80, y: 80 })
    expect(store.snapshot()).toHaveLength(0)
  })

  test("the selected shape gains a selection outline", async () => {
    // The outline is drawn by the canvas only. FlattenView renders shapes
    // through renderShape, which knows nothing about selection, so a selected
    // shape can never bake its outline into the submitted screenshot.
    const { detector, rectCount } = await mountCanvas("select", [rect("r1", 20, 20)])
    const before = rectCount()
    tap(detector, { x: 40, y: 30 })
    expect(rectCount()).toBe(before + 1)
  })
})

describe("AnnotationCanvas drawing modes", () => {
  test("pen mode still draws a stroke", async () => {
    const { detector, store } = await mountCanvas("pen")
    drag(detector, { x: 10, y: 10 }, { x: 40, y: 40 })
    expect(store.snapshot()).toHaveLength(1)
    expect(store.snapshot()[0]?.kind).toBe("pen")
  })

  test("rect mode still draws a rectangle from the drag extent", async () => {
    const { detector, store } = await mountCanvas("rect")
    drag(detector, { x: 10, y: 20 }, { x: 60, y: 40 })
    expect(store.snapshot()[0]).toMatchObject({ kind: "rect", x: 10, y: 20, w: 60, h: 40 })
  })

  test("text mode reports the tap position instead of drawing", async () => {
    const { detector, store, textTaps } = await mountCanvas("text")
    tap(detector, { x: 33, y: 44 })
    expect(textTaps).toEqual([{ x: 33, y: 44 }])
    expect(store.snapshot()).toHaveLength(0)
  })
})
