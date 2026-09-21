import type { Shape } from "./types"

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

/**
 * Default forgiveness, in canvas units, when deciding whether a tap landed on
 * a shape. A fingertip covers far more than a 2px stroke, so every hit test
 * inflates the target by at least this much.
 */
export const DEFAULT_HIT_SLOP = 12

/**
 * Text metrics we have to guess at. React Native gives no synchronous text
 * measurement, and the annotation canvas needs a box *now* to hit-test and to
 * draw a selection outline, so the box is estimated from the font size:
 *
 * - `TEXT_ADVANCE_RATIO` — mean glyph advance as a fraction of font size.
 *   0.6 is the usual approximation for a proportional sans-serif.
 * - `TEXT_ASCENT_RATIO` — how far the glyphs rise above the baseline. SVG
 *   text is positioned by its baseline, so the box starts above `y`.
 * - `TEXT_LINE_RATIO` — full line height, ascent plus descent.
 *
 * The estimate is deliberately generous: an outline slightly larger than the
 * glyphs looks intentional, while one that clips them looks broken.
 */
export const TEXT_ADVANCE_RATIO = 0.6
export const TEXT_ASCENT_RATIO = 0.8
export const TEXT_LINE_RATIO = 1.2

/** Axis-aligned box enclosing a shape, in canvas coordinates. */
export function shapeBounds(shape: Shape): Bounds {
  if (shape.kind === "rect" || shape.kind === "highlight") {
    return normalize(shape.x, shape.y, shape.w, shape.h)
  }
  if (shape.kind === "arrow") {
    return normalize(shape.x1, shape.y1, shape.x2 - shape.x1, shape.y2 - shape.y1)
  }
  if (shape.kind === "text") {
    const w = Math.max(shape.content.length * shape.fontSize * TEXT_ADVANCE_RATIO, shape.fontSize)
    return {
      x: shape.x,
      y: shape.y - shape.fontSize * TEXT_ASCENT_RATIO,
      w,
      h: shape.fontSize * TEXT_LINE_RATIO,
    }
  }
  if (shape.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of shape.points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Topmost shape under `point`, or null. Later shapes win, matching what the
 * reporter sees: shapes are painted in insertion order, so the last one drawn
 * is the one on top.
 *
 * Filled and box-like shapes (rect, highlight, text) are grabbable anywhere
 * inside them — an unfilled rectangle's 2px border is far too thin to catch
 * with a finger. Arrows and pen strokes are matched against the ink itself, so
 * a long diagonal can't be picked up from the empty corner of its bounding box.
 */
export function hitTest(
  shapes: Shape[],
  point: Point,
  slop: number = DEFAULT_HIT_SLOP,
): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]
    if (shape && isHit(shape, point, slop)) return shape
  }
  return null
}

/** Copy of `shape` offset by (dx, dy). The input is never mutated. */
export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.kind === "arrow") {
    return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy }
  }
  if (shape.kind === "pen") {
    return { ...shape, points: shape.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy }
}

/**
 * Trims a drag so the shape stays fully on the canvas. Without this a shape
 * dragged past the edge is unreachable forever — there is nothing left to tap
 * to select it again, and only undo can bring it back.
 *
 * A shape bigger than the canvas in one axis is left unconstrained on that
 * axis, since no offset could satisfy the rule and clamping would freeze it.
 */
export function clampTranslation(
  shape: Shape,
  dx: number,
  dy: number,
  canvas: { w: number; h: number },
): { dx: number; dy: number } {
  const b = shapeBounds(shape)
  return {
    dx: b.w <= canvas.w ? clamp(dx, -b.x, canvas.w - (b.x + b.w)) : dx,
    dy: b.h <= canvas.h ? clamp(dy, -b.y, canvas.h - (b.y + b.h)) : dy,
  }
}

function isHit(shape: Shape, point: Point, slop: number): boolean {
  const reach = slop + shape.strokeWidth / 2
  if (shape.kind === "arrow") {
    return distanceToSegment(point, shape.x1, shape.y1, shape.x2, shape.y2) <= reach
  }
  if (shape.kind === "pen") {
    const pts = shape.points
    if (pts.length === 1) {
      const only = pts[0]
      return only !== undefined && distance(point, only) <= reach
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      if (a && b && distanceToSegment(point, a.x, a.y, b.x, b.y) <= reach) return true
    }
    return false
  }
  const b = shapeBounds(shape)
  return (
    point.x >= b.x - slop &&
    point.x <= b.x + b.w + slop &&
    point.y >= b.y - slop &&
    point.y <= b.y + b.h + slop
  )
}

function distanceToSegment(p: Point, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distance(p, { x: x1, y: y1 })
  // Projection of p onto the segment, clamped to the segment's ends.
  const t = clamp(((p.x - x1) * dx + (p.y - y1) * dy) / lengthSq, 0, 1)
  return distance(p, { x: x1 + t * dx, y: y1 + t * dy })
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function normalize(x: number, y: number, w: number, h: number): Bounds {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
