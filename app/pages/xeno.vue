<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Garden', to: '/xeno', icon: 'i-lucide-sprout' },
  { label: 'Breeder', to: '/xeno/breeder', icon: 'i-lucide-dna' },
  { label: 'Market', to: '/xeno/market', icon: 'i-lucide-store' },
  { label: 'Artifacts', to: '/xeno/artifacts', icon: 'i-lucide-gem' },
  { label: 'Xenopedia', to: '/xeno/encyclopedia', icon: 'i-lucide-book-open' },
  { label: 'Leaderboard', to: '/xeno/leaderboard', icon: 'i-lucide-trophy' },
]

const activeTab = computed(() => route.path)
</script>

<template>
  <div class="flex flex-col min-h-full">
    <div class="border-b border-default px-3 pt-1.75 pb-2 shrink-0">
      <div class="flex items-center gap-0.5">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 px-3 py-2.5 text-sm font-medium rounded-t-lg transition-colors"
          :class="activeTab === tab.to
            ? 'text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon :name="tab.icon" class="size-4" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
        </NuxtLink>
      </div>
    </div>

    <div class="py-6 pb-12">
      <NuxtPage />
    </div>
  </div>
</template>
