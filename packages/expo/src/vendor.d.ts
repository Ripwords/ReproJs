/**
 * Ambient stub for optional peer dependencies that are not installed in the
 * workspace but must be importable at runtime in the host app.
 */

declare module "expo-document-picker" {
  export interface DocumentPickerAsset {
    uri: string
    name: string
    mimeType?: string
    size?: number
  }

  export type DocumentPickerResult =
    | { canceled: true; assets?: never }
    | { canceled: false; assets: DocumentPickerAsset[] }

  export function getDocumentAsync(options?: {
    multiple?: boolean
    copyToCacheDirectory?: boolean
    type?: string | string[]
  }): Promise<DocumentPickerResult>
}

/**
 * Both API generations are declared as optional members of one module because
 * the SDK supports Expo >= 52: SDK <= 53 ships the legacy functions, SDK >= 54
 * ships the class-based API from the same entry point. The runtime picks
 * whichever is present (see queue/attachment-store.ts).
 */
declare module "expo-file-system" {
  export const documentDirectory: string | null | undefined
  export function makeDirectoryAsync(
    uri: string,
    options?: { intermediates?: boolean },
  ): Promise<void>
  export function copyAsync(options: { from: string; to: string }): Promise<void>
  export function deleteAsync(uri: string, options?: { idempotent?: boolean }): Promise<void>
  export function getInfoAsync(
    uri: string,
    options?: { size?: boolean },
  ): Promise<{ exists: boolean; size?: number }>

  export class File {
    constructor(...uris: Array<string | File | Directory>)
    readonly uri: string
    readonly exists: boolean
    readonly size: number | null
    copy(destination: File | Directory): void
    delete(): void
  }
  export class Directory {
    constructor(...uris: Array<string | File | Directory>)
    readonly uri: string
    readonly exists: boolean
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void
    delete(): void
  }
  export const Paths: {
    document: Directory
    cache: Directory
  }
}

declare module "expo-image-picker" {
  export interface ImagePickerAsset {
    uri: string
    fileName?: string | null
    mimeType?: string
    fileSize?: number
    width?: number
    height?: number
    type?: "image" | "video"
  }

  export type ImagePickerResult =
    | { canceled: true; assets?: never }
    | { canceled: false; assets: ImagePickerAsset[] }

  export const MediaTypeOptions: {
    All: "All"
    Images: "Images"
    Videos: "Videos"
  }

  export function launchImageLibraryAsync(options?: {
    mediaTypes?: "All" | "Images" | "Videos" | string[]
    allowsMultipleSelection?: boolean
    quality?: number
    selectionLimit?: number
  }): Promise<ImagePickerResult>

  export function requestMediaLibraryPermissionsAsync(): Promise<{
    status: "granted" | "denied" | "undetermined"
    granted: boolean
  }>
}
