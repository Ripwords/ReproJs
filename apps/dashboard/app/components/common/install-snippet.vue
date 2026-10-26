<!--
  The one embed snippet. Shows the `<script async onload>` tag with this
  project's real public key and the dashboard origin the viewer is on.
  Used by the project Overview (setup state), the project Security tab and
  the admin Install page so all three stay identical.
-->
<script setup lang="ts">
import CodeSnippet from "~/components/common/code-snippet.vue"
import { buildScriptSnippet } from "~/utils/install-snippet"

interface Props {
  projectKey: string | null
}
const props = defineProps<Props>()

// `useRequestURL()` resolves at request time (SSR → Host header via reverse
// proxy; client → `window.location.origin`) so the snippet always matches
// the dashboard's real public hostname without a build-time env var.
const origin = useRequestURL().origin

const code = computed(() => buildScriptSnippet({ origin, projectKey: props.projectKey }))
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-muted">
      Paste this before the closing
      <code class="font-mono px-1 rounded bg-muted">&lt;/body&gt;</code>
      tag. The widget loads asynchronously and won't block your page.
    </p>
    <UAlert
      v-if="!projectKey"
      color="warning"
      variant="soft"
      icon="i-heroicons-exclamation-triangle"
      title="This project has no public key yet"
      description="Rotate the key on the Security tab to generate one, then replace the placeholder below."
    />
    <CodeSnippet :code="code" lang="html" copy-label="Copy embed snippet" />
  </div>
</template>
