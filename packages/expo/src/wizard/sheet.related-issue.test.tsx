import { describe, expect, test } from "bun:test"
import React from "react"
import { act, create } from "react-test-renderer"
import { hostType, installNativeMocks } from "../test-support/native-mocks"

installNativeMocks()

const RELATED_PLACEHOLDER = "#123 or issue URL"

type Submitted = Parameters<import("./sheet").WizardArgs["onSubmit"]>[0]

async function mountWizard(opts: { relatedIssue: boolean }) {
  const { WizardSheet } = await import("./sheet")
  const submitted: Submitted[] = []
  let tree: ReturnType<typeof create> | null = null
  act(() => {
    tree = create(
      <WizardSheet
        initialTitle="Login button does nothing"
        screenshot={null}
        fields={{ relatedIssue: opts.relatedIssue }}
        onSubmit={async (res) => {
          submitted.push(res)
        }}
        onClose={() => undefined}
      />,
    )
  })
  if (tree === null) throw new Error("wizard did not mount")
  return { tree: tree as ReturnType<typeof create>, submitted }
}

function relatedInputs(tree: ReturnType<typeof create>) {
  return tree.root.findAll((n) => n.props.placeholder === RELATED_PLACEHOLDER)
}

function relatedInput(tree: ReturnType<typeof create>) {
  const [input] = relatedInputs(tree)
  if (!input) throw new Error("related-issue input not rendered")
  return input
}

function primary(tree: ReturnType<typeof create>, label: string) {
  return tree.root.find((n) => n.props.label === label && typeof n.props.onPress === "function")
}

function pressPrimary(tree: ReturnType<typeof create>, label: string) {
  act(() => {
    primary(tree, label).props.onPress()
  })
}

function textNodes(tree: ReturnType<typeof create>): string[] {
  return tree.root
    .findAll((n) => n.type === hostType("Text"))
    .map((n) => React.Children.toArray(n.props.children).join(""))
}

describe("related GitHub issue field", () => {
  test("is absent unless the host enables it", async () => {
    const { tree } = await mountWizard({ relatedIssue: false })
    expect(relatedInputs(tree)).toHaveLength(0)
  })

  test("text that is not an issue reference blocks Continue with a hint", async () => {
    const { tree } = await mountWizard({ relatedIssue: true })
    const input = relatedInput(tree)
    act(() => {
      input.props.onChangeText("the login thing")
    })
    expect(primary(tree, "Continue").props.disabled).toBe(true)
    expect(textNodes(tree).some((t) => /issue number like #123/i.test(t))).toBe(true)

    // Clearing the typo unblocks the form again.
    act(() => {
      input.props.onChangeText("")
    })
    expect(primary(tree, "Continue").props.disabled).toBe(false)
  })

  test("a valid reference reaches onSubmit and the review summary", async () => {
    const { tree, submitted } = await mountWizard({ relatedIssue: true })
    const input = relatedInput(tree)
    act(() => {
      input.props.onChangeText("  https://github.com/acme/app/issues/42 ")
    })
    pressPrimary(tree, "Continue") // → annotate
    pressPrimary(tree, "Continue") // → review
    expect(textNodes(tree)).toContain("#42")
    await act(async () => {
      await primary(tree, "Send report").props.onPress()
    })
    expect(submitted.map((r) => r.relatedIssue)).toEqual(["https://github.com/acme/app/issues/42"])
  })

  test("an empty field is omitted from the submission", async () => {
    const { tree, submitted } = await mountWizard({ relatedIssue: true })
    pressPrimary(tree, "Continue")
    pressPrimary(tree, "Continue")
    await act(async () => {
      await primary(tree, "Send report").props.onPress()
    })
    expect(submitted.map((r) => "relatedIssue" in r)).toEqual([false])
  })
})
