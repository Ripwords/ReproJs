export type Config = {
  id: string
  label: string
  origin: string
  projectKey: string
  intakeEndpoint: string
  // Show the widget's optional "Related GitHub issue" field on this origin.
  // Configs saved before this key existed read back as true (see storage.ts).
  relatedIssueField: boolean
  createdAt: number
}

export type ConfigInput = Omit<Config, "id" | "createdAt">
