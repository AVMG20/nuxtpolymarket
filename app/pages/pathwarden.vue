<script setup lang="ts">
const route = useRoute()
const tabs = [
  { label: 'Defend', to: '/pathwarden', icon: 'i-lucide-castle' },
  { label: 'Field Guide', to: '/pathwarden/wiki', icon: 'i-lucide-book-open' },
  { label: 'Rankings', to: '/pathwarden/leaderboard', icon: 'i-lucide-trophy' }
]
</script>

<template>
  <div class="flex min-h-full flex-col">
    <nav class="shrink-0 border-b border-default px-3 pb-2 pt-1.75" aria-label="Pathwarden">
      <div class="flex items-center gap-0.5">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 rounded-t-lg px-3 py-2.5 text-sm font-medium transition-colors"
          :class="route.path === tab.to ? '-mb-px text-highlighted' : 'text-muted hover:text-default'"
        >
          <UIcon :name="tab.icon" class="size-4" />
          <span>{{ tab.label }}</span>
        </NuxtLink>
      </div>
    </nav>
    <NuxtPage />
  </div>
</template>
