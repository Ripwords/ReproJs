<!--
  Highlighted, copyable code block. Renders the plain code immediately (so
  SSR and first paint show something) and swaps in shiki's highlighted HTML
  once it loads on the client. Re-highlights whenever `code` changes, e.g.
  when the Install page's project picker switches keys.
-->
<script setup lang="ts">
import { highlightCode, type SnippetLang } from "~/composables/use-shiki"

interface Props {
  code: string
  lang: SnippetLang
  /** Accessible name for the copy button; shown as a toast title too. */
  copyLabel?: string
}
const props = withDefaults(defineProps<Props>(), { copyLabel: "Copy" })

const toast = useToast()
const highlighted = ref<{ light: string; dark: string } | null>(null)

watch(
  () => [props.code, props.lang] as const,
  async ([code, lang]) => {
    if (import.meta.server) return
    try {
      const result = await highlightCode(code, lang)
      // Ignore a stale result if the code changed while shiki was working.
      if (code === props.code) highlighted.value = result
    } catch {
      highlighted.value = null
    }
  },
  { immediate: true },
)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    toast.add({
      title: "Copied to clipboard",
      color: "success",
      icon: "i-heroicons-clipboard-document-check",
    })
  } catch {
    toast.add({ title: "Copy failed", color: "error", icon: "i-heroicons-exclamation-triangle" })
  }
}
</script>

<template>
  <div class="relative rounded-lg border border-default overflow-hidden">
    <template v-if="highlighted">
      <div class="hidden dark:block" v-html="highlighted.dark" />
      <div class="block dark:hidden" v-html="highlighted.light" />
    </template>
    <pre v-else class="shiki bg-elevated text-default"><code>{{ code }}</code></pre>
    <UButton
      class="absolute top-2 right-2"
      icon="i-heroicons-clipboard"
      size="xs"
      color="neutral"
      variant="subtle"
      :aria-label="copyLabel"
      @click="copy"
    />
  </div>
</template>

<style>
/* Shiki-emitted <pre> styling — fit into our layout (no horizontal scroll
   jitter, consistent padding, monospace inherits from the page). Also
   applied to the un-highlighted fallback so there is no layout shift. */
.shiki {
  padding: 0.875rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: auto;
}
.shiki code {
  font-family: inherit;
}
</style>
