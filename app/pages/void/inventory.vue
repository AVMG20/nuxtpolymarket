<script setup lang="ts">
import { VOID_AFFIX_GROUP_LABEL, voidResource, type VoidResourceId } from '#shared/utils/gamelogic/void'
import VoidResourceChip from '~/components/void/VoidResourceChip.vue'

definePageMeta({ title: 'Void Inventory' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/void/state')

const busy = ref<string | null>(null)
const sortBy = ref<'score' | 'rarity' | 'newest'>('score')
const rarityFilter = ref<string>('all')
const dealerOpen = ref(false)
const lastRoll = ref<{ name: string, rarity: string, hex: string, lines: string[], special: string | null, score: number } | null>(null)

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))
const held = computed(() => state.value?.resources ?? {})
const activeRun = computed(() => Boolean(state.value?.activeRun))
const slotCount = computed(() => state.value?.turretSlots ?? 1)
const slots = computed(() => Array.from({ length: slotCount.value }, (_, index) =>
  state.value?.weapons.find(w => w.slotIndex === index) ?? null))

const stored = computed(() => {
  const list = (state.value?.weapons ?? []).filter(w => w.slotIndex === null)
  const filtered = rarityFilter.value === 'all' ? list : list.filter(w => w.rarityId === rarityFilter.value)
  const rarityOrder = (state.value?.rarities ?? []).map(r => r.id)
  return [...filtered].sort((a, b) => {
    if (sortBy.value === 'rarity') return rarityOrder.indexOf(b.rarityId) - rarityOrder.indexOf(a.rarityId)
    if (sortBy.value === 'newest') return 0
    return b.score - a.score
  })
})

/** The weakest thing currently mounted, so the inventory can flag an upgrade. */
const worstMountedScore = computed(() => {
  const scores = (state.value?.weapons ?? []).filter(w => w.slotIndex !== null).map(w => w.score)
  if (scores.length < slotCount.value) return 0
  return Math.min(...scores)
})

function costLines(resources: Record<string, number | undefined> | null | undefined) {
  return Object.entries(resources ?? {}).map(([id, raw]) => {
    const amount = raw ?? 0
    return { id, amount, def: voidResource(id), short: (held.value[id as VoidResourceId] ?? 0) < amount }
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

const setSlot = (weaponId: string, slotIndex: number | null) =>
  post('/api/void/weapons/equip', { weaponId, slotIndex }, `slot:${weaponId}`,
    slotIndex === null ? 'Module unmounted' : `Mounted in hardpoint ${slotIndex + 1}`)

const scrap = (weaponId: string) => post('/api/void/weapons/sell', { weaponId }, `scrap:${weaponId}`, 'Module broken down for parts')

async function buyModule(rarityId: string, rarityName: string) {
  if (busy.value) return
  busy.value = `rarity:${rarityId}`
  try {
    const response = await $fetch('/api/void/weapons/buy', { method: 'POST', body: { rarityId } })
    lastRoll.value = {
      name: response.weapon.name,
      rarity: rarityName,
      hex: response.weapon.rarity.hex,
      lines: response.weapon.affixLines.map(line => line.text),
      special: response.weapon.special?.name ?? null,
      score: response.weapon.score
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
  <UContainer class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Modules
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Your gun and your mining laser are the same box. Every module you mount adds its whole stat sheet to the ship.
        </p>
      </div>
      <UBadge v-if="state" color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-gauge" />
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
        description="Dock before refitting."
      />

      <!-- Hardpoints -->
      <section class="space-y-2">
        <p class="flex items-center gap-1.5 px-1 text-sm font-bold">
          <UIcon name="i-lucide-target" class="size-4 text-primary" />
          Hardpoints
          <span class="font-normal text-muted">· {{ state.equippedShipId ? state.ships.find(s => s.equipped)?.name : '' }}</span>
        </p>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div
            v-for="(weapon, index) in slots"
            :key="index"
            class="rounded-xl border p-3"
            :class="weapon ? 'border-default bg-elevated/50' : 'border-dashed border-default bg-default'"
            :style="weapon ? { borderColor: `${weapon.rarity.hex}66` } : undefined"
          >
            <p class="text-[10px] font-bold uppercase tracking-wide text-muted">
              Hardpoint {{ index + 1 }}
            </p>
            <template v-if="weapon">
              <p class="mt-1 truncate text-sm font-bold" :style="{ color: weapon.rarity.hex }">
                {{ weapon.name }}
              </p>
              <p class="text-[10px] text-muted">
                {{ weapon.rarity.name }} · score {{ weapon.score }}
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
                icon="i-lucide-package-minus"
                label="Unmount"
                :loading="busy === `slot:${weapon.id}`"
                :disabled="activeRun"
                @click="setSlot(weapon.id, null)"
              />
            </template>
            <p v-else class="mt-2 text-xs text-muted">
              Empty. An unused hardpoint is wasted stats.
            </p>
          </div>
        </div>
      </section>

      <!-- Arms dealer, folded away until wanted -->
      <section class="rounded-xl border border-default bg-elevated/50">
        <button
          class="flex w-full items-center justify-between gap-3 p-3 text-left"
          @click="dealerOpen = !dealerOpen"
        >
          <span class="flex items-center gap-2 text-sm font-bold">
            <UIcon name="i-lucide-shopping-bag" class="size-4 text-primary" />
            Arms dealer
            <span class="font-normal text-muted">· you buy a rarity, the stats are rolled</span>
          </span>
          <UIcon :name="dealerOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
        </button>

        <div v-if="dealerOpen" class="space-y-3 border-t border-default p-3">
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div
              v-for="rarity in state.rarities"
              :key="rarity.id"
              class="rounded-lg border bg-default p-2.5"
              :style="{ borderColor: `${rarity.hex}55` }"
            >
              <div class="flex items-center justify-between">
                <p class="text-sm font-bold" :style="{ color: rarity.hex }">
                  {{ rarity.name }}
                </p>
                <span class="text-[11px] text-muted">{{ rarity.affixCount }} stats</span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-1">
                <UBadge size="sm" :color="balance < rarity.cost.credits ? 'error' : 'neutral'" variant="subtle">
                  <CoinBalance :value="rarity.cost.credits" />
                </UBadge>
                <VoidResourceChip
                  v-for="line in costLines(rarity.cost.resources)"
                  :key="line.id"
                  :resource="line.id"
                  :amount="line.amount"
                  :short="line.short"
                />
              </div>
              <UButton
                block
                class="mt-2"
                size="xs"
                icon="i-lucide-dices"
                label="Roll"
                :loading="busy === `rarity:${rarity.id}`"
                :disabled="activeRun || !rarity.affordable"
                @click="buyModule(rarity.id, rarity.name)"
              />
            </div>
          </div>

          <div v-if="lastRoll" class="rounded-lg border p-3" :style="{ borderColor: `${lastRoll.hex}88`, background: `${lastRoll.hex}12` }">
            <p class="text-[10px] font-bold uppercase tracking-wide text-muted">
              Latest roll · {{ lastRoll.rarity }} · score {{ lastRoll.score }}
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
        </div>
      </section>

      <!-- Inventory -->
      <section class="space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2 px-1">
          <p class="flex items-center gap-1.5 text-sm font-bold">
            <UIcon name="i-lucide-archive" class="size-4 text-primary" />
            Storage
            <span class="font-normal text-muted">· {{ stored.length }} module{{ stored.length === 1 ? '' : 's' }}</span>
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <UButton
              v-for="option in (['score', 'rarity', 'newest'] as const)"
              :key="option"
              size="xs"
              class="capitalize"
              :color="sortBy === option ? 'primary' : 'neutral'"
              :variant="sortBy === option ? 'solid' : 'subtle'"
              :label="option"
              @click="sortBy = option"
            />
            <USelect
              v-model="rarityFilter"
              size="xs"
              class="w-36"
              value-key="value"
              :items="[{ label: 'All rarities', value: 'all' }, ...state.rarities.map(r => ({ label: r.name, value: r.id }))]"
            />
          </div>
        </div>

        <p class="px-1 text-[11px] text-muted">
          Scrapping returns {{ Math.round(state.salvageRate * 100) }}% of what the rarity costs, in raw materials and credits.
        </p>

        <div v-if="stored.length" class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="weapon in stored"
            :key="weapon.id"
            class="rounded-xl border bg-elevated/50 p-3"
            :style="{ borderColor: `${weapon.rarity.hex}44` }"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-bold" :style="{ color: weapon.rarity.hex }">
                  {{ weapon.name }}
                </p>
                <p class="text-[10px] text-muted">
                  {{ weapon.rarity.name }} · score {{ weapon.score }}
                </p>
              </div>
              <UBadge
                v-if="weapon.score > worstMountedScore"
                size="sm"
                color="success"
                variant="subtle"
                icon="i-lucide-arrow-up"
                label="Upgrade"
              />
            </div>

            <ul class="mt-2 space-y-0.5 text-[11px]">
              <li v-for="line in weapon.affixLines" :key="line.id" class="flex items-center gap-1.5">
                <span class="w-11 shrink-0 text-[9px] uppercase tracking-wide text-muted/70">
                  {{ VOID_AFFIX_GROUP_LABEL[line.group] }}
                </span>
                <span class="text-muted">{{ line.text }}</span>
              </li>
            </ul>

            <p v-if="weapon.special" class="mt-1.5 rounded bg-error/10 px-2 py-1 text-[11px] text-error">
              <span class="font-bold">{{ weapon.special.name }}</span> — {{ weapon.special.description }}
            </p>

            <div class="mt-2.5 flex flex-wrap items-center gap-1 border-t border-default pt-2.5">
              <UButton
                v-for="index in slotCount"
                :key="index"
                size="xs"
                variant="subtle"
                :label="`Slot ${index}`"
                :loading="busy === `slot:${weapon.id}`"
                :disabled="activeRun"
                @click="setSlot(weapon.id, index - 1)"
              />
              <UButton
                class="ml-auto"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-recycle"
                :label="`Scrap · ${formatNumber(weapon.salvageValue.credits)}`"
                :loading="busy === `scrap:${weapon.id}`"
                :disabled="activeRun"
                @click="scrap(weapon.id)"
              />
            </div>
          </div>
        </div>

        <div v-else class="rounded-xl border border-dashed border-default p-8 text-center text-sm text-muted">
          Nothing in storage. Roll something from the arms dealer.
        </div>
      </section>
    </template>
  </UContainer>
</template>
