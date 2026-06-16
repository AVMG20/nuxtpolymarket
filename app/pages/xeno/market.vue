<script setup lang="ts">
import { tierLabel, tierColor, plantBgOnly, getPlant, effectiveGrowTime } from '#shared/utils/xeno'
import { formatDuration } from '~/utils/xeno-format'

const { inventory, sellPlants } = useXeno()

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

    <div v-if="!inventory" class="space-y-2">
      <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-xl" />
    </div>

    <div v-else class="space-y-2">
      <div v-if="!inventory.length" class="text-sm text-muted py-12 text-center">
        No plants in inventory.
      </div>

      <div
        v-for="item in inventory"
        :key="stackKey(item)"
        class="rounded-xl border border-default px-4 py-3 flex items-center gap-4"
        :class="plantBgOnly(item.color)"
      >
        <!-- Emoji + qty (fixed position) -->
        <div class="shrink-0 flex flex-col items-center gap-1.5 w-10">
          <span class="text-2xl leading-none">{{ item.emoji }}</span>
          <span class="text-xs font-black text-success tabular-nums leading-none">×{{ item.quantity }}</span>
        </div>

        <!-- Plant info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <p class="font-bold text-sm" :class="tierColor(item.tier)">{{ item.name }}</p>
            <span class="text-xs font-bold" :class="tierColor(item.tier)">{{ tierLabel(item.tier) }}</span>
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

        <!-- Sell buttons — always show all three, disabled when insufficient qty -->
        <div class="flex flex-col gap-1 shrink-0">
          <div class="flex gap-1">
            <UButton
              v-for="qty in [1, 10, 50]"
              :key="qty"
              size="xs"
              variant="soft"
              color="neutral"
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
            color="error"
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
