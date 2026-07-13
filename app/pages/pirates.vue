<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Set Sail', to: '/pirates', icon: 'i-lucide-sailboat' },
  { label: 'Ship', to: '/pirates/manage', icon: 'i-lucide-hammer' },
  { label: 'History', to: '/pirates/history', icon: 'i-lucide-scroll-text' },
  { label: 'Wiki', to: '/pirates/wiki', icon: 'i-lucide-book-open' },
  { label: 'Leaderboard', to: '/pirates/leaderboard', icon: 'i-lucide-trophy' }
]

const activeTab = computed(() => route.path)
</script>

<template>
  <div class="flex min-h-full flex-col">
    <div class="shrink-0 border-b border-default px-3 pb-2 pt-1.75">
      <div class="flex items-center gap-0.5">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 rounded-t-lg px-3 py-2.5 text-sm font-medium transition-colors"
          :class="activeTab === tab.to
            ? 'text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon :name="tab.icon" class="size-4" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </NuxtLink>
      </div>
    </div>

    <div class="pb-12">
      <NuxtPage />
    </div>
  </div>
</template>
