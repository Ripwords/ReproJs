import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { makeThumbnail } from "./thumbnail"

let win: Window
beforeAll(() => {
  win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})
afterAll(() => {
  // @ts-expect-error test cleanup
  delete globalThis.window // @ts-expect-error
  delete globalThis.document
})

test("returns null instead of throwing when decoding is impossible", async () => {
  const junk = new Blob(["not an image"], { type: "image/png" })
  expect(await makeThumbnail(junk, "image")).toBeNull()
  expect(await makeThumbnail(junk, "video")).toBeNull()
})
