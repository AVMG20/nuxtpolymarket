<script setup lang="ts">
const route = useRoute()
const { state, displayCash, collectableGems, cashFill } = await useMiner()

// The tabs read as an elevator down the shaft — each page is a depth.
const tabs = [
  { label: 'Shaft', depth: 'Surface', to: '/miner', icon: 'i-lucide-pickaxe' },
  { label: 'Forge', depth: '−900 m', to: '/miner/factory', icon: 'i-lucide-gem' },
  { label: 'Shop', depth: 'Supply', to: '/miner/shop', icon: 'i-lucide-store' },
  { label: 'Crates', depth: 'Loot cart', to: '/miner/lootbox', icon: 'i-lucide-package' }
]

const activeTab = computed(() => route.path)

const hud = computed(() => {
  if (!state.value) return []
  // Only what is claimable right now — the point of the strip is "what can I
  // go and collect", not a stat dump.
  return [
    {
      key: 'vault',
      icon: 'i-lucide-coins',
      label: 'Vault',
      value: `$${formatNumber(displayCash.value, true)}`,
      color: cashFill.value >= 1 ? 'text-error' : 'text-amber-400',
      hint: cashFill.value >= 1 ? 'full' : `${Math.round(cashFill.value * 100)}%`
    },
    {
      key: 'gems',
      icon: 'i-lucide-gem',
      label: 'Gems',
      value: `${collectableGems.value}`,
      color: collectableGems.value > 0 ? 'text-cyan-400' : 'text-muted',
      hint: `of ${state.value.gemCap}`
    },
    {
      key: 'crates',
      icon: 'i-lucide-package-open',
      label: 'Free opens',
      value: `${state.value.lootboxFreeOpensRemaining}`,
      color: state.value.lootboxFreeOpensRemaining > 0 ? 'text-amber-400' : 'text-muted',
      hint: `of ${state.value.lootboxSlots}`
    }
  ]
})

</script>

<template>
  <div class="miner-shell flex flex-col min-h-full">
    <!-- Depth nav -->
    <div class="border-b border-default px-4 sm:px-6 pt-3">
      <div class="flex items-stretch gap-1.5 w-full overflow-x-auto pb-0">
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="group relative flex items-center gap-2.5 px-3 sm:px-4 py-2 rounded-t-xl border border-b-0 transition-colors shrink-0"
          :class="activeTab === tab.to
            ? 'bg-elevated/80 border-default text-highlighted -mb-px'
            : 'border-transparent text-muted hover:text-default hover:bg-elevated/40'"
        >
          <span
            class="size-7 rounded-lg flex items-center justify-center transition-colors"
            :class="activeTab === tab.to ? 'bg-amber-400/15 text-amber-400' : 'bg-elevated text-muted group-hover:text-default'"
          >
            <UIcon :name="tab.icon" class="size-4" />
          </span>
          <span class="hidden sm:flex flex-col leading-tight text-left">
            <span class="text-sm font-semibold">{{ tab.label }}</span>
            <span class="text-[10px] uppercase tracking-wider text-muted">{{ tab.depth }}</span>
          </span>
          <span
            v-if="activeTab === tab.to"
            class="absolute inset-x-3 top-0 h-0.5 rounded-full bg-amber-400"
          />
        </NuxtLink>
      </div>
    </div>

    <!-- Live HUD — same figures on every subpage -->
    <div v-if="hud.length" class="border-b border-default bg-elevated/40 px-4 sm:px-6 py-2">
      <div class="flex items-center gap-x-5 gap-y-1 flex-wrap text-xs">
        <span class="text-[10px] uppercase tracking-wider text-muted">Ready to claim</span>
        <div v-for="chip in hud" :key="chip.key" class="flex items-center gap-1.5">
          <UIcon :name="chip.icon" class="size-3.5" :class="chip.color" />
          <span class="text-muted">{{ chip.label }}</span>
          <span class="font-semibold tabular-nums" :class="chip.color">{{ chip.value }}</span>
          <span class="text-muted tabular-nums">{{ chip.hint }}</span>
        </div>
      </div>
    </div>

    <div class="py-6 pb-12">
      <NuxtPage />
    </div>
  </div>
</template>

<style scoped>
/* Rock strata behind every miner page — dark bands that get warmer with depth. */
.miner-shell {
  background-image:
    linear-gradient(180deg, color-mix(in srgb, var(--ui-bg-elevated) 55%, transparent) 0%, transparent 340px),
    repeating-linear-gradient(
      179deg,
      rgba(120, 84, 42, 0.045) 0 2px,
      transparent 2px 74px
    );
}
</style>
