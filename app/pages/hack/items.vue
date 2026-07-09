<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, MOD_LABEL, formatModValue,
  itemSellPrice, RARITY_ORDER, MOD_RANGES,
  rerollCost, ITEM_MAX_LEVEL, itemUpgradeCost, itemPower,
  type HackRarity, type ItemSlot, type ItemMod, type ModType,
} from '#shared/utils/hack-config'

const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

type InvItem = { id: string; name: string; slot: ItemSlot; itemLevel: number; rarity: HackRarity; mods: ItemMod[]; equippedBy?: string | null }

// Mobile inventory
const mobileOpen = ref(false)

// Inventory selection — selecting an item lets you drop it into the crafting bench
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
    if (sortBy.value === 'value') cmp = itemSellPrice(a.rarity) - itemSellPrice(b.rarity)
    else if (sortBy.value === 'rarity') cmp = RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    else cmp = a.slot.localeCompare(b.slot)
    if (cmp === 0) cmp = itemSellPrice(a.rarity) - itemSellPrice(b.rarity)
    return cmp * dir
  })
  return items
})

// Selling arms a confirm on the first click; a second click within the window
// actually sells. `sellConfirmId` tracks which item is armed.
const selling = ref<string | null>(null)
const sellConfirmId = ref<string | null>(null)
let sellConfirmTimer: ReturnType<typeof setTimeout> | null = null

function requestSell(itemId: string) {
  if (sellConfirmTimer) clearTimeout(sellConfirmTimer)
  if (sellConfirmId.value === itemId) {
    sellConfirmId.value = null
    sellItem(itemId)
    return
  }
  sellConfirmId.value = itemId
  sellConfirmTimer = setTimeout(() => { sellConfirmId.value = null }, 3000)
}

async function sellItem(itemId: string) {
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

// ── Crafting bench ────────────────────────────────────────────
// The bench is a permanent card that does two things with gems: upgrade an item's
// level (+2 power per level) and re-roll its specs. Select an item in the inventory,
// then click the bench to load it. `rerollItem` derives from live state so it stays
// in sync (and clears itself if the item is sold).
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
// ── Level upgrades ─────────────────────────────────────────────
const upgrading = ref(false)
const upgradeCost = computed(() =>
  rerollItem.value ? itemUpgradeCost(rerollItem.value.itemLevel) : 0)
const isMaxLevel = computed(() =>
  !!rerollItem.value && rerollItem.value.itemLevel >= ITEM_MAX_LEVEL)

async function doUpgrade() {
  if (!rerollItem.value) return
  upgrading.value = true
  try {
    const res = await $fetch('/api/hack/items/upgrade', {
      method: 'POST',
      body: { itemId: rerollItem.value.id },
    })
    toast.add({ title: `Upgraded to level ${res.newLevel}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Upgrade failed', color: 'error' })
  } finally { upgrading.value = false }
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

    <!-- ── Main area: crates + crafting bench ──────────────────────── -->
    <div class="flex-1 min-w-0 overflow-y-auto p-6 space-y-8 pb-12">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold">Items</h1>
          <p class="hack-eyebrow mt-1.5">// inventory &amp; crafting</p>
        </div>
        <div class="flex items-center gap-2">
          <div v-if="state" class="hack-frame hack-frame-tight px-3 py-2 text-sm font-medium">
            {{ state.inventoryCount }}/{{ state.maxInventorySlots }} items
          </div>
          <UButton icon="i-lucide-package" label="Inventory" variant="soft" color="neutral" size="sm"
            class="lg:hidden" @click="mobileOpen = true" />
        </div>
      </div>

      <!-- ── Crates — moved to the Black Market tab (Dead Drops section) ── -->
      <UButton
        block
        size="lg"
        color="neutral"
        variant="outline"
        to="/hack/market"
        icon="i-lucide-store"
        label="Need more gear? Visit the Black Market"
      />

      <!-- ── Crafting bench — select an item in the inventory, then drop it here ── -->
      <section class="space-y-3">
        <h2 class="hack-stat-label-md flex items-center gap-2">
          <UIcon name="i-lucide-hammer" class="size-4" /> Crafting Bench
        </h2>
        <HackFrame accent class="p-5">
          <div class="flex items-start justify-between gap-3 mb-3">
            <p class="text-sm text-muted">Spend gems to upgrade an item's level (+2 power each), or lock the specs you want to keep and re-roll the rest — each lock costs extra.</p>
            <UButton v-if="rerollItem" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" @click="clearReroll" />
          </div>

          <!-- Loaded: upgrade + lock + re-roll -->
          <template v-if="rerollItem">
            <div class="flex items-center gap-2 mb-3">
              <UBadge :color="RARITY_COLOR[rerollItem.rarity]" variant="subtle" :label="RARITY_LABEL[rerollItem.rarity]" />
              <span class="hack-card-title-lg">{{ rerollItem.name }}</span>
            </div>

            <!-- Level upgrade — +2 power per level, paid in gems -->
            <div class="hack-frame hack-frame-tight hack-frame-2 flex items-center justify-between gap-3 p-3 mb-3">
              <div>
                <p class="text-sm font-semibold">
                  Level {{ rerollItem.itemLevel }}<span v-if="!isMaxLevel" class="text-muted font-normal"> / {{ ITEM_MAX_LEVEL }}</span>
                  <span class="text-primary"> · +{{ itemPower(rerollItem) }} power</span>
                </p>
                <p class="text-sm text-muted">Every level adds +2 power for the agent wearing it.</p>
              </div>
              <UBadge v-if="isMaxLevel" color="success" variant="subtle" label="Max level" />
              <UButton v-else color="primary" variant="soft" :loading="upgrading"
                :disabled="gems < upgradeCost" @click="doUpgrade">
                Upgrade
                <template #trailing>
                  <GemBalance :value="upgradeCost" :compact="false" />
                </template>
              </UButton>
            </div>

            <div class="space-y-1.5 mb-4">
              <div v-for="m in rerollItem.mods" :key="m.type" class="hack-trait-row">
                <div class="flex items-center justify-between gap-3 mb-2">
                  <span class="text-sm">
                    <b>{{ formatModValue(m.type, m.value) }}</b>
                    <span class="hack-mod-chip-label ml-1.5">{{ MOD_LABEL[m.type] }}</span>
                  </span>
                  <button type="button" class="hack-lock-chip" :class="rerollLocked.includes(m.type) && 'locked'" @click="toggleLock(m.type)">
                    <span class="hack-lock-dot" />
                    {{ rerollLocked.includes(m.type) ? 'Locked' : 'Lock' }}
                  </button>
                </div>
                <HackRangeBar
                  :min="MOD_RANGES[m.type].min" :max="MOD_RANGES[m.type].max" :value="m.value"
                />
              </div>
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
            class="hack-frame hack-frame-tight w-full flex flex-col items-center justify-center gap-2 py-8 border-dashed transition-colors"
            :class="selectedItem ? 'hack-frame-accent cursor-pointer' : 'cursor-default'"
            @click="selectedItem && loadReroll(selectedItem.id)"
          >
            <UIcon :name="selectedItem ? 'i-lucide-arrow-down-to-line' : 'i-lucide-hammer'"
              class="size-7" :class="selectedItem ? 'text-primary' : 'text-muted opacity-40'" />
            <span v-if="selectedItem" class="text-sm font-medium text-primary">Place {{ selectedItem.name }} here</span>
            <span v-else class="text-sm text-muted">Select an item from your inventory to upgrade or re-roll it.</span>
          </button>
        </HackFrame>
      </section>
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
          Buy a crate on the Black Market to fill your inventory.
        </div>
        <div v-else class="space-y-2">
          <HackItemCard
            v-for="item in sortedItems" :key="item.id"
            :item="item" :selected="selectedItemId === item.id" show-status
            @select="selectItem(item.id)"
          >
            <template #actions>
              <p class="text-sm text-muted">Click the <span class="text-primary font-medium">Crafting Bench</span> to drop this item in.</p>
              <UButton block size="sm" icon="i-lucide-dollar-sign"
                :color="sellConfirmId === item.id ? 'error' : 'neutral'"
                :variant="sellConfirmId === item.id ? 'solid' : 'subtle'"
                :label="sellConfirmId === item.id ? 'Confirm sell?' : `Sell $${formatNumber(itemSellPrice(item.rarity), true)}`"
                :loading="selling === item.id"
                @click="requestSell(item.id)" />
            </template>
          </HackItemCard>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile slideover -->
  <USlideover v-model:open="mobileOpen" title="Inventory" side="right" class="lg:hidden">
    <template #body>
      <div class="p-4 space-y-2 overflow-y-auto h-full">
        <div v-if="!state?.items.length" class="text-sm text-muted text-center py-8">No items yet.</div>
        <HackItemCard
          v-else v-for="item in sortedItems" :key="item.id"
          :item="item" :selected="selectedItemId === item.id" show-status
          @select="selectItem(item.id)"
        >
          <template #actions>
            <UButton block size="sm" color="primary" variant="soft"
              icon="i-lucide-arrow-down-to-line" label="Send to crafting bench"
              @click="loadReroll(item.id)" />
            <UButton block size="sm"
              :color="sellConfirmId === item.id ? 'error' : 'neutral'"
              :variant="sellConfirmId === item.id ? 'solid' : 'subtle'"
              :label="sellConfirmId === item.id ? 'Confirm sell?' : `Sell $${formatNumber(itemSellPrice(item.rarity), true)}`"
              :loading="selling === item.id" @click="requestSell(item.id)" />
          </template>
        </HackItemCard>
      </div>
    </template>
  </USlideover>
</template>
