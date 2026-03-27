<script setup lang="ts">
const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const { data: state, refresh } = await useFetch('/api/miner/state')

const toast = useToast()
const buying = ref<string | null>(null)

const instantFillValuePerGem = computed(() => {
  if (!state.value?.instantFillCost) return 0
  return Math.floor(state.value.cap / state.value.instantFillCost)
})

const shopItems = computed(() => [
  {
    id: 'instant-fill',
    label: 'Instant Fill',
    description: 'Max out your Money Miner storage instantly.',
    valuePerGem: instantFillValuePerGem.value,
    icon: 'i-lucide-zap',
    color: 'secondary' as const,
    cost: state.value?.instantFillCost ?? 1,
    endpoint: '/api/miner/shop/instant-fill',
  },
  {
    id: 'extra-play',
    label: 'Extra Play',
    description: 'Restore 1 used Mines play today.',
    valuePerGem: 350 * (state.value?.minesValueMultiplier ?? 1),
    icon: 'i-lucide-gamepad-2',
    color: 'primary' as const,
    cost: 1,
    endpoint: '/api/miner/shop/extra-play',
  },
  {
    id: 'quick-cash',
    label: 'Quick Cash',
    description: `Convert 1 Gem into ${formatNumber(state.value?.quickCashAmount ?? 200, false)},- instantly.`,
    valuePerGem: state.value?.quickCashAmount ?? 200,
    icon: 'i-lucide-coins',
    color: 'primary' as const,
    cost: 1,
    endpoint: '/api/miner/shop/quick-cash',
  },
])

function isItemDisabled(item: typeof shopItems[number]) {
  if (gems.value < item.cost) return true
  if (item.id === 'extra-play') {
    const s = state.value
    return !s || s.minesPlaysRemaining >= s.minesCount
  }
  return !item.endpoint
}

async function purchase(item: typeof shopItems[number]) {
  if (!item.endpoint) return
  buying.value = item.id
  try {
    await $fetch(item.endpoint, { method: 'POST' })
    toast.add({ title: `${item.label} purchased!`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    console.error(e)
    toast.add({ title: e.data?.message ?? 'Purchase failed', color: 'error' })
  } finally {
    buying.value = null
  }
}
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Gem Shop</h1>
        <p class="text-sm text-muted mt-0.5">Exchange rare gems for game-breaking advantages.</p>
      </div>
      <div class="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated border border-default">
        <UIcon name="i-lucide-gem" class="size-5 text-cyan-400" />
        <UTooltip :text="formatNumber(gems, false, 0)">
          <span class="text-xl font-bold">{{ formatNumber(gems, true, 0) }}</span>
        </UTooltip>
        <span class="text-sm text-muted">Gems</span>
      </div>
    </div>

    <!-- Skeletons -->
    <div v-if="!state" class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <USkeleton v-for="i in 4" :key="i" class="h-36 rounded-xl" />
    </div>

    <!-- Shop grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <UCard
        v-for="item in shopItems"
        :key="item.id"
        class="flex flex-col"
      >
        <div class="flex items-start gap-4 flex-1">
          <div class="size-12 rounded-xl flex items-center justify-center shrink-0" :class="`bg-${item.color}/15`">
            <UIcon :name="item.icon" class="size-6" :class="`text-${item.color}`" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between gap-2 mb-1">
              <p class="font-semibold text-base">{{ item.label }}</p>
              <div class="flex items-center gap-1 shrink-0">
                <UIcon name="i-lucide-gem" class="size-3.5 text-cyan-400" />
                <span class="font-bold">{{ item.cost }}</span>
              </div>
            </div>
            <div class="text-sm text-muted mb-4">
              <span v-html="item.description"></span>
              <div v-if="item.valuePerGem !== undefined" class="mt-1 flex items-center gap-1 opacity-75">
                (~ <CoinBalance :value="item.valuePerGem" :compact="false" /> / Gem)
              </div>
            </div>
            <UButton
              label="Purchase"
              size="sm"
              :color="item.color"
              :loading="buying === item.id"
              :disabled="isItemDisabled(item)"
              @click="purchase(item)"
            />
            <UBadge v-if="!item.endpoint" label="Coming Soon" color="neutral" variant="subtle" class="ml-2" />
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
