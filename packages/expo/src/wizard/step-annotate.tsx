import React, { useState } from "react"
import { Image, Text, View } from "react-native"
import { AnnotationCanvas } from "../annotation/canvas"
import { AnnotationToolbar } from "../annotation/toolbar"
import { TextInputModal } from "../annotation/text-input-modal"
import type { AnnotationStore } from "../annotation/store"
import type { CanvasMode } from "../annotation/mode"
import { PALETTE, STROKE_WIDTHS, newShapeId } from "@reprojs/sdk-utils"

interface Props {
  imageUri: string | null
  store: AnnotationStore
  onSizeChange?: (size: { w: number; h: number }) => void
}

export function StepAnnotate({ imageUri, store, onSizeChange }: Props) {
  const [mode, setMode] = useState<CanvasMode>("pen")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [color, setColor] = useState<string>(PALETTE[0])
  const [strokeWidth, setStrokeWidth] = useState<number>(STROKE_WIDTHS[1])
  const [textPoint, setTextPoint] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  function handleModeChange(next: CanvasMode) {
    setMode(next)
    // A selection outline would be misleading once another tool is active:
    // nothing would drag it.
    if (next !== "select") setSelectedId(null)
  }

  function handleTextTap(point: { x: number; y: number }) {
    setTextPoint(point)
  }

  function handleTextSubmit(value: string) {
    if (!textPoint) return
    store.addShape({
      kind: "text",
      id: newShapeId(),
      color,
      strokeWidth,
      x: textPoint.x,
      y: textPoint.y,
      w: 0,
      h: 0,
      content: value,
      fontSize: 16,
    })
    setTextPoint(null)
  }

  function handleTextCancel() {
    setTextPoint(null)
  }

  return (
    <View style={{ flex: 1 }}>
      <AnnotationToolbar
        mode={mode}
        onModeChange={handleModeChange}
        color={color}
        onColorChange={setColor}
        strokeWidth={strokeWidth}
        onStrokeWidthChange={setStrokeWidth}
        store={store}
      />
      <View
        style={{ flex: 1, position: "relative", backgroundColor: "#f3f4f6" }}
        onLayout={(e) => {
          const next = {
            w: Math.round(e.nativeEvent.layout.width),
            h: Math.round(e.nativeEvent.layout.height),
          }
          setSize(next)
          onSizeChange?.(next)
        }}
      >
        {imageUri && size.w > 0 && size.h > 0 ? (
          <Image
            source={{ uri: imageUri }}
            style={{ position: "absolute", top: 0, left: 0, width: size.w, height: size.h }}
            resizeMode="contain"
          />
        ) : !imageUri ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <Text style={{ color: "#6b7280", textAlign: "center" }}>
              Screenshot unavailable — annotate on a blank canvas, or go Back and try again.
            </Text>
          </View>
        ) : null}
        {size.w > 0 && size.h > 0 && (
          <AnnotationCanvas
            width={size.w}
            height={size.h}
            mode={mode}
            color={color}
            strokeWidth={strokeWidth}
            store={store}
            selectedId={selectedId}
            onSelectedIdChange={setSelectedId}
            onTextTap={handleTextTap}
          />
        )}
      </View>
      <TextInputModal
        visible={textPoint !== null}
        onSubmit={handleTextSubmit}
        onCancel={handleTextCancel}
      />
    </View>
  )
}
