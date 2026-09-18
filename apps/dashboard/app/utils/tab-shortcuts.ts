/**
 * Number-key shortcuts for a tab strip, derived from the tabs actually
 * rendered: the first tab is 1, the ninth is 9, the tenth is 0. Deriving
 * them keeps every visible tab reachable and never points a key at a tab
 * that isn't there (e.g. Replay on an Expo report).
 */
export function tabShortcutKey(index: number): string | null {
  if (index < 0 || index > 9) return null
  return String((index + 1) % 10)
}

export function tabForShortcut<T extends { id: string }>(
  tabs: readonly T[],
  key: string,
): T["id"] | null {
  if (!/^\d$/.test(key)) return null
  const index = key === "0" ? 9 : Number(key) - 1
  return tabs[index]?.id ?? null
}
