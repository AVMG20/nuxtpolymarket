<script setup lang="ts">
import {
  tierLabel, tierColor, tierNameColor, levelTextColor, getPlant, getArtifact, getEffectValueFor,
  getMutationPair, breedDuration, xenoMutationBoost,
} from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone, formatDuration } from '~/lib/xeno-format'

const {
  state, refresh, breederSlots, inventory, freeArtifacts, upgrades,
  unlockBreederSlot, startBreed, cancelBreed, collectBreed,
  attachBreederArtifact, removeBreederArtifact,
} = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
})

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

// Hybrids can't be bred — hide them from breeder parent selection.
const breedableInventory = computed(() => (inventory.value as any[]).filter(i => !i.isHybrid))

const breederFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => getArtifact(a.typeId)?.effects.some(e => e.type.startsWith('breeder_'))),
)

// ── Selection state (sidebar-driven) ─────────────────────────────────────────
const mobileInventoryOpen = ref(false)

const selectedPlant = ref<{ typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null>(null)
const selectedArtifact = ref<{ id: string; typeId: string; chargesRemaining: number } | null>(null)

watch(inventory, (inv) => {
  if (!selectedPlant.value) return
  const { typeId, speed, yield: yld } = selectedPlant.value
  if (!(inv as any[]).find(i => i.typeId === typeId && i.speed === speed && i.yield === yld)) selectedPlant.value = null
})
watch(breederFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!(arts as any[]).find(a => a.id === selectedArtifact.value?.id)) {
    const next = (arts as any[]).find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining } : null
  }
})

function onSelectPlant(p: any) { selectedPlant.value = p; if (p) selectedArtifact.value = null; sound.play(p ? 'select' : 'deselect') }
function onSelectArtifact(a: any) { selectedArtifact.value = a; if (a) selectedPlant.value = null; sound.play(a ? 'select' : 'deselect') }

// ── Per-pod parent staging ───────────────────────────────────────────────────
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
  sound.play('remove')
}
function swapParents(slotId: string) {
  const p = getSlotParents(slotId)
  const t = p.p1
  p.p1 = p.p2
  p.p2 = t
  sound.play('select')
}

/** Picking the same single-quantity stack for both parents can't work — the breed would need two. */
function stackQty(p: any): number {
  if (!p) return 0
  return (inventory.value as any[]).find(i => i.typeId === p.typeId && i.speed === p.speed && i.yield === p.yield)?.quantity ?? 0
}
function sameStack(a: any, b: any) {
  return !!a && !!b && a.typeId === b.typeId && a.speed === b.speed && a.yield === b.yield
}
function pairBlocked(slotId: string): string | null {
  const p1 = getParent(slotId, 1)
  const p2 = getParent(slotId, 2)
  if (!p1 || !p2) return null
  if (sameStack(p1, p2) && stackQty(p1) < 2) return 'You need two of this stack to breed it with itself'
  return null
}

function handleParentSlotClick(slotId: string, num: 1 | 2) {
  if (!selectedPlant.value) return
  const parents = getSlotParents(slotId)
  if (num === 1) parents.p1 = selectedPlant.value
  else parents.p2 = selectedPlant.value
  sound.play('plant')
}

const attachingSlot = ref<string | null>(null)
async function handleArtifactSlotClick(slotId: string) {
  if (!selectedArtifact.value || attachingSlot.value) return
  attachingSlot.value = slotId
  try {
    await attachBreederArtifact(slotId, selectedArtifact.value.id)
    sound.play('attach')
  } catch { sound.play('error') } finally { attachingSlot.value = null }
}
async function doRemoveArtifact(slotId: string) {
  try {
    await removeBreederArtifact(slotId)
    sound.play('remove')
  } catch { sound.play('error') }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
  const globalBoost = xenoMutationBoost(upgrades.value.mutation)
  if (!slot.artifact) return globalBoost
  const art = getArtifact(slot.artifact.typeId)
  return globalBoost + (art ? getEffectValueFor(art, 'breeder_mutation_boost', slot.artifact.gemCrafted) : 0)
}
function effectiveMutationChance(slot: any, mutation: { chance: number }): number {
  return Math.max(0, Math.min(1, mutation.chance + slotMutationBoost(slot)))
}
function slotExtraYield(slot: any): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValueFor(art, 'breeder_extra_yield', slot.artifact.gemCrafted) : 0
}
function effectiveBreedSecs(slot: any): number {
  return Math.round(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2)) * (1 - slotBreederSpeedBoost(slot)) * (1 - (upgrades.value.speed * 0.05)))
}

type PodState = 'idle' | 'breeding' | 'ready' | 'mutation'
function podState(slot: any): PodState {
  void now.value
  if (!slot.startedAt || slot.collected) return 'idle'
  if (slot.completesAt && isDone(slot.completesAt) && slot.resultTypeId) return slot.wasMutation ? 'mutation' : 'ready'
  return 'breeding'
}
function podPct(slot: any): number {
  if (!slot.startedAt || !slot.completesAt) return 0
  return progressPct(slot.startedAt, slot.completesAt, now.value)
}
const podLabel: Record<PodState, string> = { idle: 'Dormant', breeding: 'Incubating', ready: 'Specimen ready', mutation: 'Mutation detected' }

/** Locked-in parent of an active breed (typed loosely — the slot shape is the API's). */
function parentOf(slot: any, num: 1 | 2): any {
  return num === 1 ? slot.parent1 : slot.parent2
}

function socketClass(slot: any, num: 1 | 2): string {
  if (podState(slot) !== 'idle') return 'xeno-socket-filled opacity-90'
  if (getParent(slot.id, num)) return 'xeno-socket-filled'
  return selectedPlant.value ? 'xeno-socket-open cursor-pointer' : 'border-dashed'
}

// The result is withheld by the server until the timer is really up, so the
// slot data needs one more fetch the moment the countdown hits zero — without
// it the pod would sit on "Ready!" with nothing to collect until a reload.
const refreshedFor = new Set<string>()
watch(now, () => {
  for (const s of breederSlots.value as any[]) {
    if (!s.startedAt || s.collected || s.resultTypeId || !s.completesAt) continue
    const key = `${s.id}:${s.startedAt}`
    if (isDone(s.completesAt) && !refreshedFor.has(key)) {
      refreshedFor.add(key)
      void refresh()
    }
  }
})

// Fanfare the first time a finished breed is seen on screen — but not for
// results that were already waiting when the page loaded.
const seenResults = new Set<string>()
let seededResults = false
watch(() => (breederSlots.value as any[]).map(s => `${s.id}:${s.startedAt}:${podState(s)}`).join(','), () => {
  for (const s of breederSlots.value as any[]) {
    const st = podState(s)
    if (st !== 'ready' && st !== 'mutation') continue
    const key = `${s.id}:${s.startedAt}`
    if (seenResults.has(key)) continue
    seenResults.add(key)
    if (seededResults) sound.play(st === 'mutation' ? 'mutation' : 'ready')
  }
  if (state.value) seededResults = true
}, { immediate: true })

// ── Actions ───────────────────────────────────────────────────────────────────
const starting = ref(new Set<string>())
const cancelling = ref(new Set<string>())
const collecting = ref(new Set<string>())
const unlocking = ref(false)

async function doCancel(slotId: string) {
  cancelling.value.add(slotId)
  try {
    await cancelBreed(slotId)
    sound.play('remove')
  } catch { sound.play('error') } finally { cancelling.value.delete(slotId) }
}

async function doStart(slot: any) {
  const p1 = getParent(slot.id, 1)
  const p2 = getParent(slot.id, 2)
  if (!p1 || !p2 || pairBlocked(slot.id)) return
  starting.value.add(slot.id)
  try {
    await startBreed(slot.id, p1.typeId, p1.speed, p1.yield, p2.typeId, p2.speed, p2.yield)
    slotParents.value[slot.id] = { p1: null, p2: null }
    sound.play('breed-start')
    const c = fx.centerOf(document.querySelector(`[data-pod="${slot.id}"]`))
    if (c) fx.burst(c.x, c.y, { count: 10, spread: 50 })
  } catch { sound.play('error') } finally { starting.value.delete(slot.id) }
}

async function doCollect(slot: any) {
  collecting.value.add(slot.id)
  const c = fx.centerOf(document.querySelector(`[data-pod="${slot.id}"]`))
  const resultTypeId = slot.resultTypeId
  const qty = slot.resultQuantity ?? 1
  try {
    await collectBreed(slot.id)
    sound.play('collect')
    if (c) {
      fx.burst(c.x, c.y, { plantId: resultTypeId, count: 14, spread: 90 })
      fx.float(c.x, c.y - 30, qty, { plantId: resultTypeId })
    }
  } catch { sound.play('error') } finally { collecting.value.delete(slot.id) }
}

async function doUnlock() {
  unlocking.value = true
  try {
    await unlockBreederSlot()
    sound.play('unlock')
  } catch { sound.play('error') } finally { unlocking.value = false }
}

const selectedKey = computed(() => selectedPlant.value ? `${selectedPlant.value.typeId}:${selectedPlant.value.speed}:${selectedPlant.value.yield}` : null)
</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Main content ──────────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-4 md:p-6">

        <!-- Header -->
        <div class="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 class="text-2xl font-black tracking-tight">Breeder</h1>
            <p class="text-xs text-muted mt-0.5">Splice two specimens into one. Rare pairs mutate into new species.</p>
          </div>
          <UButton icon="i-lucide-package" label="Specimens" variant="soft" color="neutral" size="sm" class="lg:hidden" @click="mobileInventoryOpen = true" />
        </div>

        <div v-if="!state" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <USkeleton v-for="i in 2" :key="i" class="h-[30rem] rounded-2xl" />
        </div>

        <div v-else class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <!-- ═══════════ Pods ═══════════ -->
          <div
            v-for="(slot, idx) in breederSlots"
            :key="slot.id"
            class="xeno-pod-card flex flex-col min-h-[30rem]"
            :data-state="podState(slot)"
          >
            <XenoConfetti v-if="podState(slot) === 'mutation'" />

            <!-- Pod header -->
            <div class="flex items-center justify-between h-10 px-4 shrink-0 border-b border-default/50 relative z-10">
              <div class="flex items-center gap-2">
                <span class="xeno-eyebrow">Pod {{ String(idx + 1).padStart(2, '0') }}</span>
                <span class="h-3 w-px bg-default/60" />
                <span class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
                  :class="podState(slot) === 'mutation' ? 'text-secondary' : podState(slot) === 'idle' ? 'text-muted' : 'text-primary'">
                  <span v-if="podState(slot) === 'breeding'" class="relative flex size-2">
                    <span class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
                    <span class="relative inline-flex size-2 rounded-full bg-primary" />
                  </span>
                  <UIcon v-else-if="podState(slot) === 'mutation'" name="i-lucide-sparkles" class="size-3.5 animate-bounce" />
                  {{ podLabel[podState(slot)] }}
                </span>
              </div>
              <div class="flex items-center gap-1.5">
                <span v-if="slotBreederSpeedBoost(slot) > 0" class="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded leading-none">⚡ −{{ Math.round(slotBreederSpeedBoost(slot) * 100) }}%</span>
                <span v-if="slotExtraYield(slot) > 0" class="text-[10px] font-bold text-info bg-info/10 px-1.5 py-0.5 rounded leading-none">+{{ slotExtraYield(slot) }} litter</span>
              </div>
            </div>

            <!-- ════════ Pod stage ════════ -->
            <div class="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-4">
              <!-- Parent sockets (pod sits between them via CSS order) -->
              <div
                v-for="num in [1, 2] as const"
                :key="num"
                class="xeno-socket flex flex-col items-center justify-center gap-1 text-center min-h-[6.5rem] px-1 py-2"
                :class="[num === 2 ? 'order-3' : 'order-1', socketClass(slot, num)]"
                @click="podState(slot) === 'idle' && handleParentSlotClick(slot.id, num)"
              >
                <!-- Active breed: locked-in parent -->
                <template v-if="podState(slot) !== 'idle'">
                  <XenoPlantIcon v-if="parentOf(slot, num)" :id="parentOf(slot, num).typeId" :size="40" class="opacity-90" />
                  <p class="text-[11px] font-bold leading-tight truncate max-w-full px-1">{{ parentOf(slot, num) ? getPlant(parentOf(slot, num).typeId)?.name : '?' }}</p>
                  <div v-if="parentOf(slot, num)" class="flex items-center gap-1">
                    <XenoLevelBadge prefix="S" :level="parentOf(slot, num).speed" />
                    <XenoLevelBadge prefix="Y" :level="parentOf(slot, num).yield" />
                  </div>
                </template>
                <!-- Setup: staged parent -->
                <template v-else-if="getParent(slot.id, num)">
                  <button
                    class="absolute top-1 right-1 size-5 flex items-center justify-center rounded-md bg-black/30 hover:bg-error z-10 text-white/60 hover:text-white transition-colors"
                    @click.stop="clearParent(slot.id, num)"
                  >
                    <UIcon name="i-lucide-x" class="size-3" />
                  </button>
                  <XenoPlantIcon :id="getParent(slot.id, num).typeId" :size="44" class="xeno-pop-in" />
                  <p class="text-xs font-bold leading-tight truncate max-w-full px-1" :class="tierNameColor(getParent(slot.id, num).tier)">{{ getParent(slot.id, num).name }}</p>
                  <div class="flex items-center gap-1">
                    <XenoLevelBadge prefix="S" :level="getParent(slot.id, num).speed" />
                    <XenoLevelBadge prefix="Y" :level="getParent(slot.id, num).yield" />
                  </div>
                </template>
                <template v-else>
                  <UIcon name="i-lucide-circle-plus" class="size-6" :class="selectedPlant ? 'text-primary' : 'text-muted/40'" />
                  <p class="text-[11px] font-semibold" :class="selectedPlant ? 'text-primary' : 'text-muted/50'">
                    {{ selectedPlant ? 'Insert here' : `Specimen ${num}` }}
                  </p>
                </template>
              </div>

              <!-- Pod -->
              <div class="order-2 relative w-32 sm:w-36" :data-pod="slot.id">
                <!-- tubes -->
                <div class="absolute top-1/2 -left-3 w-3 h-1 bg-gradient-to-r from-transparent to-primary/40 rounded" />
                <div class="absolute top-1/2 -right-3 w-3 h-1 bg-gradient-to-l from-transparent to-primary/40 rounded" />
                <XenoIncubatorPod :pct="podPct(slot)" :state="podState(slot)" class="h-48 sm:h-52 w-full">
                  <!-- Ready -->
                  <div v-if="podState(slot) === 'ready' || podState(slot) === 'mutation'" class="xeno-reveal flex flex-col items-center -mt-2">
                    <XenoPlantIcon :id="slot.resultTypeId" :size="64" class="xeno-ready-bounce drop-shadow-lg" />
                  </div>
                  <!-- Breeding -->
                  <div v-else-if="podState(slot) === 'breeding'" class="flex flex-col items-center gap-1 -mt-3">
                    <XenoDnaHelix :width="96" :height="40" />
                    <p class="text-lg font-black tabular-nums leading-none drop-shadow">{{ slot.completesAt ? formatCountdown(slot.completesAt, now) : '…' }}</p>
                  </div>
                  <!-- Setup: preview -->
                  <div v-else class="flex flex-col items-center -mt-2">
                    <template v-if="bothPicked(slot.id) && mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2)).length">
                      <div class="relative">
                        <XenoPlantIcon :id="mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2))[0]!.offspring" :size="52" class="opacity-50 xeno-sway" />
                        <span class="absolute -bottom-1 -right-1 size-5 rounded-full bg-background border border-primary/50 text-primary text-xs font-black flex items-center justify-center">?</span>
                      </div>
                    </template>
                    <template v-else-if="bothPicked(slot.id)">
                      <XenoDnaHelix :width="80" :height="36" class="opacity-50" />
                    </template>
                    <template v-else>
                      <span class="text-3xl opacity-25 select-none">🧬</span>
                    </template>
                  </div>
                </XenoIncubatorPod>
              </div>
            </div>

            <!-- ════════ Lower panel ════════ -->
            <div class="relative z-10 flex-1 flex flex-col gap-3 p-4 min-h-0">

              <!-- Result -->
              <template v-if="podState(slot) === 'ready' || podState(slot) === 'mutation'">
                <div class="xeno-reveal text-center">
                  <p v-if="podState(slot) === 'mutation'" class="xeno-eyebrow text-secondary">✨ New species discovered ✨</p>
                  <p class="text-xl font-black tracking-tight mt-1" :class="tierNameColor(getPlant(slot.resultTypeId ?? '')?.tier ?? 1)">
                    {{ getPlant(slot.resultTypeId ?? '')?.name }}<span class="text-sm font-bold ml-1 opacity-70">×{{ slot.resultQuantity }}</span>
                  </p>
                  <span class="text-xs font-bold" :class="tierColor(getPlant(slot.resultTypeId ?? '')?.tier ?? 1)">{{ tierLabel(getPlant(slot.resultTypeId ?? '')?.tier ?? 1) }}</span>
                  <div class="flex items-stretch justify-center gap-3 mt-3">
                    <div class="flex flex-col items-center rounded-xl bg-background/50 border border-default/50 px-5 py-2">
                      <p class="text-[9px] font-bold uppercase tracking-widest text-muted">Speed</p>
                      <p class="text-2xl font-black leading-none" :class="levelTextColor(slot.resultSpeed ?? 0)">{{ slot.resultSpeed }}</p>
                    </div>
                    <div class="flex flex-col items-center rounded-xl bg-background/50 border border-default/50 px-5 py-2">
                      <p class="text-[9px] font-bold uppercase tracking-widest text-muted">Yield</p>
                      <p class="text-2xl font-black leading-none" :class="levelTextColor(slot.resultYield ?? 0)">{{ slot.resultYield }}</p>
                    </div>
                  </div>
                </div>
                <div class="mt-auto">
                  <UButton
                    :label="podState(slot) === 'mutation' ? 'Collect mutation' : 'Collect specimen'"
                    :icon="podState(slot) === 'mutation' ? 'i-lucide-sparkles' : 'i-lucide-package-check'"
                    block size="lg" color="primary"
                    class="xeno-cta-pulse"
                    :loading="collecting.has(slot.id)"
                    @click="doCollect(slot)"
                  />
                </div>
              </template>

              <!-- Breeding -->
              <template v-else-if="podState(slot) === 'breeding'">
                <div class="flex-1 flex flex-col justify-center gap-2">
                  <div v-if="mutationsForParents(slot.parent1, slot.parent2).length" class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span>Possible mutation:</span>
                    <span v-for="m in mutationsForParents(slot.parent1, slot.parent2)" :key="m.offspring" class="inline-flex items-center gap-1 rounded-md border border-default/60 bg-background/40 px-1.5 py-0.5">
                      <XenoPlantIcon :id="m.offspring" :size="14" />
                      <span class="font-semibold text-default">{{ getPlant(m.offspring)?.name }}</span>
                      <span :class="effectiveMutationChance(slot, m) > 0 ? 'text-primary font-bold' : 'text-error'">{{ Math.round(effectiveMutationChance(slot, m) * 100) }}%</span>
                    </span>
                  </div>
                </div>
                <UButton label="Abort & return parents" block variant="soft" color="neutral" icon="i-lucide-x" :loading="cancelling.has(slot.id)" @click="doCancel(slot.id)" />
              </template>

              <!-- Setup -->
              <template v-else>
                <div v-if="bothPicked(slot.id)" class="xeno-stagger space-y-2">
                  <!-- Swap -->
                  <div class="flex justify-center -mt-2">
                    <button class="text-[10px] font-semibold text-muted hover:text-primary flex items-center gap-1 transition-colors" @click="swapParents(slot.id)">
                      <UIcon name="i-lucide-arrow-left-right" class="size-3" /> swap
                    </button>
                  </div>

                  <!-- Mutations -->
                  <div
                    v-for="mutation in mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2))"
                    :key="mutation.offspring"
                    class="relative rounded-xl border overflow-hidden px-3 py-2.5"
                    :class="effectiveMutationChance(slot, mutation) > 0
                      ? 'border-primary/40 bg-gradient-to-br from-primary/12 to-primary/[0.02]'
                      : 'border-error/40 bg-error/[0.06]'"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="flex items-center gap-3 min-w-0">
                        <XenoPlantIcon :id="mutation.offspring" :size="40" class="shrink-0 drop-shadow" />
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5">
                            <p class="font-black text-sm truncate" :class="tierNameColor(getPlant(mutation.offspring)?.tier ?? 1)">{{ getPlant(mutation.offspring)?.name }}</p>
                            <span class="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-inverted leading-none shrink-0">Mutation</span>
                          </div>
                          <p class="text-[11px] font-bold" :class="tierColor(getPlant(mutation.offspring)?.tier ?? 1)">{{ tierLabel(getPlant(mutation.offspring)?.tier ?? 1) }}</p>
                        </div>
                      </div>
                      <div class="text-center shrink-0 rounded-lg border px-2.5 py-1" :class="effectiveMutationChance(slot, mutation) > 0 ? 'bg-primary/15 border-primary/30' : 'bg-error/10 border-error/30'">
                        <div class="flex items-baseline gap-1 justify-center">
                          <span v-if="slotMutationBoost(slot) > 0 && effectiveMutationChance(slot, mutation) > 0" class="text-[10px] font-bold text-muted/60 line-through tabular-nums">{{ Math.round(mutation.chance * 100) }}%</span>
                          <span class="text-lg font-black tabular-nums leading-none" :class="effectiveMutationChance(slot, mutation) > 0 ? 'text-primary' : 'text-error'">{{ Math.round(effectiveMutationChance(slot, mutation) * 100) }}%</span>
                        </div>
                        <p class="text-[9px] font-bold uppercase tracking-wider" :class="effectiveMutationChance(slot, mutation) > 0 ? 'text-primary/70' : 'text-error/80'">{{ effectiveMutationChance(slot, mutation) > 0 ? 'chance' : 'needs artifact' }}</p>
                      </div>
                    </div>
                  </div>

                  <div v-if="mutationsForParents(getParent(slot.id, 1), getParent(slot.id, 2)).length === 0" class="rounded-xl border border-default/60 bg-background/40 px-3 py-2.5 flex items-center gap-3">
                    <div class="size-10 rounded-lg bg-background border border-default/60 flex items-center justify-center shrink-0">
                      <UIcon name="i-lucide-shuffle" class="size-5 text-muted/60" />
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm font-bold">Standard cross</p>
                      <p class="text-[11px] text-muted">Offspring inherits type, speed and yield 50/50 from each parent</p>
                    </div>
                  </div>

                  <!-- Breed time + litter -->
                  <div class="flex items-center justify-between rounded-xl border border-default/60 bg-background/40 px-3 py-2 text-xs">
                    <span class="flex items-center gap-1.5 text-muted"><UIcon name="i-lucide-clock" class="size-3.5" /> Incubation</span>
                    <div class="flex items-baseline gap-1.5">
                      <span class="font-black tabular-nums">{{ formatDuration(effectiveBreedSecs(slot)) }}</span>
                      <span v-if="effectiveBreedSecs(slot) < baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2))" class="text-[10px] text-muted/50 line-through tabular-nums">{{ formatDuration(baseBreedSecs(getParent(slot.id, 1), getParent(slot.id, 2))) }}</span>
                    </div>
                    <span class="h-3 w-px bg-default/60" />
                    <span class="flex items-center gap-1.5 text-muted"><UIcon name="i-lucide-egg" class="size-3.5" /> Litter</span>
                    <span class="font-black tabular-nums" :class="slotExtraYield(slot) ? 'text-info' : ''">×{{ 1 + slotExtraYield(slot) }}</span>
                  </div>
                  <p v-if="pairBlocked(slot.id)" class="text-[11px] text-error font-semibold text-center">{{ pairBlocked(slot.id) }}</p>
                </div>
                <p v-else class="text-center text-xs text-muted py-2">
                  {{ selectedPlant ? 'Click a socket to insert the selected specimen' : 'Pick a specimen from the panel to load this pod' }}
                </p>

                <!-- Artifact socket -->
                <div class="mt-auto">
                  <div v-if="slot.artifact" class="flex items-center gap-2 h-11 rounded-xl border border-primary/30 bg-primary/5 px-3">
                    <span class="xeno-orb size-7 text-sm shrink-0" :class="slot.artifact.gemCrafted ? 'xeno-orb-gem' : ''">{{ getArtifact(slot.artifact.typeId)?.emoji }}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs font-semibold truncate">{{ getArtifact(slot.artifact.typeId)?.name }}</p>
                      <p class="text-[10px] text-muted leading-none mt-0.5">{{ slot.artifact.chargesRemaining }} charges left</p>
                    </div>
                    <button class="size-6 flex items-center justify-center rounded-md text-muted hover:text-error hover:bg-error/10 shrink-0 transition-colors" title="Detach" @click="doRemoveArtifact(slot.id)">
                      <UIcon name="i-lucide-x" class="size-3.5" />
                    </button>
                  </div>
                  <div
                    v-else
                    class="flex items-center gap-2 h-11 rounded-xl border border-dashed px-3 transition-colors"
                    :class="selectedArtifact ? 'border-primary/60 bg-primary/5 hover:bg-primary/10 cursor-pointer xeno-target' : 'border-default/40'"
                    :style="attachingSlot === slot.id ? 'opacity: 0.5; pointer-events: none' : ''"
                    @click="handleArtifactSlotClick(slot.id)"
                  >
                    <UIcon name="i-lucide-flask-conical" class="size-4 shrink-0" :class="selectedArtifact ? 'text-primary' : 'text-muted/40'" />
                    <span class="text-xs" :class="selectedArtifact ? 'text-primary/80 font-medium' : 'text-muted/50'">
                      {{ selectedArtifact ? 'Install artifact in this pod' : 'Artifact bay (optional)' }}
                    </span>
                  </div>
                </div>

                <UButton
                  label="Start incubation"
                  icon="i-lucide-dna"
                  block size="lg"
                  :class="bothPicked(slot.id) && !pairBlocked(slot.id) ? 'xeno-cta-pulse' : ''"
                  :disabled="!bothPicked(slot.id) || !!pairBlocked(slot.id)"
                  :loading="starting.has(slot.id)"
                  @click="doStart(slot)"
                />
              </template>
            </div>
          </div>

          <!-- ── Unlock pod ── -->
          <div
            v-if="state.breeder.unlockedCount < state.breeder.maxSlots"
            class="xeno-pod-card border-dashed min-h-[30rem] flex flex-col items-center justify-center gap-4 p-6 text-center"
          >
            <div class="w-28 opacity-40 grayscale">
              <XenoIncubatorPod :pct="0" state="idle" class="h-40 w-full" />
            </div>
            <div>
              <p class="text-lg font-black">Dormant pod</p>
              <CoinBalance :value="state.breeder.nextSlotCost" :compact="false" class="justify-center text-sm font-semibold mt-1" />
            </div>
            <UButton
              label="Power up"
              icon="i-lucide-power"
              size="md"
              :variant="balance >= state.breeder.nextSlotCost ? 'solid' : 'soft'"
              :color="balance >= state.breeder.nextSlotCost ? 'primary' : 'neutral'"
              :loading="unlocking"
              :disabled="balance < state.breeder.nextSlotCost"
              @click="doUnlock"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── Right inventory sidebar (lg+) ────────────────────────────── -->
    <USidebar collapsible="none" side="right" class="hidden lg:flex w-[26rem] border-l border-default/60 bg-background/40 backdrop-blur-sm">
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="breedableInventory"
          :free-artifacts="breederFreeArtifacts"
          artifact-domain="breeder"
          :selected-plant-key="selectedKey"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="onSelectPlant"
          @select-artifact="onSelectArtifact"
        />
      </div>
    </USidebar>
  </div>

  <USlideover v-model:open="mobileInventoryOpen" title="Specimens" side="right" class="lg:hidden">
    <template #body>
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="breedableInventory"
          :free-artifacts="breederFreeArtifacts"
          artifact-domain="breeder"
          :selected-plant-key="selectedKey"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="(p) => { onSelectPlant(p); mobileInventoryOpen = false }"
          @select-artifact="(a) => { onSelectArtifact(a); mobileInventoryOpen = false }"
        />
      </div>
    </template>
  </USlideover>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" :flashes="fx.flashes.value" />
</template>
