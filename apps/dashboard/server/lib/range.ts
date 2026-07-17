const RANGE_RE = /^bytes=(\d*)-(\d*)$/

export function parseRangeHeader(
  header: string | undefined,
  totalBytes: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null
  const m = RANGE_RE.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === "" && rawEnd === "") return null
  if (rawStart === "") {
    const suffix = Number(rawEnd)
    if (suffix === 0) return "unsatisfiable"
    const start = Math.max(0, totalBytes - suffix)
    return totalBytes === 0 ? "unsatisfiable" : { start, end: totalBytes - 1 }
  }
  const start = Number(rawStart)
  if (start >= totalBytes) return "unsatisfiable"
  const end = rawEnd === "" ? totalBytes - 1 : Math.min(Number(rawEnd), totalBytes - 1)
  if (end < start) return "unsatisfiable"
  return { start, end }
}
