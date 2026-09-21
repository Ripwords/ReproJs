import { describe, expect, test } from "bun:test"
import React from "react"
import { act, create, type ReactTestInstance } from "react-test-renderer"
import { hostType, installNativeMocks } from "../test-support/native-mocks"

installNativeMocks()

const SCREENSHOT = { uri: "file:///shot.png", width: 320, height: 640 }

async function mountWizard() {
  const { WizardSheet } = await import("./sheet")
  let tree: ReturnType<typeof create> | null = null
  act(() => {
    tree = create(
      <WizardSheet
        initialTitle="Login button does nothing"
        screenshot={SCREENSHOT}
        onSubmit={async () => undefined}
        onClose={() => undefined}
      />,
    )
  })
  if (tree === null) throw new Error("wizard did not mount")
  return tree as ReturnType<typeof create>
}

/** Walks up from a node looking for an ancestor of the given host type. */
function hasAncestorOfType(node: ReactTestInstance, type: string): boolean {
  let current: ReactTestInstance | null = node.parent
  while (current !== null) {
    if (current.type === type) return true
    current = current.parent
  }
  return false
}

function advanceToAnnotateStep(tree: ReturnType<typeof create>) {
  const primary = tree.root.find((n) => n.props.label === "Continue")
  act(() => {
    primary.props.onPress()
  })
  // The canvas only mounts once the preview container has been measured, and
  // react-test-renderer never fires layout on its own.
  const measured = tree.root.find((n) => typeof n.props.onLayout === "function")
  act(() => {
    measured.props.onLayout({ nativeEvent: { layout: { width: 300, height: 500 } } })
  })
}

describe("WizardSheet gesture root", () => {
  // Regression: on Android a react-native Modal is a separate native window
  // (ReactModalHostView.DialogRootViewGroup) that sits outside the host app's
  // GestureHandlerRootView, so gesture-handler never sees touches inside it
  // and the annotation canvas could not be drawn on at all. iOS was fine,
  // which is why this only showed up for Android reporters.
  test("mounts a GestureHandlerRootView inside the Modal", async () => {
    const tree = await mountWizard()
    const modal = tree.root.findByType(hostType("Modal"))
    const root = modal.findByType(hostType("GestureHandlerRootView"))
    expect(root.findAllByType(hostType("SafeAreaView")).length).toBeGreaterThan(0)
  })

  test("annotation gestures are inside the gesture root", async () => {
    const tree = await mountWizard()
    advanceToAnnotateStep(tree)
    const detectors = tree.root.findAllByType(hostType("GestureDetector"))
    expect(detectors.length).toBeGreaterThan(0)
    for (const detector of detectors) {
      expect(hasAncestorOfType(detector, "GestureHandlerRootView")).toBe(true)
    }
  })
})
