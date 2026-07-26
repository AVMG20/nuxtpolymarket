<script setup lang="ts">
import { voidHex, voidResource, type VoidResourceId } from '#shared/utils/gamelogic/void'
import VoidShipShowcase from '~/components/void/VoidShipShowcase.client.vue'
import VoidResourceChip from '~/components/void/VoidResourceChip.vue'

definePageMeta({ title: 'Void Hangar' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/void/state')

const busy = ref<string | null>(null)
const previewShipId = ref<string | null>(null)

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))
const gems = computed(() => state.value?.gems ?? 0)
const held = computed(() => state.value?.resources ?? {})
const equippedShip = computed(() => state.value?.ships.find(s => s.equipped))
const activeRun = computed(() => Boolean(state.value?.activeRun))
const mountedCount = computed(() => (state.value?.weapons ?? []).filter(w => w.slotIndex !== null).length)

const offence = computed(() => (state.value?.upgrades ?? []).filter(u => u.funding === 'salvage'))
const shipSide = computed(() => (state.value?.upgrades ?? []).filter(u => u.funding === 'ore'))

// The showcase follows whatever hull you last clicked, falling back to the one
// you're actually flying.
const previewShip = computed(() => {
  const ships = state.value?.ships ?? []
  return ships.find(s => s.id === previewShipId.value) ?? ships.find(s => s.equipped) ?? ships[0]
})
const previewStats = computed(() => {
  const ship = previewShip.value
  if (!ship) return []
  return [
    { label: 'Speed', value: `${ship.speedMult.toFixed(2)}×` },
    { label: 'Turn', value: `${ship.turnMult.toFixed(2)}×` },
    { label: 'Cargo', value: `${ship.cargoMult.toFixed(2)}×` },
    { label: 'Hull', value: `${ship.hullMult.toFixed(2)}×` },
    { label: 'Cut time', value: `${ship.miningMult.toFixed(2)}×` },
    { label: 'Hardpoints', value: String(ship.turretSlots) },
    { label: 'Barrels', value: String(ship.barrels) }
  ]
})

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
</script>

<template>
  <UContainer class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Hangar
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Salvage funds the guns, ore funds the boat. Everything here comes out of runs.
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

      <!-- Stores: one tight strip, not a wall of cards -->
      <div class="flex flex-wrap items-center gap-1.5 rounded-xl border border-default bg-elevated/60 p-2">
        <span class="flex items-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1.5">
          <UIcon name="i-lucide-circle-dollar-sign" class="size-3.5 text-warning" />
          <CoinBalance :value="balance" class="text-sm font-black" />
        </span>
        <span class="flex items-center gap-1.5 rounded-lg border border-info/30 bg-info/10 px-2.5 py-1.5">
          <UIcon name="i-lucide-gem" class="size-3.5 text-info" />
          <span class="text-sm font-black tabular-nums text-info">{{ formatNumber(gems) }}</span>
        </span>
        <span
          v-for="resource in state.resourceCatalog"
          :key="resource.id"
          class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
          :style="{
            backgroundColor: `${voidHex(resource.color)}14`,
            boxShadow: `inset 0 0 0 1px ${voidHex(resource.color)}33`
          }"
          :title="resource.description"
        >
          <UIcon :name="resource.icon" class="size-3.5" :style="{ color: voidHex(resource.color) }" />
          <span class="text-[11px]" :style="{ color: voidHex(resource.color) }">{{ resource.name }}</span>
          <span class="text-sm font-black tabular-nums">{{ formatNumber(held[resource.id] ?? 0) }}</span>
        </span>
      </div>

      <!-- Upgrades: two compact columns of rows -->
      <div class="grid gap-4 lg:grid-cols-2">
        <section
          v-for="column in [
            { key: 'offence', title: 'Weapon systems', hint: 'Paid for in salvage', icon: 'i-lucide-crosshair', accent: 'warning', rows: offence },
            { key: 'ship', title: 'Ship systems', hint: 'Paid for in ore', icon: 'i-lucide-rocket', accent: 'info', rows: shipSide }
          ]"
          :key="column.key"
          class="space-y-2"
        >
          <div class="flex items-center justify-between px-1">
            <p class="flex items-center gap-1.5 text-sm font-bold">
              <UIcon :name="column.icon" class="size-4" :class="column.accent === 'warning' ? 'text-warning' : 'text-info'" />
              {{ column.title }}
            </p>
            <span class="text-[11px] text-muted">{{ column.hint }}</span>
          </div>

          <div
            v-for="upgrade in column.rows"
            :key="upgrade.id"
            class="rounded-xl border border-default bg-elevated/50 p-3"
          >
            <div class="flex items-start gap-3">
              <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-default">
                <UIcon :name="upgrade.icon" class="size-4.5 text-primary" />
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between gap-2">
                  <p class="truncate text-sm font-bold">
                    {{ upgrade.name }}
                  </p>
                  <span class="shrink-0 text-[11px] tabular-nums text-muted">
                    Lv {{ upgrade.level }}<span class="opacity-50">/{{ upgrade.maxLevel }}</span>
                  </span>
                </div>

                <div class="mt-1 h-1 overflow-hidden rounded-full bg-accented">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${upgrade.level / upgrade.maxLevel * 100}%` }" />
                </div>

                <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  <template v-for="(line, index) in upgrade.current" :key="line">
                    <span class="tabular-nums text-muted">{{ line }}</span>
                    <UIcon v-if="upgrade.next" name="i-lucide-arrow-right" class="size-3 text-muted/60" />
                    <span v-if="upgrade.next" class="font-semibold tabular-nums text-primary">{{ upgrade.next[index] }}</span>
                    <span v-if="index < upgrade.current.length - 1" class="text-muted/40">·</span>
                  </template>
                </div>

                <details class="group mt-1.5">
                  <summary class="cursor-pointer list-none text-[11px] text-muted hover:text-default">
                    <span class="group-open:hidden">What does this do?</span>
                    <span class="hidden group-open:inline">Hide</span>
                  </summary>
                  <p class="mt-1 text-[11px] leading-snug text-muted">
                    {{ upgrade.description }}
                  </p>
                </details>
              </div>
            </div>

            <div v-if="upgrade.cost" class="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-default pt-2.5">
              <div class="flex flex-wrap items-center gap-1">
                <UBadge size="sm" :color="balance < upgrade.cost.credits ? 'error' : 'neutral'" variant="subtle">
                  <CoinBalance :value="upgrade.cost.credits" />
                </UBadge>
                <VoidResourceChip
                  v-for="line in costLines(upgrade.cost.resources)"
                  :key="line.id"
                  :resource="line.id"
                  :amount="line.amount"
                  :short="line.short"
                />
              </div>
              <UButton
                size="xs"
                icon="i-lucide-arrow-big-up"
                label="Upgrade"
                :loading="busy === `upgrade:${upgrade.id}`"
                :disabled="activeRun || !upgrade.affordable"
                @click="buyUpgrade(upgrade.id, upgrade.name)"
              />
            </div>
            <p v-else class="mt-2.5 border-t border-default pt-2.5 text-[11px] font-semibold text-success">
              Fully upgraded
            </p>
          </div>
        </section>
      </div>

      <!-- Modules live on their own page; this is just the doorway -->
      <NuxtLink
        to="/void/inventory"
        class="flex items-center justify-between gap-3 rounded-xl border border-default bg-elevated/50 p-4 transition-colors hover:border-primary/50"
      >
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-default">
            <UIcon name="i-lucide-boxes" class="size-5 text-primary" />
          </div>
          <div>
            <p class="text-sm font-bold">
              Modules &amp; hardpoints
            </p>
            <p class="text-xs text-muted">
              {{ mountedCount }} of {{ state.turretSlots }} mounted · {{ state.weapons.length }} owned. Buy, swap and scrap in the inventory.
            </p>
          </div>
        </div>
        <UIcon name="i-lucide-chevron-right" class="size-5 text-muted" />
      </NuxtLink>

      <!-- Hulls: live preview on the left, pickable roster on the right -->
      <section class="space-y-2">
        <p class="flex items-center gap-1.5 px-1 text-sm font-bold">
          <UIcon name="i-lucide-rocket" class="size-4 text-primary" /> Hulls
        </p>

        <div class="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div v-if="previewShip" class="overflow-hidden rounded-xl border border-default bg-elevated/50">
            <div class="relative bg-gradient-to-b from-slate-950 to-slate-900" style="aspect-ratio: 560 / 260;">
              <ClientOnly>
                <VoidShipShowcase :ship-id="previewShip.id" :locked="!previewShip.owned" />
                <template #fallback>
                  <div class="size-full animate-pulse bg-slate-900" />
                </template>
              </ClientOnly>

              <div class="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
                <UBadge v-if="previewShip.equipped" size="sm" color="primary" variant="subtle" label="Flying" />
                <UBadge v-else-if="previewShip.owned" size="sm" color="neutral" variant="subtle" label="In fleet" />
                <UBadge v-else-if="!previewShip.unlocked" size="sm" color="warning" variant="subtle" icon="i-lucide-lock" :label="`Sector ${previewShip.requiresSector}`" />
                <UBadge v-else size="sm" color="neutral" variant="subtle" icon="i-lucide-tag" label="For sale" />
              </div>
            </div>

            <div class="p-3">
              <p class="text-base font-bold">
                {{ previewShip.name }}
              </p>
              <p class="mt-0.5 text-xs leading-snug text-muted">
                {{ previewShip.description }}
              </p>

              <div class="mt-2.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                <div v-for="stat in previewStats" :key="stat.label" class="rounded-lg bg-default px-1 py-1.5 text-center">
                  <p class="text-[9px] uppercase tracking-wide text-muted">
                    {{ stat.label }}
                  </p>
                  <p class="text-sm font-black tabular-nums">
                    {{ stat.value }}
                  </p>
                </div>
              </div>

              <template v-if="previewShip.owned">
                <UButton
                  v-if="!previewShip.equipped"
                  block
                  class="mt-3"
                  icon="i-lucide-check"
                  label="Fly this hull"
                  :loading="busy === `ship:${previewShip.id}`"
                  :disabled="activeRun"
                  @click="equipShip(previewShip.id, previewShip.name)"
                />
                <p v-else class="mt-3 text-center text-xs text-muted">
                  This is the hull you're flying.
                </p>
              </template>
              <template v-else>
                <div class="mt-3 flex flex-wrap items-center gap-1">
                  <UBadge size="sm" :color="balance < previewShip.cost.credits ? 'error' : 'neutral'" variant="subtle">
                    <CoinBalance :value="previewShip.cost.credits" />
                  </UBadge>
                  <VoidResourceChip
                    v-for="line in costLines(previewShip.cost.resources)"
                    :key="line.id"
                    :resource="line.id"
                    :amount="line.amount"
                    :short="line.short"
                  />
                  <UBadge v-if="previewShip.gemCost > 0" size="sm" :color="gems < previewShip.gemCost ? 'error' : 'info'" variant="subtle" icon="i-lucide-gem" :label="formatNumber(previewShip.gemCost)" />
                </div>
                <UButton
                  block
                  class="mt-2"
                  icon="i-lucide-shopping-cart"
                  label="Acquire"
                  :loading="busy === `ship:${previewShip.id}`"
                  :disabled="activeRun || !previewShip.unlocked || !previewShip.affordable"
                  @click="buyShip(previewShip.id, previewShip.name)"
                />
                <p v-if="!previewShip.unlocked" class="mt-1.5 text-center text-[11px] text-warning">
                  Extract from sector {{ previewShip.requiresSector }} to unlock this hull.
                </p>
              </template>
            </div>
          </div>

          <div class="space-y-1.5">
            <button
              v-for="ship in state.ships"
              :key="ship.id"
              type="button"
              class="flex w-full items-center gap-3 rounded-xl border bg-elevated/50 p-2.5 text-left transition-colors"
              :class="previewShip?.id === ship.id ? 'border-primary/60 bg-elevated' : 'border-default hover:border-default/80'"
              @click="previewShipId = ship.id"
            >
              <span
                class="flex size-9 shrink-0 items-center justify-center rounded-lg"
                :style="{ backgroundColor: `#${ship.color.toString(16).padStart(6, '0')}22` }"
              >
                <UIcon
                  :name="ship.owned ? 'i-lucide-rocket' : ship.unlocked ? 'i-lucide-tag' : 'i-lucide-lock'"
                  class="size-4"
                  :style="{ color: `#${ship.color.toString(16).padStart(6, '0')}` }"
                />
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-sm font-bold">{{ ship.name }}</span>
                  <UBadge v-if="ship.equipped" size="sm" color="primary" variant="subtle" label="Flying" />
                </span>
                <span class="mt-0.5 block text-[11px] text-muted">
                  {{ ship.turretSlots }} hardpoint{{ ship.turretSlots === 1 ? '' : 's' }}
                  · {{ ship.barrels }} barrel{{ ship.barrels === 1 ? '' : 's' }}
                  · {{ ship.cargoMult.toFixed(2) }}× cargo
                </span>
              </span>

              <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted" />
            </button>
          </div>
        </div>
      </section>
    </template>
  </UContainer>
</template>
