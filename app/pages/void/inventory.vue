<script setup lang="ts">
import {
  VOID_AFFIX_GROUP_LABEL, VOID_SPECIALS, VOID_SPECIAL_GROUP_LABEL,
  voidResource, voidSpecial,
  type VoidResourceId, type VoidSpecialGroup, type VoidSpecialId
} from '#shared/utils/gamelogic/void'
import VoidResourceChip from '~/components/void/VoidResourceChip.vue'

definePageMeta({ title: 'Void Inventory' })

const toast = useToast()
const { fetchSession } = useAuth()
const { data: state, refresh } = await useFetch('/api/void/state')

const busy = ref<string | null>(null)
const sortBy = ref<'score' | 'rarity' | 'newest'>('score')
const rarityFilter = ref<string>('all')
const specialFilter = ref<string>('all')
const lastRoll = ref<{ name: string, rarity: string, hex: string, lines: string[], special: string | null, score: number } | null>(null)

const balance = computed(() => parseFloat(state.value?.balance ?? '0'))
const held = computed(() => state.value?.resources ?? {})
const activeRun = computed(() => Boolean(state.value?.activeRun))
const slotCount = computed(() => state.value?.turretSlots ?? 1)
const slots = computed(() => Array.from({ length: slotCount.value }, (_, index) =>
  state.value?.weapons.find(w => w.slotIndex === index) ?? null))

/**
 * The effect definitions come from the shared module rather than the API
 * payload: they carry `describe(count)` functions, and functions do not survive
 * JSON. The server sends the ids; the numbers are worked out here from the same
 * source the engine reads, so a card can never disagree with the ship.
 */
function specialFor(id: string | null | undefined) {
  return voidSpecial(id)
}

// ── The build ───────────────────────────────────────────────────────────────

const mounted = computed(() => (state.value?.weapons ?? []).filter(w => w.slotIndex !== null))

/** How many mounted modules carry each effect, most-stacked first. */
const activeSpecials = computed(() => {
  const counts = new Map<VoidSpecialId, number>()
  for (const weapon of mounted.value) {
    const id = weapon.specialId as VoidSpecialId | null
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, def: voidSpecial(id) }))
    .filter(entry => entry.def !== null)
    .sort((a, b) => b.count - a.count || a.def!.name.localeCompare(b.def!.name))
})

/** Every affix on every mounted module, pooled — the whole ship's sheet. */
const pooledAffixes = computed(() => {
  const totals = new Map<string, { text: string, group: string, value: number }>()
  for (const weapon of mounted.value) {
    for (const line of weapon.affixLines) {
      const existing = totals.get(line.id)
      if (existing) existing.value += line.value
      else totals.set(line.id, { text: line.text, group: line.group, value: line.value })
    }
  }
  return [...totals.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => a.group.localeCompare(b.group) || b.value - a.value)
})

const emptySlots = computed(() => slotCount.value - mounted.value.length)

// ── Storage ─────────────────────────────────────────────────────────────────

const stored = computed(() => {
  const list = (state.value?.weapons ?? []).filter(w => w.slotIndex === null)
  const rarityOrder = (state.value?.rarities ?? []).map(r => r.id)
  return list
    .filter(w => rarityFilter.value === 'all' || w.rarityId === rarityFilter.value)
    .filter(w => specialFilter.value === 'all' || w.specialId === specialFilter.value)
    .sort((a, b) => {
      if (sortBy.value === 'rarity') return rarityOrder.indexOf(b.rarityId) - rarityOrder.indexOf(a.rarityId)
      if (sortBy.value === 'newest') return 0
      return b.score - a.score
    })
})

/** Only offer effects the player actually owns something of. */
const ownedSpecialOptions = computed(() => {
  const owned = new Set((state.value?.weapons ?? []).map(w => w.specialId).filter(Boolean))
  return [
    { label: 'All effects', value: 'all' },
    ...VOID_SPECIALS.filter(s => owned.has(s.id)).map(s => ({ label: s.name, value: s.id as string }))
  ]
})

/** The weakest thing currently mounted, so the inventory can flag an upgrade. */
const worstMountedScore = computed(() => {
  const scores = mounted.value.map(w => w.score)
  if (scores.length < slotCount.value) return 0
  return Math.min(...scores)
})

// ── The catalogue ───────────────────────────────────────────────────────────

const specialGroups = computed(() => {
  const groups: VoidSpecialGroup[] = ['offence', 'defence', 'mining', 'haul', 'mobility']
  return groups.map(group => ({
    group,
    label: VOID_SPECIAL_GROUP_LABEL[group],
    specials: VOID_SPECIALS.filter(s => s.group === group)
  }))
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
          Your gun and your mining laser are the same box. Every module carries an effect and adds its whole stat sheet
          to the ship — and mounting the same effect twice stacks it.
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
        <div class="flex flex-wrap items-center justify-between gap-2 px-1">
          <p class="flex items-center gap-1.5 text-sm font-bold">
            <UIcon name="i-lucide-target" class="size-4 text-primary" />
            Hardpoints
            <span class="font-normal text-muted">· {{ state.ships.find(s => s.equipped)?.name }}</span>
          </p>
          <UBadge
            v-if="emptySlots > 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :label="`${emptySlots} empty hardpoint${emptySlots === 1 ? '' : 's'}`"
          />
        </div>
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
              <div v-if="specialFor(weapon.specialId)" class="mt-1.5 flex items-start gap-1.5 rounded bg-primary/10 px-2 py-1">
                <UIcon :name="specialFor(weapon.specialId)!.icon" class="mt-0.5 size-3.5 shrink-0 text-primary" />
                <span class="text-[11px] font-bold text-primary">{{ specialFor(weapon.specialId)!.name }}</span>
              </div>
              <ul class="mt-1.5 space-y-0.5 text-[11px] text-muted">
                <li v-for="line in weapon.affixLines" :key="line.id">
                  {{ line.text }}
                </li>
              </ul>
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
              Empty. An unused hardpoint is a wasted effect.
            </p>
          </div>
        </div>
      </section>

      <!--
        The build sheet. Effects stack, so what matters is not what each module
        is individually but what the four of them add up to — this is that number.
      -->
      <section class="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <p class="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <UIcon name="i-lucide-layers" class="size-4 text-primary" />
          Active build
          <span class="font-normal text-muted">· what everything mounted adds up to</span>
        </p>

        <div v-if="activeSpecials.length" class="grid gap-2 md:grid-cols-2">
          <div
            v-for="entry in activeSpecials"
            :key="entry.id"
            class="rounded-lg border border-default bg-default p-2.5"
          >
            <p class="flex items-center gap-1.5 text-sm font-bold">
              <UIcon :name="entry.def!.icon" class="size-4 text-primary" />
              {{ entry.def!.name }}
              <UBadge
                v-if="entry.count > 1"
                size="sm"
                color="primary"
                variant="solid"
                :label="`×${entry.count}`"
              />
            </p>
            <p class="mt-1 text-[11px] font-semibold text-primary">
              {{ entry.def!.describe(entry.count) }}
            </p>
            <p v-if="entry.count === 1" class="mt-0.5 text-[10px] text-muted">
              A second copy: {{ entry.def!.describe(2) }}
            </p>
          </div>
        </div>
        <p v-else class="text-xs text-muted">
          Nothing mounted. Every module has an effect — an empty ship has none of them.
        </p>

        <div v-if="pooledAffixes.length" class="mt-3 border-t border-default pt-2.5">
          <p class="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
            Pooled stats
          </p>
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="affix in pooledAffixes"
              :key="affix.id"
              size="sm"
              color="neutral"
              variant="subtle"
              :label="affix.text"
            />
          </div>
        </div>
      </section>

      <!-- Arms dealer -->
      <section class="space-y-2">
        <div class="flex flex-wrap items-end justify-between gap-2 px-1">
          <p class="flex items-center gap-1.5 text-sm font-bold">
            <UIcon name="i-lucide-shopping-bag" class="size-4 text-primary" />
            Arms dealer
            <span class="font-normal text-muted">· you buy a rarity, the stats and the effect are rolled</span>
          </p>
          <div class="flex items-center gap-1.5">
            <UBadge color="warning" variant="subtle" icon="i-lucide-circle-dollar-sign">
              <CoinBalance :value="balance" />
            </UBadge>
          </div>
        </div>

        <p class="px-1 text-[11px] text-muted">
          Every module rolls one of {{ VOID_SPECIALS.length }} effects, whatever it cost — a common is the cheap way to
          try a build. What the higher rarities buy is the stat sheet wrapped around it, which is why the deep end is a
          hunt for the right rolls on an effect you have already decided on.
        </p>

        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="rarity in state.rarities"
            :key="rarity.id"
            class="flex flex-col rounded-xl border bg-elevated/40 p-3"
            :style="{ borderColor: `${rarity.hex}55` }"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-black" :style="{ color: rarity.hex }">
                {{ rarity.name }}
              </p>
              <div class="flex shrink-0 items-center gap-1">
                <UBadge size="sm" color="neutral" variant="subtle" :label="`${rarity.affixCount} stats`" />
                <UBadge size="sm" color="neutral" variant="subtle" :label="`${rarity.power}× rolls`" />
              </div>
            </div>

            <p class="mt-1 min-h-8 text-[11px] text-muted">
              {{ rarity.pitch }}
            </p>

            <div class="mt-2 flex flex-wrap items-center gap-1">
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
              class="mt-2.5"
              size="sm"
              icon="i-lucide-dices"
              label="Roll"
              :loading="busy === `rarity:${rarity.id}`"
              :disabled="activeRun || !rarity.affordable"
              @click="buyModule(rarity.id, rarity.name)"
            />
          </div>
        </div>

        <div v-if="lastRoll" class="rounded-xl border p-3" :style="{ borderColor: `${lastRoll.hex}88`, background: `${lastRoll.hex}12` }">
          <p class="text-[10px] font-bold uppercase tracking-wide text-muted">
            Latest roll · {{ lastRoll.rarity }} · score {{ lastRoll.score }}
          </p>
          <p class="mt-0.5 text-lg font-black" :style="{ color: lastRoll.hex }">
            {{ lastRoll.name }}
          </p>
          <p v-if="lastRoll.special" class="mt-1 text-sm font-bold text-primary">
            {{ lastRoll.special }}
          </p>
          <ul class="mt-1 space-y-0.5 text-xs text-muted">
            <li v-for="line in lastRoll.lines" :key="line">
              {{ line }}
            </li>
          </ul>
        </div>
      </section>

      <!-- Effect catalogue -->
      <section class="space-y-2">
        <p class="flex items-center gap-1.5 px-1 text-sm font-bold">
          <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
          Effect catalogue
          <span class="font-normal text-muted">· what a roll can land on, and what a second copy adds</span>
        </p>

        <div v-for="group in specialGroups" :key="group.group" class="space-y-1.5">
          <p class="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
            {{ group.label }}
          </p>
          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="special in group.specials"
              :key="special.id"
              class="rounded-lg border p-2.5"
              :class="activeSpecials.some(s => s.id === special.id) ? 'border-primary/60 bg-primary/5' : 'border-default bg-elevated/40'"
            >
              <p class="flex items-center gap-1.5 text-xs font-bold">
                <UIcon :name="special.icon" class="size-3.5 text-primary" />
                {{ special.name }}
                <UBadge
                  v-if="activeSpecials.find(s => s.id === special.id)"
                  size="sm"
                  color="primary"
                  variant="subtle"
                  :label="`mounted ×${activeSpecials.find(s => s.id === special.id)!.count}`"
                />
              </p>
              <p class="mt-1 text-[11px] text-muted">
                {{ special.description }}
              </p>
              <div class="mt-1.5 space-y-0.5 border-t border-default pt-1.5 text-[10px]">
                <p class="text-default">
                  <span class="font-bold text-muted">×1</span> {{ special.describe(1) }}
                </p>
                <p class="text-muted">
                  <span class="font-bold">×3</span> {{ special.describe(3) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Storage -->
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
              class="w-32"
              value-key="value"
              :items="[{ label: 'All rarities', value: 'all' }, ...state.rarities.map(r => ({ label: r.name, value: r.id }))]"
            />
            <USelect
              v-model="specialFilter"
              size="xs"
              class="w-40"
              value-key="value"
              :items="ownedSpecialOptions"
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
            class="flex flex-col rounded-xl border bg-elevated/50 p-3"
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

            <div v-if="specialFor(weapon.specialId)" class="mt-2 rounded border border-primary/30 bg-primary/5 p-2">
              <p class="flex items-center gap-1.5 text-[11px] font-bold text-primary">
                <UIcon :name="specialFor(weapon.specialId)!.icon" class="size-3.5" />
                {{ specialFor(weapon.specialId)!.name }}
                <UBadge
                  v-if="activeSpecials.find(s => s.id === weapon.specialId)"
                  size="sm"
                  color="primary"
                  variant="subtle"
                  :label="`stacks to ×${activeSpecials.find(s => s.id === weapon.specialId)!.count + 1}`"
                />
              </p>
              <p class="mt-0.5 text-[10px] text-muted">
                {{ specialFor(weapon.specialId)!.describe(1) }}
              </p>
            </div>

            <ul class="mt-2 space-y-0.5 text-[11px]">
              <li v-for="line in weapon.affixLines" :key="line.id" class="flex items-center gap-1.5">
                <span class="w-11 shrink-0 text-[9px] uppercase tracking-wide text-muted/70">
                  {{ VOID_AFFIX_GROUP_LABEL[line.group] }}
                </span>
                <span class="text-muted">{{ line.text }}</span>
              </li>
            </ul>

            <div class="mt-auto flex flex-wrap items-center gap-1 border-t border-default pt-2.5">
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
          Nothing matches. Roll something from the arms dealer, or clear the filters.
        </div>
      </section>
    </template>
  </UContainer>
</template>
