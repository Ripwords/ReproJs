import React from "react"
import Svg, { Path, Rect } from "react-native-svg"

interface IconProps {
  size?: number
  color?: string
}

export function PenIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 3 17 L 14 6 L 18 10 L 7 21 L 3 21 Z"
        stroke={color}
        strokeWidth={1.6}
        fill={color}
      />
    </Svg>
  )
}

export function ArrowIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 3 11 L 19 11 M 13 6 L 19 11 L 13 16"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function RectIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Rect x={3} y={3} width={16} height={16} stroke={color} fill="none" strokeWidth={1.8} />
    </Svg>
  )
}

export function HighlightIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Rect x={2} y={8} width={18} height={6} rx={2} fill={color} opacity={0.6} />
    </Svg>
  )
}

export function TextIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 4 5 L 18 5 M 11 5 L 11 19"
        stroke={color}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function UndoIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 9 14 L 5 10 L 9 6 M 5 10 L 14 10 A 5 5 0 0 1 14 20 L 11 20"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function RedoIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 13 14 L 17 10 L 13 6 M 17 10 L 8 10 A 5 5 0 0 0 8 20 L 11 20"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function CloseIcon({ size = 14, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M 6 6 L 18 18 M 18 6 L 6 18"
        stroke={color}
        strokeWidth={2.4}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  )
}

export function ChevronLeftIcon({ size = 16, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M 15 6 L 9 12 L 15 18"
        stroke={color}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function TrashIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 4 7 L 18 7 M 7 7 L 7 19 L 15 19 L 15 7 M 9 7 V 5 H 13 V 7"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function CursorIcon({ size = 20, color = "#111827" }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Path
        d="M 5 2 L 5 17 L 9 13 L 12 20 L 15 19 L 12 12 L 17 12 Z"
        stroke={color}
        strokeWidth={1.4}
        fill={color}
        strokeLinejoin="round"
      />
    </Svg>
  )
}
