<!-- apps/dashboard/app/components/report-drawer/comments-tab.vue
     Two-way synced comment thread — chat-bubble layout. Own messages
     are right-aligned with a primary-tinted bubble; others' messages
     are left-aligned with a neutral surface bubble. GitHub-synced
     comments carry a github icon in their author row. Polls every
     20s for inbound webhook comments. Renders naturally (no inner
     scroll), so it can be embedded inline in the overview or used as
     a standalone tab — the parent's scroll container handles overflow. -->
<script setup lang="ts">
import RelativeTime from "~/components/common/relative-time.vue"
import type { CommentDTO } from "@reprojs/shared"

interface Props {
  projectId: string
  reportId: string
  /** Hide the section title strip — the embedding card already provides one. */
  hideHeader?: boolean
  /** Posting, editing and deleting comments is manager+ on the server;
   *  viewers get a read-only thread. */
  canComment: boolean
}
const props = defineProps<Props>()

const { renderMarkdown } = useMarkdown()
const { data, refresh } = useApi<{ items: CommentDTO[] }>(
  `/api/projects/${props.projectId}/reports/${props.reportId}/comments`,
)

let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(refresh, 20_000)
})
onUnmounted(() => {
  if (pollTimer !== null) clearInterval(pollTimer)
})

defineExpose({ refresh })

// ---- composer ----
const composerBody = ref("")
const composerLoading = ref(false)
const composerError = ref<string | null>(null)
const uploading = ref(false)

// Pasted/dropped images live as out-of-band "pending attachments" rendered
// as thumbnail chips above the textarea. The body the user types stays
// readable — markdown image syntax only gets spliced in at submit time.
// Each pending entry tracks its own optimistic local-blob preview alongside
// the server-returned URL so the chip can render the moment the upload
// kicks off (no flash of empty thumbnail while the server round-trip
// completes).
interface PendingAttachment {
  tempId: string
  uploading: boolean
  previewUrl: string | null // object URL during upload, then the signed URL
  uploadedUrl: string | null // signed absolute URL once upload returns
  name: string
}
const pendingAttachments = ref<PendingAttachment[]>([])

const canSend = computed(() => {
  if (composerLoading.value) return false
  if (uploading.value) return false
  if (pendingAttachments.value.some((a) => a.uploading)) return false
  return composerBody.value.trim().length > 0 || pendingAttachments.value.length > 0
})

async function submitComment() {
  if (!canSend.value) return
  // Compose the final body: typed text + a trailing markdown image for each
  // ready attachment. Attachments without an uploaded URL (still loading or
  // failed silently) are skipped — canSend guards against this in practice.
  const typed = composerBody.value.trim()
  const imageMarkdown = pendingAttachments.value
    .filter((a) => a.uploadedUrl !== null)
    .map((a) => `![${a.name}](${a.uploadedUrl})`)
    .join("\n\n")
  const finalBody = [typed, imageMarkdown].filter((s) => s.length > 0).join("\n\n")
  if (!finalBody) return

  composerLoading.value = true
  composerError.value = null
  try {
    await $fetch(`/api/projects/${props.projectId}/reports/${props.reportId}/comments`, {
      method: "POST",
      credentials: "include",
      body: { body: finalBody },
    })
    // Revoke object URLs before clearing so we don't leak.
    for (const a of pendingAttachments.value) {
      if (a.previewUrl && a.previewUrl.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl)
    }
    composerBody.value = ""
    pendingAttachments.value = []
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    composerError.value = err.statusMessage ?? err.message ?? "Failed to post comment"
  } finally {
    composerLoading.value = false
  }
}

function onComposerKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault()
    submitComment()
  }
}

async function uploadFile(file: File): Promise<{ url: string; contentType: string } | null> {
  const form = new FormData()
  form.append("file", file, file.name || "pasted-image.png")
  try {
    return await $fetch<{ url: string; contentType: string }>(
      `/api/projects/${props.projectId}/reports/${props.reportId}/comments/upload-image`,
      { method: "POST", credentials: "include", body: form },
    )
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    composerError.value = err.statusMessage ?? err.message ?? "Image upload failed"
    return null
  }
}

async function addPendingImage(file: File) {
  // Optimistic chip: object URL for instant local preview + uploading=true
  // marker. Replaced with the server URL when the POST resolves.
  const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const previewUrl = URL.createObjectURL(file)
  const name = file.name && !/^image\.\w+$/i.test(file.name) ? file.name : "pasted image"
  const entry: PendingAttachment = {
    tempId,
    uploading: true,
    previewUrl,
    uploadedUrl: null,
    name,
  }
  pendingAttachments.value = [...pendingAttachments.value, entry]

  uploading.value = true
  try {
    const result = await uploadFile(file)
    if (!result) {
      // Failed: drop this chip; the toast/error message in composerError tells the user.
      pendingAttachments.value = pendingAttachments.value.filter((a) => a.tempId !== tempId)
      URL.revokeObjectURL(previewUrl)
      return
    }
    pendingAttachments.value = pendingAttachments.value.map((a) =>
      a.tempId === tempId ? { ...a, uploading: false, uploadedUrl: result.url } : a,
    )
  } finally {
    uploading.value = pendingAttachments.value.some((a) => a.uploading)
  }
}

function removePending(tempId: string) {
  const target = pendingAttachments.value.find((a) => a.tempId === tempId)
  if (target?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl)
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.tempId !== tempId)
}

// Paste handler — when the clipboard holds an image, intercept the paste
// and add a pending-attachment chip. Falls through to default text paste
// otherwise.
async function onComposerPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  const imageItems = Array.from(items).filter(
    (it) => it.kind === "file" && it.type.startsWith("image/"),
  )
  if (imageItems.length === 0) return
  e.preventDefault()
  // Run uploads in parallel — pasting multiple images shouldn't queue.
  await Promise.all(
    imageItems
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null)
      .map((f) => addPendingImage(f)),
  )
}

// Clean up object URLs for any chips still pending when the component
// unmounts (e.g., user navigates away mid-compose).
onUnmounted(() => {
  for (const a of pendingAttachments.value) {
    if (a.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(a.previewUrl)
  }
})

// ---- inline edit ----
const editingId = ref<string | null>(null)
const editBody = ref("")
const editLoading = ref(false)
const editError = ref<string | null>(null)

function startEdit(comment: CommentDTO) {
  editingId.value = comment.id
  editBody.value = comment.body
  editError.value = null
}
function cancelEdit() {
  editingId.value = null
  editBody.value = ""
  editError.value = null
}
async function submitEdit(commentId: string) {
  const body = editBody.value.trim()
  if (!body) return
  editLoading.value = true
  editError.value = null
  try {
    await $fetch(
      `/api/projects/${props.projectId}/reports/${props.reportId}/comments/${commentId}`,
      { method: "PATCH", credentials: "include", body: { body } },
    )
    cancelEdit()
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    editError.value = err.statusMessage ?? err.message ?? "Failed to update comment"
  } finally {
    editLoading.value = false
  }
}

// ---- delete ----
const toast = useToast()
const { confirm } = useConfirm()
const deleteLoading = ref<string | null>(null)
async function deleteComment(comment: CommentDTO) {
  const ok = await confirm({
    title: "Delete comment?",
    description:
      comment.githubCommentId !== null
        ? "This comment is synced to GitHub and will be deleted there too. This cannot be undone."
        : "This cannot be undone.",
    confirmLabel: "Delete",
    confirmColor: "error",
    icon: "i-heroicons-trash",
  })
  if (!ok) return
  deleteLoading.value = comment.id
  try {
    await $fetch(
      `/api/projects/${props.projectId}/reports/${props.reportId}/comments/${comment.id}`,
      { method: "DELETE", credentials: "include" },
    )
    await refresh()
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    toast.add({
      title: "Could not delete comment",
      description: err.statusMessage ?? err.message,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    deleteLoading.value = null
  }
}

// ---- session ----
const { user } = useSession()

function authorLabel(comment: CommentDTO): string {
  const a = comment.author
  if (a.kind === "dashboard") return a.name ?? a.email ?? "Dashboard user"
  return a.githubLogin ?? "GitHub user"
}
function authorInitials(comment: CommentDTO): string {
  return authorLabel(comment).slice(0, 2).toUpperCase()
}
function authorAvatar(comment: CommentDTO): string | undefined {
  return comment.author.avatarUrl ?? undefined
}
function isOwn(comment: CommentDTO): boolean {
  if (!user.value?.id) return false
  return comment.author.kind === "dashboard" && comment.author.id === user.value.id
}

// Stable per-author colour from a hash of the label. Six warm + cool hues
// from the project palette so multiple GitHub authors are visually distinct
// in a thread without clashing with the primary accent. Own-author always
// uses primary, so this only fires for everyone else.
const AUTHOR_COLORS = [
  "text-sky-400",
  "text-emerald-400",
  "text-amber-400",
  "text-rose-400",
  "text-violet-400",
  "text-fuchsia-400",
] as const
function authorColor(comment: CommentDTO): string {
  if (isOwn(comment)) return "text-primary"
  const label = authorLabel(comment)
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  return AUTHOR_COLORS[h % AUTHOR_COLORS.length] ?? "text-primary"
}
</script>

<template>
  <div class="flex flex-col">
    <!-- Bubble list. Empty-state copy sits inside the same vertical rhythm. -->
    <div class="px-5 py-4 space-y-4 text-sm">
      <p v-if="!data?.items?.length" class="text-muted text-center py-8">
        {{ canComment ? "No comments yet — start the conversation below." : "No comments yet." }}
      </p>

      <div
        v-for="comment in data?.items"
        :key="comment.id"
        :class="['flex items-start gap-3', isOwn(comment) ? 'flex-row-reverse' : 'flex-row']"
      >
        <UAvatar
          :src="authorAvatar(comment)"
          :text="authorInitials(comment)"
          size="md"
          class="shrink-0 mt-0.5"
        />

        <!-- Bubble: own → primary tint, others → neutral elevated surface.
             max-w cap keeps long messages readable without spanning the
             whole column on wide layouts. -->
        <div
          :class="[
            'min-w-0 max-w-[85%] rounded-2xl px-4 py-3 ring-1',
            isOwn(comment)
              ? 'bg-primary/10 ring-primary/30 rounded-tr-sm'
              : 'bg-elevated ring-default rounded-tl-sm',
          ]"
        >
          <div
            :class="[
              'flex items-center gap-2 mb-1',
              isOwn(comment) ? 'flex-row-reverse' : 'flex-row',
            ]"
          >
            <span :class="['font-semibold tracking-tight truncate', authorColor(comment)]">
              {{ authorLabel(comment) }}
            </span>
            <span
              v-if="comment.source === 'github'"
              class="inline-flex items-center gap-1 text-sm text-muted px-1.5 py-0.5 rounded bg-default ring-1 ring-default"
              title="Synced from GitHub"
            >
              <UIcon name="i-simple-icons-github" class="size-3" />
              GitHub
            </span>
          </div>

          <!-- Inline edit -->
          <template v-if="editingId === comment.id">
            <UTextarea v-model="editBody" :rows="3" class="w-full mb-2" autofocus />
            <p v-if="editError" class="text-sm text-error mb-2">{{ editError }}</p>
            <div class="flex gap-2">
              <UButton size="xs" :loading="editLoading" @click="submitEdit(comment.id)"
                >Save</UButton
              >
              <UButton size="xs" variant="ghost" @click="cancelEdit">Cancel</UButton>
            </div>
          </template>

          <!-- Rendered body. The markdown renderer rewrites GitHub
               user-attachment image URLs through our image-proxy so they
               actually load — see use-markdown.ts. -->
          <template v-else>
            <!-- eslint-disable vue/no-v-html -->
            <div
              class="prose prose-sm dark:prose-invert max-w-none text-default break-words"
              v-html="
                renderMarkdown(comment.body, { rewriteImagesFor: { projectId: props.projectId } })
              "
            />
            <!-- eslint-enable vue/no-v-html -->

            <div
              :class="[
                'flex items-center gap-3 mt-1.5 text-sm text-muted tabular-nums',
                isOwn(comment) ? 'justify-end' : 'justify-start',
              ]"
            >
              <RelativeTime :value="comment.createdAt" />
              <template v-if="canComment && isOwn(comment)">
                <button
                  type="button"
                  class="hover:text-default transition-colors"
                  @click="startEdit(comment)"
                >
                  Edit
                </button>
                <button
                  type="button"
                  class="hover:text-error transition-colors"
                  :disabled="deleteLoading === comment.id"
                  @click="deleteComment(comment)"
                >
                  {{ deleteLoading === comment.id ? "Deleting…" : "Delete" }}
                </button>
              </template>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Composer. Pending image attachments render as thumbnail chips
         ABOVE the textarea (with an upload spinner overlay until the
         server returns), so the typed body stays clean and the user
         actually sees what they pasted. Markdown image syntax is only
         spliced in at submit time. -->
    <p v-if="!canComment" class="px-5 py-3 border-t border-default text-sm text-muted">
      Viewers can read comments but not post them.
    </p>
    <div v-else class="px-5 py-3 border-t border-default">
      <label class="sr-only" for="comment-composer">Add a comment</label>

      <!-- Attachment thumbnail strip -->
      <div v-if="pendingAttachments.length > 0" class="flex flex-wrap gap-2 mb-2">
        <div
          v-for="att in pendingAttachments"
          :key="att.tempId"
          class="relative group rounded-lg ring-1 ring-default bg-elevated overflow-hidden"
        >
          <img
            v-if="att.previewUrl"
            :src="att.previewUrl"
            :alt="att.name"
            class="block h-20 w-20 object-cover"
          />
          <div
            v-if="att.uploading"
            class="absolute inset-0 flex items-center justify-center bg-neutral-950/55 backdrop-blur-[1px]"
          >
            <UIcon name="i-heroicons-arrow-path" class="size-5 text-white animate-spin" />
          </div>
          <button
            type="button"
            class="absolute top-1 right-1 inline-flex items-center justify-center size-5 rounded-full bg-neutral-950/80 text-white ring-1 ring-white/15 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            :aria-label="`Remove ${att.name}`"
            @click="removePending(att.tempId)"
          >
            <UIcon name="i-heroicons-x-mark" class="size-3" />
          </button>
        </div>
      </div>

      <div
        class="flex items-center gap-2 rounded-xl bg-elevated ring-1 ring-default pl-3 pr-2 py-1.5 focus-within:ring-primary/40 transition-colors"
      >
        <UIcon name="i-heroicons-plus" class="size-5 text-muted shrink-0" aria-hidden="true" />
        <textarea
          id="comment-composer"
          v-model="composerBody"
          rows="1"
          placeholder="Type a message — paste an image to upload"
          class="flex-1 resize-none bg-transparent text-sm text-default placeholder:text-muted/70 focus:outline-none leading-6 py-1 min-h-6 max-h-40"
          @keydown="onComposerKeydown"
          @paste="onComposerPaste"
        />
        <span
          v-if="uploading"
          class="text-sm text-primary inline-flex items-center gap-1.5 shrink-0"
        >
          <UIcon name="i-heroicons-arrow-path" class="size-3.5 animate-spin" />
          Uploading…
        </span>
        <span v-else class="text-sm text-muted/70 hidden sm:inline shrink-0 tabular-nums"
          >⌘+Enter</span
        >
        <button
          type="button"
          class="shrink-0 inline-flex items-center justify-center size-8 rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          :disabled="!canSend"
          :aria-label="composerLoading ? 'Sending' : 'Send'"
          @click="submitComment"
        >
          <UIcon v-if="!composerLoading" name="i-heroicons-paper-airplane" class="size-4" />
          <UIcon v-else name="i-heroicons-arrow-path" class="size-4 animate-spin" />
        </button>
      </div>
      <p v-if="composerError" class="mt-2 text-sm text-error">{{ composerError }}</p>
    </div>
  </div>
</template>
