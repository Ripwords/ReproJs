import { expect, test } from "bun:test"
import type { Shape } from "./types"
import { clampTranslation, hitTest, shapeBounds, translateShape } from "./hit-test"

function rect(over: Partial<Extract<Shape, { kind: "rect" }>> = {}): Shape {
  return {
    kind: "rect",
    id: "r1",
    color: "#f00",
    strokeWidth: 2,
    x: 10,
    y: 20,
    w: 40,
    h: 30,
    ...over,
  }
}

function text(over: Partial<Extract<Shape, { kind: "text" }>> = {}): Shape {
  return {
    kind: "text",
    id: "t1",
    color: "#f00",
    strokeWidth: 2,
    x: 100,
    y: 100,
    w: 0,
    h: 0,
    content: "hello",
    fontSize: 16,
    ...over,
  }
}

function arrow(over: Partial<Extract<Shape, { kind: "arrow" }>> = {}): Shape {
  return {
    kind: "arrow",
    id: "a1",
    color: "#f00",
    strokeWidth: 2,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
    ...over,
  }
}

function pen(points: Array<{ x: number; y: number }>): Shape {
  return {
    kind: "pen",
    id: "p1",
    color: "#f00",
    strokeWidth: 2,
    points: points.map((p) => ({ ...p, p: 1 })),
  }
}

// --- shapeBounds -------------------------------------------------------------

test("shapeBounds returns the rect itself", () => {
  expect(shapeBounds(rect())).toEqual({ x: 10, y: 20, w: 40, h: 30 })
})

test("shapeBounds normalises a rect drawn with negative extent", () => {
  expect(shapeBounds(rect({ x: 50, y: 50, w: -20, h: -10 }))).toEqual({
    x: 30,
    y: 40,
    w: 20,
    h: 10,
  })
})

test("shapeBounds spans both arrow endpoints regardless of direction", () => {
  expect(shapeBounds(arrow({ x1: 100, y1: 80, x2: 20, y2: 10 }))).toEqual({
    x: 20,
    y: 10,
    w: 80,
    h: 70,
  })
})

test("shapeBounds covers every pen point", () => {
  const b = shapeBounds(
    pen([
      { x: 5, y: 5 },
      { x: 25, y: 15 },
      { x: 15, y: 40 },
    ]),
  )
  expect(b).toEqual({ x: 5, y: 5, w: 20, h: 35 })
})

test("shapeBounds of a text sits above the baseline", () => {
  // SVG text is positioned by its baseline, so the box has to extend upwards
  // from `y` or a tap on the glyphs would miss it entirely.
  const b = shapeBounds(text({ x: 100, y: 100, fontSize: 20 }))
  expect(b.x).toBe(100)
  expect(b.y).toBeLessThan(100)
  expect(b.y + b.h).toBeGreaterThan(100)
  expect(b.w).toBeGreaterThan(0)
})

test("shapeBounds of a text scales with content length", () => {
  const short = shapeBounds(text({ content: "hi" }))
  const long = shapeBounds(text({ content: "a much longer label" }))
  expect(long.w).toBeGreaterThan(short.w)
})

test("shapeBounds gives an empty pen shape a zero box rather than infinities", () => {
  expect(shapeBounds(pen([]))).toEqual({ x: 0, y: 0, w: 0, h: 0 })
})

// --- hitTest -----------------------------------------------------------------

test("hitTest finds a rect when tapped inside", () => {
  const r = rect()
  expect(hitTest([r], { x: 30, y: 30 })?.id).toBe("r1")
})

test("hitTest misses a rect tapped well outside", () => {
  expect(hitTest([rect()], { x: 300, y: 300 })).toBeNull()
})

test("hitTest forgives a near miss by the slop margin", () => {
  // Fingers are imprecise: just outside the edge still counts.
  expect(hitTest([rect()], { x: 8, y: 30 }, 12)?.id).toBe("r1")
  expect(hitTest([rect()], { x: 8, y: 30 }, 0)).toBeNull()
})

test("hitTest returns the topmost shape when two overlap", () => {
  const under = rect({ id: "under" })
  const over = rect({ id: "over" })
  expect(hitTest([under, over], { x: 30, y: 30 })?.id).toBe("over")
})

test("hitTest matches an arrow by distance to its shaft, not its bounding box", () => {
  const a = arrow({ x1: 0, y1: 0, x2: 100, y2: 100 })
  expect(hitTest([a], { x: 50, y: 50 })?.id).toBe("a1")
  // Inside the bounding box but far from the diagonal line.
  expect(hitTest([a], { x: 95, y: 5 })).toBeNull()
})

test("hitTest matches a pen stroke near any of its segments", () => {
  const p = pen([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ])
  expect(hitTest([p], { x: 50, y: 2 })?.id).toBe("p1")
  expect(hitTest([p], { x: 98, y: 80 })?.id).toBe("p1")
  // The open corner of the L — inside the box, nowhere near the ink.
  expect(hitTest([p], { x: 10, y: 90 })).toBeNull()
})

test("hitTest matches a text label by its estimated box", () => {
  expect(hitTest([text({ x: 100, y: 100 })], { x: 105, y: 95 })?.id).toBe("t1")
})

test("hitTest on an empty list is null", () => {
  expect(hitTest([], { x: 0, y: 0 })).toBeNull()
})

// --- translateShape ----------------------------------------------------------

test("translateShape moves a rect and leaves the original untouched", () => {
  const r = rect()
  const moved = translateShape(r, 5, -10)
  expect(moved).toMatchObject({ x: 15, y: 10, w: 40, h: 30 })
  expect(r).toMatchObject({ x: 10, y: 20 })
})

test("translateShape moves both arrow endpoints", () => {
  const moved = translateShape(arrow(), 10, 20)
  expect(moved).toMatchObject({ x1: 10, y1: 20, x2: 110, y2: 120 })
})

test("translateShape moves every pen point", () => {
  const moved = translateShape(
    pen([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]),
    3,
    4,
  )
  expect(moved.kind === "pen" && moved.points).toEqual([
    { x: 3, y: 4, p: 1 },
    { x: 13, y: 14, p: 1 },
  ])
})

test("translateShape keeps the shape id and style", () => {
  const moved = translateShape(text(), 1, 1)
  expect(moved.id).toBe("t1")
  expect(moved.color).toBe("#f00")
  expect(moved.kind === "text" && moved.content).toBe("hello")
})

// --- clampTranslation --------------------------------------------------------

test("clampTranslation passes a move that stays inside through unchanged", () => {
  expect(clampTranslation(rect(), 5, 5, { w: 200, h: 200 })).toEqual({ dx: 5, dy: 5 })
})

test("clampTranslation stops a shape at the left and top edges", () => {
  // rect sits at x:10 y:20, so it can only move -10 / -20 before clipping.
  expect(clampTranslation(rect(), -50, -60, { w: 200, h: 200 })).toEqual({ dx: -10, dy: -20 })
})

test("clampTranslation stops a shape at the right and bottom edges", () => {
  // rect is 40x30 inside a 100x100 canvas: 50 left horizontally, 50 vertically.
  expect(clampTranslation(rect(), 999, 999, { w: 100, h: 100 })).toEqual({ dx: 50, dy: 50 })
})

test("clampTranslation leaves a shape larger than the canvas free to move", () => {
  const huge = rect({ x: 0, y: 0, w: 500, h: 500 })
  expect(clampTranslation(huge, -100, -100, { w: 100, h: 100 })).toEqual({ dx: -100, dy: -100 })
})
