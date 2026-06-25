<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, formatModValue, MOD_LABEL,
  itemSellPrice, RARITY_ORDER, MOD_RANGES, RARITY_MOD_COUNT,
  SLOT_ICON, SLOT_LABEL, SLOT_COLOR, tierModRange, rerollCost,
  type HackRarity, type ItemSlot, type ItemMod, type ModType,
} from '#shared/utils/hack-config'

// Roll quality: what % of max value does this mod roll represent
function rollQuality(type: ModType, value: number): number {
  const range = MOD_RANGES[type]
  return Math.round((value - range.min) / (range.max - range.min) * 100)
}
// Roll quality coloring (shared by value text + progress bar). Red below 25% of max,
// yellow below 55%, primary above — never muted, so every bar stays visible.
function rollQualityColor(pct: number) {
  if (pct < 25) return 'text-error'
  if (pct < 55) return 'text-warning'
  return 'text-primary'
}
function formatRangeValue(type: ModType, val: number): string {
  if (type === 'gem_chance' || type === 'item_chance') return `${(val * 100).toFixed(1)}%`
  if (type === 'xp_flat') return `${val} XP`
  if (type === 'gem_bonus') return `${Math.round(val)} gems`
  if (type === 'power_flat') return `${val}`
  return `${val}%`
}

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

type InvItem = { id: string; name: string; slot: ItemSlot; itemLevel: number; rarity: HackRarity; mods: ItemMod[]; equippedBy?: string | null }

// Mobile inventory
const mobileOpen = ref(false)

// Item pulls
const pulling = ref<string | null>(null)
const lastPull = ref<{
  name: string; rarity: string; rarityLabel: string
  slot: string; itemLevel: number; mods: ItemMod[]
} | null>(null)

async function pullItem(tierId: string) {
  pulling.value = tierId
  lastPull.value = null
  try {
    const res = await $fetch('/api/hack/items/pull', { method: 'POST', body: { tierId } })
    const item = res.item!
    lastPull.value = {
      name: item.name, rarity: res.rarity, rarityLabel: res.rarityLabel,
      slot: item.slot, itemLevel: item.itemLevel, mods: item.mods as ItemMod[],
    }
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Pull failed', color: 'error' })
  } finally { pulling.value = null }
}

// Inventory selection — selecting an item lets you drop it into the re-roll station
const selectedItemId = ref<string | null>(null)
const selectedItem = computed<InvItem | null>(() => state.value?.items.find(i => i.id === selectedItemId.value) ?? null)
function selectItem(id: string) {
  selectedItemId.value = selectedItemId.value === id ? null : id
}

// Inventory sorting
const sortOptions = [
  { value: 'value', label: 'Value' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'type', label: 'Type' },
] as const
const sortBy = ref<'value' | 'rarity' | 'type'>('rarity')
const sortDir = ref<'desc' | 'asc'>('desc')

const sortedItems = computed<InvItem[]>(() => {
  const items = [...(state.value?.items ?? [])]
  const dir = sortDir.value === 'asc' ? 1 : -1
  items.sort((a, b) => {
    let cmp = 0
    if (sortBy.value === 'value') cmp = itemSellPrice(a.rarity, a.itemLevel) - itemSellPrice(b.rarity, b.itemLevel)
    else if (sortBy.value === 'rarity') cmp = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    else cmp = a.slot.localeCompare(b.slot)
    if (cmp === 0) cmp = itemSellPrice(a.rarity, a.itemLevel) - itemSellPrice(b.rarity, b.itemLevel)
    return cmp * dir
  })
  return items
})

const selling = ref<string | null>(null)
async function sellItem(itemId: string, rarity: HackRarity, itemLevel: number) {
  selling.value = itemId
  try {
    const res = await $fetch('/api/hack/items/sell', { method: 'POST', body: { itemId } })
    toast.add({ title: `Sold for $${formatNumber(res.price, true)}`, color: 'success' })
    selectedItemId.value = null
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Sell failed', color: 'error' })
  } finally { selling.value = null }
}

// ── Re-roll station ───────────────────────────────────────────
// The station is a permanent card. Select an item in the inventory, then click the
// station to load it. `rerollItem` derives from live state so it stays in sync (and
// clears itself if the item is sold).
const rerollItemId = ref<string | null>(null)
const rerollItem = computed<InvItem | null>(() => state.value?.items.find(i => i.id === rerollItemId.value) ?? null)
const rerollLocked = ref<ModType[]>([])
const rerolling = ref(false)

function loadReroll(id: string) {
  rerollItemId.value = id
  rerollLocked.value = []
  selectedItemId.value = null
  mobileOpen.value = false
}
function clearReroll() {
  rerollItemId.value = null
  rerollLocked.value = []
}
function toggleLock(type: ModType) {
  const i = rerollLocked.value.indexOf(type)
  if (i === -1) rerollLocked.value.push(type)
  else rerollLocked.value.splice(i, 1)
}
const rerollCostValue = computed(() =>
  rerollItem.value ? rerollCost(rerollItem.value.mods.length, rerollLocked.value.length) : 0)
const rerollCount = computed(() =>
  rerollItem.value ? rerollItem.value.mods.length - rerollLocked.value.length : 0)
const canReroll = computed(() => rerollCount.value > 0)

async function doReroll() {
  if (!rerollItem.value) return
  rerolling.value = true
  try {
    const res = await $fetch('/api/hack/items/reroll', {
      method: 'POST',
      body: { itemId: rerollItem.value.id, lockedTypes: rerollLocked.value },
    })
    toast.add({ title: `Re-rolled for ${res.cost} gems`, color: 'success' })
    // Live state refresh updates the derived rerollItem with the new mods.
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Re-roll failed', color: 'error' })
  } finally { rerolling.value = false }
}
</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Main area: Item Pulls ───────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-6 pb-12">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold">Item Pulls</h1>
          <p class="text-sm text-muted mt-0.5">Gamble for random gear. Better tiers = better mods and rarity.</p>
        </div>
        <div class="flex items-center gap-2">
          <div v-if="state" class="px-3 py-2 rounded-lg bg-elevated border border-default text-sm font-medium">
            {{ state.inventoryCount }}/{{ state.maxInventorySlots }} items
          </div>
          <UButton icon="i-lucide-package" label="Inventory" variant="soft" color="neutral" size="sm"
            class="lg:hidden" @click="mobileOpen = true" />
        </div>
      </div>

      <p class="text-sm text-muted -mt-2">
        Each crate has a <strong>fixed price</strong>. Better tiers cost more but roll higher rarity and stronger mods.
      </p>

      <!-- Re-roll station — permanent. Select an item in the inventory, then drop it here. -->
      <UCard class="ring-1 ring-cyan-500/40">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-start gap-2.5">
            <div class="size-9 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-dices" class="size-5 text-cyan-400" />
            </div>
            <div>
              <p class="font-bold text-base leading-tight">Re-roll Station</p>
              <p class="text-sm text-muted">Lock the specs you want to keep — the rest are re-rolled. Each lock costs extra.</p>
            </div>
          </div>
          <UButton v-if="rerollItem" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="clearReroll" />
        </div>

        <!-- Loaded: lock + re-roll -->
        <template v-if="rerollItem">
          <div class="flex items-center gap-2 mb-3">
            <UBadge :color="RARITY_COLOR[rerollItem.rarity]" variant="subtle" :label="RARITY_LABEL[rerollItem.rarity]" />
            <span class="font-semibold text-sm">{{ rerollItem.name }}</span>
            <span class="text-sm text-muted">Lv {{ rerollItem.itemLevel }}</span>
          </div>

          <div class="space-y-1.5 mb-4">
            <button
              v-for="m in rerollItem.mods" :key="m.type" type="button"
              class="w-full flex items-center justify-between gap-3 p-2 rounded-lg border transition-colors text-left"
              :class="rerollLocked.includes(m.type)
                ? 'border-cyan-500/50 bg-cyan-500/10'
                : 'border-default bg-elevated hover:border-cyan-500/30'"
              @click="toggleLock(m.type)"
            >
              <div class="flex items-center gap-2 shrink-0">
                <UIcon :name="rerollLocked.includes(m.type) ? 'i-lucide-lock' : 'i-lucide-lock-open'"
                  class="size-4" :class="rerollLocked.includes(m.type) ? 'text-cyan-400' : 'text-muted'" />
                <span class="text-sm text-muted">{{ MOD_LABEL[m.type] }}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted">max {{ formatRangeValue(m.type, MOD_RANGES[m.type].max) }}</span>
                <span class="font-bold text-sm w-16 text-right" :class="rollQualityColor(rollQuality(m.type, m.value))">
                  {{ formatModValue(m.type, m.value) }}
                </span>
                <div class="w-16 h-1.5 rounded-full bg-elevated-2 overflow-hidden">
                  <div class="h-full rounded-full transition-all"
                    :class="rollQualityColor(rollQuality(m.type, m.value)).replace('text-', 'bg-')"
                    :style="{ width: `${rollQuality(m.type, m.value)}%` }" />
                </div>
              </div>
            </button>
          </div>

          <div class="flex items-center justify-between gap-3">
            <p class="text-sm text-muted">
              {{ rerollLocked.length }} locked · re-rolls {{ rerollCount }} mod{{ rerollCount === 1 ? '' : 's' }}
            </p>
            <UButton color="primary" :loading="rerolling"
              :disabled="!canReroll || gems < rerollCostValue" @click="doReroll">
              Re-roll
              <template #trailing>
                <GemBalance :value="rerollCostValue" :compact="false" />
              </template>
            </UButton>
          </div>
        </template>

        <!-- Empty: drop target when an item is selected, otherwise a hint -->
        <button
          v-else type="button" :disabled="!selectedItem"
          class="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-lg border-2 border-dashed transition-colors"
          :class="selectedItem
            ? 'border-cyan-500/60 bg-cyan-500/5 hover:bg-cyan-500/10 cursor-pointer'
            : 'border-default cursor-default'"
          @click="selectedItem && loadReroll(selectedItem.id)"
        >
          <UIcon :name="selectedItem ? 'i-lucide-arrow-down-to-line' : 'i-lucide-dices'"
            class="size-7" :class="selectedItem ? 'text-cyan-400' : 'text-muted opacity-40'" />
          <span v-if="selectedItem" class="text-sm font-medium text-cyan-400">Place {{ selectedItem.name }} here</span>
          <span v-else class="text-sm text-muted">Select an item from your inventory to re-roll its mods.</span>
        </button>
      </UCard>

      <!-- Pull result reveal card — shown on top right after a pull -->
      <UCard v-if="lastPull" class="ring-1 ring-primary/40">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="flex items-start gap-3">
            <div class="size-12 rounded-xl flex items-center justify-center shrink-0 ring-1"
              :class="[SLOT_COLOR[lastPull.slot as ItemSlot].bg, SLOT_COLOR[lastPull.slot as ItemSlot].ring]">
              <UIcon :name="SLOT_ICON[lastPull.slot as ItemSlot]" class="size-6"
                :class="SLOT_COLOR[lastPull.slot as ItemSlot].text" />
            </div>
            <div>
              <div class="flex items-center gap-2 mb-1">
                <UBadge :color="RARITY_COLOR[lastPull.rarity as HackRarity]" variant="subtle" :label="lastPull.rarityLabel" />
                <div class="flex items-center gap-1 px-2 py-0.5 rounded-md border text-sm font-medium"
                  :class="[SLOT_COLOR[lastPull.slot as ItemSlot].bg, SLOT_COLOR[lastPull.slot as ItemSlot].border, SLOT_COLOR[lastPull.slot as ItemSlot].text]">
                  <UIcon :name="SLOT_ICON[lastPull.slot as ItemSlot]" class="size-3.5" />
                  <span>{{ SLOT_LABEL[lastPull.slot as ItemSlot] }}</span>
                </div>
                <span class="text-sm text-muted">Lv {{ lastPull.itemLevel }}</span>
              </div>
              <p class="font-bold text-xl">{{ lastPull.name }}</p>
            </div>
          </div>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="lastPull = null" />
        </div>
        <div class="space-y-1.5">
          <div v-for="m in lastPull.mods" :key="m.type"
            class="flex items-center justify-between p-2 rounded-lg bg-elevated">
            <span class="text-sm text-muted">{{ MOD_LABEL[m.type] }}</span>
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted">
                max {{ formatRangeValue(m.type, MOD_RANGES[m.type].max) }}
              </span>
              <span class="font-bold text-base" :class="rollQualityColor(rollQuality(m.type, m.value))">
                {{ formatModValue(m.type, m.value) }}
              </span>
              <div class="w-16 h-1.5 rounded-full bg-elevated-2 overflow-hidden">
                <div class="h-full rounded-full transition-all"
                  :class="rollQualityColor(rollQuality(m.type, m.value)).replace('text-', 'bg-')"
                  :style="{ width: `${rollQuality(m.type, m.value)}%` }" />
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <div v-if="!state" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <USkeleton v-for="i in 4" :key="i" class="h-52 rounded-xl" />
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UCard v-for="tier in state.itemPullTiers" :key="tier.id" class="flex flex-col">
          <div class="flex items-start gap-3 mb-4">
            <div class="size-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <UIcon name="i-lucide-package-open" class="size-6 text-primary" />
            </div>
            <div>
              <p class="font-bold text-base">{{ tier.name }}</p>
              <p class="text-sm text-muted">{{ tier.description }}</p>
              <p class="text-sm text-muted">Item level {{ tier.minItemLevel }}–{{ tier.maxItemLevel }}</p>
            </div>
          </div>

          <!-- Rarity odds -->
          <div class="space-y-1.5 mb-3">
            <div v-for="r in RARITY_ORDER.filter(r => tier.weights[r] > 0)" :key="r"
              class="flex items-center justify-between text-sm">
              <div class="flex items-center gap-2">
                <UBadge :color="RARITY_COLOR[r]" variant="subtle" :label="RARITY_LABEL[r]" />
                <span class="text-muted text-sm">{{ RARITY_MOD_COUNT[r] }} mod{{ RARITY_MOD_COUNT[r] > 1 ? 's' : '' }}</span>
              </div>
              <span class="font-medium">{{ Math.round(tier.weights[r] / Object.values(tier.weights).reduce((a, b) => a + b, 0) * 100) }}%</span>
            </div>
          </div>

          <!-- Possible stat ranges (scaled per tier) -->
          <div class="mb-4 p-3 rounded-lg bg-elevated space-y-1">
            <p class="text-sm font-semibold text-muted mb-1.5">Possible stat rolls:</p>
            <div v-for="(_range, type) in MOD_RANGES" :key="type" class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ MOD_LABEL[type as ModType] }}</span>
              <span class="font-medium text-default">
                {{ formatRangeValue(type as ModType, tierModRange(type as ModType, tier.rollQuality).min) }}
                – {{ formatRangeValue(type as ModType, tierModRange(type as ModType, tier.rollQuality).max) }}
              </span>
            </div>
          </div>

          <UButton block :loading="pulling === tier.id"
            :disabled="(state.inventoryCount ?? 0) >= (state.maxInventorySlots ?? 15) || balance < tier.cost"
            @click="pullItem(tier.id)">
            Pull
            <template #trailing>
              <span class="text-sm opacity-80">${{ formatNumber(tier.cost, true) }}</span>
            </template>
          </UButton>
        </UCard>
      </div>
    </div>

    <!-- ── Right sidebar: Inventory ───────────────────────────────── -->
    <div class="hidden lg:flex flex-col w-80 shrink-0 border-l border-default overflow-y-auto">
      <div class="p-4 space-y-3 pb-12">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-base">Inventory</h2>
          <span class="text-sm text-muted">{{ state?.inventoryCount ?? 0 }}/{{ state?.maxInventorySlots ?? 30 }}</span>
        </div>

        <!-- Sort controls -->
        <div v-if="state?.items.length" class="flex items-center gap-1">
          <UButtonGroup size="xs" class="flex-1">
            <UButton
              v-for="opt in sortOptions" :key="opt.value"
              :color="sortBy === opt.value ? 'primary' : 'neutral'"
              :variant="sortBy === opt.value ? 'solid' : 'outline'"
              class="flex-1 justify-center" :label="opt.label"
              @click="sortBy = opt.value"
            />
          </UButtonGroup>
          <UButton
            size="xs" color="neutral" variant="outline"
            :icon="sortDir === 'desc' ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-narrow-wide'"
            @click="sortDir = sortDir === 'desc' ? 'asc' : 'desc'"
          />
        </div>

        <div v-if="!state" class="space-y-2">
          <USkeleton v-for="i in 4" :key="i" class="h-20 rounded-lg" />
        </div>
        <div v-else-if="!state.items.length" class="text-sm text-muted text-center py-8">
          <UIcon name="i-lucide-package-open" class="size-8 mx-auto mb-2 opacity-30" />
          Pull some items to fill your inventory.
        </div>
        <div v-else class="space-y-2">
          <HackInventoryItem
            v-for="item in sortedItems" :key="item.id"
            :item="item" :selected="selectedItemId === item.id" show-status
            @select="selectItem(item.id)"
          >
            <template #actions>
              <p class="text-sm text-muted">Click the <span class="text-cyan-400 font-medium">Re-roll Station</span> to drop this item in.</p>
              <UButton block size="sm" color="neutral" variant="subtle"
                icon="i-lucide-dollar-sign"
                :label="`Sell $${formatNumber(itemSellPrice(item.rarity, item.itemLevel), true)}`"
                :loading="selling === item.id"
                @click="sellItem(item.id, item.rarity, item.itemLevel)" />
            </template>
          </HackInventoryItem>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile slideover -->
  <USlideover v-model:open="mobileOpen" title="Inventory" side="right" class="lg:hidden">
    <template #body>
      <div class="p-4 space-y-2 overflow-y-auto h-full">
        <div v-if="!state?.items.length" class="text-sm text-muted text-center py-8">No items yet.</div>
        <HackInventoryItem
          v-else v-for="item in sortedItems" :key="item.id"
          :item="item" :selected="selectedItemId === item.id" show-status
          @select="selectItem(item.id)"
        >
          <template #actions>
            <UButton block size="sm" color="info" variant="soft"
              icon="i-lucide-arrow-down-to-line" label="Send to re-roll station"
              @click="loadReroll(item.id)" />
            <UButton block size="sm" color="neutral" variant="subtle"
              :label="`Sell $${formatNumber(itemSellPrice(item.rarity, item.itemLevel), true)}`"
              :loading="selling === item.id" @click="sellItem(item.id, item.rarity, item.itemLevel)" />
          </template>
        </HackInventoryItem>
      </div>
    </template>
  </USlideover>
</template>
