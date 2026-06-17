<script setup lang="ts">
import { tierLabel, tierColor, plantColor, plantBgOnly, getPlant, effectiveGrowTime } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { inventory, sellPlants } = useXeno()

const searchQuery = ref('')
const tierFilter = ref(0)

const filteredInventory = computed(() => {
  const q = searchQuery.value.toLowerCase()
  return (inventory.value || []).filter((item: any) => {
    if (tierFilter.value !== 0 && item.tier !== tierFilter.value) return false
    if (q && !item.name.toLowerCase().includes(q)) return false
    return true
  })
})

const selling = ref<Record<string, boolean>>({})

function stackKey(item: any) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

async function doSell(item: any, qty: number) {
  const key = `${stackKey(item)}-${qty}`
  selling.value[key] = true
  try { await sellPlants(item.typeId, item.speed, item.yield, qty) }
  finally { delete selling.value[key] }
}

function growTime(item: any) {
  const base = getPlant(item.typeId)
  return base ? formatDuration(effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed })) : '?'
}
</script>

<template>
  <UContainer>
    <div class="mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2"><span>🏪</span> Market</h1>
      <p class="text-sm text-muted mt-0.5">Sell your xenoflora for cash.</p>
    </div>

    <!-- Filters -->
    <div class="flex gap-2 mb-4">
      <UInput
        v-model="searchQuery"
        placeholder="Search plants…"
        icon="i-lucide-search"
        size="sm"
        class="flex-1"
      />
      <USelect
        v-model="tierFilter"
        :items="[
          { label: 'All tiers', value: 0 },
          { label: 'T1', value: 1 },
          { label: 'T2', value: 2 },
          { label: 'T3', value: 3 },
          { label: 'T4', value: 4 },
          { label: 'T5', value: 5 },
        ]"
        size="sm"
        class="w-28"
      />
    </div>

    <div v-if="!inventory" class="space-y-2">
      <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else class="space-y-2">
      <div v-if="!filteredInventory.length" class="text-sm text-muted py-12 text-center">
        {{ inventory.length ? 'No plants match your filter.' : 'No plants in inventory.' }}
      </div>

      <div
        v-for="item in filteredInventory"
        :key="stackKey(item)"
        class="rounded-xl border border-default px-4 py-3 flex items-center gap-4"
        :class="plantBgOnly(item.color)"
      >
        <!-- Emoji + qty -->
        <div class="shrink-0 flex flex-col items-center gap-1.5 w-10">
          <span class="text-2xl leading-none">{{ item.emoji }}</span>
          <span class="text-xs font-black text-success tabular-nums leading-none">×{{ item.quantity }}</span>
        </div>

        <!-- Plant info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="font-bold text-sm" :class="plantColor(item.color)">{{ item.name }}</p>
            <XenoTierLabel :tier="item.tier" />
          </div>
          <div class="flex items-center gap-1.5 mt-0.5">
            <XenoLevelBadge prefix="S" :level="item.speed" />
            <XenoLevelBadge prefix="Y" :level="item.yield" />
            <span class="text-xs text-muted">~{{ growTime(item) }}</span>
          </div>
        </div>

        <!-- Price per unit -->
        <div class="text-right shrink-0 hidden sm:block">
          <p class="text-xs text-muted tabular-nums">${{ formatNumber(item.value, false) }} ea</p>
        </div>

        <!-- Sell buttons -->
        <div class="flex flex-col gap-1 shrink-0">
          <div class="flex gap-1">
            <UButton
              v-for="qty in [1, 10, 50]"
              :key="qty"
              size="xs"
              variant="soft"
              color="success"
              :disabled="qty > item.quantity"
              :loading="selling[`${stackKey(item)}-${qty}`]"
              @click="doSell(item, qty)"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
              <span class="text-xs text-muted ml-1 tabular-nums">${{ formatNumber(item.value * qty, false) }}</span>
            </UButton>
          </div>
          <UButton
            size="xs"
            color="success"
            variant="soft"
            block
            :loading="selling[`${stackKey(item)}-${item.quantity}`]"
            @click="doSell(item, item.quantity)"
          >
            <span class="font-semibold">Sell All</span>
            <span class="text-xs ml-1 tabular-nums">${{ formatNumber(item.value * item.quantity, false) }}</span>
          </UButton>
        </div>
      </div>
    </div>
  </UContainer>
</template>
