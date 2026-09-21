import type { Shape } from "@reprojs/sdk-utils"
import { translateShape } from "@reprojs/sdk-utils"

export interface AnnotationStore {
  addShape: (s: Shape) => void
  /** Offsets one shape by (dx, dy) as a single undoable step. */
  moveShape: (id: string, dx: number, dy: number) => void
  undo: () => void
  redo: () => void
  clear: () => void
  snapshot: () => Shape[]
  subscribe: (fn: () => void) => () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

/**
 * History is kept as whole-list snapshots rather than a stack of added shapes,
 * because undo has to reverse edits as well as additions: once a shape can be
 * dragged, "pop the last shape" would delete the label you just nudged instead
 * of putting it back where it was. Annotations number in the tens, so copying
 * the list per edit costs nothing.
 */
export function createAnnotationStore(): AnnotationStore {
  let past: Shape[][] = []
  let present: Shape[] = []
  let future: Shape[][] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }
  /** Commits a new shape list, making the previous one undoable. */
  const commit = (next: Shape[]) => {
    past = [...past, present]
    present = next
    future = []
    notify()
  }
  return {
    addShape(s) {
      commit([...present, s])
    },
    moveShape(id, dx, dy) {
      if (dx === 0 && dy === 0) return
      if (!present.some((s) => s.id === id)) return
      commit(present.map((s) => (s.id === id ? translateShape(s, dx, dy) : s)))
    },
    undo() {
      const previous = past[past.length - 1]
      if (previous === undefined) return
      past = past.slice(0, -1)
      future = [present, ...future]
      present = previous
      notify()
    },
    redo() {
      const next = future[0]
      if (next === undefined) return
      future = future.slice(1)
      past = [...past, present]
      present = next
      notify()
    },
    clear() {
      past = []
      present = []
      future = []
      notify()
    },
    snapshot: () => present,
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  }
}
