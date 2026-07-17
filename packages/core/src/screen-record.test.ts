import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { startScreenRecording, MAX_RECORDING_MS, RECORDING_VIDEO_BPS } from "./screen-record"

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

test("constants match the spec", () => {
  expect(MAX_RECORDING_MS).toBe(300_000)
  expect(RECORDING_VIDEO_BPS).toBe(2_500_000)
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
