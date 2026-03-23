<script setup lang="ts">
const route = useRoute()

const tabs = [
  { label: 'Miner', to: '/miner', icon: 'i-lucide-pickaxe' },
  { label: 'Factory', to: '/miner/factory', icon: 'i-lucide-factory' },
  { label: 'Shop', to: '/miner/shop', icon: 'i-lucide-store' },
  { label: 'Mines', to: '/miner/mines', icon: 'i-lucide-mountain' },
]

const activeTab = computed(() => route.path)
</script>

<template>
  <div class="flex flex-col min-h-full">
    <!-- Tab bar -->
    <div class="border-b border-default px-6 pb-0 shrink-0">
      <div class="flex items-center gap-1">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg  transition-colors"
          :class="activeTab === tab.to
            ? 'bg-background border-default text-highlighted -mb-px'
            : 'text-muted hover:text-default'"
        >
          <UIcon :name="tab.icon" class="size-4" />
          {{ tab.label }}
        </NuxtLink>
      </div>
    </div>

    <div class="py-6">
      <NuxtPage />
    </div>
  </div>
</template>
