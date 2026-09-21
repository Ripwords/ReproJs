import type { Tool } from "@reprojs/sdk-utils"

/**
 * What the canvas does with a gesture: draw with one of the shared drawing
 * tools, or select and move what is already drawn.
 *
 * `select` is deliberately *not* a member of `@reprojs/sdk-utils`'s `Tool`
 * union. `Tool` means "a tool that produces a shape", and the web widget keys
 * an exhaustive `Record<Tool, ToolHandler>` off it — adding a member there
 * would break that build for a mode the web widget does not have.
 */
export type CanvasMode = Tool | "select"

export const SELECT_MODE: CanvasMode = "select"
