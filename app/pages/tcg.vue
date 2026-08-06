<script setup lang="ts">
const route = useRoute()
const { user } = useAuth()

const tabs = [
  { label: 'Shop', to: '/tcg', icon: 'i-lucide-store' },
  { label: 'My packs', to: '/tcg/packs', icon: 'i-lucide-package' },
  { label: 'Collection', to: '/tcg/collection', icon: 'i-lucide-library-big' },
  { label: 'Grading', to: '/tcg/grading', icon: 'i-lucide-medal' },
  { label: 'Pop report', to: '/tcg/pops', icon: 'i-lucide-chart-column' }
]
</script>

<template>
  <div class="flex min-h-full flex-col">
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
      <h1 class="flex items-center gap-2 text-lg font-semibold text-highlighted">
        <UIcon
          name="i-lucide-layers"
          class="size-5 text-primary"
        />
        TCG
      </h1>
      <span class="flex items-center gap-1.5 text-sm text-muted">
        <UIcon
          name="i-lucide-gem"
          class="size-4 text-primary"
        />
        <b class="tabular-nums text-highlighted">{{ formatNumber(user?.gems ?? 0, false) }}</b>
        gems
      </span>
    </div>

    <div class="flex gap-1 border-b border-default px-4">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm"
        :class="route.path === tab.to
          ? 'border-primary font-medium text-highlighted'
          : 'border-transparent text-muted hover:text-highlighted'"
      >
        <UIcon
          :name="tab.icon"
          class="size-4"
        />
        <span class="hidden sm:inline-block">{{ tab.label }}</span>
      </NuxtLink>
    </div>

    <NuxtPage />
  </div>
</template>
