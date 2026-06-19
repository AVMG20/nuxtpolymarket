<script setup lang="ts">
import {
  tierLabel, tierColor, tierNameColor, levelTextColor, getPlant, getArtifact, getEffectValue,
  getMutation, breedDuration,
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
function mutationForParents(p1: any, p2: any) {
  if (!p1 || !p2) return null
  return getMutation(p1.typeId, p2.typeId)
}

function mutationPlantFor(p1: any, p2: any) {
  const m = mutationForParents(p1, p2)
  return m ? getPlant(m.offspring) : null
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
  return art ? getEffectValue(art, 'breeder_speed_boost') : 0
}

function slotMutationBoost(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValue(art, 'breeder_mutation_boost') : 0
}

function breedDurationSecs(slot: any): number {
  if (!slot.completesAt || !slot.startedAt) return 0
  const end = Number(slot.completesAt)
  const start = Number(new Date(slot.startedAt))
  const secs = Math.round((end - start) / 1000)
  return Number.isFinite(secs) && secs > 0 ? secs : 0
}

function effectiveMutationChance(slot: any, p1: any, p2: any): number {
  const m = mutationForParents(p1, p2)
  if (!m) return 0
  return Math.max(0, Math.min(1, m.chance + slotMutationBoost(slot)))
}

function slotExtraYield(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValue(art, 'breeder_extra_yield') : 0
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
          <!-- ── Breeder slots ── -->
          <div
            v-for="slot in breederSlots"
            :key="slot.id"
            class="rounded-2xl border border-default bg-elevated flex flex-col overflow-hidden h-[28rem]"
          >
            <!-- ════════ Active breeding ════════ -->
            <template v-if="slot.startedAt && !slot.collected">

              <!-- ──── Result reveal ──── -->
              <template v-if="slot.completesAt && isDone(slot.completesAt) && slot.resultTypeId">
                <!-- Status banner (fixed height) -->
                <div
                  class="flex items-center justify-center gap-1.5 h-9 shrink-0"
                  :class="slot.wasMutation ? 'bg-primary/15 border-b border-primary/20' : 'bg-elevated border-b border-default'"
                >
                  <template v-if="slot.wasMutation">
                    <span class="text-xs animate-bounce">✨</span>
                    <p class="text-[10px] font-black text-primary uppercase tracking-[0.25em]">Mutation</p>
                    <span class="text-xs animate-bounce">✨</span>
                  </template>
                  <p v-else class="text-[10px] font-black text-muted uppercase tracking-[0.25em]">Harvest ready</p>
                </div>

                <!-- Reveal body -->
                <div class="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center min-h-0">
                  <span class="text-6xl leading-none select-none">{{ getPlant(slot.resultTypeId)?.emoji }}</span>
                  <div class="leading-tight">
                    <p class="text-lg font-black tracking-tight" :class="tierNameColor(getPlant(slot.resultTypeId)?.tier ?? 1)">
                      {{ getPlant(slot.resultTypeId)?.name }}<sup class="text-xs font-semibold ml-0.5 opacity-70">×{{ slot.resultQuantity }}</sup>
                    </p>
                    <span class="text-xs font-bold" :class="tierColor(getPlant(slot.resultTypeId)?.tier ?? 1)">
                      {{ tierLabel(getPlant(slot.resultTypeId)?.tier ?? 1) }}
                    </span>
                  </div>
                  <div class="flex items-stretch gap-4">
                    <div class="flex flex-col items-center gap-0.5">
                      <p class="text-[10px] font-bold uppercase tracking-widest text-muted">Speed</p>
                      <p class="text-2xl font-black leading-none" :class="levelTextColor(slot.resultSpeed ?? 0)">{{ slot.resultSpeed }}</p>
                    </div>
                    <div class="border-r border-default" />
                    <div class="flex flex-col items-center gap-0.5">
                      <p class="text-[10px] font-bold uppercase tracking-widest text-muted">Yield</p>
                      <p class="text-2xl font-black leading-none" :class="levelTextColor(slot.resultYield ?? 0)">{{ slot.resultYield }}</p>
                    </div>
                  </div>
                  <p v-if="breedDurationSecs(slot) > 0" class="text-xs text-muted">Took {{ formatDuration(breedDurationSecs(slot)) }}</p>
                </div>

                <!-- Footer -->
                <div class="p-4 shrink-0">
                  <UButton
                    :label="slot.wasMutation ? '✨ Collect Mutation' : 'Collect'"
                    block
                    color="primary"
                    :loading="collecting.has(slot.id)"
                    @click="doCollect(slot.id)"
                  />
                </div>
              </template>

              <!-- ──── In progress ──── -->
              <template v-else>
                <!-- Status header (fixed height) -->
                <div class="flex items-center justify-between h-9 px-4 shrink-0 border-b border-default/60">
                  <div class="flex items-center gap-2">
                    <span class="relative flex size-2">
                      <span class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                      <span class="relative inline-flex size-2 rounded-full bg-primary" />
                    </span>
                    <p class="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Breeding</p>
                  </div>
                  <span v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded leading-none">
                    ⚡ −{{ Math.round(slotBreederSpeedBoost(slot) * 100) }}%
                  </span>
                </div>

                <!-- Body -->
                <div class="flex-1 flex flex-col justify-center gap-5 p-4 min-h-0">
                  <!-- Parents -->
                  <div class="flex items-center gap-2">
                    <div
                      v-for="(parent, i) in [slot.parent1, slot.parent2]"
                      :key="i"
                      class="flex-1 flex flex-col items-center gap-1.5 rounded-xl bg-background/40 border border-default/50 h-28 justify-center"
                    >
                      <span class="text-3xl leading-none">{{ parent ? getPlant(parent.typeId)?.emoji : '?' }}</span>
                      <p class="text-xs font-bold leading-tight text-center px-1">{{ parent ? getPlant(parent.typeId)?.name : '?' }}</p>
                      <div v-if="parent" class="flex items-center gap-1">
                        <XenoLevelBadge prefix="S" :level="parent.speed ?? 0" />
                        <XenoLevelBadge prefix="Y" :level="parent.yield ?? 0" />
                      </div>
                    </div>
                  </div>

                  <!-- Progress -->
                  <div class="space-y-2">
                    <div class="flex items-center justify-between text-xs">
                      <span class="font-semibold tabular-nums">{{ slot.completesAt ? formatCountdown(slot.completesAt, now) : '…' }}</span>
                      <span class="text-muted tabular-nums">{{ slot.completesAt ? Math.round(progressPct(slot.startedAt!, slot.completesAt, now)) : 0 }}%</span>
                    </div>
                    <div class="h-2 rounded-full bg-black/20 overflow-hidden">
                      <div
                        class="h-full bg-primary rounded-full transition-[width] duration-1000 ease-linear"
                        :style="{ width: `${slot.completesAt ? progressPct(slot.startedAt!, slot.completesAt, now) : 0}%` }"
                      />
                    </div>
                  </div>
                </div>

                <!-- Footer -->
                <div class="p-4 shrink-0">
                  <UButton
                    label="Cancel"
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
              <!-- Header (fixed height) -->
              <div class="flex items-center h-9 px-4 shrink-0 border-b border-default/60">
                <p class="text-[10px] font-black text-muted uppercase tracking-[0.2em]">Breed Setup</p>
              </div>

              <!-- Body -->
              <div class="flex-1 flex flex-col gap-3 p-4 min-h-0">
                <!-- Parent pickers -->
                <div class="flex items-stretch gap-2">
                  <div
                    v-for="num in [1, 2] as const"
                    :key="num"
                    class="relative flex-1 h-28 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-center transition-colors"
                    :class="[
                      getParent(slot.id, num)
                        ? 'border-default bg-background/50'
                        : selectedPlant
                          ? 'border-dashed border-primary/60 bg-primary/5 hover:bg-primary/10 cursor-pointer'
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
                      <span class="text-3xl leading-none">{{ getParent(slot.id, num).emoji }}</span>
                      <p class="text-xs font-bold leading-tight px-1">{{ getParent(slot.id, num).name }}</p>
                      <div class="flex items-center gap-1">
                        <XenoLevelBadge prefix="S" :level="getParent(slot.id, num).speed" />
                        <XenoLevelBadge prefix="Y" :level="getParent(slot.id, num).yield" />
                      </div>
                    </template>
                    <template v-else>
                      <UIcon name="i-lucide-plus" class="size-5" :class="selectedPlant ? 'text-primary/70' : 'text-muted/40'" />
                      <p class="text-xs" :class="selectedPlant ? 'text-primary/80' : 'text-muted/50'">
                        {{ selectedPlant ? 'Assign here' : `Plant ${num}` }}
                      </p>
                    </template>
                  </div>
                </div>

                <!-- Outcome panel — always present so the card never resizes -->
                <div class="flex-1 min-h-0 rounded-xl border border-default/50 bg-background/30 px-3 py-3 flex flex-col justify-center">
                  <template v-if="getParent(slot.id, 1) && getParent(slot.id, 2)">
                    <!-- Mutation -->
                    <template v-if="mutationForParents(getParent(slot.id, 1), getParent(slot.id, 2))">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <span class="text-3xl leading-none shrink-0">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.emoji }}</span>
                          <div class="min-w-0">
                            <div class="flex items-center gap-1.5">
                              <p class="font-bold text-sm truncate">{{ mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.name }}</p>
                              <span class="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded leading-none shrink-0 bg-primary/10 text-primary">Mutation</span>
                            </div>
                            <span class="text-xs font-bold" :class="tierColor(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1)">
                              {{ tierLabel(mutationPlantFor(getParent(slot.id, 1), getParent(slot.id, 2))?.tier ?? 1) }}
                            </span>
                          </div>
                        </div>
                        <!-- Chance -->
                        <div class="text-right shrink-0">
                          <template v-if="effectiveMutationChance(slot, getParent(slot.id, 1), getParent(slot.id, 2)) === 0">
                            <p class="text-sm font-black text-error leading-none">0%</p>
                            <p class="text-[10px] text-error/80 mt-0.5">needs artifact</p>
                          </template>
                          <template v-else>
                            <div class="flex items-baseline gap-1 justify-end">
                              <span
                                v-if="slotMutationBoost(slot) > 0"
                                class="text-[10px] font-bold text-muted/60 line-through tabular-nums"
                              >{{ Math.round(mutationForParents(getParent(slot.id, 1), getParent(slot.id, 2))!.chance * 100) }}%</span>
                              <span class="text-lg font-black text-primary tabular-nums leading-none">
                                {{ Math.round(effectiveMutationChance(slot, getParent(slot.id, 1), getParent(slot.id, 2)) * 100) }}%
                              </span>
                            </div>
                            <p v-if="slotMutationBoost(slot) > 0" class="text-[10px] font-bold text-primary mt-0.5">🧬 +{{ Math.round(slotMutationBoost(slot) * 100) }}%</p>
                          </template>
                        </div>
                      </div>
                    </template>

                    <!-- Standard cross -->
                    <div v-else class="flex items-center gap-2.5">
                      <UIcon name="i-lucide-sparkles" class="size-5 text-muted/50 shrink-0" />
                      <p class="text-xs text-muted">Standard cross — offspring inherits a 50/50 mix of parent stats.</p>
                    </div>

                    <!-- Breed time + yield -->
                    <div class="border-t border-default/50 mt-3 pt-3 grid grid-cols-2 gap-2">
                      <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Breed time</p>
                        <div class="flex items-baseline gap-1.5">
                          <span class="text-sm font-semibold tabular-nums">{{ formatDuration(Math.round(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2)) * (1 - slotBreederSpeedBoost(slot)))) }}</span>
                          <span v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] text-muted/60 line-through tabular-nums">
                            {{ formatDuration(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2))) }}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p class="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Result qty</p>
                        <div class="flex items-baseline gap-1.5">
                          <span class="text-sm font-semibold tabular-nums">×{{ 1 + slotExtraYield(slot) }}</span>
                          <span v-if="slotExtraYield(slot) > 0" class="text-[10px] font-bold text-primary">+{{ slotExtraYield(slot) }}</span>
                        </div>
                      </div>
                    </div>
                  </template>

                  <!-- Empty hint -->
                  <div v-else class="text-center">
                    <UIcon name="i-lucide-flask-conical" class="size-6 text-muted/25 mx-auto mb-1.5" />
                    <p class="text-xs text-muted/60">Pick two plants to preview the outcome.</p>
                  </div>
                </div>

                <!-- Artifact row (fixed height) -->
                <div class="shrink-0">
                  <div
                    v-if="slot.artifact"
                    class="flex items-center gap-2 h-11 rounded-xl border border-default/50 bg-background/40 px-3"
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
                      {{ selectedArtifact ? 'Attach artifact here' : 'No artifact' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Footer -->
              <div class="p-4 pt-0 shrink-0">
                <UButton
                  label="Start Breeding"
                  icon="i-lucide-dna"
                  block
                  :disabled="!getParent(slot.id, 1) || !getParent(slot.id, 2)"
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
          :inventory="inventory"
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
          :inventory="inventory"
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
