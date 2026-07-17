import { describe, expect, test } from "bun:test"
import { clampPlayback } from "./clamp-playback"

describe("clampPlayback", () => {
  test("normal pre-start seek: currentTime before trim start seeks forward", () => {
    const action = clampPlayback({
      currentTime: 0,
      duration: 20,
      trimStartMs: 5000,
      trimEndMs: null,
    })
    expect(action).toEqual({ type: "seek", to: 5 })
  })

  test("THE BUG: trimStartMs beyond real duration must not seek — stays none forever", () => {
    const input = {
      currentTime: 10,
      duration: 10,
      trimStartMs: 60_000,
      trimEndMs: null,
    }
    const first = clampPlayback(input)
    expect(first).toEqual({ type: "none" })

    // Re-invoking with the identical state (as timeupdate would fire again
    // after a browser-clamped seek) must keep returning "none" — this is
    // the loop-proof guarantee.
    const second = clampPlayback(input)
    expect(second).toEqual({ type: "none" })
    const third = clampPlayback(input)
    expect(third).toEqual({ type: "none" })
  })

  test("trim-end pause-and-reset: currentTime past a real trim end pauses and resets to start", () => {
    const action = clampPlayback({
      currentTime: 10,
      duration: 20,
      trimStartMs: 5000,
      trimEndMs: 10_000,
    })
    expect(action).toEqual({ type: "pause-and-reset", to: 5 })
  })

  test("natural EOF with trimEnd null → none (not a real trim end)", () => {
    const action = clampPlayback({
      currentTime: 20,
      duration: 20,
      trimStartMs: 0,
      trimEndMs: null,
    })
    expect(action).toEqual({ type: "none" })
  })

  test("epsilon: gap of 0.1s below start is not worth seeking", () => {
    const action = clampPlayback({
      currentTime: 4.9,
      duration: 20,
      trimStartMs: 5000,
      trimEndMs: null,
    })
    expect(action).toEqual({ type: "none" })
  })

  test("epsilon: gap of 3s below start does seek", () => {
    const action = clampPlayback({
      currentTime: 2,
      duration: 20,
      trimStartMs: 5000,
      trimEndMs: null,
    })
    expect(action).toEqual({ type: "seek", to: 5 })
  })

  test("NaN duration during metadata load does not affect normal pre-start seek", () => {
    const action = clampPlayback({
      currentTime: 0,
      duration: Number.NaN,
      trimStartMs: 5000,
      trimEndMs: null,
    })
    expect(action).toEqual({ type: "seek", to: 5 })
  })

  test("degenerate row: trimStart >= trimEnd after capping plays untrimmed", () => {
    const action = clampPlayback({
      currentTime: 3,
      duration: 20,
      trimStartMs: 15_000,
      trimEndMs: 10_000,
    })
    expect(action).toEqual({ type: "none" })
  })
})
