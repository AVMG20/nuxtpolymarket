<script setup lang="ts">
import {
  RARITY_COLOR, RARITY_LABEL, formatModValue, MOD_LABEL,
  itemSellPrice, RARITY_ORDER, MOD_RANGES, RARITY_MOD_COUNT,
  SLOT_ICON, SLOT_LABEL, SLOT_COLOR,
  type HackRarity, type ItemSlot, type ItemMod, type ModType,
} from '#shared/utils/hack-config'

// Roll quality: what % of max value does this mod roll represent
function rollQuality(type: ModType, value: number): number {
  const range = MOD_RANGES[type]
  return Math.round((value - range.min) / (range.max - range.min) * 100)
}
function rollQualityColor(pct: number) {
  if (pct >= 80) return 'text-success'
  if (pct >= 50) return 'text-warning'
  return 'text-muted'
}
function formatRangeValue(type: ModType, val: number): string {
  if (type === 'gem_chance') return `${(val * 100).toFixed(1)}%`
  if (type === 'xp_flat') return `${val} XP`
  if (type === 'power_flat') return `${val}`
  return `${val}%`
}

const { fetchSession, user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const { data: state, refresh } = await useFetch('/api/hack/state')
const toast = useToast()

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

// Inventory actions
const selectedItemId = ref<string | null>(null)
function selectItem(id: string) {
  selectedItemId.value = selectedItemId.value === id ? null : id
}

const equipping = ref(false)
async function equipTo(itemId: string, agentId: string | null) {
  equipping.value = true
  try {
    await $fetch('/api/hack/items/equip', { method: 'POST', body: { itemId, agentId } })
    toast.add({ title: agentId ? 'Item equipped' : 'Item unequipped', color: 'success' })
    selectedItemId.value = null
    await refresh()
  } catch (e: any) {
    toast.add({ title: e.data?.statusMessage ?? 'Failed', color: 'error' })
  } finally { equipping.value = false }
}

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

          <!-- Possible stat ranges -->
          <div class="mb-4 p-3 rounded-lg bg-elevated space-y-1">
            <p class="text-sm font-semibold text-muted mb-1.5">Possible stat rolls:</p>
            <div v-for="(range, type) in MOD_RANGES" :key="type" class="flex items-center justify-between text-sm">
              <span class="text-muted">{{ MOD_LABEL[type as ModType] }}</span>
              <span class="font-medium text-default">{{ formatRangeValue(type as ModType, range.min) }} – {{ formatRangeValue(type as ModType, range.max) }}</span>
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
    <div class="hidden lg:flex flex-col w-72 shrink-0 border-l border-default overflow-y-auto">
      <div class="p-4 space-y-3 pb-12">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold text-base">Inventory</h2>
          <span class="text-sm text-muted">{{ state?.inventoryCount ?? 0 }}/{{ state?.maxInventorySlots ?? 15 }}</span>
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
            v-for="item in state.items" :key="item.id"
            :item="item" :selected="selectedItemId === item.id" show-status
            @select="selectItem(item.id)"
          >
            <template #actions>
              <p class="text-sm font-medium text-muted">Equip to:</p>
              <UButton v-for="agent in state.agents" :key="agent.id" block size="sm" variant="outline" color="primary"
                :loading="equipping" @click="equipTo(item.id, agent.id)">
                {{ agent.name }}
                <template #trailing><span class="text-sm opacity-60">{{ SLOT_LABEL[item.slot] }}</span></template>
              </UButton>
              <UButton v-if="item.equippedBy" block size="sm" color="neutral" variant="outline"
                icon="i-lucide-link-slash" label="Unequip" :loading="equipping"
                @click="equipTo(item.id, null)" />
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
          v-else v-for="item in state!.items" :key="item.id"
          :item="item" :selected="selectedItemId === item.id" show-status
          @select="selectItem(item.id)"
        >
          <template #actions>
            <p class="text-sm font-medium text-muted">Equip to:</p>
            <UButton v-for="agent in state!.agents" :key="agent.id" block size="sm" variant="outline" color="primary"
              :loading="equipping" @click="equipTo(item.id, agent.id)">
              {{ agent.name }}
              <template #trailing><span class="text-sm opacity-60">{{ item.slot }}</span></template>
            </UButton>
            <UButton v-if="item.equippedBy" block size="sm" color="neutral" variant="outline"
              icon="i-lucide-link-slash" label="Unequip" :loading="equipping" @click="equipTo(item.id, null)" />
            <UButton block size="sm" color="neutral" variant="subtle"
              :label="`Sell $${formatNumber(itemSellPrice(item.rarity, item.itemLevel), true)}`"
              :loading="selling === item.id" @click="sellItem(item.id, item.rarity, item.itemLevel)" />
          </template>
        </HackInventoryItem>
      </div>
    </template>
  </USlideover>
</template>
