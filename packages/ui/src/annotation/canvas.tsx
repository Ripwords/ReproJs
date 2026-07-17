// packages/ui/src/annotation/canvas.tsx
import { effect } from "@preact/signals"
import { h } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { render as renderAll } from "./render"
import { sourceHeight, sourceWidth, type ImageSource } from "../decode-image"
import { color, commit, draft, shapes, strokeW, tool, viewport } from "./store"
import { arrowTool, highlightTool, penTool, rectTool, textTool } from "@reprojs/sdk-utils"
import type { ToolHandler } from "@reprojs/sdk-utils"
import type { TextShape, Tool } from "@reprojs/sdk-utils"
import { clampPan, fitTransform, isInsideImage, screenToWorld, zoomAt } from "./viewport"

const HANDLERS: Record<Tool, ToolHandler> = {
  arrow: arrowTool,
  rect: rectTool,
  pen: penTool,
  highlight: highlightTool,
  text: textTool,
}

export interface CanvasProps {
  bg: ImageSource
}

function naturalDims(bg: ImageSource): { w: number; h: number } {
  return { w: sourceWidth(bg), h: sourceHeight(bg) }
}

export function Canvas({ bg }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activePointer = useRef<number | null>(null)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const spaceHeld = useRef(false)
  const drawScheduled = useRef(false)
  const [editingText, setEditingText] = useState<{ shape: TextShape; value: string } | null>(null)

  // Fit on mount / size change
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const applyFit = () => {
      const { w: bgW, h: bgH } = naturalDims(bg)
      viewport.value = fitTransform(bgW, bgH, el.clientWidth, el.clientHeight)
    }
    applyFit()
    const ro = new ResizeObserver(applyFit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bg])

  // Keep canvas backing size in sync (HiDPI)
  useEffect(() => {
    const canvas = canvasRef.current
    const el = containerRef.current
    if (!canvas || !el) return
    const sync = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = el.clientWidth * dpr
      canvas.height = el.clientHeight * dpr
      canvas.style.width = `${el.clientWidth}px`
      canvas.style.height = `${el.clientHeight}px`
      const ctx = canvas.getContext("2d")
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      scheduleDraw()
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // RAF draw loop driven by signal changes
  function scheduleDraw() {
    if (drawScheduled.current) return
    drawScheduled.current = true
    requestAnimationFrame(() => {
      drawScheduled.current = false
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const visible = draft.value ? [...shapes.value, draft.value] : shapes.value
      renderAll(ctx, bg, visible, viewport.value)
    })
  }

  useEffect(() => {
    const dispose = effect(() => {
      // Subscribe to reactive sources
      void shapes.value
      void draft.value
      void viewport.value
      scheduleDraw()
    })
    return () => dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Space held = pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  function onPointerDown(e: PointerEvent) {
    if (e.button === 1 || e.button === 2) return
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    activePointer.current = e.pointerId

    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)
    const { w: bgW, h: bgH } = naturalDims(bg)

    if (spaceHeld.current || !isInsideImage(worldX, worldY, bgW, bgH)) {
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        panX: viewport.value.panX,
        panY: viewport.value.panY,
      }
      return
    }

    const handler = HANDLERS[tool.value]
    const s = handler.onPointerDown({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
    })
    draft.value = s
  }

  function onPointerMove(e: PointerEvent) {
    if (activePointer.current !== e.pointerId) return
    const canvas = canvasRef.current
    if (!canvas) return

    if (panStart.current) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      const rect = canvas.getBoundingClientRect()
      const { w: bgW, h: bgH } = naturalDims(bg)
      viewport.value = clampPan(
        {
          scale: viewport.value.scale,
          panX: panStart.current.panX + dx,
          panY: panStart.current.panY + dy,
        },
        bgW,
        bgH,
        rect.width,
        rect.height,
      )
      return
    }

    if (!draft.value) return
    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)
    const handler = HANDLERS[draft.value.kind as Tool]
    draft.value = handler.onPointerMove({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
      shape: draft.value,
    })
  }

  function onPointerUp(e: PointerEvent) {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null

    if (panStart.current) {
      panStart.current = null
      return
    }

    if (!draft.value) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY, rect, viewport.value)
    const handler = HANDLERS[draft.value.kind as Tool]
    const committed = handler.onPointerUp({
      worldX,
      worldY,
      pressure: e.pressure || 0.5,
      color: color.value,
      strokeWidth: strokeW.value,
      shape: draft.value,
    })

    if (committed && committed.kind === "text") {
      setEditingText({ shape: committed, value: "" })
      draft.value = null
      return
    }

    if (committed) commit(committed)
    draft.value = null
  }

  function onWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    viewport.value = zoomAt(cx, cy, factor, viewport.value)
  }

  function commitText() {
    if (!editingText) return
    const value = editingText.value.trim()
    if (value.length === 0) {
      setEditingText(null)
      return
    }
    commit({ ...editingText.shape, content: value })
    setEditingText(null)
  }

  function cancelText() {
    setEditingText(null)
  }

  // Render the text input overlay in screen coords
  const overlay = editingText
    ? (() => {
        const { shape } = editingText
        const { scale, panX, panY } = viewport.value
        const left = shape.x * scale + panX
        const top = shape.y * scale + panY
        const width = shape.w * scale
        const height = shape.h * scale
        return h(
          "textarea",
          {
            class: "ft-text-input",
            style: `position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${shape.fontSize * scale}px;color:${shape.color};resize:none;background:transparent;outline:2px solid ${shape.color};border:none;padding:2px;font-family:system-ui,-apple-system,sans-serif;overflow:hidden;`,
            autoFocus: true,
            onInput: (e: Event) =>
              setEditingText({
                ...editingText,
                value: (e.target as HTMLTextAreaElement).value,
              }),
            onBlur: commitText,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Escape") {
                e.preventDefault()
                cancelText()
              }
            },
          },
          editingText.value,
        )
      })()
    : null

  return h(
    "div",
    {
      ref: containerRef,
      class: "ft-canvas-container",
      style: "position:relative;flex-grow:1;overflow:hidden;background:#f0f0f0;",
    },
    h("canvas", {
      ref: canvasRef,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onWheel,
      style: "display:block;",
    }),
    overlay,
  )
}
