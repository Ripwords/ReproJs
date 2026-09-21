import { test, expect } from "bun:test"
import { createAnnotationStore } from "./store"
import { newShapeId } from "@reprojs/sdk-utils"
import type { Shape } from "@reprojs/sdk-utils"

function rect(color = "#f00", x = 0): Shape {
  return { kind: "rect", id: newShapeId(), color, strokeWidth: 2, x, y: 0, w: 1, h: 1 }
}

test("addShape appends and snapshot returns the list", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  expect(s.snapshot()).toHaveLength(1)
})

test("undo removes last, redo re-adds", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  s.undo()
  expect(s.snapshot()).toHaveLength(0)
  s.redo()
  expect(s.snapshot()).toHaveLength(1)
})

test("addShape after undo discards redo stack", () => {
  const s = createAnnotationStore()
  s.addShape(rect("#f00", 0))
  s.undo()
  s.addShape(rect("#0f0", 1))
  expect(s.snapshot()).toHaveLength(1)
  s.redo() // no-op
  expect(s.snapshot()).toHaveLength(1)
})

test("clear empties and resets stacks", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  s.clear()
  expect(s.snapshot()).toEqual([])
  s.redo()
  expect(s.snapshot()).toEqual([])
})

test("canUndo is false on empty store, true after addShape", () => {
  const s = createAnnotationStore()
  expect(s.canUndo()).toBe(false)
  s.addShape(rect())
  expect(s.canUndo()).toBe(true)
  s.undo()
  expect(s.canUndo()).toBe(false)
})

test("canRedo is false initially, true after undo, false after redo", () => {
  const s = createAnnotationStore()
  expect(s.canRedo()).toBe(false)
  s.addShape(rect())
  expect(s.canRedo()).toBe(false)
  s.undo()
  expect(s.canRedo()).toBe(true)
  s.redo()
  expect(s.canRedo()).toBe(false)
})

test("canRedo is false after addShape clears redo stack", () => {
  const s = createAnnotationStore()
  s.addShape(rect("#f00", 0))
  s.undo()
  expect(s.canRedo()).toBe(true)
  s.addShape(rect("#0f0", 1))
  expect(s.canRedo()).toBe(false)
})

test("moveShape offsets the matching shape and leaves others alone", () => {
  const s = createAnnotationStore()
  const a = rect("#f00", 0)
  const b = rect("#0f0", 100)
  s.addShape(a)
  s.addShape(b)
  s.moveShape(a.id, 5, 7)
  const [movedA, untouchedB] = s.snapshot()
  expect(movedA).toMatchObject({ id: a.id, x: 5, y: 7 })
  expect(untouchedB).toMatchObject({ id: b.id, x: 100, y: 0 })
})

test("moveShape keeps the shape's place in the paint order", () => {
  const s = createAnnotationStore()
  const first = rect("#f00", 0)
  const second = rect("#0f0", 100)
  s.addShape(first)
  s.addShape(second)
  s.moveShape(first.id, 10, 0)
  expect(s.snapshot().map((x) => x.id)).toEqual([first.id, second.id])
})

test("undo after a move restores the old position instead of deleting the shape", () => {
  const s = createAnnotationStore()
  const r = rect("#f00", 0)
  s.addShape(r)
  s.moveShape(r.id, 40, 40)
  s.undo()
  expect(s.snapshot()).toHaveLength(1)
  expect(s.snapshot()[0]).toMatchObject({ x: 0, y: 0 })
  s.redo()
  expect(s.snapshot()[0]).toMatchObject({ x: 40, y: 40 })
})

test("moveShape with an unknown id records no history step", () => {
  const s = createAnnotationStore()
  s.addShape(rect())
  s.undo()
  expect(s.canUndo()).toBe(false)
  s.moveShape("nope", 10, 10)
  expect(s.canUndo()).toBe(false)
  expect(s.canRedo()).toBe(true)
})

test("a zero-distance move records no history step", () => {
  const s = createAnnotationStore()
  const r = rect()
  s.addShape(r)
  s.moveShape(r.id, 0, 0)
  s.undo()
  expect(s.snapshot()).toHaveLength(0)
})

test("moveShape discards the redo stack", () => {
  const s = createAnnotationStore()
  const r = rect("#f00", 0)
  s.addShape(r)
  s.addShape(rect("#0f0", 50))
  s.undo()
  expect(s.canRedo()).toBe(true)
  s.moveShape(r.id, 1, 1)
  expect(s.canRedo()).toBe(false)
})

test("moveShape notifies subscribers", () => {
  const s = createAnnotationStore()
  const r = rect()
  s.addShape(r)
  let calls = 0
  s.subscribe(() => {
    calls++
  })
  s.moveShape(r.id, 2, 2)
  expect(calls).toBe(1)
})
