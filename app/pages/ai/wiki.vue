<script setup lang="ts">
interface AiTool {
  name: string
  description: string
}

const { data } = await useFetch<{ tools: AiTool[] }>('/api/ai/tools', {
  default: () => ({ tools: [] })
})

const tools = computed(() => data.value?.tools ?? [])

function toolLabel(name: string) {
  return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
</script>

<template>
  <div class="min-h-svh bg-background">
    <header class="border-b border-default bg-default">
      <UContainer class="flex h-14 items-center gap-3">
        <UButton color="neutral" icon="i-lucide-arrow-left" label="AI Assistant" to="/ai" variant="ghost" />
        <USeparator class="h-5" orientation="vertical" />
        <span class="text-sm font-medium text-muted">AI Wiki</span>
      </UContainer>
    </header>

    <UContainer class="max-w-5xl py-8 sm:py-12">
      <div class="max-w-2xl">
        <p class="text-sm font-medium text-primary">AI Assistant</p>
        <h1 class="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Available tools</h1>
        <p class="mt-3 text-muted">These are the live game actions and lookups the assistant can use for your account. Actions ask for approval unless you enable auto-approval.</p>
      </div>

      <div class="mt-8 grid gap-3 sm:grid-cols-2">
        <UCard v-for="tool in tools" :key="tool.name" :ui="{ body: 'p-4 sm:p-5' }">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <UIcon class="size-4 text-primary" name="i-lucide-wrench" />
            </div>
            <div class="min-w-0">
              <h2 class="font-medium text-highlighted">{{ toolLabel(tool.name) }}</h2>
              <p class="mt-1 text-sm leading-5 text-muted">{{ tool.description }}</p>
            </div>
          </div>
        </UCard>
      </div>

      <p v-if="!tools.length" class="mt-8 text-sm text-muted">No AI tools are currently available.</p>
    </UContainer>
  </div>
</template>
