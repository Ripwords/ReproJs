import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react"
import { Image, View } from "react-native"
import Svg from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import type { Shape } from "@reprojs/sdk-utils"
import { renderShape } from "../annotation/render-shape"

export interface FlattenHandle {
  flatten: () => Promise<{ uri: string }>
}

interface Props {
  uri: string
  width: number
  height: number
  shapes: Shape[]
}

/** How long flatten() waits for the screenshot bitmap to decode before giving
 *  up. The image is a local PNG the SDK just wrote, so this is generous; the
 *  caller falls back to the un-annotated screenshot on rejection. */
const IMAGE_LOAD_TIMEOUT_MS = 5_000

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
}

function deferred(): Deferred {
  const settle: Partial<Pick<Deferred, "resolve" | "reject">> = {}
  const promise = new Promise<void>((resolve, reject) => {
    settle.resolve = resolve
    settle.reject = reject
  })
  // Rejections are consumed inside flatten(); never surface as unhandled.
  promise.catch(() => undefined)
  return {
    promise,
    resolve: () => settle.resolve?.(),
    reject: (err) => settle.reject?.(err),
  }
}

export const FlattenView = forwardRef<FlattenHandle, Props>(function FlattenView(
  { uri, width, height, shapes },
  ref,
) {
  const viewRef = useRef<View>(null)
  // Settles when the <Image> for this uri has decoded. captureRef before that
  // point snapshots an empty image view, which on Android produced PNGs with
  // the annotations drawn over a blank background.
  const loaded = useMemo(() => deferred(), [uri])

  useImperativeHandle(ref, () => ({
    flatten: async () => {
      if (!viewRef.current) throw new Error("Repro: flatten view not mounted")
      let timer: ReturnType<typeof setTimeout> | null = null
      try {
        await Promise.race([
          loaded.promise,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Repro: screenshot did not decode in time")),
              IMAGE_LOAD_TIMEOUT_MS,
            )
          }),
        ])
      } finally {
        if (timer !== null) clearTimeout(timer)
      }
      const out = await captureRef(viewRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      })
      return { uri: out }
    },
  }))

  return (
    // Kept inside the layout at opacity 0 rather than parked at left: -9999.
    // Views far offscreen are a candidate for the platform to skip drawing
    // entirely, and an undrawn view captures blank. The opacity sits on this
    // wrapper, not on the captured view, so the snapshot itself is opaque.
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, width, height, opacity: 0 }}
    >
      <View
        ref={viewRef}
        collapsable={false}
        // Transparent background so the exported PNG's letterbox bars (created
        // by resizeMode="contain") are alpha-transparent — the dashboard's dark
        // surface shows through instead of a hardcoded light-gray frame.
        // `format: "png"` in captureRef preserves the alpha channel.
        style={{ width, height, backgroundColor: "transparent" }}
      >
        {/* resizeMode="contain" mirrors what the StepAnnotate preview uses, so
            shape coordinates drawn on the preview land at the same pixel offsets
            in the flattened PNG — no more cover-crop that clipped top + bottom. */}
        <Image
          source={{ uri }}
          style={{ width, height }}
          resizeMode="contain"
          onLoad={() => loaded.resolve()}
          onError={(e) =>
            loaded.reject(
              new Error(`Repro: screenshot failed to decode: ${e.nativeEvent.error ?? "unknown"}`),
            )
          }
        />
        <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
          {shapes.map((s, i) => renderShape(s, i))}
        </Svg>
      </View>
    </View>
  )
})
