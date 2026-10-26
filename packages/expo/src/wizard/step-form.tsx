import React from "react"
import { ScrollView, Text, TextInput, View } from "react-native"
import { FieldLabel, inputStyle } from "./controls"
import { AttachmentList } from "./attachment-list"
import { theme } from "./theme"
import {
  DEFAULT_ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentLimits,
} from "@reprojs/sdk-utils"

export const RELATED_ISSUE_PLACEHOLDER = "#123 or issue URL"
export const RELATED_ISSUE_HINT = "Enter an issue number like #123 or paste the issue link"

interface Props {
  title: string
  description: string
  /**
   * Present only when the host enabled `fields.relatedIssue`. `error` is the
   * inline hint shown while the text cannot be read as an issue reference.
   */
  relatedIssue?: { value: string; error: string | null; onChange: (v: string) => void }
  attachments: Attachment[]
  attachmentErrors: string[]
  limits?: AttachmentLimits
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onAttachmentsAdd: () => void
  onAttachmentRemove: (id: string) => void
}

export function StepForm({
  title,
  description,
  relatedIssue,
  attachments,
  attachmentErrors,
  limits = DEFAULT_ATTACHMENT_LIMITS,
  onTitleChange,
  onDescriptionChange,
  onAttachmentsAdd,
  onAttachmentRemove,
}: Props) {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      <View style={{ gap: 8 }}>
        <FieldLabel label="Title" />
        <TextInput
          value={title}
          onChangeText={onTitleChange}
          placeholder="What went wrong?"
          placeholderTextColor={theme.color.textFaint}
          maxLength={120}
          returnKeyType="next"
          style={inputStyle}
        />
      </View>
      <View style={{ gap: 8 }}>
        <FieldLabel label="Details" optional />
        <TextInput
          value={description}
          onChangeText={onDescriptionChange}
          placeholder="Steps to reproduce, expected vs actual…"
          placeholderTextColor={theme.color.textFaint}
          multiline
          maxLength={10000}
          style={[inputStyle, { minHeight: 140, textAlignVertical: "top" }]}
        />
      </View>
      {relatedIssue && (
        <View style={{ gap: 8 }}>
          <FieldLabel label="Related GitHub issue" optional />
          <TextInput
            value={relatedIssue.value}
            onChangeText={relatedIssue.onChange}
            placeholder={RELATED_ISSUE_PLACEHOLDER}
            placeholderTextColor={theme.color.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            maxLength={300}
            accessibilityLabel="Related GitHub issue"
            style={[inputStyle, relatedIssue.error ? { borderColor: theme.color.danger } : null]}
          />
          {relatedIssue.error ? (
            <Text style={{ fontSize: 12, color: theme.color.danger }}>{relatedIssue.error}</Text>
          ) : (
            <Text style={{ fontSize: 12, color: theme.color.textMuted }}>
              Re-testing a known bug? Paste its issue link or number and the team will attach this
              report to it.
            </Text>
          )}
        </View>
      )}
      <View style={{ gap: 8 }}>
        <FieldLabel label="Attachments" optional />
        <AttachmentList
          attachments={attachments}
          limits={limits}
          errors={attachmentErrors}
          onAdd={onAttachmentsAdd}
          onRemove={onAttachmentRemove}
        />
      </View>
    </ScrollView>
  )
}
