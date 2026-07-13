<script setup lang="ts">
import {
    PIRATE_SHIP_STAT_IDS, PIRATE_MAX_STAT_LEVEL, PIRATE_CANNON_TIERS, PIRATE_MAX_CANNON_SLOTS,
    pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity, pirateCannonDps,
    type PirateShipStatId
} from '#shared/utils/gamelogic/pirates'

definePageMeta({
    title: 'Ship Armory'
})

const { user, fetchSession } = useAuth()
const toast = useToast()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))
const gems = computed(() => user.value?.gems ?? 0)

const { data: state, refresh } = await useFetch('/api/pirates/state')

// Reference defense used only to compare cannon tiers in the shop — an
// approximate mid-game target, not tied to any real enemy.
const DPS_REFERENCE_DEFENSE = 20

const STAT_META: Record<PirateShipStatId, { label: string, icon: string, color: string, value: (level: number) => number, unit: string }> = {
    hull: { label: 'Hull', icon: 'i-lucide-heart', color: 'text-red-400 bg-red-400/15', value: l => pirateMaxHp(l), unit: 'HP' },
    speed: { label: 'Speed', icon: 'i-lucide-wind', color: 'text-cyan-400 bg-cyan-400/15', value: l => pirateShipSpeed(l), unit: 'spd' },
    defense: { label: 'Defense', icon: 'i-lucide-shield', color: 'text-blue-400 bg-blue-400/15', value: l => pirateDefenseRating(l), unit: 'def' },
    ammoCapacity: { label: 'Ammo Hold', icon: 'i-lucide-package', color: 'text-amber-400 bg-amber-400/15', value: l => pirateAmmoCapacity(l), unit: 'cap' }
}

// Tier accents, matching the escalation feel in-game
const TIER_ACCENTS: Record<string, string> = {
    swivel: 'text-stone-400',
    carronade: 'text-amber-500',
    culverin: 'text-slate-300',
    longgun: 'text-sky-400',
    basilisk: 'text-violet-400',
    mythril: 'text-emerald-400',
    adamantite: 'text-fuchsia-400',
    leviathan: 'text-rose-400'
}

const upgrading = ref<PirateShipStatId | null>(null)
const unlockingSlot = ref(false)
const buyingAmmo = ref<number | null>(null)
const buyingGemAmmo = ref<number | null>(null)
const equipping = ref<string | null>(null)
const sellingSlot = ref<number | null>(null)
const swapping = ref(false)

// Swap mode: pick a source port, then pick a destination.
const swapSource = ref<number | null>(null)

const pickerOpen = ref(false)
const pickerSlot = ref<number | null>(null)
const pickerCurrentTier = computed(() => {
    if (pickerSlot.value === null || !state.value) return null
    return state.value.cannons.find(c => c.slotIndex === pickerSlot.value) ?? null
})

const cannonsBySlot = computed(() => {
    const map = new Map<number, NonNullable<typeof state.value>['cannons'][number]>()
    for (const c of state.value?.cannons ?? []) map.set(c.slotIndex, c)
    return map
})

const slots = computed(() => Array.from({ length: PIRATE_MAX_CANNON_SLOTS }, (_, i) => i))

const totalDps = computed(() => {
    if (!state.value) return 0
    return state.value.cannons.reduce((sum, c) => {
        const tier = PIRATE_CANNON_TIERS.find(t => t.id === c.tierId)
        return sum + (tier ? pirateCannonDps(tier, DPS_REFERENCE_DEFENSE) : 0)
    }, 0)
})

const bestRange = computed(() => state.value?.cannons.reduce((max, c) => Math.max(max, c.range), 0) ?? 0)
const maxTierDps = computed(() => Math.max(...PIRATE_CANNON_TIERS.map(t => pirateCannonDps(t, DPS_REFERENCE_DEFENSE))))

function tierDps(tierId: string) {
    const tier = PIRATE_CANNON_TIERS.find(t => t.id === tierId)
    return tier ? pirateCannonDps(tier, DPS_REFERENCE_DEFENSE) : 0
}

function ammoCostFor(amount: number) {
    return amount * (state.value?.ammo.pricePerUnit ?? 0)
}

function statDelta(tier: typeof PIRATE_CANNON_TIERS[number], key: 'attackRating' | 'maxDamage' | 'range') {
    if (!pickerCurrentTier.value) return null
    return tier[key] - pickerCurrentTier.value[key]
}

function openPicker(slotIndex: number) {
    swapSource.value = null
    pickerSlot.value = slotIndex
    pickerOpen.value = true
}

function handlePortClick(slotIndex: number) {
    if (swapSource.value === null) return
    if (swapSource.value === slotIndex) {
        swapSource.value = null
        return
    }
    swapCannons(swapSource.value, slotIndex)
}

async function swapCannons(slotA: number, slotB: number) {
    if (swapping.value) return
    swapping.value = true
    try {
        await $fetch('/api/pirates/cannons/swap', { method: 'POST', body: { slotA, slotB } })
        await refresh()
        toast.add({ title: 'Cannons rearranged', color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to swap cannons', color: 'error' })
    } finally {
        swapping.value = false
        swapSource.value = null
    }
}

async function upgradeStat(stat: PirateShipStatId) {
    if (upgrading.value) return
    upgrading.value = stat
    try {
        await $fetch('/api/pirates/upgrade', { method: 'POST', body: { stat } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Upgrade failed', color: 'error' })
    } finally {
        upgrading.value = null
    }
}

async function unlockSlot() {
    if (unlockingSlot.value) return
    unlockingSlot.value = true
    try {
        await $fetch('/api/pirates/slots/unlock', { method: 'POST' })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: 'New gun port unlocked', color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to unlock slot', color: 'error' })
    } finally {
        unlockingSlot.value = false
    }
}

async function buyAmmo(amount: number) {
    if (buyingAmmo.value !== null) return
    buyingAmmo.value = amount
    try {
        const res = await $fetch('/api/pirates/ammo/buy', { method: 'POST', body: { amount } })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: `Stocked ${res.bought} ammo`, color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to buy ammo', color: 'error' })
    } finally {
        buyingAmmo.value = null
    }
}

async function buyGemAmmo(bundles: number) {
    if (buyingGemAmmo.value !== null) return
    buyingGemAmmo.value = bundles
    try {
        const res = await $fetch<{ bought: number, cost: number, ammoCount: number }>('/api/pirates/ammo/buy', { method: 'POST', body: { currency: 'gems', bundles } })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: `Loaded ${res.bought} gem shots`, color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to buy gem powder', color: 'error' })
    } finally {
        buyingGemAmmo.value = null
    }
}

async function equipCannon(tierId: string) {
    if (pickerSlot.value === null || equipping.value) return
    equipping.value = tierId
    try {
        if (pickerCurrentTier.value) {
            await $fetch('/api/pirates/cannons/sell', { method: 'POST', body: { slotIndex: pickerSlot.value } })
        }
        await $fetch('/api/pirates/cannons/buy', { method: 'POST', body: { slotIndex: pickerSlot.value, tierId } })
        await Promise.all([refresh(), fetchSession()])
        pickerOpen.value = false
        toast.add({ title: 'Cannon equipped', color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to equip cannon', color: 'error' })
    } finally {
        equipping.value = null
    }
}

async function sellCannon(slotIndex: number) {
    if (sellingSlot.value !== null) return
    sellingSlot.value = slotIndex
    try {
        const res = await $fetch('/api/pirates/cannons/sell', { method: 'POST', body: { slotIndex } })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: `Sold for ${formatNumber(res.refund, false)} coins`, color: 'success' })
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to sell cannon', color: 'error' })
    } finally {
        sellingSlot.value = null
    }
}
</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Ship Armory
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Refit your hull, stock the magazine, and fill out the gun deck.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UBadge v-if="state" color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-anchor" />
        <UButton to="/pirates" color="neutral" variant="subtle" icon="i-lucide-sailboat" label="Set Sail" />
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-40 rounded-xl" />
      <USkeleton class="h-64 rounded-xl" />
    </div>

    <template v-else>
      <p v-if="state.activeRun" class="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
        You have a voyage in progress — refitting is locked until it ends.
      </p>

      <!-- Ship stats -->
      <div>
        <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-2 px-0.5">
          Shipwright — Hull &amp; Systems
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <UCard v-for="statId in PIRATE_SHIP_STAT_IDS" :key="statId" :ui="{ body: 'p-3.5' }">
            <div class="flex items-center gap-2.5 mb-2">
              <div class="size-8 rounded-lg flex items-center justify-center shrink-0" :class="STAT_META[statId].color">
                <UIcon :name="STAT_META[statId].icon" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold text-sm truncate">
                  {{ STAT_META[statId].label }}
                </p>
                <p class="text-xs text-muted">
                  Lv {{ state.levels[statId] }} / {{ PIRATE_MAX_STAT_LEVEL }}
                </p>
              </div>
            </div>

            <!-- Level pips -->
            <div class="flex gap-0.5 mb-2.5">
              <div
                v-for="i in PIRATE_MAX_STAT_LEVEL"
                :key="i"
                class="h-1 flex-1 rounded-full"
                :class="i <= state.levels[statId] ? 'bg-primary' : 'bg-elevated'"
              />
            </div>

            <p class="text-xs mb-3">
              <span class="font-semibold">{{ STAT_META[statId].value(state.levels[statId]) }} {{ STAT_META[statId].unit }}</span>
              <template v-if="state.levels[statId] < PIRATE_MAX_STAT_LEVEL">
                <UIcon name="i-lucide-arrow-right" class="size-3 inline mx-1 text-muted" />
                <span class="text-emerald-400 font-semibold">{{ STAT_META[statId].value(state.levels[statId] + 1) }}</span>
              </template>
            </p>

            <UButton
              block
              size="sm"
              :color="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL ? 'neutral' : 'primary'"
              :variant="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL ? 'subtle' : 'solid'"
              :disabled="!!state.activeRun || state.levels[statId] >= PIRATE_MAX_STAT_LEVEL || balance < (state.costs[statId] ?? 0)"
              :loading="upgrading === statId"
              @click="upgradeStat(statId)"
            >
              <span v-if="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL">Maxed</span>
              <span v-else class="flex items-center gap-1">
                <UIcon name="i-lucide-coins" class="size-3.5 text-yellow-400" />
                {{ formatNumber(state.costs[statId] ?? 0, false) }}
              </span>
            </UButton>
          </UCard>
        </div>
      </div>

      <!-- Munitions -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <!-- Coin ammo -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2.5">
              <div class="size-8 rounded-lg bg-amber-400/15 flex items-center justify-center">
                <UIcon name="i-lucide-box" class="size-4 text-amber-400" />
              </div>
              <div>
                <p class="font-semibold text-sm">
                  Ammo Depot
                </p>
                <p class="text-xs text-muted">
                  {{ state.ammo.pricePerUnit }} coin per shot — run dry mid-voyage and the trip ends
                </p>
              </div>
            </div>
          </template>

          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Stock</span>
              <span class="font-semibold">{{ state.ammo.count }} / {{ state.ammo.capacity }}</span>
            </div>
            <div class="h-2 rounded-full bg-elevated overflow-hidden">
              <div class="h-full bg-amber-400 rounded-full transition-[width]" :style="{ width: `${state.ammo.capacity ? (state.ammo.count / state.ammo.capacity) * 100 : 0}%` }" />
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="amount in [10, 50]"
                :key="amount"
                size="sm"
                color="neutral"
                variant="subtle"
                :disabled="state.ammo.count >= state.ammo.capacity || balance < ammoCostFor(amount)"
                :loading="buyingAmmo === amount"
                @click="buyAmmo(amount)"
              >
                +{{ amount }} <span class="text-muted ml-1">({{ formatNumber(ammoCostFor(amount), false) }})</span>
              </UButton>
              <UButton
                size="sm"
                :disabled="state.ammo.count >= state.ammo.capacity || balance < ammoCostFor(state.ammo.capacity - state.ammo.count)"
                :loading="buyingAmmo === state.ammo.capacity - state.ammo.count"
                @click="buyAmmo(state.ammo.capacity - state.ammo.count)"
              >
                Fill hold <span class="opacity-80 ml-1">({{ formatNumber(ammoCostFor(state.ammo.capacity - state.ammo.count), false) }})</span>
              </UButton>
            </div>
          </div>
        </UCard>

        <!-- Gem powder -->
        <UCard class="ring-1 ring-sky-400/20">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <div class="size-8 rounded-lg bg-sky-400/15 flex items-center justify-center">
                  <UIcon name="i-lucide-gem" class="size-4 text-sky-400" />
                </div>
                <div>
                  <p class="font-semibold text-sm">
                    Gem Powder Magazine
                  </p>
                  <p class="text-xs text-muted">
                    Charged shots — +50% accuracy rating, +75% damage
                  </p>
                </div>
              </div>
              <UBadge color="info" variant="subtle" size="sm">
                <UIcon name="i-lucide-gem" class="size-3 mr-0.5" /> {{ formatNumber(gems, false) }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Loaded</span>
              <span class="font-semibold text-sky-300">{{ state.gemAmmo.count }} / {{ state.gemAmmo.capacity }}</span>
            </div>
            <div class="h-2 rounded-full bg-elevated overflow-hidden">
              <div class="h-full bg-sky-400 rounded-full transition-[width]" :style="{ width: `${state.gemAmmo.capacity ? (state.gemAmmo.count / state.gemAmmo.capacity) * 100 : 0}%` }" />
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="bundles in [1, 3]"
                :key="bundles"
                size="sm"
                color="info"
                :variant="bundles === 1 ? 'subtle' : 'solid'"
                :disabled="state.gemAmmo.count >= state.gemAmmo.capacity || gems < bundles * state.gemAmmo.bundlePriceGems"
                :loading="buyingGemAmmo === bundles"
                @click="buyGemAmmo(bundles)"
              >
                +{{ bundles * state.gemAmmo.bundleSize }} shots
                <span class="opacity-80 ml-1 flex items-center gap-0.5">(<UIcon name="i-lucide-gem" class="size-3" />{{ bundles * state.gemAmmo.bundlePriceGems }})</span>
              </UButton>
            </div>
            <p class="text-[11px] text-muted">
              Gems are far rarer than coins — save these shots for elite ships, or flip them on when you're swarmed.
            </p>
          </div>
        </UCard>
      </div>

      <!-- Cannon deck -->
      <div>
        <div class="flex items-center justify-between mb-2 px-0.5">
          <p class="text-xs font-semibold text-muted uppercase tracking-wider">
            Gun Deck — {{ state.cannonSlots }} / {{ PIRATE_MAX_CANNON_SLOTS }} ports
          </p>
          <div class="flex items-center gap-3 text-xs text-muted">
            <span class="flex items-center gap-1"><UIcon name="i-lucide-gauge" class="size-3.5" /> {{ totalDps.toFixed(1) }} DPS (vs def {{ DPS_REFERENCE_DEFENSE }})</span>
            <span class="flex items-center gap-1"><UIcon name="i-lucide-crosshair" class="size-3.5" /> {{ bestRange }} best range</span>
          </div>
        </div>

        <p v-if="swapSource !== null" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-lg px-3 py-2 mb-2">
          Moving the cannon from port {{ swapSource + 1 }} — click another unlocked port to swap, or click the same port to cancel.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <UCard
            v-for="slotIndex in slots"
            :key="slotIndex"
            :ui="{ body: 'p-3.5' }"
            :class="[
              swapSource === slotIndex ? 'ring-2 ring-sky-400' : '',
              swapSource !== null && swapSource !== slotIndex && slotIndex < state.cannonSlots ? 'ring-1 ring-sky-400/40 cursor-pointer' : ''
            ]"
            @click="slotIndex < state.cannonSlots ? handlePortClick(slotIndex) : undefined"
          >
            <template v-if="slotIndex >= state.cannonSlots">
              <div class="flex flex-col items-center justify-center text-center gap-2 py-3">
                <UIcon name="i-lucide-lock" class="size-6 text-muted" />
                <p class="text-xs text-muted">
                  Locked port
                </p>
                <UButton
                  v-if="slotIndex === state.cannonSlots"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  :disabled="!!state.activeRun || !state.nextSlotCost || balance < (state.nextSlotCost ?? 0)"
                  :loading="unlockingSlot"
                  @click="unlockSlot"
                >
                  Unlock ({{ formatNumber(state.nextSlotCost ?? 0, false) }})
                </UButton>
              </div>
            </template>
            <template v-else-if="cannonsBySlot.get(slotIndex)">
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <p class="font-semibold text-sm truncate" :class="TIER_ACCENTS[cannonsBySlot.get(slotIndex)!.tierId]">
                    {{ cannonsBySlot.get(slotIndex)!.name }}
                  </p>
                  <UBadge color="neutral" variant="subtle" size="sm" :label="`Port ${slotIndex + 1}`" />
                </div>
                <!-- DPS bar relative to best tier -->
                <div class="h-1.5 rounded-full bg-elevated overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary transition-[width]"
                    :style="{ width: `${Math.max(4, (tierDps(cannonsBySlot.get(slotIndex)!.tierId) / maxTierDps) * 100)}%` }"
                  />
                </div>
                <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-target" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.attackRating }} atk</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-swords" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.maxDamage }} max dmg</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-timer" class="size-3" /> {{ (cannonsBySlot.get(slotIndex)!.reloadMs / 1000).toFixed(1) }}s</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-crosshair" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.range }} rng</span>
                </div>
                <div class="flex gap-1.5 pt-1">
                  <UButton size="xs" color="neutral" variant="subtle" block :disabled="!!state.activeRun || swapSource !== null" @click.stop="openPicker(slotIndex)">
                    Refit
                  </UButton>
                  <UButton
                    size="xs"
                    color="info"
                    variant="subtle"
                    icon="i-lucide-arrow-left-right"
                    :disabled="!!state.activeRun || state.cannonSlots < 2 || swapping"
                    @click.stop="swapSource = swapSource === slotIndex ? null : slotIndex"
                  />
                  <UButton
                    size="xs"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-trash-2"
                    :disabled="!!state.activeRun || swapSource !== null"
                    :loading="sellingSlot === slotIndex"
                    @click.stop="sellCannon(slotIndex)"
                  >
                    {{ formatNumber(cannonsBySlot.get(slotIndex)!.sellValue, false) }}
                  </UButton>
                </div>
              </div>
            </template>
            <template v-else>
              <div class="flex flex-col items-center justify-center text-center gap-2 py-3">
                <UIcon name="i-lucide-crosshair" class="size-6 text-muted" />
                <p class="text-xs text-muted">
                  Empty port
                </p>
                <UButton v-if="swapSource === null" size="xs" :disabled="!!state.activeRun" @click.stop="openPicker(slotIndex)">
                  Equip cannon
                </UButton>
                <p v-else class="text-[11px] text-sky-400">
                  Move here
                </p>
              </div>
            </template>
          </UCard>
        </div>
      </div>
    </template>

    <!-- Cannon tier picker -->
    <UModal v-model:open="pickerOpen" :title="pickerCurrentTier ? `Refit port ${(pickerSlot ?? 0) + 1}` : `Arm port ${(pickerSlot ?? 0) + 1}`" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <div class="space-y-2">
          <UCard
            v-for="tier in PIRATE_CANNON_TIERS"
            :key="tier.id"
            :ui="{ body: 'p-3' }"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="font-semibold text-sm" :class="TIER_ACCENTS[tier.id]">
                    {{ tier.name }}
                  </p>
                  <UBadge v-if="pickerCurrentTier?.tierId === tier.id" color="primary" variant="subtle" size="sm" label="Equipped" />
                </div>
                <div class="h-1.5 rounded-full bg-elevated overflow-hidden my-1.5 max-w-48">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${Math.max(4, (pirateCannonDps(tier, DPS_REFERENCE_DEFENSE) / maxTierDps) * 100)}%` }" />
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>
                    {{ tier.attackRating }} atk
                    <template v-if="statDelta(tier, 'attackRating') !== null && statDelta(tier, 'attackRating') !== 0">
                      <span :class="statDelta(tier, 'attackRating')! > 0 ? 'text-emerald-400' : 'text-red-400'">({{ statDelta(tier, 'attackRating')! > 0 ? '+' : '' }}{{ statDelta(tier, 'attackRating') }})</span>
                    </template>
                  </span>
                  <span>
                    {{ tier.maxDamage }} dmg
                    <template v-if="statDelta(tier, 'maxDamage') !== null && statDelta(tier, 'maxDamage') !== 0">
                      <span :class="statDelta(tier, 'maxDamage')! > 0 ? 'text-emerald-400' : 'text-red-400'">({{ statDelta(tier, 'maxDamage')! > 0 ? '+' : '' }}{{ statDelta(tier, 'maxDamage') }})</span>
                    </template>
                  </span>
                  <span>{{ (tier.reloadMs / 1000).toFixed(1) }}s reload</span>
                  <span>
                    {{ tier.range }} range
                    <template v-if="statDelta(tier, 'range') !== null && statDelta(tier, 'range') !== 0">
                      <span :class="statDelta(tier, 'range')! > 0 ? 'text-emerald-400' : 'text-red-400'">({{ statDelta(tier, 'range')! > 0 ? '+' : '' }}{{ statDelta(tier, 'range') }})</span>
                    </template>
                  </span>
                  <span class="font-medium text-highlighted">{{ pirateCannonDps(tier, DPS_REFERENCE_DEFENSE).toFixed(1) }} DPS</span>
                </div>
              </div>
              <UButton
                size="sm"
                :disabled="pickerCurrentTier?.tierId === tier.id || balance < tier.cost"
                :loading="equipping === tier.id"
                @click="equipCannon(tier.id)"
              >
                <span v-if="tier.cost === 0">Free</span>
                <span v-else class="flex items-center gap-1">
                  <UIcon name="i-lucide-coins" class="size-3.5 text-yellow-400" />
                  {{ formatNumber(tier.cost, false) }}
                </span>
              </UButton>
            </div>
          </UCard>
          <p v-if="pickerCurrentTier" class="text-xs text-muted px-1">
            Equipping a new cannon sells the current one first (refunds {{ formatNumber(pickerCurrentTier.sellValue, false) }}).
          </p>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
