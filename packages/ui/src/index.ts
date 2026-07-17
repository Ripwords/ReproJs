// packages/ui/src/index.ts
export { mount, open, close, unmount, openMenu, openCapture, openRecord, openGallery } from "./mount"
export type {
  MountOptions,
  WidgetMode,
  PendingShareInput,
  RecordingResultLike,
  RecordingEndReasonLike,
  RecordingSessionLike,
} from "./mount"
export type { ReporterSubmitResult } from "./reporter"
export { registerAllCollectors } from "./collectors"
export type { CollectorConfig, PendingReport, LogsAttachment } from "./collectors"
export type { BreadcrumbLevel } from "@reprojs/sdk-utils"
