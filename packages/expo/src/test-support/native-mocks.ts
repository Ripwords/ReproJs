import { mock } from "bun:test"
import type React from "react"

/**
 * Replaces every native module the wizard tree touches with host-component
 * stand-ins, so `react-test-renderer` can mount it under `bun test`. Each
 * stub is the *string* name the node will carry in the rendered tree, which
 * is what the structural assertions match on.
 *
 * `react-native-svg`'s `Text` is deliberately stubbed as `"SvgText"` so a tree
 * assertion can tell an SVG label apart from a react-native `<Text>`.
 *
 * Call this before importing the module under test — `mock.module` only
 * affects imports that happen after it runs.
 *
 * Every test in this package that needs `react-native` must go through here.
 * `bun test` shares one module registry across files, so a test file that
 * registers its own partial `react-native` stub decides what *other* files
 * see: components then import a `View` that does not exist, bun falls through
 * to the real Flow-typed source, and the suite fails only when run together.
 */
export const RN_DEVICE = {
  os: "ios",
  osVersion: "17.4",
  window: { width: 390, height: 844 },
  screen: { width: 1179, height: 2556 },
  pixelRatio: 3,
} as const

function pickIos(options: Record<string, unknown>): unknown {
  return options.ios
}

export function installNativeMocks(): void {
  mock.module("react-native", () => ({
    ActivityIndicator: "ActivityIndicator",
    Image: "Image",
    KeyboardAvoidingView: "KeyboardAvoidingView",
    Modal: "Modal",
    Pressable: "Pressable",
    SafeAreaView: "SafeAreaView",
    ScrollView: "ScrollView",
    Text: "Text",
    TextInput: "TextInput",
    View: "View",
    Platform: { OS: RN_DEVICE.os, Version: RN_DEVICE.osVersion, select: pickIos },
    Dimensions: {
      get: (key: "window" | "screen") =>
        key === "window" ? { ...RN_DEVICE.window } : { ...RN_DEVICE.screen },
    },
    PixelRatio: { get: () => RN_DEVICE.pixelRatio },
  }))

  mock.module("react-native-svg", () => ({
    default: "Svg",
    Path: "Path",
    Rect: "Rect",
    Text: "SvgText",
  }))

  mock.module("react-native-gesture-handler", () => ({
    GestureHandlerRootView: "GestureHandlerRootView",
    GestureDetector: "GestureDetector",
    Gesture: {
      Pan: () => gestureStub("pan"),
      Tap: () => gestureStub("tap"),
      Race: (...members: GestureStub[]) => gestureStub("race", members),
    },
  }))

  mock.module("react-native-view-shot", () => ({
    captureRef: async () => "file:///flattened.png",
  }))

  mock.module("expo-document-picker", () => ({
    getDocumentAsync: async () => ({ canceled: true, assets: null }),
  }))

  mock.module("expo-image-picker", () => ({
    launchImageLibraryAsync: async () => ({ canceled: true, assets: null }),
    MediaTypeOptions: { All: "All" },
  }))
}

export type GestureKind = "pan" | "tap" | "race"

export interface GestureStub {
  kind: GestureKind
  /** Callbacks the component registered, keyed by builder method name. */
  handlers: Record<string, (event: unknown) => void>
  /** Composed gestures, for `Gesture.Race(...)`. */
  members: GestureStub[]
}

/**
 * Stands in for a gesture builder. An unknown property access returns a
 * function that returns the stub again, so any chain the canvas writes
 * (`.runOnJS(true).minDistance(2).onStart(fn)`) resolves without the stub
 * having to know which methods exist — while `onX` callbacks are recorded so a
 * test can fire the gesture by hand.
 */
function gestureStub(kind: GestureKind, members: GestureStub[] = []): GestureStub {
  const state: GestureStub = { kind, handlers: {}, members }
  const proxy = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof GestureStub]
      return (arg: unknown) => {
        if (typeof prop === "string" && prop.startsWith("on") && typeof arg === "function") {
          target.handlers[prop] = arg as (event: unknown) => void
        }
        return proxy
      }
    },
  })
  return proxy
}

/** Digs the gesture of the given kind out of whatever `GestureDetector` got. */
export function gestureOfKind(gesture: unknown, kind: GestureKind): GestureStub {
  const stub = gesture as GestureStub
  if (stub.kind === kind) return stub
  const found = stub.members.find((m) => m.kind === kind)
  if (!found) throw new Error(`no ${kind} gesture found`)
  return found
}

/** Fires a recorded handler, or throws if the component never registered it. */
export function fireGesture(stub: GestureStub, handler: string, event: unknown): void {
  const fn = stub.handlers[handler]
  if (!fn) throw new Error(`gesture has no ${handler} handler`)
  fn(event)
}

/**
 * `findByType` typed for a mocked host component. The stubs above are plain
 * strings, and react-test-renderer's signature only admits names React knows
 * as JSX intrinsics — which native components never are.
 */
export function hostType(name: string): React.ElementType {
  return name as unknown as React.ElementType
}
