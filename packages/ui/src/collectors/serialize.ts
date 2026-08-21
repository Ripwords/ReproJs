// packages/ui/src/collectors/serialize.ts
//
// The value→string core now lives in @reprojs/sdk-utils so the web and Expo
// console collectors share ONE implementation. They previously had separate
// copies, and the Expo copy was missing the undefined/function/symbol guards —
// which took down Expo report intake entirely. Re-exported here so existing
// web import paths keep working.

import { truncate } from "@reprojs/sdk-utils"
import { safeStringify, scrubString } from "@reprojs/sdk-utils"

export { DEFAULT_STRING_REDACTORS, scrubString } from "@reprojs/sdk-utils"

export function serializeArg(v: unknown, maxBytes: number, redactors: readonly RegExp[]): string {
  return scrubString(truncate(safeStringify(v), maxBytes), redactors)
}
