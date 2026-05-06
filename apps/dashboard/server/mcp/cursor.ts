// Opaque pagination cursor for tools that page over (createdAt DESC, id DESC).
// We don't need it to be unforgeable — any user who can list a project's
// tickets can also reconstruct cursors by hand. Base64url is just to keep
// the wire format opaque to clients.

export interface Cursor {
  createdAt: Date
  id: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`, "utf-8").toString("base64url")
}

export function decodeCursor(raw: string): Cursor | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf-8")
  } catch {
    return null
  }
  const sep = decoded.indexOf("|")
  if (sep < 0) return null
  const isoPart = decoded.slice(0, sep)
  const idPart = decoded.slice(sep + 1)
  if (!UUID_REGEX.test(idPart)) return null
  const ts = new Date(isoPart)
  if (Number.isNaN(ts.getTime())) return null
  return { createdAt: ts, id: idPart }
}
