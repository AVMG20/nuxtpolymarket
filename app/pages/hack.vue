<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Ops', to: '/hack', icon: 'i-lucide-terminal' },
  { label: 'Agents', to: '/hack/agents', icon: 'i-lucide-users' },
  { label: 'Items', to: '/hack/items', icon: 'i-lucide-cpu' },
  { label: 'Wiki', to: '/hack/wiki', icon: 'i-lucide-book-open' },
]

const activeTab = computed(() => route.path)
</script>

<template>
  <div class="flex flex-col min-h-full">
    <div class="border-b border-default px-6 pb-0 shrink-0">
      <div class="flex items-center justify-between sm:justify-start gap-1 w-full">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors"
          :class="activeTab === tab.to
            ? 'bg-background border-default text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon :name="tab.icon" class="size-4" />
          <span class="hidden sm:inline-block">{{ tab.label }}</span>
        </NuxtLink>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>
