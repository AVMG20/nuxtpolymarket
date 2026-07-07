<script setup lang="ts">
import {
  tierLabel, tierColor, tierNameColor, levelTextColor, getPlant, getArtifact, getEffectValueFor,
  getMutationPair, breedDuration,
} from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone, formatDuration } from '~/utils/xeno-format'

const {
  state, breederSlots, inventory, freeArtifacts,
  unlockBreederSlot, startBreed, cancelBreed, collectBreed,
  attachBreederArtifact, removeBreederArtifact,
} = useXeno()

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
})

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

// Hybrids can't be bred — hide them from breeder parent selection.
const breedableInventory = computed(() => (inventory.value as any[]).filter(i => !i.isHybrid))

// ── Breeder-only artifacts for the panel ─────────────────────────────────────
const breederFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => {
    const art = getArtifact(a.typeId)
    return art?.effects.some(e => e.type.startsWith('breeder_'))
  }),
)

// ── Selection state (sidebar-driven) ─────────────────────────────────────────
const mobileInventoryOpen = ref(false)

const selectedPlant = ref<{
  typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number
} | null>(null)

const selectedArtifact = ref<{
  id: string; typeId: string; chargesRemaining: number
} | null>(null)

watch(inventory, (inv) => {
  if (!selectedPlant.value) return
  const { typeId, speed, yield: yld } = selectedPlant.value
  if (!(inv as any[]).find(i => i.typeId === typeId && i.speed === speed && i.yield === yld))
    selectedPlant.value = null
})
// Keep artifact selected after placing — switch to next of same type, clear only if none left
watch(breederFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!(arts as any[]).find(a => a.id === selectedArtifact.value?.id)) {
    const next = (arts as any[]).find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining } : null
  }
})

function onSelectPlant(p: any) { selectedPlant.value = p; if (p) selectedArtifact.value = null }
function onSelectArtifact(a: any) { selectedArtifact.value = a; if (a) selectedPlant.value = null }

// ── Per-slot parent staging ───────────────────────────────────────────────────
const slotParents = ref<Record<string, { p1: any; p2: any }>>({})

function getSlotParents(slotId: string) {
  if (!slotParents.value[slotId]) slotParents.value[slotId] = { p1: null, p2: null }
  return slotParents.value[slotId]!
}

function getParent(slotId: string, num: 1 | 2) {
  return getSlotParents(slotId)[num === 1 ? 'p1' : 'p2']
}

function bothPicked(slotId: string) {
  return !!getParent(slotId, 1) && !!getParent(slotId, 2)
}

function clearParent(slotId: string, num: 1 | 2) {
  getSlotParents(slotId)[num === 1 ? 'p1' : 'p2'] = null
}

function handleParentSlotClick(slotId: string, num: 1 | 2) {
  if (!selectedPlant.value) return
  const parents = getSlotParents(slotId)
  if (num === 1) parents.p1 = selectedPlant.value
  else parents.p2 = selectedPlant.value
}

const attachingSlot = ref<string | null>(null)
async function handleArtifactSlotClick(slotId: string) {
  if (!selectedArtifact.value || attachingSlot.value) return
  attachingSlot.value = slotId
  try { await attachBreederArtifact(slotId, selectedArtifact.value.id) }
  finally { attachingSlot.value = null }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// A parent pair can have more than one possible mutation (e.g. crystal-vine +
// voidbloom → xenoform OR deepfrond) — each is rolled independently server-side,
// so all must be shown, not just the first match.
function mutationsForParents(p1: any, p2: any) {
  if (!p1 || !p2) return []
  return getMutationPair(p1.typeId, p2.typeId)
}

function baseBreedSecs(p1: any, p2: any): number {
  const t1 = getPlant(p1.typeId)
  const t2 = getPlant(p2.typeId)
  if (!t1 || !t2) return 0
  return breedDuration({ baseTime: t1.baseTime }, { baseTime: t2.baseTime })
}

function slotBreederSpeedBoost(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValueFor(art, 'breeder_speed_boost', slot.artifact.gemCrafted) : 0
}

function slotMutationBoost(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValueFor(art, 'breeder_mutation_boost', slot.artifact.gemCrafted) : 0
}

function breedDurationSecs(slot: any): number {
  if (!slot.completesAt || !slot.startedAt) return 0
  const end = Number(slot.completesAt)
  const start = Number(new Date(slot.startedAt))
  const secs = Math.round((end - start) / 1000)
  return Number.isFinite(secs) && secs > 0 ? secs : 0
}

function effectiveMutationChance(slot: any, mutation: { chance: number }): number {
  return Math.max(0, Math.min(1, mutation.chance + slotMutationBoost(slot)))
}

function slotExtraYield(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValueFor(art, 'breeder_extra_yield', slot.artifact.gemCrafted) : 0
}

// ── Actions ───────────────────────────────────────────────────────────────────
const starting = ref(new Set<string>())
const cancelling = ref(new Set<string>())
const collecting = ref(new Set<string>())
const unlocking = ref(false)

async function doCancel(slotId: string) {
  cancelling.value.add(slotId)
  try { await cancelBreed(slotId) } finally { cancelling.value.delete(slotId) }
}

async function doStart(slot: any) {
  const p1 = getParent(slot.id, 1)
  const p2 = getParent(slot.id, 2)
  if (!p1 || !p2) return
  starting.value.add(slot.id)
  try {
    await startBreed(slot.id, p1.typeId, p1.speed, p1.yield, p2.typeId, p2.speed, p2.yield)
    slotParents.value[slot.id] = { p1: null, p2: null }
  } finally { starting.value.delete(slot.id) }
}

async function doCollect(slotId: string) {
  collecting.value.add(slotId)
  try { await collectBreed(slotId) } finally { collecting.value.delete(slotId) }
}
</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Main content ──────────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-4 md:p-6">

        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div>
            <h1 class="text-xl font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-dna" class="size-5 text-primary" />
              Breeder
            </h1>
            <p class="text-xs text-muted mt-0.5">Combine two plants to create new varieties. Rare pairs may mutate.</p>
          </div>
          <UButton
            icon="i-lucide-package"
            label="Inventory"
            variant="soft"
            color="neutral"
            size="sm"
            class="lg:hidden"
            @click="mobileInventoryOpen = true"
          />
        </div>

        <div v-if="!state" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <USkeleton v-for="i in 3" :key="i" class="h-[28rem] rounded-2xl" />
        </div>

        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <!-- ═══════════ Breeder slots ═══════════ -->
          <div
            v-for="slot in breederSlots"
            :key="slot.id"
            class="rounded-2xl border border-default bg-elevated flex flex-col overflow-hidden min-h-[28rem]"
          >
            <!-- ════════ Active breeding ════════ -->
            <template v-if="slot.startedAt && !slot.collected">

              <!-- ──── Result reveal ──── -->
              <template v-if="slot.completesAt && isDone(slot.completesAt) && slot.resultTypeId">
                <div
                  class="flex items-center justify-center gap-1.5 h-9 shrink-0"
                  :class="slot.wasMutation ? 'bg-primary/20 border-b border-primary/30' : 'bg-elevated border-b border-default'"
                >
                  <template v-if="slot.wasMutation">
                    <span class="text-xs animate-bounce">✨</span>
                    <p class="text-[10px] font-black text-primary uppercase tracking-[0.25em]">Mutation!</p>
                    <span class="text-xs animate-bounce">✨</span>
                  </template>
                  <p v-else class="text-[10px] font-black text-muted uppercase tracking-[0.25em]">New variety</p>
                </div>

                <div class="relative flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center min-h-0 overflow-hidden">
                  <!-- glow -->
                  <div
                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] size-44 rounded-full blur-3xl pointer-events-none"
                    :class="slot.wasMutation ? 'bg-primary/25' : 'bg-primary/10'"
                  />
                  <XenoPlantIcon :id="slot.resultTypeId" :size="80" class="relative select-none drop-shadow-lg" />
                  <div class="relative leading-tight">
                    <p class="text-lg font-black tracking-tight" :class="tierNameColor(getPlant(slot.resultTypeId)?.tier ?? 1)">
                      {{ getPlant(slot.resultTypeId)?.name }}<sup class="text-xs font-semibold ml-0.5 opacity-70">×{{ slot.resultQuantity }}</sup>
                    </p>
                    <span class="text-xs font-bold" :class="tierColor(getPlant(slot.resultTypeId)?.tier ?? 1)">
                      {{ tierLabel(getPlant(slot.resultTypeId)?.tier ?? 1) }}
                    </span>
                  </div>
                  <div class="relative flex items-stretch gap-3">
                    <div class="flex flex-col items-center gap-0.5 rounded-lg bg-background/50 border border-default/50 px-4 py-1.5">
                      <p class="text-[9px] font-bold uppercase tracking-widest text-muted">Speed</p>
                      <p class="text-xl font-black leading-none" :class="levelTextColor(slot.resultSpeed ?? 0)">{{ slot.resultSpeed }}</p>
                    </div>
                    <div class="flex flex-col items-center gap-0.5 rounded-lg bg-background/50 border border-default/50 px-4 py-1.5">
                      <p class="text-[9px] font-bold uppercase tracking-widest text-muted">Yield</p>
                      <p class="text-xl font-black leading-none" :class="levelTextColor(slot.resultYield ?? 0)">{{ slot.resultYield }}</p>
                    </div>
                  </div>
                </div>

                <div class="p-4 shrink-0">
                  <UButton
                    :label="slot.wasMutation ? '✨ Collect Mutation' : 'Collect Harvest'"
                    block
                    size="lg"
                    color="primary"
                    :loading="collecting.has(slot.id)"
                    @click="doCollect(slot.id)"
                  />
                </div>
              </template>

              <!-- ──── In progress ──── -->
              <template v-else>
                <div class="flex items-center justify-between h-9 px-4 shrink-0 border-b border-default/60">
                  <div class="flex items-center gap-2">
                    <span class="relative flex size-2">
                      <span class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                      <span class="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    <p class="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Breeding</p>
                  </div>
                  <span v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded leading-none">
                    ⚡ −{{ Math.round(slotBreederSpeedBoost(slot) * 100) }}% speed
                  </span>
                </div>

                <div class="flex-1 flex flex-col p-4 min-h-0">
                  <!-- Parents -->
                  <div class="flex items-center gap-2">
                    <div class="flex-1 flex flex-col items-center gap-1 rounded-xl bg-background/50 border border-default/50 py-2.5">
                      <XenoPlantIcon v-if="slot.parent1" :id="slot.parent1.typeId" :size="28" />
                      <span v-else class="text-2xl leading-none">?</span>
                      <p class="text-[11px] font-bold leading-tight text-center px-1 truncate max-w-full">{{ slot.parent1 ? getPlant(slot.parent1.typeId)?.name : '?' }}</p>
                    </div>
                    <UIcon name="i-lucide-plus" class="size-4 text-muted shrink-0" />
                    <div class="flex-1 flex flex-col items-center gap-1 rounded-xl bg-background/50 border border-default/50 py-2.5">
                      <XenoPlantIcon v-if="slot.parent2" :id="slot.parent2.typeId" :size="28" />
                      <span v-else class="text-2xl leading-none">?</span>
                      <p class="text-[11px] font-bold leading-tight text-center px-1 truncate max-w-full">{{ slot.parent2 ? getPlant(slot.parent2.typeId)?.name : '?' }}</p>
                    </div>
                  </div>

                  <!-- Mystery + countdown -->
                  <div class="flex-1 flex flex-col items-center justify-center gap-2 min-h-0">
                    <div class="text-4xl leading-none select-none animate-pulse">🧬</div>
                    <p class="text-3xl font-black tabular-nums leading-none">{{ slot.completesAt ? formatCountdown(slot.completesAt, now) : '…' }}</p>
                    <p class="text-[11px] text-muted uppercase tracking-wider">until ready</p>
                  </div>

                  <!-- Progress -->
                  <div class="h-2 rounded-full bg-black/25 overflow-hidden">
                    <div
                      class="h-full bg-primary rounded-full transition-[width] duration-1000 ease-linear"
                      :style="{ width: `${slot.completesAt ? progressPct(slot.startedAt!, slot.completesAt, now) : 0}%` }"
                    />
                  </div>
                </div>

                <div class="p-4 pt-3 shrink-0">
                  <UButton
                    label="Cancel breed"
                    block
                    variant="soft"
                    color="neutral"
                    icon="i-lucide-x"
                    :loading="cancelling.has(slot.id)"
                    @click="doCancel(slot.id)"
                  />
                </div>
              </template>
            </template>

            <!-- ════════ Setup ════════ -->
            <template v-else>
              <div class="flex items-center h-9 px-4 shrink-0 border-b border-default/60">
                <p class="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Breed Setup</p>
              </div>

              <div class="flex-1 flex flex-col gap-3 p-4 min-h-0">
                <!-- Parents — fill the card when empty, compact when picked -->
                <div class="flex items-stretch gap-2" :class="bothPicked(slot.id) ? '' : 'flex-1'">
                  <template v-for="num in [1, 2] as const" :key="num">
                    <div v-if="num === 2" class="flex items-center shrink-0">
                      <div class="size-7 rounded-full bg-elevated border border-default flex items-center justify-center">
                        <UIcon name="i-lucide-plus" class="size-3.5 text-muted" />
                      </div>
                    </div>

                    <div
                      class="relative flex-1 min-h-[6.5rem] rounded-xl border flex flex-col items-center justify-center gap-1.5 text-center transition-all"
                      :class="[
                        getParent(slot.id, num)
                          ? 'border-default bg-background/50'
                          : selectedPlant
                            ? 'border-dashed border-primary/60 bg-primary/5 hover:bg-primary/10 hover:scale-[1.02] cursor-pointer'
                            : 'border-dashed border-default/50',
                      ]"
                      @click="handleParentSlotClick(slot.id, num)"
                    >
                      <template v-if="getParent(slot.id, num)">
                        <button
                          class="absolute top-1.5 right-1.5 size-5 flex items-center justify-center rounded-md bg-black/30 hover:bg-black/60 z-10 text-white/60 hover:text-white transition-colors"
                          @click.stop="clearParent(slot.id, num)"
                        >
                          <UIcon name="i-lucide-x" class="size-3" />
                        </button>
                        <XenoPlantIcon :id="getParent(slot.id, num).typeId" :size="44" />
                        <p class="text-xs font-bold leading-tight px-1 truncate max-w-full">{{ getParent(slot.id, num).name }}</p>
                        <div class="flex items-center gap-1">
                          <XenoLevelBadge prefix="S" :level="getParent(slot.id, num).speed" />
                          <XenoLevelBadge prefix="Y" :level="getParent(slot.id, num).yield" />
                        </div>
                      </template>
                      <template v-else>
                        <UIcon name="i-lucide-plus" class="size-6" :class="selectedPlant ? 'text-primary/70' : 'text-muted/40'" />
                        <p class="text-xs font-medium" :class="selectedPlant ? 'text-primary/80' : 'text-muted/50'">
                          {{ selectedPlant ? 'Assign here' : `Plant ${num}` }}
                        </p>
                      </template>
                    </div>
                  </template>
                </div>

                <!-- ═══ Expected offspring (focal hero) ═══ -->
                <template v-if="bothPicked(slot.id)">
                  <!-- Mutations — a pair can roll into more than one possible offspring -->
                  <div
                    v-for="mutation in mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2))"
                    :key="mutation.offspring"
                    class="relative rounded-xl border overflow-hidden px-3.5 py-3"
                    :class="effectiveMutationChance(slot, mutation) > 0
                      ? 'border-primary/40 bg-gradient-to-br from-primary/12 to-primary/[0.02]'
                      : 'border-error/40 bg-error/[0.06]'"
                  >
                    <div
                      v-if="effectiveMutationChance(slot, mutation) > 0"
                      class="absolute -top-10 -right-8 size-28 rounded-full bg-primary/20 blur-2xl pointer-events-none"
                    />
                    <div class="relative flex items-center justify-between gap-2">
                      <div class="flex items-center gap-3 min-w-0">
                        <XenoPlantIcon :id="getPlant(mutation.offspring)?.id" :size="44" class="shrink-0 drop-shadow" />
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5">
                            <p class="font-black text-base truncate" :class="tierNameColor(getPlant(mutation.offspring)?.tier ?? 1)">{{ getPlant(mutation.offspring)?.name }}</p>
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-inverted leading-none shrink-0">Mutation</span>
                          </div>
                          <p class="text-xs font-bold mt-0.5" :class="tierColor(getPlant(mutation.offspring)?.tier ?? 1)">
                            {{ tierLabel(getPlant(mutation.offspring)?.tier ?? 1) }}
                          </p>
                        </div>
                      </div>
                      <!-- Chance pill -->
                      <div
                        class="text-center shrink-0 rounded-lg border px-2.5 py-1.5"
                        :class="effectiveMutationChance(slot, mutation) > 0
                          ? 'bg-primary/15 border-primary/30'
                          : 'bg-error/10 border-error/30'"
                      >
                        <div class="flex items-baseline gap-1 justify-center">
                          <span
                            v-if="slotMutationBoost(slot) > 0 && effectiveMutationChance(slot, mutation) > 0"
                            class="text-[10px] font-bold text-muted/60 line-through tabular-nums"
                          >{{ Math.round(mutation.chance * 100) }}%</span>
                          <span
                            class="text-xl font-black tabular-nums leading-none"
                            :class="effectiveMutationChance(slot, mutation) > 0 ? 'text-primary' : 'text-error'"
                          >{{ Math.round(effectiveMutationChance(slot, mutation) * 100) }}%</span>
                        </div>
                        <p
                          class="text-[9px] font-bold uppercase tracking-wider mt-0.5"
                          :class="effectiveMutationChance(slot, mutation) > 0 ? 'text-primary/70' : 'text-error/80'"
                        >{{ effectiveMutationChance(slot, mutation) > 0 ? 'chance' : 'needs flask' }}</p>
                      </div>
                    </div>
                  </div>

                  <!-- Standard cross (only when no mutation is possible for this pair) -->
                  <div v-if="mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2)).length === 0" class="rounded-xl border border-default/60 bg-background/40 px-3.5 py-3">
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-3 min-w-0">
                        <div class="size-11 rounded-lg bg-background border border-default/60 flex items-center justify-center shrink-0">
                          <UIcon name="i-lucide-sparkles" class="size-5 text-muted/60" />
                        </div>
                        <div class="min-w-0">
                          <p class="text-sm font-bold">Standard cross</p>
                          <p class="text-[11px] text-muted mt-0.5">Inherits a 50/50 parent stat mix</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- ═══ Breed-time bar (shows artifact speed-up) ═══ -->
                  <div>
                    <div class="flex items-center justify-between mb-1.5">
                      <span class="text-[10px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                        <UIcon name="i-lucide-clock" class="size-3.5" /> Breed time
                      </span>
                      <div class="flex items-baseline gap-1.5">
                        <span class="text-sm font-bold tabular-nums">{{ formatDuration(Math.round(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2)) * (1 - slotBreederSpeedBoost(slot)))) }}</span>
                        <span v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] text-muted/50 line-through tabular-nums">{{ formatDuration(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2))) }}</span>
                      </div>
                    </div>
                    <div class="h-2 rounded-full bg-black/25 overflow-hidden flex">
                      <div class="h-full bg-primary transition-[width] duration-300" :style="{ width: `${(1 - slotBreederSpeedBoost(slot)) * 100}%` }" />
                      <div v-if="slotBreederSpeedBoost(slot) > 0" class="h-full bg-primary/25 transition-[width] duration-300" :style="{ width: `${slotBreederSpeedBoost(slot) * 100}%` }" />
                    </div>
                    <div class="flex justify-between">
                      <p class="text-sm font-semibold text-muted">
                        +{{ 1 + slotExtraYield(slot) }}
                      </p>
                      <p v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] font-bold text-primary text-right mt-1">
                        ⚡ saves {{ formatDuration(Math.round(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2)) * slotBreederSpeedBoost(slot))) }}
                      </p>
                    </div>
                  </div>
                </template>

                <!-- ═══ Artifact slot (docked to bottom) ═══ -->
                <div class="mt-auto">
                  <div
                    v-if="slot.artifact"
                    class="flex items-center gap-2 h-11 rounded-xl border border-primary/30 bg-primary/5 px-3"
                  >
                    <span class="text-base leading-none shrink-0">{{ getArtifact(slot.artifact.typeId)?.emoji }}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-semibold truncate">{{ getArtifact(slot.artifact.typeId)?.name }}</p>
                      <p class="text-[10px] text-muted leading-none mt-0.5">{{ slot.artifact.chargesRemaining }}× charges</p>
                    </div>
                    <button class="size-5 flex items-center justify-center rounded-md text-muted hover:text-default hover:bg-black/20 shrink-0 transition-colors" @click="removeBreederArtifact(slot.id)">
                      <UIcon name="i-lucide-x" class="size-3.5" />
                    </button>
                  </div>
                  <div
                    v-else
                    class="flex items-center gap-2 h-11 rounded-xl border border-dashed px-3 transition-colors"
                    :class="selectedArtifact
                      ? 'border-primary/60 bg-primary/5 hover:bg-primary/10 cursor-pointer'
                      : 'border-default/40'"
                    :style="attachingSlot === slot.id ? 'opacity: 0.5; pointer-events: none' : ''"
                    @click="handleArtifactSlotClick(slot.id)"
                  >
                    <UIcon
                      name="i-lucide-flask-conical"
                      class="size-4 shrink-0"
                      :class="selectedArtifact ? 'text-primary' : 'text-muted/40'"
                    />
                    <span class="text-xs" :class="selectedArtifact ? 'text-primary/80 font-medium' : 'text-muted/50'">
                      {{ selectedArtifact ? 'Attach artifact here' : 'Add artifact (optional)' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="p-4 pt-0 shrink-0">
                <UButton
                  label="Start Breeding"
                  icon="i-lucide-dna"
                  block
                  size="lg"
                  :disabled="!bothPicked(slot.id)"
                  :loading="starting.has(slot.id)"
                  @click="doStart(slot)"
                />
              </div>
            </template>
          </div>

          <!-- ── Unlock slot ── -->
          <div
            v-if="state.breeder.unlockedCount < state.breeder.maxSlots"
            class="rounded-2xl border border-dashed border-default bg-elevated/40 h-[28rem] flex flex-col items-center justify-center gap-3 p-4"
          >
            <div class="size-12 rounded-full bg-elevated border border-default flex items-center justify-center">
              <UIcon name="i-lucide-lock" class="size-5 text-muted" />
            </div>
            <div class="text-center">
              <p class="text-sm font-semibold">New Breeder Slot</p>
              <p class="text-xs text-muted mt-0.5">${{ formatNumber(state.breeder.nextSlotCost, false) }}</p>
            </div>
            <UButton
              label="Unlock"
              size="sm"
              variant="soft"
              color="neutral"
              :loading="unlocking"
              :disabled="balance < state.breeder.nextSlotCost"
              @click="async () => { unlocking = true; try { await unlockBreederSlot() } finally { unlocking = false } }"
            />
          </div>
        </div>
      </div>

    </div>

    <!-- ── Right inventory sidebar (lg+) ────────────────────────────── -->
    <USidebar
      collapsible="none"
      side="right"
      class="hidden lg:flex w-[26rem] border-l border-default"
    >
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="breedableInventory"
          :free-artifacts="breederFreeArtifacts"
          :selected-plant-key="selectedPlant ? `${selectedPlant.typeId}:${selectedPlant.speed}:${selectedPlant.yield}` : null"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="onSelectPlant"
          @select-artifact="onSelectArtifact"
        />
      </div>
    </USidebar>
  </div>

  <!-- Mobile inventory slideover -->
  <USlideover v-model:open="mobileInventoryOpen" title="Inventory" side="right" class="lg:hidden">
    <template #body>
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="breedableInventory"
          :free-artifacts="breederFreeArtifacts"
          :selected-plant-key="selectedPlant ? `${selectedPlant.typeId}:${selectedPlant.speed}:${selectedPlant.yield}` : null"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="(p) => { onSelectPlant(p); mobileInventoryOpen = false }"
          @select-artifact="(a) => { onSelectArtifact(a); mobileInventoryOpen = false }"
        />
      </div>
    </template>
  </USlideover>
</template>
