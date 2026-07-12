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

const { data: state, refresh } = await useFetch('/api/pirates/state')

// Reference defense used only to compare cannon tiers in the shop — an
// approximate mid-game target, not tied to any real enemy.
const DPS_REFERENCE_DEFENSE = 20

const STAT_META: Record<PirateShipStatId, { label: string, icon: string, color: string, effect: (level: number) => string }> = {
    hull: { label: 'Hull', icon: 'i-lucide-heart', color: 'text-red-400 bg-red-400/15', effect: l => `${pirateMaxHp(l)} HP` },
    speed: { label: 'Speed', icon: 'i-lucide-wind', color: 'text-cyan-400 bg-cyan-400/15', effect: l => `${pirateShipSpeed(l)} spd` },
    defense: { label: 'Defense', icon: 'i-lucide-shield', color: 'text-blue-400 bg-blue-400/15', effect: l => `${pirateDefenseRating(l)} defense rating` },
    ammoCapacity: { label: 'Ammo Hold', icon: 'i-lucide-package', color: 'text-amber-400 bg-amber-400/15', effect: l => `${pirateAmmoCapacity(l)} capacity` }
}

const upgrading = ref<PirateShipStatId | null>(null)
const unlockingSlot = ref(false)
const buyingAmmo = ref<number | null>(null)
const equipping = ref<string | null>(null)
const sellingSlot = ref<number | null>(null)

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

function ammoCostFor(amount: number) {
    return amount * (state.value?.ammo.pricePerUnit ?? 0)
}

function openPicker(slotIndex: number) {
    pickerSlot.value = slotIndex
    pickerOpen.value = true
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
            <div class="flex items-center gap-2.5 mb-2.5">
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

            <p class="text-xs text-muted mb-3">
              {{ STAT_META[statId].effect(state.levels[statId]) }}
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

      <!-- Ammo depot -->
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
            <div class="h-full bg-sky-400 rounded-full transition-[width]" :style="{ width: `${state.ammo.capacity ? (state.ammo.count / state.ammo.capacity) * 100 : 0}%` }" />
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

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <UCard v-for="slotIndex in slots" :key="slotIndex" :ui="{ body: 'p-3.5' }">
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
                  <p class="font-semibold text-sm truncate">
                    {{ cannonsBySlot.get(slotIndex)!.name }}
                  </p>
                  <UBadge color="neutral" variant="subtle" size="sm" :label="`Port ${slotIndex + 1}`" />
                </div>
                <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-target" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.attackRating }} atk</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-swords" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.maxDamage }} max dmg</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-timer" class="size-3" /> {{ (cannonsBySlot.get(slotIndex)!.reloadMs / 1000).toFixed(1) }}s</span>
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-crosshair" class="size-3" /> {{ cannonsBySlot.get(slotIndex)!.range }} rng</span>
                </div>
                <div class="flex gap-1.5 pt-1">
                  <UButton size="xs" color="neutral" variant="subtle" block :disabled="!!state.activeRun" @click="openPicker(slotIndex)">
                    Refit
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="subtle"
                    icon="i-lucide-trash-2"
                    :disabled="!!state.activeRun"
                    :loading="sellingSlot === slotIndex"
                    @click="sellCannon(slotIndex)"
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
                <UButton size="xs" :disabled="!!state.activeRun" @click="openPicker(slotIndex)">
                  Equip cannon
                </UButton>
              </div>
            </template>
          </UCard>
        </div>
      </div>
    </template>

    <!-- Cannon tier picker -->
    <UModal v-model:open="pickerOpen" title="Choose a cannon" :ui="{ content: 'max-w-lg' }">
      <template #body>
        <div class="space-y-2">
          <UCard
            v-for="tier in PIRATE_CANNON_TIERS"
            :key="tier.id"
            :ui="{ body: 'p-3 flex items-center justify-between gap-3' }"
          >
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <p class="font-semibold text-sm">
                  {{ tier.name }}
                </p>
                <UBadge v-if="pickerCurrentTier?.tierId === tier.id" color="primary" variant="subtle" size="sm" label="Equipped" />
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted mt-1">
                <span>{{ tier.attackRating }} atk</span>
                <span>{{ tier.maxDamage }} max dmg</span>
                <span>{{ (tier.reloadMs / 1000).toFixed(1) }}s reload</span>
                <span>{{ tier.range }} range</span>
                <span>{{ pirateCannonDps(tier, DPS_REFERENCE_DEFENSE).toFixed(1) }} DPS</span>
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
          </UCard>
          <p v-if="pickerCurrentTier" class="text-xs text-muted px-1">
            Equipping a new cannon sells the current one first (refunds {{ formatNumber(pickerCurrentTier.sellValue, false) }}).
          </p>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
