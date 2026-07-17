import { closeSource, decodeImage, sourceHeight, sourceWidth } from "../decode-image"

const MAX_EDGE = 160

/** Best-effort poster/preview. Any failure returns null — UI renders a generic tile. */
export async function makeThumbnail(blob: Blob, kind: "image" | "video"): Promise<Blob | null> {
  if (kind !== "image") return null // video posters need blob: URLs, which strict host CSPs block; v1 uses a generic tile
  try {
    const source = await decodeImage(blob)
    if (!source) return null
    try {
      const w = sourceWidth(source)
      const h = sourceHeight(source)
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    } finally {
      closeSource(source)
    }
  } catch {
    return null
  }
}
