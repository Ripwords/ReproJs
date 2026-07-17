import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import {
  pickMime,
  startScreenRecording,
  MAX_RECORDING_MS,
  RECORDING_VIDEO_BPS,
} from "./screen-record"

let win: Window
beforeAll(() => {
  win = new Window()
  Object.assign(globalThis, { window: win, document: win.document, navigator: win.navigator })
})
afterAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.document
  delete g.navigator
})

type Listener = (ev: { data?: Blob }) => void

class FakeTrack {
  stopped = false
  private listeners: (() => void)[] = []
  stop() {
    this.stopped = true
  }
  addEventListener(_: "ended", cb: () => void) {
    this.listeners.push(cb)
  }
  fireEnded() {
    for (const cb of this.listeners) cb()
  }
}

class FakeStream {
  tracks = [new FakeTrack()]
  getTracks() {
    return this.tracks
  }
  getVideoTracks() {
    return this.tracks
  }
}

class FakeMediaRecorder {
  static created: FakeMediaRecorder[] = []
  ondataavailable: Listener | null = null
  onstop: (() => void) | null = null
  state = "inactive"
  constructor(
    public stream: FakeStream,
    public opts: { mimeType?: string; videoBitsPerSecond?: number },
  ) {
    FakeMediaRecorder.created.push(this)
  }
  start(_timeslice: number) {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    this.ondataavailable?.({ data: new Blob(["chunk"], { type: "video/webm" }) })
    this.onstop?.()
  }
}

function deps(stream: FakeStream) {
  return {
    getDisplayMedia: async () => stream as unknown as MediaStream, // FakeStream implements the used surface
    createMediaRecorder: (s: MediaStream, o: MediaRecorderOptions) =>
      new FakeMediaRecorder(s as unknown as FakeStream, o) as unknown as MediaRecorder,
  }
}

/**
 * Mirrors the real MediaRecorder spec gap: `.stop()` flips `state` to
 * "inactive" synchronously, but `ondataavailable`/`onstop` fire asynchronously
 * afterwards. This lets tests exercise a second termination trigger arriving
 * in that synchronous-state/async-event gap.
 */
class FakeAsyncMediaRecorder {
  static created: FakeAsyncMediaRecorder[] = []
  ondataavailable: Listener | null = null
  onstop: (() => void) | null = null
  state = "inactive"
  constructor(
    public stream: FakeStream,
    public opts: { mimeType?: string; videoBitsPerSecond?: number },
  ) {
    FakeAsyncMediaRecorder.created.push(this)
  }
  start(_timeslice: number) {
    this.state = "recording"
  }
  stop() {
    this.state = "inactive"
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["chunk"], { type: "video/webm" }) })
      this.onstop?.()
    }, 0)
  }
}

function asyncDeps(stream: FakeStream) {
  return {
    getDisplayMedia: async () => stream as unknown as MediaStream, // FakeStream implements the used surface
    createMediaRecorder: (s: MediaStream, o: MediaRecorderOptions) =>
      new FakeAsyncMediaRecorder(s as unknown as FakeStream, o) as unknown as MediaRecorder,
  }
}

test("constants match the spec", () => {
  expect(MAX_RECORDING_MS).toBe(300_000)
  expect(RECORDING_VIDEO_BPS).toBe(2_500_000)
})

test("pickMime returns the full parameterized candidate the browser supports", () => {
  const g = globalThis as unknown as Record<string, unknown>
  const prev = g.MediaRecorder
  g.MediaRecorder = {
    isTypeSupported: (m: string) => m === "video/webm;codecs=vp9" || m === "video/webm",
  }
  try {
    expect(pickMime()).toBe("video/webm;codecs=vp9")
  } finally {
    if (prev === undefined) delete g.MediaRecorder
    else g.MediaRecorder = prev
  }
})

test("RecordingResult.mime is the bare container mime, never a parameterized codec string", async () => {
  const g = globalThis as unknown as Record<string, unknown>
  const prev = g.MediaRecorder
  // Force pickMime to select the parameterized vp9 candidate — the real-world
  // Chrome case that produced a `video/webm;codecs=vp9` mime and 415'd intake.
  g.MediaRecorder = {
    isTypeSupported: (m: string) => m === "video/webm;codecs=vp9" || m === "video/webm",
  }
  try {
    const stream = new FakeStream()
    let ended: { result: unknown; reason: string } | null = null
    const session = await startScreenRecording({
      ...deps(stream),
      onEnd: (result, reason) => {
        ended = { result, reason }
      },
    })
    expect(session).not.toBeNull()
    session!.stop()
    await Bun.sleep(10)
    const result = ended!.result as { blob: Blob; mime: string; durationMs: number }
    expect(result.mime).toBe("video/webm")
    expect(result.mime).not.toContain(";")
    expect(result.blob.type).toBe("video/webm")
  } finally {
    if (prev === undefined) delete g.MediaRecorder
    else g.MediaRecorder = prev
  }
})

test("stop() assembles chunks, reports duration, stops tracks", async () => {
  const stream = new FakeStream()
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({
    ...deps(stream),
    onEnd: (result, reason) => {
      ended = { result, reason }
    },
  })
  expect(session).not.toBeNull()
  session!.stop()
  await Bun.sleep(10)
  expect(ended!.reason).toBe("stopped")
  const result = ended!.result as { blob: Blob; mime: string; durationMs: number }
  expect(result.blob.size).toBeGreaterThan(0)
  expect(result.mime).toContain("video/")
  expect(stream.tracks[0]!.stopped).toBe(true)
})

test("cancel() discards and reports null", async () => {
  const stream = new FakeStream()
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({
    ...deps(stream),
    onEnd: (r, reason) => {
      ended = { result: r, reason }
    },
  })
  session!.cancel()
  await Bun.sleep(10)
  expect(ended).toEqual({ result: null, reason: "cancelled" })
  expect(stream.tracks[0]!.stopped).toBe(true)
})

test("native stop-sharing (track ended) finishes the recording", async () => {
  const stream = new FakeStream()
  let reason = ""
  const session = await startScreenRecording({
    ...deps(stream),
    onEnd: (_r, why) => {
      reason = why
    },
  })
  expect(session).not.toBeNull()
  stream.tracks[0]!.fireEnded()
  await Bun.sleep(10)
  expect(reason).toBe("track-ended")
})

test("auto-stops at maxMs", async () => {
  const stream = new FakeStream()
  let reason = ""
  await startScreenRecording({
    ...deps(stream),
    maxMs: 40,
    onEnd: (_r, why) => {
      reason = why
    },
  })
  await Bun.sleep(700) // TICK_MS is 500; one tick past maxMs must fire auto-stop
  expect(reason).toBe("auto")
})

test("returns null when getDisplayMedia rejects", async () => {
  const session = await startScreenRecording({
    getDisplayMedia: async () => {
      throw new Error("denied")
    },
    onEnd: () => {},
  })
  expect(session).toBeNull()
})

test("first-trigger-wins: cancel() arriving after auto-stop's recorder.stop() does not relabel the result", async () => {
  const stream = new FakeStream()
  let endedCalls = 0
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({
    ...asyncDeps(stream),
    maxMs: 40,
    onEnd: (result, reason) => {
      endedCalls++
      ended = { result, reason }
    },
  })
  expect(session).not.toBeNull()
  // Deterministically land in the spec's synchronous-state/async-event gap:
  // wrap the fake recorder's stop() so that the moment auto-stop's tick calls
  // it (state flips to "inactive" synchronously) we immediately fire a second
  // termination trigger, still before the queued onstop/ondataavailable run.
  const rec = FakeAsyncMediaRecorder.created.at(-1)!
  const originalStop = rec.stop.bind(rec)
  rec.stop = () => {
    originalStop()
    session!.cancel()
  }
  await Bun.sleep(700) // TICK_MS is 500; one tick past maxMs must fire auto-stop
  await Bun.sleep(10)
  expect(endedCalls).toBe(1)
  expect(ended!.reason).toBe("auto")
  const result = ended!.result as { blob: Blob; mime: string; durationMs: number } | null
  expect(result).not.toBeNull()
  expect(result!.blob.size).toBeGreaterThan(0)
})

test("first-trigger-wins: stop() arriving right after cancel() does not resurrect the recording", async () => {
  const stream = new FakeStream()
  let endedCalls = 0
  let ended: { result: unknown; reason: string } | null = null
  const session = await startScreenRecording({
    ...asyncDeps(stream),
    onEnd: (result, reason) => {
      endedCalls++
      ended = { result, reason }
    },
  })
  expect(session).not.toBeNull()
  session!.cancel()
  session!.stop()
  await Bun.sleep(10)
  expect(endedCalls).toBe(1)
  expect(ended).toEqual({ result: null, reason: "cancelled" })
})
