import { h } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { closeSource, decodeImage, sourceHeight, sourceWidth } from "./decode-image"

interface Props {
  blob: Blob
  alt: string
  class?: string
}

// Renders a Blob as an image without going through a blob: object URL, which
// host-page CSPs routinely refuse (`img-src 'self' data:`). Draws the decoded
// bitmap into a <canvas> instead — canvas painting is not a resource load, so
// no img-src check applies. See decode-image.ts.
//
// <canvas> is a replaced element, so the object-fit / aspect-ratio rules the
// thumbnails rely on still apply.
export function BlobImage({ blob, alt, class: className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // decodeImage is documented to always resolve (null on failure)
      // rather than throw, but this is the SDK's fail-open guarantee, not
      // a runtime one — never let a widget-breaking exception here reach
      // an unhandled rejection. Treat a throw the same as a null result.
      let src: Awaited<ReturnType<typeof decodeImage>> = null
      try {
        src = await decodeImage(blob)
      } catch {
        return
      }
      if (!src) return
      const canvas = ref.current
      if (cancelled || !canvas) {
        closeSource(src)
        return
      }
      canvas.width = sourceWidth(src)
      canvas.height = sourceHeight(src)
      canvas.getContext("2d")?.drawImage(src, 0, 0)
      closeSource(src)
    })()
    return () => {
      cancelled = true
    }
  }, [blob])

  return h("canvas", { ref, class: className, role: "img", "aria-label": alt })
}
