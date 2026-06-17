<script setup lang="ts">
import { tierColor, plantColor, plantBgOnly, getPlant, effectiveGrowTime, PLANT_TYPES } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const { inventory, sellPlants, unlockedTypeIds, buyPlants } = useXeno()

const activeTab = ref<'sell' | 'buy'>('sell')
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

function buyPrice(plant: { value: number; yield: number; speed: number }): number {
  return Math.round(plant.value * 2 * (1 + plant.yield) * (1 + plant.speed * 0.05))
}

const buyablePlants = computed(() => {
  const unlocked = new Set(unlockedTypeIds.value)
  const q = searchQuery.value.toLowerCase()
  return PLANT_TYPES
    .filter(p => {
      if (!unlocked.has(p.id)) return false
      if (tierFilter.value !== 0 && p.tier !== tierFilter.value) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
    .map(p => ({ ...p, buyPrice: buyPrice(p) }))
    .sort((a, b) => b.tier !== a.tier ? b.tier - a.tier : b.value - a.value)
})

const selling = ref<Record<string, boolean>>({})
const buying = ref<Record<string, boolean>>({})

function stackKey(item: any) {
  return `${item.typeId}:${item.speed}:${item.yield}`
}

async function doSell(item: any, qty: number) {
  const key = `${stackKey(item)}-${qty}`
  selling.value[key] = true
  try { await sellPlants(item.typeId, item.speed, item.yield, qty) }
  finally { delete selling.value[key] }
}

async function doBuy(typeId: string, qty: number) {
  const key = `${typeId}-${qty}`
  buying.value[key] = true
  try { await buyPlants(typeId, qty) }
  finally { delete buying.value[key] }
}

function growTime(item: any) {
  const base = getPlant(item.typeId ?? item.id)
  return base ? formatDuration(effectiveGrowTime({ baseTime: base.baseTime, speed: item.speed })) : '?'
}
</script>

<template>
  <UContainer>
    <div class="mb-6">
      <h1 class="text-2xl font-bold flex items-center gap-2"><span>🏪</span> Market</h1>
      <p class="text-sm text-muted mt-0.5">Buy and sell xenoflora.</p>
    </div>

    <!-- Tabs -->
    <div class="flex border-b border-default mb-4">
      <button
        class="px-5 py-2.5 text-sm font-semibold transition-all duration-100"
        :class="activeTab === 'sell' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'sell'"
      >
        Sell
      </button>
      <button
        class="px-5 py-2.5 text-sm font-semibold transition-all duration-100"
        :class="activeTab === 'buy' ? 'text-primary border-b-2 border-primary' : 'text-muted hover:text-default'"
        @click="activeTab = 'buy'"
      >
        Buy
      </button>
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

    <!-- ── SELL TAB ── -->
    <div v-if="activeTab === 'sell'">
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
            <UTooltip :delay-duration="300" :content="{ side: 'right', sideOffset: 8 }">
              <template #content>
                <XenoPlantTooltipContent
                  :name="item.name"
                  :tier="item.tier"
                  :color="item.color"
                  :speed="item.speed"
                  :yield="item.yield"
                  :base-time="item.baseTime"
                  :value="item.value"
                  :description="item.description"
                  :quantity="item.quantity"
                />
              </template>
              <span class="text-2xl leading-none cursor-default">{{ item.emoji }}</span>
            </UTooltip>
            <span class="text-xs font-black text-primary tabular-nums leading-none">×{{ item.quantity }}</span>
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
                color="primary"
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
              color="primary"
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
    </div>

    <!-- ── BUY TAB ── -->
    <div v-else>
      <div v-if="!unlockedTypeIds.length" class="text-sm text-muted py-12 text-center">
        Harvest plants from the grid first to unlock them for purchase.
      </div>

      <div v-else class="space-y-2">
        <div v-if="!buyablePlants.length" class="text-sm text-muted py-12 text-center">
          No unlocked plants match your filter.
        </div>

        <div
          v-for="plant in buyablePlants"
          :key="plant.id"
          class="rounded-xl border border-default px-4 py-3 flex items-center gap-4"
          :class="plantBgOnly(plant.color)"
        >
          <!-- Emoji -->
          <div class="shrink-0 flex flex-col items-center gap-1.5 w-10">
            <UTooltip :delay-duration="300" :content="{ side: 'right', sideOffset: 8 }">
              <template #content>
                <XenoPlantTooltipContent
                  :name="plant.name"
                  :tier="plant.tier"
                  :color="plant.color"
                  :speed="plant.speed"
                  :yield="plant.yield"
                  :base-time="plant.baseTime"
                  :value="plant.value"
                  :description="plant.description"
                />
              </template>
              <span class="text-2xl leading-none cursor-default">{{ plant.emoji }}</span>
            </UTooltip>
          </div>

          <!-- Plant info -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <p class="font-bold text-sm" :class="plantColor(plant.color)">{{ plant.name }}</p>
              <XenoTierLabel :tier="plant.tier" />
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
              <XenoLevelBadge prefix="S" :level="plant.speed" />
              <XenoLevelBadge prefix="Y" :level="plant.yield" />
              <span class="text-xs text-muted">~{{ formatDuration(effectiveGrowTime({ baseTime: plant.baseTime, speed: plant.speed })) }}</span>
            </div>
          </div>

          <!-- Price per unit -->
          <div class="text-right shrink-0 hidden sm:block">
            <p class="text-xs text-muted tabular-nums">${{ formatNumber(plant.buyPrice, false) }} ea</p>
          </div>

          <!-- Buy buttons -->
          <div class="flex gap-1 shrink-0">
            <UButton
              v-for="qty in [1, 10]"
              :key="qty"
              size="xs"
              variant="soft"
              color="primary"
              :disabled="balance < plant.buyPrice * qty"
              :loading="buying[`${plant.id}-${qty}`]"
              @click="doBuy(plant.id, qty)"
            >
              <span class="tabular-nums font-semibold">×{{ qty }}</span>
              <span class="text-xs text-muted ml-1 tabular-nums">${{ formatNumber(plant.buyPrice * qty, false) }}</span>
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </UContainer>
</template>
