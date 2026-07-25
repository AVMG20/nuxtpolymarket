<script setup lang="ts">
import { voidResource, type VoidResourceId } from '#shared/utils/gamelogic/void'

definePageMeta({ title: 'Void Hangar' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/void/state')

const busy = ref<string | null>(null)
const activeTab = ref('upgrades')
const groupFilter = ref<'all' | 'combat' | 'hull' | 'mining'>('all')

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))
const held = computed(() => state.value?.resources ?? {})
const equippedShip = computed(() => state.value?.ships.find(s => s.equipped))
const slots = computed(() => Array.from({ length: state.value?.turretSlots ?? 1 }, (_, index) =>
  state.value?.weapons.find(w => w.slotIndex === index) ?? null))
const storedWeapons = computed(() => (state.value?.weapons ?? []).filter(w => w.slotIndex === null))
const activeRun = computed(() => Boolean(state.value?.activeRun))

const resourceRows = computed(() => (state.value?.resourceCatalog ?? []).map(def => ({
  ...def,
  amount: held.value[def.id] ?? 0
})))

const visibleUpgrades = computed(() => (state.value?.upgrades ?? [])
  .filter(u => groupFilter.value === 'all' || u.group === groupFilter.value))

function costLines(resources: Record<string, number | undefined> | null | undefined) {
  return Object.entries(resources ?? {}).map(([id, raw]) => {
    const amount = raw ?? 0
    return {
      id,
      amount,
      def: voidResource(id),
      short: (held.value[id as VoidResourceId] ?? 0) < amount
    }
  })
}

async function post(path: string, body: Record<string, unknown>, key: string, success: string) {
  if (busy.value) return
  busy.value = key
  try {
    await $fetch(path, { method: 'POST', body })
    await Promise.all([refresh(), fetchSession()])
    toast.add({ title: success, color: 'success' })
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'That did not work'), color: 'error' })
  } finally {
    busy.value = null
  }
}

const buyUpgrade = (id: string, name: string) => post('/api/void/upgrade', { upgrade: id }, `upgrade:${id}`, `${name} upgraded`)
const buyShip = (id: string, name: string) => post('/api/void/ships/buy', { shipId: id }, `ship:${id}`, `${name} added to the fleet`)
const equipShip = (id: string, name: string) => post('/api/void/ships/equip', { shipId: id }, `ship:${id}`, `Now flying the ${name}`)
const sellWeapon = (id: string) => post('/api/void/weapons/sell', { weaponId: id }, `sell:${id}`, 'Turret stripped for parts')
const setSlot = (weaponId: string, slotIndex: number | null) =>
  post('/api/void/weapons/equip', { weaponId, slotIndex }, `slot:${weaponId}`, slotIndex === null ? 'Turret unmounted' : `Mounted in hardpoint ${slotIndex + 1}`)

const lastRoll = ref<{ name: string, rarity: string, hex: string, lines: string[], special: string | null } | null>(null)

async function buyWeapon(rarityId: string, rarityName: string) {
  if (busy.value) return
  busy.value = `rarity:${rarityId}`
  try {
    const response = await $fetch('/api/void/weapons/buy', { method: 'POST', body: { rarityId } })
    lastRoll.value = {
      name: response.weapon.name,
      rarity: rarityName,
      hex: response.weapon.rarity.hex,
      lines: response.weapon.affixLines.map(line => line.text),
      special: response.weapon.special?.name ?? null
    }
    await Promise.all([refresh(), fetchSession()])
  } catch (error: unknown) {
    toast.add({ title: apiErrorMessage(error, 'Purchase failed'), color: 'error' })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Hangar
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Ore buys the boat, salvage buys the guns. Everything here comes out of runs.
        </p>
      </div>
      <div v-if="state" class="flex flex-wrap items-center gap-2">
        <UBadge color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-gauge" />
        <UBadge color="neutral" variant="subtle" :label="equippedShip?.name ?? 'Scout Skiff'" icon="i-lucide-rocket" />
      </div>
    </div>

    <div v-if="!state">
      <USkeleton class="h-96 rounded-xl" />
    </div>

    <template v-else>
      <UAlert
        v-if="activeRun"
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Run in progress"
        description="Dock or lose the ship before refitting — nothing here can be changed mid-flight."
      />

      <!-- Stores -->
      <UCard :ui="{ body: 'p-3 sm:p-4' }">
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <div class="rounded-lg border border-warning/30 bg-warning/5 p-2.5">
            <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Credits
            </p>
            <CoinBalance :value="balance" class="mt-0.5 font-black" />
          </div>
          <div
            v-for="resource in resourceRows"
            :key="resource.id"
            class="rounded-lg border border-default bg-elevated p-2.5"
            :title="resource.description"
          >
            <p class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <UIcon :name="resource.icon" class="size-3" /> {{ resource.name }}
            </p>
            <p class="mt-0.5 font-black tabular-nums">
              {{ formatNumber(resource.amount) }}
            </p>
          </div>
        </div>
      </UCard>

      <UTabs
        v-model="activeTab"
        :items="[
          { label: 'Upgrades', value: 'upgrades', icon: 'i-lucide-arrow-big-up' },
          { label: 'Turrets', value: 'turrets', icon: 'i-lucide-crosshair' },
          { label: 'Hulls', value: 'ships', icon: 'i-lucide-rocket' }
        ]"
        class="w-full"
      >
        <!-- ── Upgrades ── -->
        <template #content="{ item }">
          <div v-if="item.value === 'upgrades'" class="space-y-3 pt-4">
            <div class="flex flex-wrap gap-1.5">
              <UButton
                v-for="group in (['all', 'combat', 'hull', 'mining'] as const)"
                :key="group"
                size="xs"
                :color="groupFilter === group ? 'primary' : 'neutral'"
                :variant="groupFilter === group ? 'solid' : 'subtle'"
                class="capitalize"
                :label="group"
                @click="groupFilter = group"
              />
            </div>

            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <UCard v-for="upgrade in visibleUpgrades" :key="upgrade.id" :ui="{ body: 'p-4' }">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 font-bold">
                      <UIcon :name="upgrade.icon" class="size-4 text-primary" />
                      {{ upgrade.name }}
                    </p>
                    <p class="mt-1 text-xs leading-snug text-muted">
                      {{ upgrade.description }}
                    </p>
                  </div>
                  <UBadge
                    :color="upgrade.funding === 'ore' ? 'info' : 'warning'"
                    variant="subtle"
                    :label="upgrade.funding === 'ore' ? 'Ore' : 'Salvage'"
                  />
                </div>

                <div class="mt-3 flex items-center justify-between rounded-lg bg-elevated px-3 py-2 text-sm">
                  <span class="font-bold tabular-nums">{{ upgrade.current }}</span>
                  <template v-if="upgrade.next">
                    <UIcon name="i-lucide-arrow-right" class="size-4 text-muted" />
                    <span class="font-bold tabular-nums text-primary">{{ upgrade.next }}</span>
                  </template>
                  <UBadge v-else color="success" variant="subtle" label="Maxed" />
                </div>

                <p class="mt-2 text-[11px] text-muted">
                  Level {{ upgrade.level }} / {{ upgrade.maxLevel }}
                </p>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-accented">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${upgrade.level / upgrade.maxLevel * 100}%` }" />
                </div>

                <template v-if="upgrade.cost">
                  <div class="mt-3 flex flex-wrap items-center gap-1.5">
                    <UBadge :color="balance < upgrade.cost.credits ? 'error' : 'neutral'" variant="subtle">
                      <CoinBalance :value="upgrade.cost.credits" />
                    </UBadge>
                    <UBadge
                      v-for="line in costLines(upgrade.cost.resources)"
                      :key="line.id"
                      :color="line.short ? 'error' : 'neutral'"
                      variant="subtle"
                      :icon="line.def.icon"
                      :label="`${formatNumber(line.amount)}`"
                    />
                  </div>
                  <UButton
                    block
                    class="mt-3"
                    icon="i-lucide-arrow-big-up"
                    label="Upgrade"
                    :loading="busy === `upgrade:${upgrade.id}`"
                    :disabled="activeRun || !upgrade.affordable"
                    @click="buyUpgrade(upgrade.id, upgrade.name)"
                  />
                </template>
              </UCard>
            </div>
          </div>

          <!-- ── Turrets ── -->
          <div v-else-if="item.value === 'turrets'" class="space-y-5 pt-4">
            <UCard :ui="{ body: 'p-4' }">
              <p class="mb-3 flex items-center gap-1.5 text-sm font-bold">
                <UIcon name="i-lucide-target" class="size-4 text-primary" />
                Hardpoints · {{ equippedShip?.name }}
              </p>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div
                  v-for="(weapon, index) in slots"
                  :key="index"
                  class="rounded-lg border p-3"
                  :class="weapon ? 'border-default bg-elevated' : 'border-dashed border-default bg-default'"
                >
                  <p class="text-[10px] font-bold uppercase tracking-wide text-muted">
                    Hardpoint {{ index + 1 }}
                  </p>
                  <template v-if="weapon">
                    <p class="mt-1 truncate font-bold" :style="{ color: weapon.rarity.hex }">
                      {{ weapon.name }}
                    </p>
                    <ul class="mt-1.5 space-y-0.5 text-[11px] text-muted">
                      <li v-for="line in weapon.affixLines" :key="line.id">
                        {{ line.text }}
                      </li>
                    </ul>
                    <p v-if="weapon.special" class="mt-1.5 rounded bg-error/10 px-2 py-1 text-[11px] font-semibold text-error">
                      {{ weapon.special.name }}
                    </p>
                    <UButton
                      block
                      class="mt-2"
                      size="xs"
                      color="neutral"
                      variant="subtle"
                      label="Unmount"
                      :loading="busy === `slot:${weapon.id}`"
                      :disabled="activeRun"
                      @click="setSlot(weapon.id, null)"
                    />
                  </template>
                  <p v-else class="mt-2 text-xs text-muted">
                    Empty — mount something from storage.
                  </p>
                </div>
              </div>
            </UCard>

            <UCard :ui="{ body: 'p-4' }">
              <p class="mb-1 flex items-center gap-1.5 text-sm font-bold">
                <UIcon name="i-lucide-shopping-bag" class="size-4 text-primary" /> Arms dealer
              </p>
              <p class="mb-3 text-xs text-muted">
                You buy a rarity, not a gun. Stats roll at purchase — higher rarities roll more affixes and bigger numbers, and a Unique always comes with a gameplay-altering special.
              </p>
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  v-for="rarity in state.rarities"
                  :key="rarity.id"
                  class="rounded-lg border border-default bg-elevated p-3"
                  :style="{ borderColor: `${rarity.hex}55` }"
                >
                  <div class="flex items-center justify-between">
                    <p class="font-bold" :style="{ color: rarity.hex }">
                      {{ rarity.name }}
                    </p>
                    <UBadge color="neutral" variant="subtle" :label="`${rarity.affixCount} affix${rarity.affixCount === 1 ? '' : 'es'}`" />
                  </div>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <UBadge :color="balance < rarity.cost.credits ? 'error' : 'neutral'" variant="subtle">
                      <CoinBalance :value="rarity.cost.credits" />
                    </UBadge>
                    <UBadge
                      v-for="line in costLines(rarity.cost.resources)"
                      :key="line.id"
                      :color="line.short ? 'error' : 'neutral'"
                      variant="subtle"
                      :icon="line.def.icon"
                      :label="formatNumber(line.amount)"
                    />
                  </div>
                  <UButton
                    block
                    class="mt-3"
                    size="sm"
                    icon="i-lucide-dices"
                    label="Roll a turret"
                    :loading="busy === `rarity:${rarity.id}`"
                    :disabled="activeRun || !rarity.affordable"
                    @click="buyWeapon(rarity.id, rarity.name)"
                  />
                </div>
              </div>

              <div v-if="lastRoll" class="mt-4 rounded-lg border p-3" :style="{ borderColor: `${lastRoll.hex}88`, background: `${lastRoll.hex}12` }">
                <p class="text-[10px] font-bold uppercase tracking-wide text-muted">
                  Latest roll · {{ lastRoll.rarity }}
                </p>
                <p class="mt-0.5 text-lg font-black" :style="{ color: lastRoll.hex }">
                  {{ lastRoll.name }}
                </p>
                <ul class="mt-1 space-y-0.5 text-xs text-muted">
                  <li v-for="line in lastRoll.lines" :key="line">
                    {{ line }}
                  </li>
                </ul>
                <p v-if="lastRoll.special" class="mt-1.5 text-xs font-bold text-error">
                  Special: {{ lastRoll.special }}
                </p>
              </div>
            </UCard>

            <UCard :ui="{ body: 'p-4' }">
              <p class="mb-3 flex items-center gap-1.5 text-sm font-bold">
                <UIcon name="i-lucide-archive" class="size-4 text-primary" /> Storage ({{ storedWeapons.length }})
              </p>
              <div v-if="storedWeapons.length" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  v-for="weapon in storedWeapons"
                  :key="weapon.id"
                  class="rounded-lg border border-default bg-elevated p-3"
                  :style="{ borderColor: `${weapon.rarity.hex}44` }"
                >
                  <p class="truncate font-bold" :style="{ color: weapon.rarity.hex }">
                    {{ weapon.name }}
                  </p>
                  <ul class="mt-1 space-y-0.5 text-[11px] text-muted">
                    <li v-for="line in weapon.affixLines" :key="line.id">
                      {{ line.text }}
                    </li>
                  </ul>
                  <p v-if="weapon.special" class="mt-1.5 rounded bg-error/10 px-2 py-1 text-[11px] font-semibold text-error">
                    {{ weapon.special.name }} — {{ weapon.special.description }}
                  </p>
                  <div class="mt-2 flex flex-wrap gap-1">
                    <UButton
                      v-for="index in (state.turretSlots)"
                      :key="index"
                      size="xs"
                      variant="subtle"
                      :label="`Slot ${index}`"
                      :loading="busy === `slot:${weapon.id}`"
                      :disabled="activeRun"
                      @click="setSlot(weapon.id, index - 1)"
                    />
                    <UButton
                      size="xs"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-recycle"
                      label="Strip"
                      :loading="busy === `sell:${weapon.id}`"
                      :disabled="activeRun"
                      @click="sellWeapon(weapon.id)"
                    />
                  </div>
                </div>
              </div>
              <p v-else class="text-xs text-muted">
                Nothing in storage. Everything you own is bolted on.
              </p>
            </UCard>
          </div>

          <!-- ── Hulls ── -->
          <div v-else class="grid gap-3 pt-4 md:grid-cols-2 xl:grid-cols-3">
            <UCard
              v-for="ship in state.ships"
              :key="ship.id"
              :ui="{ body: 'p-4' }"
              :class="ship.equipped ? 'ring-2 ring-primary' : ''"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="font-bold">
                    {{ ship.name }}
                  </p>
                  <p class="mt-1 text-xs leading-snug text-muted">
                    {{ ship.description }}
                  </p>
                </div>
                <UBadge v-if="ship.equipped" color="primary" variant="subtle" label="Flying" />
              </div>

              <div class="mt-3 grid grid-cols-3 gap-1.5 text-center">
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Speed
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.speedMult.toFixed(2) }}x
                  </p>
                </div>
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Turn
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.turnMult.toFixed(2) }}x
                  </p>
                </div>
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Cargo
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.cargoMult.toFixed(2) }}x
                  </p>
                </div>
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Hull
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.hullMult.toFixed(2) }}x
                  </p>
                </div>
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Mining
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.miningMult.toFixed(2) }}x
                  </p>
                </div>
                <div class="rounded bg-elevated px-1 py-1.5">
                  <p class="text-[9px] uppercase text-muted">
                    Turrets
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ ship.turretSlots }}
                  </p>
                </div>
              </div>

              <template v-if="ship.owned">
                <UButton
                  block
                  class="mt-3"
                  color="neutral"
                  variant="subtle"
                  icon="i-lucide-check"
                  :label="ship.equipped ? 'Currently flying' : 'Fly this hull'"
                  :loading="busy === `ship:${ship.id}`"
                  :disabled="activeRun || ship.equipped"
                  @click="equipShip(ship.id, ship.name)"
                />
              </template>
              <template v-else>
                <div class="mt-3 flex flex-wrap items-center gap-1.5">
                  <UBadge :color="balance < ship.cost.credits ? 'error' : 'neutral'" variant="subtle">
                    <CoinBalance :value="ship.cost.credits" />
                  </UBadge>
                  <UBadge
                    v-for="line in costLines(ship.cost.resources)"
                    :key="line.id"
                    :color="line.short ? 'error' : 'neutral'"
                    variant="subtle"
                    :icon="line.def.icon"
                    :label="formatNumber(line.amount)"
                  />
                </div>
                <p v-if="!ship.unlocked" class="mt-2 text-[11px] text-warning">
                  Requires a successful extraction from sector {{ ship.requiresSector }}.
                </p>
                <UButton
                  block
                  class="mt-2"
                  icon="i-lucide-shopping-cart"
                  label="Acquire"
                  :loading="busy === `ship:${ship.id}`"
                  :disabled="activeRun || !ship.unlocked || !ship.affordable"
                  @click="buyShip(ship.id, ship.name)"
                />
              </template>
            </UCard>
          </div>
        </template>
      </UTabs>
    </template>
  </UContainer>
</template>
