<script setup lang="ts">
import {
    PIRATE_SHIP_STAT_IDS, PIRATE_CANNON_TIERS, PIRATE_MAX_CANNON_SLOTS,
    pirateMaxHp, pirateShipSpeed, pirateDefenseRating, pirateAmmoCapacity, pirateRegenRate,
    pirateStatMaxLevel, pirateCannonDps, pirateCannonTier,
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
// Skin previews carry the guns actually fitted, so the shipyard shows your ship.
const loadoutGunTiers = computed(() => state.value?.cannons.map(cannon => cannon.tierId) ?? [])

const repairRemainingLabel = computed(() => {
    const ms = state.value?.repair?.remainingMs ?? 0
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
})

// Reference defense used only to compare cannon tiers in the shop — an
// approximate mid-game target, not tied to any real enemy.
const DPS_REFERENCE_DEFENSE = 20

const STAT_META: Record<PirateShipStatId, { label: string, icon: string, color: string, value: (level: number) => number, unit: string }> = {
    hull: { label: 'Hull', icon: 'i-lucide-heart', color: '#f0524f', value: l => pirateMaxHp(l), unit: 'HP' },
    speed: { label: 'Speed', icon: 'i-lucide-wind', color: '#2dd4bf', value: l => pirateShipSpeed(l), unit: 'spd' },
    defense: { label: 'Armour', icon: 'i-lucide-shield', color: '#6cb8ff', value: l => pirateDefenseRating(l), unit: 'def' },
    ammoCapacity: { label: 'Ammo Hold', icon: 'i-lucide-package', color: '#f3c35a', value: l => pirateAmmoCapacity(l), unit: 'cap' },
    regen: { label: 'Regen', icon: 'i-lucide-heart-pulse', color: '#fb7185', value: l => pirateRegenRate(l), unit: 'HP/5s' }
}

const statMaxLevel = (statId: PirateShipStatId) => pirateStatMaxLevel(statId)

// Each tier glows in its own shot colour, the same colour its barrel tip burns at sea.
function tierHex(tierId: string) {
    return pirateHex(pirateCannonTier(tierId).shotColor)
}

const upgrading = ref<PirateShipStatId | 'marque' | null>(null)
const unlockingSlot = ref(false)
const buyingAmmo = ref<number | null>(null)
const buyingGemAmmo = ref<number | null>(null)
const equipping = ref<string | null>(null)
const sellingSlot = ref<number | null>(null)
const swapping = ref(false)
const skinAction = ref<string | null>(null)
const abilityAction = ref<string | null>(null)

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

const gemAmmoFill = computed(() => {
    const g = state.value?.gemAmmo
    if (!g) return null
    const room = g.capacity - g.count
    if (room <= 0) return null
    const bundles = Math.ceil(room / g.bundleSize)
    return { bundles, cost: bundles * g.bundlePriceGems }
})

function statDelta(tier: typeof PIRATE_CANNON_TIERS[number], key: 'attackRating' | 'maxDamage' | 'range') {
    if (!pickerCurrentTier.value) return null
    return tier[key] - pickerCurrentTier.value[key]
}

function closePickerOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') pickerOpen.value = false
}
onMounted(() => window.addEventListener('keydown', closePickerOnEscape))
onUnmounted(() => window.removeEventListener('keydown', closePickerOnEscape))

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
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to swap cannons'), color: 'error' })
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
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Upgrade failed'), color: 'error' })
    } finally {
        upgrading.value = null
    }
}

async function signMarque() {
    if (upgrading.value) return
    upgrading.value = 'marque'
    try {
        await $fetch('/api/pirates/marque/upgrade', { method: 'POST' })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to sign the letters'), color: 'error' })
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
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to unlock slot'), color: 'error' })
    } finally {
        unlockingSlot.value = false
    }
}

async function buyAmmo(amount: number) {
    if (buyingAmmo.value !== null) return
    buyingAmmo.value = amount
    try {
        await $fetch('/api/pirates/ammo/buy', { method: 'POST', body: { amount } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to buy ammo'), color: 'error' })
    } finally {
        buyingAmmo.value = null
    }
}

async function buyGemAmmo(bundles: number) {
    if (buyingGemAmmo.value !== null) return
    buyingGemAmmo.value = bundles
    try {
        await $fetch<{ bought: number, cost: number, ammoCount: number }>('/api/pirates/ammo/buy', { method: 'POST', body: { currency: 'gems', bundles } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to buy gem powder'), color: 'error' })
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
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to equip cannon'), color: 'error' })
    } finally {
        equipping.value = null
    }
}

async function sellCannon(slotIndex: number) {
    if (sellingSlot.value !== null) return
    sellingSlot.value = slotIndex
    try {
        await $fetch('/api/pirates/cannons/sell', { method: 'POST', body: { slotIndex } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to sell cannon'), color: 'error' })
    } finally {
        sellingSlot.value = null
    }
}

async function selectSkin(skin: NonNullable<typeof state.value>['skins'][number]) {
    if (skin.equipped || skinAction.value) return
    skinAction.value = skin.id
    try {
        if (skin.owned) {
            await $fetch('/api/pirates/skins/equip', { method: 'POST', body: { skinId: skin.id } })
        } else {
            await $fetch('/api/pirates/skins/buy', { method: 'POST', body: { skinId: skin.id } })
        }
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to update ship skin'), color: 'error' })
    } finally {
        skinAction.value = null
    }
}

async function selectAbility(ability: NonNullable<typeof state.value>['abilities'][number]) {
    if (ability.equipped || abilityAction.value) return
    abilityAction.value = ability.id
    try {
        if (ability.owned) {
            await $fetch('/api/pirates/abilities/equip', { method: 'POST', body: { abilityId: ability.id } })
        } else {
            await $fetch('/api/pirates/abilities/buy', { method: 'POST', body: { abilityId: ability.id } })
        }
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to update ability'), color: 'error' })
    } finally {
        abilityAction.value = null
    }
}

async function upgradeAbility(ability: NonNullable<typeof state.value>['abilities'][number]) {
    if (!ability.owned || ability.upgradeCost === null || abilityAction.value) return
    abilityAction.value = ability.id
    try {
        await $fetch('/api/pirates/abilities/upgrade', { method: 'POST', body: { abilityId: ability.id } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: unknown) {
        toast.add({ title: apiErrorMessage(e, 'Failed to upgrade ability'), color: 'error' })
    } finally {
        abilityAction.value = null
    }
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl space-y-8 px-3 sm:px-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="pr-heading text-xs">
          The shipwright's
        </p>
        <h1 class="pr-display text-5xl leading-none sm:text-6xl">
          Armory
        </h1>
        <p class="pr-muted mt-2 text-sm">
          Refit the hull, fill the gun deck, stock the magazine.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="state" class="pr-tag" style="--tag: #f3c35a"><UIcon name="i-lucide-anchor" class="size-3" />Power {{ state.power }}</span>
        <span v-if="state?.repair.remainingMs" class="pr-tag" style="--tag: #fb923c"><UIcon name="i-lucide-wrench" class="size-3" />Dry dock {{ repairRemainingLabel }}</span>
        <div class="pr-inset flex items-center gap-3 px-3 py-1.5 text-sm font-bold">
          <CoinBalance :value="balance" />
          <GemBalance :value="gems" />
        </div>
      </div>
    </header>

    <div v-if="!state" class="space-y-4">
      <div class="pr-skeleton h-72" />
      <div class="pr-skeleton h-48" />
    </div>

    <template v-else>
      <p v-if="state.activeRun" class="pr-inset flex items-center gap-2 px-3 py-2 text-xs text-[var(--pr-gold)]">
        <UIcon name="i-lucide-sailboat" class="size-4" />
        You have a voyage in progress. Refitting is locked until it ends.
      </p>

      <!-- ══ Gun deck ═══════════════════════════════════════════════════ -->
      <section class="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
        <div class="pr-panel overflow-hidden">
          <div class="armory-dock h-56 sm:h-64">
            <PiratesShipPreview :skin-id="state.equippedSkinId" :gun-tier-ids="loadoutGunTiers" animate class="size-full" />
          </div>
          <div class="grid grid-cols-3 gap-2 p-4 text-center">
            <div class="pr-inset py-2">
              <p class="pr-dim text-[9px] font-bold uppercase tracking-wider">Guns</p>
              <p class="text-lg font-black">{{ state.cannons.length }}<span class="pr-dim text-xs">/{{ state.cannonSlots }}</span></p>
            </div>
            <div class="pr-inset py-2">
              <p class="pr-dim text-[9px] font-bold uppercase tracking-wider">DPS</p>
              <p class="text-lg font-black">{{ totalDps.toFixed(1) }}</p>
            </div>
            <div class="pr-inset py-2">
              <p class="pr-dim text-[9px] font-bold uppercase tracking-wider">Range</p>
              <p class="text-lg font-black">{{ bestRange }}</p>
            </div>
          </div>
          <p class="pr-dim px-4 pb-4 text-[11px]">
            DPS is measured against defense {{ DPS_REFERENCE_DEFENSE }}. Every barrel on the ship is one of your guns, tipped in its tier's colour.
          </p>
        </div>

        <div>
          <div class="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 class="pr-display text-3xl leading-none">
                Gun deck
              </h2>
              <p class="pr-muted text-xs">
                {{ state.cannonSlots }} of {{ PIRATE_MAX_CANNON_SLOTS }} ports open. Each gun fires on its own and aims at its own target.
              </p>
            </div>
          </div>

          <p v-if="swapSource !== null" class="pr-inset mb-2 px-3 py-2 text-xs text-[var(--pr-teal)]">
            Moving the gun from port {{ swapSource + 1 }}. Click another open port to swap, or the same port to cancel.
          </p>

          <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div
              v-for="slotIndex in slots"
              :key="slotIndex"
              class="armory-port"
              :class="{
                'is-locked': slotIndex >= state.cannonSlots,
                'is-source': swapSource === slotIndex,
                'is-target': swapSource !== null && swapSource !== slotIndex && slotIndex < state.cannonSlots
              }"
              :style="cannonsBySlot.get(slotIndex) ? { '--gun': tierHex(cannonsBySlot.get(slotIndex)!.tierId) } : undefined"
              @click="slotIndex < state.cannonSlots ? handlePortClick(slotIndex) : undefined"
            >
              <span class="armory-port-no">{{ slotIndex + 1 }}</span>

              <template v-if="slotIndex >= state.cannonSlots">
                <UIcon name="i-lucide-lock" class="mx-auto size-6 pr-dim" />
                <p class="pr-dim text-center text-[11px]">
                  Sealed port
                </p>
                <PiratesButton
                  v-if="slotIndex === state.cannonSlots"
                  size="sm"
                  variant="wood"
                  block
                  :disabled="!!state.activeRun || !state.nextSlotCost || balance < (state.nextSlotCost ?? 0)"
                  :loading="unlockingSlot"
                  @click.stop="unlockSlot"
                >
                  <CoinBalance :value="state.nextSlotCost ?? 0" />
                </PiratesButton>
              </template>

              <template v-else-if="cannonsBySlot.get(slotIndex)">
                <PiratesCannonArt :tier-id="cannonsBySlot.get(slotIndex)!.tierId" class="mx-auto w-24" />
                <p class="truncate text-center text-sm font-black" :style="{ color: 'var(--gun)' }">
                  {{ cannonsBySlot.get(slotIndex)!.name }}
                </p>
                <div class="pr-bar h-1.5">
                  <i :style="{ 'width': `${Math.max(4, (tierDps(cannonsBySlot.get(slotIndex)!.tierId) / maxTierDps) * 100)}%`, '--fill': 'var(--gun)' }" />
                </div>
                <div class="pr-muted grid grid-cols-2 gap-x-2 text-[10px]">
                  <span>{{ cannonsBySlot.get(slotIndex)!.attackRating }} atk</span>
                  <span class="text-right">{{ cannonsBySlot.get(slotIndex)!.maxDamage }} dmg</span>
                  <span>{{ (cannonsBySlot.get(slotIndex)!.reloadMs / 1000).toFixed(1) }}s</span>
                  <span class="text-right">{{ cannonsBySlot.get(slotIndex)!.range }} rng</span>
                </div>
                <div class="flex gap-1">
                  <PiratesButton size="sm" variant="wood" class="flex-1" :disabled="!!state.activeRun || swapSource !== null" label="Refit" @click.stop="openPicker(slotIndex)" />
                  <PiratesButton
                    size="sm"
                    variant="ghost"
                    icon="i-lucide-arrow-left-right"
                    :disabled="!!state.activeRun || state.cannonSlots < 2 || swapping"
                    aria-label="Move gun"
                    @click.stop="swapSource = swapSource === slotIndex ? null : slotIndex"
                  />
                  <UTooltip :text="`Sell for ${formatNumber(cannonsBySlot.get(slotIndex)!.sellValue)}`">
                    <PiratesButton
                      size="sm"
                      variant="ghost"
                      icon="i-lucide-trash-2"
                      :disabled="!!state.activeRun || swapSource !== null"
                      :loading="sellingSlot === slotIndex"
                      aria-label="Sell gun"
                      @click.stop="sellCannon(slotIndex)"
                    />
                  </UTooltip>
                </div>
              </template>

              <template v-else>
                <UIcon name="i-lucide-crosshair" class="mx-auto size-6 pr-muted" />
                <p class="pr-muted text-center text-[11px]">
                  Empty port
                </p>
                <PiratesButton v-if="swapSource === null" size="sm" variant="gold" block :disabled="!!state.activeRun" label="Fit gun" @click.stop="openPicker(slotIndex)" />
                <p v-else class="text-center text-[11px] text-[var(--pr-teal)]">
                  Move here
                </p>
              </template>
            </div>
          </div>
        </div>
      </section>

      <!-- ══ Shipwright ═════════════════════════════════════════════════ -->
      <section>
        <h2 class="pr-display mb-3 text-3xl leading-none">
          Hull &amp; systems
        </h2>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div v-for="statId in PIRATE_SHIP_STAT_IDS" :key="statId" class="pr-panel p-4" :style="{ '--stat': STAT_META[statId].color }">
            <div class="mb-3 flex items-center gap-3">
              <div class="grid size-10 shrink-0 place-items-center rounded-full pr-glow" :style="{ '--glow': STAT_META[statId].color, 'color': STAT_META[statId].color }">
                <UIcon :name="STAT_META[statId].icon" class="size-5" />
              </div>
              <div class="min-w-0">
                <p class="truncate font-bold">
                  {{ STAT_META[statId].label }}
                </p>
                <p class="pr-dim text-[11px]">
                  Level {{ state.levels[statId] }} of {{ statMaxLevel(statId) }}
                </p>
              </div>
            </div>
            <div class="mb-3 flex gap-0.5">
              <span
                v-for="i in statMaxLevel(statId)"
                :key="i"
                class="h-1.5 flex-1 rounded-full"
                :style="{ background: i <= state.levels[statId] ? STAT_META[statId].color : 'rgba(255,255,255,0.08)', boxShadow: i <= state.levels[statId] ? `0 0 6px ${STAT_META[statId].color}` : 'none' }"
              />
            </div>
            <p class="mb-3 text-sm">
              <b>{{ STAT_META[statId].value(state.levels[statId]) }}</b> <span class="pr-dim text-xs">{{ STAT_META[statId].unit }}</span>
              <template v-if="state.levels[statId] < statMaxLevel(statId)">
                <UIcon name="i-lucide-arrow-right" class="mx-1 inline size-3 pr-dim" />
                <b class="text-[var(--pr-emerald)]">{{ STAT_META[statId].value(state.levels[statId] + 1) }}</b>
              </template>
            </p>
            <PiratesButton
              block
              size="sm"
              :variant="state.levels[statId] >= statMaxLevel(statId) ? 'ghost' : 'gold'"
              :disabled="!!state.activeRun || state.levels[statId] >= statMaxLevel(statId) || balance < (state.costs[statId] ?? 0)"
              :loading="upgrading === statId"
              @click="upgradeStat(statId)"
            >
              <span v-if="state.levels[statId] >= statMaxLevel(statId)">Maxed</span>
              <CoinBalance v-else :value="state.costs[statId] ?? 0" />
            </PiratesButton>
          </div>
        </div>
      </section>

      <!-- ══ Letters of Marque ══════════════════════════════════════════ -->
      <section>
        <div class="pr-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5" style="--stat: #f3c35a">
          <div class="flex min-w-0 flex-1 items-center gap-4">
            <div class="grid size-12 shrink-0 place-items-center rounded-full pr-glow" style="--glow: #f3c35a; color: #f3c35a">
              <UIcon name="i-lucide-scroll-text" class="size-6" />
            </div>
            <div class="min-w-0">
              <p class="pr-display text-2xl leading-none">
                Letters of Marque <span class="pr-dim font-sans text-sm font-bold">{{ state.marque.level }} / {{ state.marque.maxLevel }}</span>
              </p>
              <p class="pr-muted mt-1 text-sm">
                A standing commission from the Crown. Every level raises the pay for every second at sea, and the completion bonus, by 20%.
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-4">
            <p class="text-sm font-black whitespace-nowrap">
              <span class="text-[var(--pr-emerald)]">×{{ state.marque.multiplier.toFixed(1) }}</span>
              <template v-if="state.marque.nextMultiplier">
                <UIcon name="i-lucide-arrow-right" class="mx-1 inline size-3 pr-dim" />
                <span class="text-[var(--pr-emerald)]">×{{ state.marque.nextMultiplier.toFixed(1) }}</span>
              </template>
            </p>
            <div class="flex gap-1">
              <span
                v-for="i in state.marque.maxLevel"
                :key="i"
                class="size-1.5 rounded-full"
                :style="{ background: i <= state.marque.level ? '#f3c35a' : 'rgba(255,255,255,0.12)', boxShadow: i <= state.marque.level ? '0 0 6px #f3c35a' : 'none' }"
              />
            </div>
            <PiratesButton
              size="sm"
              class="min-w-32"
              :variant="state.marque.cost === null ? 'ghost' : 'gold'"
              :disabled="!!state.activeRun || state.marque.cost === null || balance < (state.marque.cost ?? 0)"
              :loading="upgrading === 'marque'"
              @click="signMarque"
            >
              <span v-if="state.marque.cost === null">Maxed</span>
              <template v-else>
                Sign · <CoinBalance :value="state.marque.cost" />
              </template>
            </PiratesButton>
          </div>
        </div>
      </section>

      <!-- ══ Abilities ══════════════════════════════════════════════════ -->
      <section>
        <div class="mb-3">
          <h2 class="pr-display text-3xl leading-none">
            Captain's arsenal
          </h2>
          <p class="pr-muted text-xs">
            Unlock techniques for good and equip one before you sail. Five levels each; every level hits harder and recharges faster.
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="ability in state.abilities"
            :key="ability.id"
            class="pr-panel flex flex-col p-4"
            :class="{ 'pr-glow': ability.equipped }"
            :style="{ '--glow': pirateAbilityHex(ability.id) }"
          >
            <div class="flex items-start gap-3">
              <PiratesAbilityArt :id="ability.id" class="size-16 shrink-0" :dimmed="!ability.owned" :animated="ability.equipped" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="pr-display truncate text-2xl leading-tight" :style="{ color: pirateAbilityHex(ability.id) }">
                    {{ ability.name }}
                  </p>
                  <span v-if="ability.equipped" class="pr-tag" :style="{ '--tag': pirateAbilityHex(ability.id) }">Equipped</span>
                  <span v-else-if="ability.owned" class="pr-tag" style="--tag: #3ddc97">Owned</span>
                </div>
                <p class="pr-muted mt-1 text-[11px] leading-snug">
                  {{ ability.description }}
                </p>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2 text-[11px]">
              <UIcon name="i-lucide-timer" class="size-3.5 pr-dim" />
              <span>{{ ability.currentCooldownMs / 1000 }}s cooldown</span>
              <span v-if="ability.currentCooldownMs > ability.bestCooldownMs" class="pr-dim">→ {{ ability.bestCooldownMs / 1000 }}s at max</span>
            </div>
            <div v-if="ability.owned" class="mt-2 flex items-center gap-2">
              <span class="text-[11px] font-bold">Lv {{ ability.level }}</span>
              <div class="flex flex-1 gap-0.5">
                <span
                  v-for="pip in ability.maxLevel"
                  :key="pip"
                  class="h-1.5 flex-1 rounded-full"
                  :style="{ background: pip <= ability.level ? pirateAbilityHex(ability.id) : 'rgba(255,255,255,0.08)' }"
                />
              </div>
            </div>
            <div class="mt-auto flex gap-2 pt-3">
              <PiratesButton
                class="flex-1"
                size="sm"
                :variant="ability.equipped ? 'ghost' : ability.owned ? 'wood' : 'gold'"
                :disabled="!!state.activeRun || ability.equipped || (!ability.owned && balance < ability.cost)"
                :loading="abilityAction === ability.id"
                @click="selectAbility(ability)"
              >
                <span v-if="ability.equipped">Ready to fire</span>
                <span v-else-if="ability.owned">Equip</span>
                <span v-else-if="ability.cost === 0">Free</span>
                <CoinBalance v-else :value="ability.cost" />
              </PiratesButton>
              <PiratesButton
                v-if="ability.owned"
                class="flex-1"
                size="sm"
                variant="teal"
                icon="i-lucide-arrow-big-up-dash"
                :disabled="!!state.activeRun || ability.upgradeCost === null || balance < ability.upgradeCost"
                :loading="abilityAction === ability.id"
                @click="upgradeAbility(ability)"
              >
                <span v-if="ability.upgradeCost === null">Max</span>
                <CoinBalance v-else :value="ability.upgradeCost" :show-icon="false" />
              </PiratesButton>
            </div>
          </div>
        </div>
      </section>

      <!-- ══ Magazine ═══════════════════════════════════════════════════ -->
      <section>
        <h2 class="pr-display mb-3 text-3xl leading-none">
          Magazine
        </h2>
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div class="pr-panel p-5">
            <div class="flex items-center gap-3">
              <div class="grid size-11 place-items-center rounded-full pr-glow text-[var(--pr-gold)]" style="--glow: #f3c35a">
                <UIcon name="i-lucide-box" class="size-5" />
              </div>
              <div>
                <p class="font-bold">
                  Premium shot
                </p>
                <div class="pr-muted flex flex-wrap items-center gap-1 text-xs">
                  <CoinBalance :value="state.ammo.pricePerUnit" /> <span>per shot at power {{ state.power }}</span>
                </div>
              </div>
              <span class="ml-auto text-lg font-black">{{ state.ammo.count }}<span class="pr-dim text-xs">/{{ state.ammo.capacity }}</span></span>
            </div>
            <div class="pr-bar mt-3 h-2.5">
              <i :style="{ 'width': `${state.ammo.capacity ? (state.ammo.count / state.ammo.capacity) * 100 : 0}%`, '--fill': '#f3c35a' }" />
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <PiratesButton
                v-for="amount in [10, 50]"
                :key="amount"
                size="sm"
                variant="wood"
                :disabled="state.ammo.count >= state.ammo.capacity || balance < ammoCostFor(amount)"
                :loading="buyingAmmo === amount"
                @click="buyAmmo(amount)"
              >
                +{{ amount }} <CoinBalance :value="ammoCostFor(amount)" />
              </PiratesButton>
              <PiratesButton
                size="sm"
                variant="gold"
                :disabled="state.ammo.count >= state.ammo.capacity || balance < ammoCostFor(state.ammo.capacity - state.ammo.count)"
                :loading="buyingAmmo === state.ammo.capacity - state.ammo.count"
                @click="buyAmmo(state.ammo.capacity - state.ammo.count)"
              >
                Fill hold <CoinBalance :value="ammoCostFor(state.ammo.capacity - state.ammo.count)" />
              </PiratesButton>
            </div>
            <p class="pr-dim mt-3 text-[11px]">
              +10% range and +20% damage. When it runs out, your guns keep firing basic shot for free.
            </p>
          </div>

          <div class="pr-panel p-5" style="border-color: rgba(108, 184, 255, 0.45)">
            <div class="flex items-center gap-3">
              <div class="grid size-11 place-items-center rounded-full pr-glow text-[var(--pr-sky)]" style="--glow: #6cb8ff">
                <UIcon name="i-lucide-gem" class="size-5" />
              </div>
              <div>
                <p class="font-bold">
                  Gem powder
                </p>
                <p class="pr-muted text-xs">
                  +50% accuracy, +75% damage. Toggle with E at sea.
                </p>
              </div>
              <span class="ml-auto text-lg font-black text-[var(--pr-sky)]">{{ state.gemAmmo.count }}<span class="pr-dim text-xs">/{{ state.gemAmmo.capacity }}</span></span>
            </div>
            <div class="pr-bar mt-3 h-2.5">
              <i :style="{ 'width': `${state.gemAmmo.capacity ? (state.gemAmmo.count / state.gemAmmo.capacity) * 100 : 0}%`, '--fill': '#6cb8ff' }" />
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <PiratesButton
                v-for="bundles in [1, 3]"
                :key="bundles"
                size="sm"
                variant="wood"
                :disabled="state.gemAmmo.count >= state.gemAmmo.capacity || gems < bundles * state.gemAmmo.bundlePriceGems"
                :loading="buyingGemAmmo === bundles"
                @click="buyGemAmmo(bundles)"
              >
                +{{ bundles * state.gemAmmo.bundleSize }} <GemBalance :value="bundles * state.gemAmmo.bundlePriceGems" />
              </PiratesButton>
              <PiratesButton
                v-if="gemAmmoFill"
                size="sm"
                variant="gem"
                :disabled="gems < gemAmmoFill.cost"
                :loading="buyingGemAmmo === gemAmmoFill.bundles"
                @click="buyGemAmmo(gemAmmoFill.bundles)"
              >
                Fill <GemBalance :value="gemAmmoFill.cost" />
              </PiratesButton>
            </div>
            <p class="pr-dim mt-3 text-[11px]">
              Gems are rarer than coins. Save these for bosses and swarms.
            </p>
          </div>
        </div>
      </section>

      <!-- ══ Shipyard ═══════════════════════════════════════════════════ -->
      <section>
        <div class="mb-3">
          <h2 class="pr-display text-3xl leading-none">
            Shipyard
          </h2>
          <p class="pr-muted text-xs">
            Skins add no power. Only bragging rights.
          </p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div
            v-for="skin in state.skins"
            :key="skin.id"
            class="pr-panel flex flex-col overflow-hidden"
            :class="{ 'pr-glow': skin.equipped }"
            style="--glow: #f3c35a"
          >
            <div class="armory-dock relative h-32">
              <PiratesShipPreview :skin-id="skin.id" :gun-tier-ids="loadoutGunTiers" :animate="skin.equipped" class="size-full" />
              <span v-if="skin.equipped" class="pr-tag absolute right-3 top-3">At the helm</span>
              <span v-else-if="skin.owned" class="pr-tag absolute right-3 top-3" style="--tag: #3ddc97">Owned</span>
            </div>
            <div class="flex flex-1 flex-col p-4">
              <p class="truncate font-black" :class="skin.id === 'crown-of-tides' ? 'pr-gold' : ''">
                {{ skin.name }}
              </p>
              <p class="pr-muted mt-1 flex-1 text-[11px] leading-snug">
                {{ skin.description }}
              </p>
              <PiratesButton
                block
                size="sm"
                class="mt-3"
                :variant="skin.equipped ? 'ghost' : skin.owned ? 'wood' : skin.id === 'crown-of-tides' ? 'gold' : 'gem'"
                :disabled="!!state.activeRun || skin.equipped || (!skin.owned && gems < skin.cost)"
                :loading="skinAction === skin.id"
                @click="selectSkin(skin)"
              >
                <span v-if="skin.equipped">At the helm</span>
                <span v-else-if="skin.owned">Equip</span>
                <span v-else-if="skin.cost === 0">Free</span>
                <GemBalance v-else :value="skin.cost" />
              </PiratesButton>
            </div>
          </div>
        </div>
      </section>
    </template>

    <!-- ══ Gun picker ════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="armory-modal">
        <div v-if="pickerOpen" class="pirate-theme armory-modal" @click.self="pickerOpen = false">
          <div class="pr-panel armory-modal-card" role="dialog" aria-modal="true">
            <div class="flex items-center justify-between gap-3 px-5 pt-5">
              <h3 class="pr-display text-3xl leading-none">
                {{ pickerCurrentTier ? `Refit port ${(pickerSlot ?? 0) + 1}` : `Arm port ${(pickerSlot ?? 0) + 1}` }}
              </h3>
              <PiratesButton variant="ghost" size="sm" icon="i-lucide-x" aria-label="Close" @click="pickerOpen = false" />
            </div>
            <div class="max-h-[70vh] space-y-2 overflow-y-auto p-5">
              <div
                v-for="tier in PIRATE_CANNON_TIERS"
                :key="tier.id"
                class="armory-tier"
                :class="{ 'is-current': pickerCurrentTier?.tierId === tier.id }"
                :style="{ '--gun': pirateHex(tier.shotColor) }"
              >
                <PiratesCannonArt :tier-id="tier.id" class="w-20 shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <p class="font-black" :style="{ color: 'var(--gun)' }">
                      {{ tier.name }}
                    </p>
                    <span v-if="pickerCurrentTier?.tierId === tier.id" class="pr-tag">Fitted</span>
                  </div>
                  <div class="pr-bar my-1.5 h-1.5 max-w-52">
                    <i :style="{ 'width': `${Math.max(4, (pirateCannonDps(tier, DPS_REFERENCE_DEFENSE) / maxTierDps) * 100)}%`, '--fill': 'var(--gun)' }" />
                  </div>
                  <div class="pr-muted flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    <span>
                      {{ tier.attackRating }} atk
                      <b v-if="statDelta(tier, 'attackRating')" :class="statDelta(tier, 'attackRating')! > 0 ? 'text-[var(--pr-emerald)]' : 'text-[var(--pr-blood)]'">({{ statDelta(tier, 'attackRating')! > 0 ? '+' : '' }}{{ statDelta(tier, 'attackRating') }})</b>
                    </span>
                    <span>
                      {{ tier.maxDamage }} dmg
                      <b v-if="statDelta(tier, 'maxDamage')" :class="statDelta(tier, 'maxDamage')! > 0 ? 'text-[var(--pr-emerald)]' : 'text-[var(--pr-blood)]'">({{ statDelta(tier, 'maxDamage')! > 0 ? '+' : '' }}{{ statDelta(tier, 'maxDamage') }})</b>
                    </span>
                    <span>{{ (tier.reloadMs / 1000).toFixed(1) }}s</span>
                    <span>
                      {{ tier.range }} rng
                      <b v-if="statDelta(tier, 'range')" :class="statDelta(tier, 'range')! > 0 ? 'text-[var(--pr-emerald)]' : 'text-[var(--pr-blood)]'">({{ statDelta(tier, 'range')! > 0 ? '+' : '' }}{{ statDelta(tier, 'range') }})</b>
                    </span>
                    <span class="font-bold text-[var(--pr-ink)]">{{ pirateCannonDps(tier, DPS_REFERENCE_DEFENSE).toFixed(1) }} DPS</span>
                  </div>
                </div>
                <PiratesButton
                  size="sm"
                  :variant="tier.cost === 0 ? 'wood' : 'gold'"
                  :disabled="pickerCurrentTier?.tierId === tier.id || balance < tier.cost"
                  :loading="equipping === tier.id"
                  @click="equipCannon(tier.id)"
                >
                  <span v-if="tier.cost === 0">Free</span>
                  <CoinBalance v-else :value="tier.cost" />
                </PiratesButton>
              </div>
              <div v-if="pickerCurrentTier" class="pr-muted flex flex-wrap items-center gap-1 px-1 pt-1 text-xs">
                <span>Fitting a new gun sells the current one first. Refund:</span>
                <CoinBalance :value="pickerCurrentTier.sellValue" />
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.armory-dock {
  background:
    radial-gradient(ellipse at 50% 65%, rgba(45, 212, 191, 0.18), transparent 65%),
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 14px),
    linear-gradient(180deg, #0f2b3d, #081723);
  border-bottom: 1px solid rgba(201, 151, 60, 0.35);
}

.armory-port {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-height: 11.5rem;
  padding: 0.75rem;
  border-radius: 0.8rem;
  background: linear-gradient(180deg, rgba(58, 38, 22, 0.9), rgba(30, 20, 12, 0.95));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--gun, #c9973c) 45%, transparent), inset 0 1px 0 rgba(255, 226, 154, 0.1);
  justify-content: center;
  transition: box-shadow 0.15s, transform 0.15s;
}
.armory-port.is-locked { background: rgba(0, 0, 0, 0.3); box-shadow: inset 0 0 0 1px rgba(147, 168, 182, 0.15); }
.armory-port.is-source { box-shadow: 0 0 0 2px #2dd4bf, 0 0 20px -6px #2dd4bf; }
.armory-port.is-target { cursor: pointer; box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.6); }
.armory-port.is-target:hover { transform: translateY(-2px); }
.armory-port-no {
  position: absolute;
  top: 0.4rem;
  left: 0.55rem;
  font-family: 'Cinzel', serif;
  font-size: 0.7rem;
  font-weight: 900;
  color: #5f7686;
}
.armory-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(3, 9, 15, 0.75) !important;
  backdrop-filter: blur(3px);
}
.armory-modal-card { width: 100%; max-width: 34rem; }
.armory-tier {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.8rem;
  border-radius: 0.7rem;
  background: rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}
.armory-tier.is-current { box-shadow: inset 0 0 0 1px var(--gun), 0 0 18px -8px var(--gun); }

.armory-modal-enter-active, .armory-modal-leave-active { transition: opacity 0.2s; }
.armory-modal-enter-from, .armory-modal-leave-to { opacity: 0; }
</style>
