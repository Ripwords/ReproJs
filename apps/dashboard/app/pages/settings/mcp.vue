<script setup lang="ts">
import { computed, ref } from "vue"

useHead({ title: "MCP / AI assistants" })

const toast = useToast()

// `useRequestURL()` resolves at request time (SSR → Host header via reverse
// proxy; client → `window.location.origin`) so copy-paste snippets always
// match the dashboard's real public hostname without relying on a build-time
// env var.
const origin = useRequestURL().origin
const mcpUrl = computed(() => `${origin}/api/mcp`)

const claudeDesktopSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        repro: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl.value],
        },
      },
    },
    null,
    2,
  ),
)

const cursorSnippet = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        repro: { url: mcpUrl.value, transport: "streamable-http" },
      },
    },
    null,
    2,
  ),
)

const remoteCli = computed(() => `npx mcp-remote ${mcpUrl.value}`)

interface Connection {
  clientId: string
  clientName: string
  scopes: string[]
  connectedAt: string
  lastUsedAt: string | null
}

const { data: connectionsData, refresh } = await useApi<{ connections: Connection[] }>(
  "/api/me/mcp-connections",
)

const connections = computed(() => connectionsData.value?.connections ?? [])

const revokingClient = ref<string | null>(null)

async function revoke(clientId: string): Promise<void> {
  revokingClient.value = clientId
  try {
    await $fetch(`/api/me/mcp-connections/${clientId}`, {
      method: "DELETE",
      credentials: "include",
    })
    await refresh()
    toast.add({
      title: "Disconnected",
      color: "success",
      icon: "i-heroicons-check-circle",
    })
  } catch (e: unknown) {
    const err = e as { statusMessage?: string; message?: string }
    toast.add({
      title: "Could not disconnect",
      description: err.statusMessage ?? err.message ?? "Unknown error",
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  } finally {
    revokingClient.value = null
  }
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({
      title: "Copied to clipboard",
      color: "success",
      icon: "i-heroicons-clipboard-document-check",
    })
  } catch {
    toast.add({ title: "Copy failed", color: "error" })
  }
}
</script>

<template>
  <div class="space-y-8 max-w-3xl">
    <header>
      <h1 class="text-2xl font-semibold text-default">MCP / AI assistants</h1>
      <p class="text-sm text-muted mt-1">
        Connect an AI assistant (Claude Desktop, Cursor, ChatGPT, …) to triage your Repro tickets
        through the Model Context Protocol.
      </p>
    </header>

    <!-- ── Connect section ─────────────────────────────────────────────── -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-default">Connect an AI assistant</h2>

      <!-- Claude Desktop -->
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold text-default">Claude Desktop</h3>
        </template>
        <p class="text-sm text-muted mb-3">
          Add to
          <code class="font-mono px-1 rounded bg-muted">
            ~/Library/Application Support/Claude/claude_desktop_config.json
          </code>
          (macOS) or
          <code class="font-mono px-1 rounded bg-muted">
            %APPDATA%\Claude\claude_desktop_config.json
          </code>
          (Windows):
        </p>
        <div class="relative rounded-lg border border-default overflow-hidden">
          <pre
            class="text-xs p-4 overflow-x-auto font-mono leading-relaxed"
          ><code>{{ claudeDesktopSnippet }}</code></pre>
          <UButton
            class="absolute top-2 right-2"
            icon="i-heroicons-clipboard"
            size="xs"
            color="neutral"
            variant="subtle"
            aria-label="Copy Claude Desktop snippet"
            @click="copy(claudeDesktopSnippet)"
          />
        </div>
      </UCard>

      <!-- Cursor -->
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold text-default">Cursor</h3>
        </template>
        <p class="text-sm text-muted mb-3">
          Add to
          <code class="font-mono px-1 rounded bg-muted">~/.cursor/mcp.json</code>:
        </p>
        <div class="relative rounded-lg border border-default overflow-hidden">
          <pre
            class="text-xs p-4 overflow-x-auto font-mono leading-relaxed"
          ><code>{{ cursorSnippet }}</code></pre>
          <UButton
            class="absolute top-2 right-2"
            icon="i-heroicons-clipboard"
            size="xs"
            color="neutral"
            variant="subtle"
            aria-label="Copy Cursor snippet"
            @click="copy(cursorSnippet)"
          />
        </div>
      </UCard>

      <!-- ChatGPT custom connectors -->
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold text-default">ChatGPT custom connectors</h3>
        </template>
        <p class="text-sm text-muted mb-3">
          Paste this URL into the connector dialog — OAuth discovery and login happen automatically:
        </p>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded border border-default truncate"
          >
            {{ mcpUrl }}
          </code>
          <UButton
            icon="i-heroicons-clipboard"
            size="xs"
            color="neutral"
            variant="subtle"
            aria-label="Copy MCP URL"
            @click="copy(mcpUrl)"
          >
            Copy
          </UButton>
        </div>
      </UCard>

      <!-- Generic / mcp-remote -->
      <UCard>
        <template #header>
          <h3 class="text-base font-semibold text-default">Generic (any MCP client)</h3>
        </template>
        <p class="text-sm text-muted mb-3">
          Use the <code class="font-mono px-1 rounded bg-muted">mcp-remote</code> shim to bridge any
          client that only supports the local stdio transport:
        </p>
        <div class="flex items-center gap-2">
          <code
            class="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded border border-default truncate"
          >
            {{ remoteCli }}
          </code>
          <UButton
            icon="i-heroicons-clipboard"
            size="xs"
            color="neutral"
            variant="subtle"
            aria-label="Copy mcp-remote command"
            @click="copy(remoteCli)"
          >
            Copy
          </UButton>
        </div>
      </UCard>
    </section>

    <!-- ── Connected apps section ───────────────────────────────────────── -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-default">Connected apps</h2>

      <p v-if="connections.length === 0" class="text-sm text-muted">
        No AI assistants connected yet. Follow the instructions above to connect your first client.
      </p>

      <ul v-else class="space-y-2">
        <li
          v-for="c in connections"
          :key="c.clientId"
          class="flex items-start justify-between gap-4 rounded-lg border border-default p-4"
        >
          <div class="space-y-1 min-w-0">
            <div class="font-medium text-default text-sm">{{ c.clientName }}</div>
            <div class="text-xs text-muted">
              Connected {{ new Date(c.connectedAt).toLocaleDateString() }}
              <span v-if="c.lastUsedAt">
                &middot; last used {{ new Date(c.lastUsedAt).toLocaleString() }}
              </span>
            </div>
            <div class="text-xs text-muted">
              Scopes:
              <span class="font-mono">{{ c.scopes.length ? c.scopes.join(", ") : "(none)" }}</span>
            </div>
          </div>
          <UButton
            size="xs"
            variant="subtle"
            color="error"
            :loading="revokingClient === c.clientId"
            @click="revoke(c.clientId)"
          >
            Disconnect
          </UButton>
        </li>
      </ul>
    </section>
  </div>
</template>
