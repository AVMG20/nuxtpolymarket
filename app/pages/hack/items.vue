<script setup lang="ts">
import {
  RARITY_LABEL, RARITY_STYLE, MOD_LABEL, formatModValue,
  itemSellPrice, RARITY_ORDER, MOD_RANGES,
  rerollCost, ITEM_MAX_LEVEL, itemUpgradeCost, itemUpgradeCostForLevels, itemBulkUpgradeLevels, itemPower,
  type HackRarity, type ItemSlot, type ItemMod, type ModType
} from '#shared/utils/hack-config'
import { CRAFT_UPGRADE, CRAFT_MAX_LEVEL, CRAFT_REROLL_GOOD, CRAFT_REROLL_BAD, pickVoiceLine, type VoiceEntry } from '~/utils/hack-voice-lines'
import type { VoiceHandle } from '~/composables/useAudio'

const { fetchSession, user } = useAuth()
const gems = computed(() => user.value?.gems ?? 0)
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()
const audio = useAudio('hack')

// RELAY's spoken reaction on bench actions — audio-only, no-immediate-repeat,
// single-tracked so back-to-back crafts cut the previous line instead of stacking.
// Throttled via barkThrottle (same cadence as reveal barks) so a crafting spree
// doesn't talk over itself on every single click.
let barkHandle: VoiceHandle | null = null
function relayBark(entry: VoiceEntry, { rare = false } = {}) {
  barkHandle?.cancel()
  if (!audio.barkThrottle({ rare })) return
  barkHandle = audio.playVoice(pickVoiceLine(entry).voice, { delayMs: 80 })
}
onUnmounted(() => barkHandle?.cancel())

// Mean roll quality (0-1) across an item's mods, each scored against its own
// range — used only to decide whether a re-roll earned RELAY's approval or not.
function rollQuality(mods: ItemMod[]): number {
  if (!mods.length) return 0
  const sum = mods.reduce((acc, m) => {
    const r = MOD_RANGES[m.type]
    if (!r || r.max === r.min) return acc + 1
    return acc + (m.value - r.min) / (r.max - r.min)
  }, 0)
  return sum / mods.length
}

type InvItem = { id: string, name: string, slot: ItemSlot, itemLevel: number, rarity: HackRarity, mods: ItemMod[], equippedBy?: string | null }

// ── Inventory filter + sort (mirrors items.html toolbar) ──────────────
const slotFilter = ref<ItemSlot | 'all'>('all')
const sortBy = ref<'rarity' | 'power' | 'name'>('rarity')
const slotFilters = [
  { value: 'all', label: 'All' },
  { value: 'tool', label: 'Tool' },
  { value: 'software', label: 'Software' },
  { value: 'hardware', label: 'Hardware' }
] as const

const shownItems = computed<InvItem[]>(() => {
  const items = ((state.value?.items ?? []) as InvItem[])
    .filter(i => slotFilter.value === 'all' || i.slot === slotFilter.value)
  items.sort((a, b) => {
    if (sortBy.value === 'power') {
      return itemPower(b) - itemPower(a)
    }
    if (sortBy.value === 'name') {
      return a.name.localeCompare(b.name)
    }
    const r = RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)
    return r !== 0 ? r : itemPower(b) - itemPower(a)
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
    audio.playSfx('purchase')
    toast.add({ title: `Sold for $${formatNumber(res.price, true)}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: apiErrorMessage(e, 'Sell failed'), color: 'error' })
  } finally { selling.value = null }
}

// ── Crafting bench ────────────────────────────────────────────
// The bench upgrades an item's level (+2 power/level) and re-rolls its specs,
// both paid in gems. `benchItem` derives from live state so it stays in sync
// (and clears itself if the item is sold).
const benchItemId = ref<string | null>(null)
const benchItem = computed<InvItem | null>(() => state.value?.items.find(i => i.id === benchItemId.value) ?? null)
const rerollLocked = ref<ModType[]>([])
const rerolling = ref(false)

function loadIntoBench(id: string) {
  benchItemId.value = id
  rerollLocked.value = []
}
function clearBench() {
  benchItemId.value = null
  rerollLocked.value = []
}
function toggleLock(type: ModType) {
  const i = rerollLocked.value.indexOf(type)
  if (i === -1) rerollLocked.value.push(type)
  else rerollLocked.value.splice(i, 1)
}

// ── Level upgrades ─────────────────────────────────────────────
// `upgrading` tracks how many levels the in-flight request is buying (1 or
// bulkLevels), so the two buttons can show independent loading states.
const upgrading = ref<number | null>(null)
const upgradeCost = computed(() =>
  benchItem.value ? itemUpgradeCost(benchItem.value.itemLevel) : 0)
const isMaxLevel = computed(() =>
  !!benchItem.value && benchItem.value.itemLevel >= ITEM_MAX_LEVEL)

// Bulk button buys up to ITEM_BULK_UPGRADE_LEVELS levels at once, fewer once the
// item is within that many levels of the cap (e.g. Lv 17 → "Upgrade 3 levels").
const bulkLevels = computed(() =>
  benchItem.value ? itemBulkUpgradeLevels(benchItem.value.itemLevel) : 0)
const bulkCost = computed(() =>
  benchItem.value ? itemUpgradeCostForLevels(benchItem.value.itemLevel, bulkLevels.value) : 0)

async function doUpgrade(levels: number) {
  if (!benchItem.value) return
  upgrading.value = levels
  try {
    const res = await $fetch('/api/hack/items/upgrade', {
      method: 'POST',
      body: { itemId: benchItem.value.id, levels }
    })
    const reachedMax = res.newLevel >= ITEM_MAX_LEVEL
    relayBark(reachedMax ? CRAFT_MAX_LEVEL : CRAFT_UPGRADE, { rare: reachedMax })
    toast.add({ title: `Upgraded to level ${res.newLevel}`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: apiErrorMessage(e, 'Upgrade failed'), color: 'error' })
  } finally { upgrading.value = null }
}

const rerollCostValue = computed(() =>
  benchItem.value ? rerollCost(benchItem.value.mods.length, rerollLocked.value.length) : 0)
const rerollCountValue = computed(() =>
  benchItem.value ? benchItem.value.mods.length - rerollLocked.value.length : 0)
const canReroll = computed(() => rerollCountValue.value > 0)

async function doReroll() {
  if (!benchItem.value) return
  rerolling.value = true
  const beforeQuality = rollQuality(benchItem.value.mods)
  try {
    const res = await $fetch('/api/hack/items/reroll', {
      method: 'POST',
      body: { itemId: benchItem.value.id, lockedTypes: rerollLocked.value }
    })
    relayBark(rollQuality(res.item!.mods as ItemMod[]) >= beforeQuality ? CRAFT_REROLL_GOOD : CRAFT_REROLL_BAD)
    toast.add({ title: `Re-rolled for ${res.cost} gems`, color: 'success' })
    await Promise.all([refresh(), fetchSession()])
  } catch (e: any) {
    audio.playSfx('deny')
    toast.add({ title: apiErrorMessage(e, 'Re-roll failed'), color: 'error' })
  } finally { rerolling.value = false }
}
</script>

<template>
  <div class="p-6 pb-12 overflow-y-auto h-full">
    <div class="mb-5">
      <p class="hack-eyebrow">
        // inventory &amp; crafting
      </p>
      <h1 class="text-2xl font-bold mt-1.5">
        Items
      </h1>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 items-start">
      <!-- ── Inventory (left, wide) ─────────────────────────────────── -->
      <HackFrame class="p-4">
        <div class="flex items-center justify-between gap-3 flex-wrap mb-3.5">
          <h2 class="hack-stat-label-md">
            Inventory <span class="text-muted normal-case tracking-normal">— {{ shownItems.length }} / {{ state?.maxInventorySlots ?? 30 }} shown</span>
          </h2>
          <div class="flex items-center gap-2 flex-wrap">
            <div class="flex gap-1.5">
              <button
                v-for="f in slotFilters"
                :key="f.value"
                type="button"
                class="hack-filter-btn"
                :class="slotFilter === f.value && 'active'"
                @click="slotFilter = f.value"
              >
                {{ f.label }}
              </button>
            </div>
            <select
              v-model="sortBy"
              class="hack-sort-select"
            >
              <option value="rarity">
                Sort: Rarity
              </option>
              <option value="power">
                Sort: Power
              </option>
              <option value="name">
                Sort: Name
              </option>
            </select>
          </div>
        </div>

        <div
          v-if="!state"
          class="space-y-2"
        >
          <USkeleton
            v-for="i in 4"
            :key="i"
            class="h-24 rounded-lg"
          />
        </div>
        <div
          v-else-if="!shownItems.length"
          class="text-sm text-muted text-center py-10"
        >
          <UIcon
            name="i-lucide-package-open"
            class="size-8 mx-auto mb-2 opacity-30"
          />
          {{ state.items.length ? 'No items match this filter.' : 'Buy a crate on the Black Market to fill your inventory.' }}
        </div>
        <div
          v-else
          class="space-y-2.5 max-h-[70vh] overflow-y-auto pr-1"
        >
          <HackItemCard
            v-for="item in shownItems"
            :key="item.id"
            :item="item"
            actions-always
            show-status
          >
            <template #actions>
              <div class="flex items-center gap-2">
                <UButton
                  size="sm"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-arrow-down-to-line"
                  label="Load into Bench"
                  :disabled="benchItemId === item.id"
                  @click="loadIntoBench(item.id)"
                />
                <UButton
                  size="sm"
                  class="ml-auto"
                  :color="sellConfirmId === item.id ? 'error' : 'neutral'"
                  :variant="sellConfirmId === item.id ? 'solid' : 'subtle'"
                  icon="i-lucide-dollar-sign"
                  :label="sellConfirmId === item.id ? 'Confirm sell?' : `Sell $${formatNumber(itemSellPrice(item.rarity), true)}`"
                  :loading="selling === item.id"
                  @click="audio.playSfx('click'); requestSell(item.id)"
                />
              </div>
            </template>
          </HackItemCard>
        </div>

        <UButton
          block
          class="mt-4"
          color="neutral"
          variant="outline"
          to="/hack/market"
          icon="i-lucide-store"
          label="Need more gear? → Black Market"
        />
      </HackFrame>

      <!-- ── Crafting bench (right; stacks below on mobile) ─────────────── -->
      <HackFrame
        accent
        class="p-5"
      >
        <h2 class="hack-stat-label-md mb-3.5 flex items-center gap-2">
          <UIcon
            name="i-lucide-hammer"
            class="size-4"
          /> Crafting Bench
        </h2>

        <!-- Empty state -->
        <div
          v-if="!benchItem"
          class="hack-frame hack-frame-tight border-dashed text-center py-8 px-4"
        >
          <UIcon
            name="i-lucide-arrow-left-to-line"
            class="size-6 text-muted opacity-40 mb-2 mx-auto"
          />
          <p class="text-sm text-muted">
            Choose <span class="text-primary font-medium">Load into Bench</span> on any item to upgrade or re-roll it.
          </p>
        </div>

        <!-- Loaded -->
        <template v-else>
          <div class="flex items-start justify-between gap-2 mb-1">
            <span
              class="hack-card-title-lg"
              :class="RARITY_STYLE[benchItem.rarity].text"
            >{{ benchItem.name }}</span>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              @click="clearBench"
            />
          </div>
          <p class="text-xs text-muted font-mono mb-4">
            {{ RARITY_LABEL[benchItem.rarity] }} · Level {{ benchItem.itemLevel }} / {{ ITEM_MAX_LEVEL }} · +{{ itemPower(benchItem) }} PWR
          </p>

          <!-- Upgrade level -->
          <p class="hack-stat-label-md mb-2">
            Upgrade level
          </p>
          <div
            v-if="!isMaxLevel"
            class="space-y-2 mb-5"
          >
            <UButton
              block
              color="primary"
              variant="soft"
              icon="i-lucide-arrow-up"
              :loading="upgrading === 1"
              :disabled="gems < upgradeCost || upgrading !== null"
              @click="doUpgrade(1)"
            >
              Upgrade to Lv {{ benchItem.itemLevel + 1 }}
              <template #trailing>
                <GemBalance
                  :value="upgradeCost"
                  :compact="false"
                />
              </template>
            </UButton>
            <UButton
              v-if="bulkLevels > 1"
              block
              color="primary"
              variant="soft"
              icon="i-lucide-chevrons-up"
              :loading="upgrading === bulkLevels"
              :disabled="gems < bulkCost || upgrading !== null"
              @click="doUpgrade(bulkLevels)"
            >
              Upgrade {{ bulkLevels }} levels
              <template #trailing>
                <GemBalance
                  :value="bulkCost"
                  :compact="false"
                />
              </template>
            </UButton>
          </div>
          <div
            v-else
            class="flex justify-center mb-5"
          >
            <span class="hack-stamp-sm text-emerald-400">
              <UIcon
                name="i-lucide-check"
                class="size-3 -mt-0.5 mr-0.5 inline-block"
              />
              Max Level
            </span>
          </div>

          <hr class="border-default mb-4">

          <!-- Re-roll mods -->
          <div class="flex items-center justify-between mb-1.5">
            <p class="hack-stat-label-md">
              Re-roll mods
            </p>
            <span class="text-[11px] text-muted font-mono">cost = mods + (2×locked−1)</span>
          </div>
          <p class="text-xs text-muted mb-3 leading-relaxed">
            Click a chip to lock it — locked mods keep their exact value. Bars show where each roll landed in its full range.
          </p>

          <div class="space-y-2.5 mb-4">
            <div
              v-for="m in benchItem.mods"
              :key="m.type"
              class="hack-trait-row"
            >
              <div class="flex items-center justify-between gap-3 mb-2">
                <span class="text-sm">
                  <b>{{ formatModValue(m.type, m.value) }}</b>
                  <span class="hack-mod-chip-label ml-1.5">{{ MOD_LABEL[m.type] }}</span>
                </span>
                <button
                  type="button"
                  class="hack-lock-chip"
                  :class="rerollLocked.includes(m.type) && 'locked'"
                  @click="toggleLock(m.type)"
                >
                  <span class="hack-lock-dot" />
                  {{ rerollLocked.includes(m.type) ? 'Locked' : 'Lock' }}
                </button>
              </div>
              <HackRangeBar
                :min="MOD_RANGES[m.type].min"
                :max="MOD_RANGES[m.type].max"
                :value="m.value"
              />
            </div>
          </div>

          <UButton
            block
            color="primary"
            variant="soft"
            :loading="rerolling"
            :disabled="!canReroll || gems < rerollCostValue"
            @click="doReroll"
          >
            Re-roll {{ rerollCountValue }} mod{{ rerollCountValue === 1 ? '' : 's' }}<span v-if="rerollLocked.length"> ({{ rerollLocked.length }} locked)</span>
            <template #trailing>
              <GemBalance
                :value="rerollCostValue"
                :compact="false"
              />
            </template>
          </UButton>
        </template>
      </HackFrame>
    </div>
  </div>
</template>
