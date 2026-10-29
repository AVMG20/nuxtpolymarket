<script setup lang="ts">
import {
  getPlant, getArtifact, getEffectValueFor, breedSecs, breedDuration,
  xenoMutationBoost, MUTATIONS, PLANT_TYPES, XENO_MAX_BREEDER_SLOTS
} from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone, formatDuration } from '~/lib/xeno-format'
import { breedOdds, formatPct, roman, tierClass, plantName } from '~/lib/xeno-ui'
import { createReusableTemplate } from '@vueuse/core'
import type { BreedResult } from '~/components/xeno/BreedReveal.vue'

const [DefineRecipes, ReuseRecipes] = createReusableTemplate()

const {
  state, reconcile, breederSlots, inventory, freeArtifacts, upgrades, unlockedTypeIds,
  unlockBreederSlot, startBreed, cancelBreed, collectBreed,
  attachBreederArtifact, removeBreederArtifact
} = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 1000)
  onUnmounted(() => clearInterval(t))
})

const { balanceNum } = useAuth()

// Hybrids can't be bred — keep them off the Nursery shelf.
const breedableInventory = computed(() => (inventory.value as any[]).filter(i => !i.isHybrid))

const breederFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => getArtifact(a.typeId)?.effects.some(e => e.type.startsWith('breeder_')))
)

// ── Selection (shelf-driven) ────────────────────────────────────────────────
type Held = { typeId: string, speed: number, yield: number, name: string, emoji: string, tier: number }
const shelfOpen = ref(false)
const shelfTab = ref<'seeds' | 'artifacts' | 'extra'>('seeds')
const selectedPlant = ref<Held | null>(null)
const selectedArtifact = ref<{ id: string, typeId: string, chargesRemaining: number } | null>(null)

watch(inventory, (inv) => {
  if (!selectedPlant.value) return
  const { typeId, speed, yield: yld } = selectedPlant.value
  if (!(inv as any[]).find(i => i.typeId === typeId && i.speed === speed && i.yield === yld)) selectedPlant.value = null
})
watch(breederFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!arts.find(a => a.id === selectedArtifact.value?.id)) {
    const next = arts.find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining } : null
  }
})

function onSelectPlant(p: Held | null) { selectedPlant.value = p; if (p) selectedArtifact.value = null; sound.play(p ? 'select' : 'deselect') }
function onSelectArtifact(a: any) { selectedArtifact.value = a; if (a) selectedPlant.value = null; sound.play(a ? 'select' : 'deselect') }
function clearSelection() {
  if (!selectedPlant.value && !selectedArtifact.value) return
  selectedPlant.value = null
  selectedArtifact.value = null
  sound.play('deselect')
}

function openShelf(tab: 'seeds' | 'artifacts' | 'extra') {
  shelfTab.value = tab
  if (!window.matchMedia('(min-width: 1280px)').matches) shelfOpen.value = true
}

// ── Per-pod parent staging ──────────────────────────────────────────────────
const slotParents = ref<Record<string, { p1: any, p2: any }>>({})

function getSlotParents(slotId: string) {
  if (!slotParents.value[slotId]) slotParents.value[slotId] = { p1: null, p2: null }
  return slotParents.value[slotId]!
}
/** Staged parents without creating an entry, so computeds can read it. */
function staged(slotId: string): { p1: any, p2: any } {
  return slotParents.value[slotId] ?? { p1: null, p2: null }
}
function getParent(slotId: string, num: 1 | 2) {
  return staged(slotId)[num === 1 ? 'p1' : 'p2']
}
/** The parent a pot shows: the running breed's, else the staged one. */
function shownParent(slot: any, num: 1 | 2): any {
  if (podState(slot) !== 'idle') return num === 1 ? slot.parent1 : slot.parent2
  return getParent(slot.id, num)
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

function stackQty(p: any): number {
  if (!p) return 0
  return (inventory.value as any[]).find(i => i.typeId === p.typeId && i.speed === p.speed && i.yield === p.yield)?.quantity ?? 0
}
function sameStack(a: any, b: any) {
  return !!a && !!b && a.typeId === b.typeId && a.speed === b.speed && a.yield === b.yield
}
/** Picking the same single-quantity stack for both parents can't work — the breed needs two. */
function pairBlocked(slotId: string): string | null {
  const p1 = getParent(slotId, 1)
  const p2 = getParent(slotId, 2)
  if (!p1 || !p2) return null
  if (sameStack(p1, p2) && stackQty(p1) < 2) return 'You need two of this stack to pair it with itself'
  return null
}

function handlePotClick(slot: any, num: 1 | 2) {
  if (podState(slot) !== 'idle') return
  if (!selectedPlant.value) {
    openShelf('seeds')
    return
  }
  const parents = getSlotParents(slot.id)
  if (num === 1) parents.p1 = selectedPlant.value
  else parents.p2 = selectedPlant.value
  sound.play('plant')
}

const attachingSlot = ref<string | null>(null)
async function handleArtifactSlotClick(slot: any) {
  if (attachingSlot.value) return
  if (!selectedArtifact.value) {
    openShelf('artifacts')
    return
  }
  attachingSlot.value = slot.id
  sound.play('attach')
  try {
    await attachBreederArtifact(slot.id, selectedArtifact.value.id)
  } catch { sound.play('error') } finally { attachingSlot.value = null }
}
async function doRemoveArtifact(slotId: string) {
  sound.play('remove')
  try {
    await removeBreederArtifact(slotId)
  } catch { sound.play('error') }
}

// ── Pod maths ───────────────────────────────────────────────────────────────
function slotArtifactValue(slot: any, type: 'breeder_speed_boost' | 'breeder_mutation_boost' | 'breeder_extra_yield'): number {
  if (!slot.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValueFor(art, type, slot.artifact.gemCrafted) : 0
}
const globalMutation = computed(() => xenoMutationBoost(upgrades.value.mutation))
function slotMutationBoost(slot: any): number {
  return globalMutation.value + slotArtifactValue(slot, 'breeder_mutation_boost')
}
function slotExtraYield(slot: any): number {
  return slotArtifactValue(slot, 'breeder_extra_yield')
}
/** The pair a pod is showing: the running breed's parents, or the staged ones. */
function podPair(slot: any): [any, any] | null {
  if (podState(slot) !== 'idle') return slot.parent1 && slot.parent2 ? [slot.parent1, slot.parent2] : null
  const { p1, p2 } = staged(slot.id)
  return p1 && p2 ? [p1, p2] : null
}
function podOdds(slot: any) {
  const pair = podPair(slot)
  return pair ? breedOdds(pair[0].typeId, pair[1].typeId, slotMutationBoost(slot)) : null
}
function podBreedSecs(slot: any): number {
  const pair = podPair(slot)
  if (!pair) return 0
  return breedSecs({ typeId: pair[0].typeId }, { typeId: pair[1].typeId }, slot.artifact?.typeId, slot.artifact?.gemCrafted, upgrades.value.speed) ?? 0
}
function podBaseSecs(slot: any): number {
  const pair = podPair(slot)
  const a = pair && getPlant(pair[0].typeId)
  const b = pair && getPlant(pair[1].typeId)
  return a && b ? breedDuration(a, b) : 0
}

type PodState = 'idle' | 'breeding' | 'done'
function podState(slot: any): PodState {
  void now.value
  if (!slot.startedAt || slot.collected) return 'idle'
  if (slot.completesAt && isDone(slot.completesAt) && slot.resultTypeId) return 'done'
  return 'breeding'
}
function podPct(slot: any): number {
  if (!slot.startedAt || !slot.completesAt) return 0
  return progressPct(slot.startedAt, slot.completesAt, now.value)
}
function podLabel(slot: any): { text: string, color: string } {
  const st = podState(slot)
  if (st === 'done') return { text: 'Done', color: 'var(--xg-accent-text)' }
  if (st === 'breeding') return { text: 'Growing', color: 'var(--xg-muted)' }
  if (bothPicked(slot.id)) return { text: 'Ready to start', color: 'var(--xg-sun)' }
  return { text: 'Idle', color: 'var(--xg-faint)' }
}
/** What the seed bed shows: the likeliest mutation as a silhouette, else a parent seedling. */
function bedPreview(slot: any): string | null {
  const odds = podOdds(slot)
  if (!odds) return null
  return odds.mutations[0]?.offspring ?? odds.parents[0]?.typeId ?? null
}
function odd(n: number) {
  return `${Math.max(0, n * 100)}%`
}

// The result is withheld by the server until the timer is really up, so the
// slot data needs one more fetch the moment the countdown hits zero — without
// it the pod would sit on "Ready" with nothing to collect until a reload.
const refreshedFor = new Set<string>()
watch(now, () => {
  for (const s of breederSlots.value as any[]) {
    if (!s.startedAt || s.collected || s.resultTypeId || !s.completesAt) continue
    const key = `${s.id}:${s.startedAt}`
    if (isDone(s.completesAt) && !refreshedFor.has(key)) {
      refreshedFor.add(key)
      void reconcile()
    }
  }
})

// Chime the first time a finished breed is seen on screen — but not for
// results that were already waiting when the page loaded.
const seenResults = new Set<string>()
let seededResults = false
watch(() => (breederSlots.value as any[]).map(s => `${s.id}:${s.startedAt}:${podState(s)}`).join(','), () => {
  for (const s of breederSlots.value as any[]) {
    if (podState(s) !== 'done') continue
    const key = `${s.id}:${s.startedAt}`
    if (seenResults.has(key)) continue
    seenResults.add(key)
    if (seededResults) sound.play(s.wasMutation ? 'mutation' : 'ready')
  }
  if (state.value) seededResults = true
}, { immediate: true })

// ── Actions ─────────────────────────────────────────────────────────────────
const starting = ref(new Set<string>())
const cancelling = ref(new Set<string>())
const collecting = ref(new Set<string>())
const unlocking = ref(false)

const revealOpen = ref(false)
const reveal = ref<BreedResult | null>(null)

async function doCancel(slotId: string) {
  cancelling.value.add(slotId)
  sound.play('remove')
  try {
    await cancelBreed(slotId)
  } catch { sound.play('error') } finally { cancelling.value.delete(slotId) }
}

async function doStart(slot: any, quiet = false) {
  const p1 = getParent(slot.id, 1)
  const p2 = getParent(slot.id, 2)
  if (!p1 || !p2 || pairBlocked(slot.id)) return
  starting.value.add(slot.id)
  slotParents.value[slot.id] = { p1: null, p2: null }
  if (!quiet) sound.play('breed-start')
  const c = fx.centerOf(document.querySelector(`[data-pod="${slot.id}"]`))
  if (c) fx.burst(c.x, c.y, { count: 6, spread: 40 })
  try {
    await startBreed(slot.id, p1.typeId, p1.speed, p1.yield, p2.typeId, p2.speed, p2.yield)
  } catch {
    sound.play('error')
    slotParents.value[slot.id] = { p1, p2 }
  } finally { starting.value.delete(slot.id) }
}

async function doCollect(slot: any, quiet = false) {
  collecting.value.add(slot.id)
  const c = fx.centerOf(document.querySelector(`[data-pod="${slot.id}"]`))
  const result: BreedResult = {
    typeId: slot.resultTypeId,
    quantity: slot.resultQuantity ?? 1,
    speed: slot.resultSpeed ?? 0,
    yield: slot.resultYield ?? 0,
    isNew: !unlockedTypeIds.value.includes(slot.resultTypeId),
    discovered: 0
  }
  const mutation = !!slot.wasMutation
  if (!quiet) sound.play(mutation ? 'mutation' : 'collect')
  if (c) {
    fx.burst(c.x, c.y, { plantId: result.typeId, count: 8, spread: 60 })
    fx.float(c.x, c.y - 30, result.quantity, { plantId: result.typeId })
  }
  try {
    await collectBreed(slot.id)
    if (mutation && (!quiet || !revealOpen.value)) {
      const known = new Set(unlockedTypeIds.value)
      known.add(result.typeId)
      reveal.value = { ...result, discovered: PLANT_TYPES.filter(p => known.has(p.id)).length }
      revealOpen.value = true
    }
  } catch { sound.play('error') } finally { collecting.value.delete(slot.id) }
}

// ── Mass actions ────────────────────────────────────────────────────────────
function stackKey(p: any) {
  return `${p.typeId}:${p.speed}:${p.yield}`
}

const idlePods = computed(() => (breederSlots.value as any[]).filter(s => podState(s) === 'idle' && !starting.value.has(s.id)))
const readyPods = computed(() => (breederSlots.value as any[]).filter(s => podState(s) === 'done' && !collecting.value.has(s.id)))
const breedingCount = computed(() => (breederSlots.value as any[]).filter(s => podState(s) === 'breeding').length)
const hasStaged = computed(() => idlePods.value.some(s => staged(s.id).p1 || staged(s.id).p2))

/** Units of a stack not already staged in an idle pod, so fills never stage more than are owned. */
function unstagedQty(p: any): number {
  const key = stackKey(p)
  const used = idlePods.value.reduce((n, s) => {
    const { p1, p2 } = staged(s.id)
    return n + (p1 && stackKey(p1) === key ? 1 : 0) + (p2 && stackKey(p2) === key ? 1 : 0)
  }, 0)
  return stackQty(p) - used
}

type Side = 1 | 2
const sideKey = (num: Side) => (num === 1 ? 'p1' : 'p2') as 'p1' | 'p2'

/**
 * The idle pods a side fill would change. The held seed goes into that side of
 * every idle pod (replacing what was staged there), counting down the stack,
 * including copies already staged on the other side, so no pod is left needing
 * more plants than are owned. Pods past the end of the stack are left alone.
 */
function sideFillTargets(num: Side): string[] {
  const plant = selectedPlant.value
  if (!plant) return []
  const key = stackKey(plant)
  const side = sideKey(num)
  const other = sideKey(num === 1 ? 2 : 1)
  const pods = idlePods.value
  let left = stackQty(plant) - pods.filter(s => staged(s.id)[other] && stackKey(staged(s.id)[other]) === key).length
  const targets: string[] = []
  for (const slot of pods) {
    if (left < 1) break
    left--
    const cur = staged(slot.id)[side]
    if (!cur || stackKey(cur) !== key) targets.push(slot.id)
  }
  return targets
}
const fillLeftTargets = computed(() => sideFillTargets(1))
const fillRightTargets = computed(() => sideFillTargets(2))

function fillSide(num: Side) {
  const plant = selectedPlant.value
  const targets = num === 1 ? fillLeftTargets.value : fillRightTargets.value
  if (!plant || !targets.length) return
  for (const id of targets) getSlotParents(id)[sideKey(num)] = plant
  sound.play('plant')
}
function fillSideTitle(num: Side): string {
  const side = num === 1 ? 'left' : 'right'
  if (!selectedPlant.value) return `Hold a seed to fill the ${side} pot of every idle pod`
  return `Fill ${side} with ${selectedPlant.value.name}`
}

/** Pods whose staged pair can start, counting down each stack so a batch never asks for more plants than are owned. */
const startablePods = computed(() => {
  const left = new Map<string, number>()
  return idlePods.value.filter((s) => {
    const { p1, p2 } = staged(s.id)
    if (!p1 || !p2) return false
    const k1 = stackKey(p1)
    const k2 = stackKey(p2)
    if (!left.has(k1)) left.set(k1, stackQty(p1))
    if (!left.has(k2)) left.set(k2, stackQty(p2))
    if (k1 === k2 ? left.get(k1)! < 2 : left.get(k1)! < 1 || left.get(k2)! < 1) return false
    left.set(k1, left.get(k1)! - 1)
    left.set(k2, left.get(k2)! - 1)
    return true
  })
})

function clearAllStaged() {
  for (const slot of idlePods.value) slotParents.value[slot.id] = { p1: null, p2: null }
  sound.play('remove')
}

async function doStartAll() {
  const pods = startablePods.value
  if (!pods.length) return
  sound.play('breed-start')
  await Promise.allSettled(pods.map(s => doStart(s, true)))
}

async function doCollectAll() {
  const pods = readyPods.value
  if (!pods.length) return
  sound.play(pods.some(s => s.wasMutation) ? 'mutation' : 'collect')
  await Promise.allSettled(pods.map(s => doCollect(s, true)))
}

async function doUnlock() {
  unlocking.value = true
  try {
    await unlockBreederSlot()
    sound.play('unlock')
  } catch { sound.play('error') } finally { unlocking.value = false }
}

// ── Recipe finder ───────────────────────────────────────────────────────────
type RecipeFilter = 'have' | 'new' | 'all'
const recipeFilter = ref<RecipeFilter>('have')
const recipeSearch = ref('')
const discovered = computed(() => new Set(unlockedTypeIds.value))

function bestStack(typeId: string, exclude?: any): any | null {
  return breedableInventory.value
    .filter(i => i.typeId === typeId && unstagedQty(i) - (exclude && sameStack(i, exclude) ? 1 : 0) > 0)
    .sort((a, b) => (b.speed + b.yield) - (a.speed + a.yield) || b.quantity - a.quantity)[0] ?? null
}
/** Two parents for a recipe from what's on the shelf (and not already staged). */
function recipeParents(m: { parent1: string, parent2: string }): [any, any] | null {
  const a = bestStack(m.parent1)
  if (!a) return null
  const b = bestStack(m.parent2, a)
  return b ? [a, b] : null
}

/** Undiscovered species stay nameless everywhere in the Nursery (recipes and pod odds alike). */
function knownName(id: string): string {
  return discovered.value.has(id) ? plantName(id) : 'Unknown species'
}

const recipes = computed(() => {
  const q = recipeSearch.value.trim().toLowerCase()
  const owned = new Set(breedableInventory.value.map(i => i.typeId))
  return MUTATIONS
    .map((m) => {
      const target = getPlant(m.offspring)
      const chance = Math.max(0, Math.min(1, m.chance + globalMutation.value))
      const secs = breedSecs({ typeId: m.parent1 }, { typeId: m.parent2 }, null, false, upgrades.value.speed) ?? 0
      return { m, target, chance, secs, have: owned.has(m.parent1) && owned.has(m.parent2), known: discovered.value.has(m.offspring) }
    })
    .filter(r => r.target)
    .filter(r => recipeFilter.value === 'all' || (recipeFilter.value === 'have' ? r.have : !r.known))
    .filter(r => !q || [r.m.offspring, r.m.parent1, r.m.parent2].some(id => discovered.value.has(id) && plantName(id).toLowerCase().includes(q)))
    .sort((a, b) => Number(b.have) - Number(a.have) || b.target!.tier - a.target!.tier || b.chance - a.chance)
})

function fillWithRecipe(m: { parent1: string, parent2: string }, everyIdle: boolean) {
  let filled = 0
  for (const slot of idlePods.value) {
    const p = staged(slot.id)
    if (p.p1 || p.p2) continue
    const pair = recipeParents(m)
    if (!pair) break
    slotParents.value[slot.id] = { p1: pair[0], p2: pair[1] }
    filled++
    if (!everyIdle) break
  }
  sound.play(filled ? 'plant' : 'error')
  if (filled) shelfOpen.value = false
}
const emptyIdleCount = computed(() => idlePods.value.filter(s => !staged(s.id).p1 && !staged(s.id).p2).length)

// ── Keyboard ────────────────────────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (shelfOpen.value || revealOpen.value) return
  if (e.key === 'Escape') clearSelection()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  onUnmounted(() => window.removeEventListener('keydown', onKey))
})

const selectedKey = computed(() => selectedPlant.value ? stackKey(selectedPlant.value) : null)
const unlockedPods = computed(() => state.value?.breeder?.unlockedCount ?? 0)
const maxPods = computed(() => state.value?.breeder?.maxSlots ?? XENO_MAX_BREEDER_SLOTS)
</script>

<template>
  <DefineRecipes>
            <div class="flex flex-col gap-3 min-h-0 flex-1">
              <UInput v-model="recipeSearch" placeholder="Target or parent" icon="i-lucide-search" size="lg" :ui="{ base: 'rounded-full' }" aria-label="Search recipes" />
              <div class="flex flex-wrap gap-1.5">
                <button type="button" class="xg-filter" :class="recipeFilter === 'have' ? 'on' : ''" @click="recipeFilter = 'have'">I have both parents</button>
                <button type="button" class="xg-filter" :class="recipeFilter === 'new' ? 'on' : ''" @click="recipeFilter = 'new'">Undiscovered</button>
                <button type="button" class="xg-filter" :class="recipeFilter === 'all' ? 'on' : ''" @click="recipeFilter = 'all'">All</button>
              </div>
              <p class="text-xs text-(--xg-muted)">Odds include your Genetic Instability upgrade, not a pod artifact. Time is before pod artifacts.</p>
              <div class="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
                <p v-if="!recipes.length" class="xg-well text-center text-sm text-(--xg-muted) py-8 px-3">
                  {{ recipeFilter === 'have' ? 'No recipe uses two species you have on the shelf.' : 'No recipes match.' }}
                </p>
                <div v-for="r in recipes" :key="`${r.m.parent1}-${r.m.parent2}-${r.m.offspring}`" class="xg-item hoverable !gap-2.5">
                  <span class="xg-thumb size-11"><XenoPlantIcon :id="r.m.offspring" :size="36" stage="ready" :silhouette="!r.known" /></span>
                  <span class="flex-1 min-w-0">
                    <span class="flex items-center gap-1.5">
                      <b class="text-[13px] truncate" :class="r.known ? '' : 'text-(--xg-uv)'">{{ knownName(r.m.offspring) }}</b>
                      <XenoTierLabel :tier="r.target!.tier" :is-void="!!r.target!.voidPlant" />
                    </span>
                    <span class="block text-[11.5px] text-(--xg-faint) truncate">{{ knownName(r.m.parent1) }} + {{ knownName(r.m.parent2) }}</span>
                  </span>
                  <span class="text-right shrink-0">
                    <b class="xg-num text-[13px] block" :class="r.chance > 0 ? 'text-(--xg-uv)' : 'text-(--xg-rose)'">
                      {{ r.chance > 0 ? formatPct(r.chance) : `+${formatPct(-(r.m.chance + globalMutation))}` }}
                    </b>
                    <span class="text-[11px] text-(--xg-faint) xg-num">{{ formatDuration(r.secs) }}</span>
                  </span>
                  <span v-if="r.have" class="flex flex-col gap-1 shrink-0">
                    <XenoButton size="xs" label="Fill" :disabled="!emptyIdleCount || !recipeParents(r.m)" :title="`Put ${plantName(r.m.parent1)} and ${plantName(r.m.parent2)} in an idle pod`" @click="fillWithRecipe(r.m, false)" />
                    <XenoButton v-if="emptyIdleCount > 1" size="xs" variant="ghost" label="All" :disabled="!recipeParents(r.m)" title="Fill every idle pod with this recipe" @click="fillWithRecipe(r.m, true)" />
                  </span>
                </div>
              </div>
            </div>
  </DefineRecipes>

  <div class="mx-auto max-w-[1440px] px-4 md:px-6 pt-5 md:pt-6 flex flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="xg-label">Nursery · {{ unlockedPods }} of {{ maxPods }} pods</p>
        <h1 class="xg-h text-2xl md:text-3xl mt-1">Nursery</h1>
        <p v-if="state" class="xg-stats mt-1.5">
          <b class="!text-(--xg-accent-text)">{{ readyPods.length }}</b> done ·
          <b>{{ breedingCount }}</b> growing ·
          <b>{{ idlePods.length }}</b> idle
        </p>
      </div>
      <div v-if="state" class="flex flex-wrap items-center gap-2">
        <XenoButton size="sm" icon="i-lucide-panel-right-open" label="Shelf" class="xl:!hidden" @click="shelfOpen = true" />
        <div class="xg-split" role="group" aria-label="Fill a side of every idle pod">
          <UTooltip v-for="num in ([1, 2] as const)" :key="num" :text="fillSideTitle(num)" :delay-duration="250">
            <XenoButton
              size="sm"
              :icon="num === 1 ? 'i-lucide-panel-left' : 'i-lucide-panel-right'"
              class="max-sm:!px-2.5"
              :disabled="!(num === 1 ? fillLeftTargets : fillRightTargets).length"
              :aria-label="fillSideTitle(num)"
              @click="fillSide(num)"
            >
              <span class="max-sm:sr-only">Fill {{ num === 1 ? 'left' : 'right' }}</span>
            </XenoButton>
          </UTooltip>
        </div>
        <XenoButton size="sm" icon="i-lucide-eraser" class="max-sm:!px-2.5" :disabled="!hasStaged" title="Clear idle" aria-label="Clear idle" @click="clearAllStaged">
          <span class="max-sm:sr-only">Clear idle</span>
        </XenoButton>
        <XenoButton
          size="sm"
          icon="i-lucide-play"
          :variant="startablePods.length ? 'go' : 'default'"
          :disabled="!startablePods.length"
          :label="`Start ${startablePods.length}`"
          @click="doStartAll"
        />
        <XenoButton
          size="sm"
          icon="i-lucide-arrow-down-to-line"
          :variant="readyPods.length ? 'go' : 'default'"
          :disabled="!readyPods.length"
          :waiting="readyPods.length > 0"
          :label="`Collect ${readyPods.length}`"
          @click="doCollectAll"
        />
      </div>
    </div>

    <div class="flex gap-6 items-start">
      <section class="flex-1 min-w-0 grid gap-4 grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))]" aria-label="Pods">
        <template v-if="!state">
          <USkeleton v-for="i in 2" :key="i" class="h-[22rem] rounded-[20px_20px_20px_6px]" />
        </template>

        <template v-else>
          <article
            v-for="(slot, idx) in breederSlots"
            :key="slot.id"
            class="xg-pane p-4 flex flex-col gap-3.5 @container"
            :class="podState(slot) === 'done' ? 'is-go' : ''"
          >
            <!-- Header -->
            <div class="flex items-center gap-2.5 min-h-8">
              <b class="xg-h text-[15px]">Pod {{ idx + 1 }}</b>
              <span class="xg-label !tracking-[.1em]" :style="{ color: podLabel(slot).color }">{{ podLabel(slot).text }}</span>
              <span class="flex-1" />
              <span v-if="slot.artifact" class="inline-flex items-center gap-2 text-xs text-(--xg-muted) min-w-0">
                <XenoArtifactGlyph :type-id="slot.artifact.typeId" :gem-crafted="slot.artifact.gemCrafted" :size="28" :show-level="false" />
                <span class="truncate"><b class="text-(--xg-ink)">{{ getArtifact(slot.artifact.typeId)?.name }}</b> · {{ slot.artifact.chargesRemaining }} left</span>
                <button
                  v-if="podState(slot) === 'idle'"
                  type="button"
                  class="xg-btn ghost xs ico !min-h-7"
                  :aria-label="`Take ${getArtifact(slot.artifact.typeId)?.name} off Pod ${idx + 1}`"
                  title="Back to the shelf"
                  @click="doRemoveArtifact(slot.id)"
                >
                  <UIcon name="i-lucide-x" class="size-3.5" />
                </button>
              </span>
              <XenoButton
                v-else-if="podState(slot) === 'idle'"
                size="xs"
                :variant="selectedArtifact ? 'go' : 'default'"
                icon="i-lucide-plus"
                :loading="attachingSlot === slot.id"
                :label="selectedArtifact ? 'Fit artifact' : 'Artifact'"
                @click="handleArtifactSlotClick(slot)"
              />
            </div>

            <!-- Parent pot · seed bed · parent pot -->
            <div class="grid grid-cols-[1fr_auto_1fr] items-start gap-3" :data-pod="slot.id">
              <template v-for="num in ([1, 2] as const)" :key="num">
                <div class="flex flex-col items-center gap-1.5 min-w-0" :class="num === 2 ? 'order-3' : 'order-1'">
                  <!-- Running breed: locked-in parent -->
                  <div v-if="podState(slot) !== 'idle'" class="xg-pot size-[clamp(60px,24cqi,92px)]">
                    <XenoPlantIcon v-if="shownParent(slot, num)" :id="shownParent(slot, num).typeId" size="80%" stage="ready" />
                  </div>
                  <!-- Staged parent -->
                  <div v-else-if="getParent(slot.id, num)" class="relative">
                    <button
                      type="button"
                      class="xg-pot size-[clamp(60px,24cqi,92px)]"
                      :aria-label="`Replace parent ${num} of Pod ${idx + 1}`"
                      @click="handlePotClick(slot, num)"
                    >
                      <XenoPlantIcon :id="getParent(slot.id, num).typeId" size="80%" stage="ready" />
                    </button>
                    <button
                      type="button"
                      class="xg-plot-x !opacity-100 !-top-1.5 !-right-1.5"
                      :aria-label="`Take parent ${num} out of Pod ${idx + 1}`"
                      @click="clearParent(slot.id, num)"
                    >
                      <UIcon name="i-lucide-x" class="size-3.5" />
                    </button>
                  </div>
                  <!-- Empty pot -->
                  <button
                    v-else
                    type="button"
                    class="xg-pot size-[clamp(60px,24cqi,92px)]"
                    :class="selectedPlant ? 'target' : 'empty'"
                    :aria-label="selectedPlant ? `Put ${selectedPlant.name} in Pod ${idx + 1}` : `Choose parent ${num} for Pod ${idx + 1}`"
                    @click="handlePotClick(slot, num)"
                  >
                    <UIcon name="i-lucide-plus" class="size-5" :class="selectedPlant ? 'text-(--xg-accent-text)' : 'text-(--xg-faint)'" />
                  </button>

                  <template v-if="shownParent(slot, num)">
                    <span class="text-[12.5px] font-bold text-center leading-tight max-w-full truncate">
                      {{ plantName(shownParent(slot, num).typeId) }}
                    </span>
                    <span class="flex items-center gap-1">
                      <XenoTierLabel :tier="getPlant(shownParent(slot, num).typeId)?.tier ?? 1" />
                      <span class="xg-stats">S<b>{{ shownParent(slot, num).speed ?? 0 }}</b> Y<b>{{ shownParent(slot, num).yield ?? 0 }}</b></span>
                    </span>
                  </template>
                  <span v-else class="text-[12px] font-bold text-(--xg-faint)">{{ selectedPlant ? 'Put here' : `Parent ${num}` }}</span>
                </div>
              </template>

              <!-- Seed bed -->
              <div class="order-2 flex flex-col items-center">
                <div
                  class="xg-bed size-[clamp(88px,33cqi,140px)]"
                  :class="podState(slot) === 'done' ? 'done' : ''"
                  :style="{ '--p': podState(slot) === 'done' ? 100 : podPct(slot), '--rc': 'var(--xg-uv)' }"
                >
                  <span v-if="podState(slot) === 'breeding'" class="xg-ring" />
                  <template v-if="podState(slot) === 'done'">
                    <XenoPlantIcon :id="slot.resultTypeId" size="62%" stage="ready" silhouette />
                  </template>
                  <template v-else-if="bedPreview(slot)">
                    <XenoPlantIcon
                      :id="bedPreview(slot)"
                      size="62%"
                      :stage="podState(slot) === 'breeding' && podPct(slot) < 20 ? 'seedling' : 'growing'"
                      :progress="podState(slot) === 'breeding' ? Math.max(0.05, Math.min(0.99, podPct(slot) / 100)) : 0.5"
                      silhouette
                    />
                  </template>
                  <UIcon v-else name="i-lucide-sprout" class="size-7 text-(--xg-faint)" />
                  <span
                    v-if="podState(slot) !== 'idle'"
                    class="absolute bottom-3 inset-x-0 text-center text-[12px] font-extrabold xg-num"
                    :class="podState(slot) === 'done' ? 'text-(--xg-accent-text)' : 'text-(--xg-muted)'"
                  >{{ podState(slot) === 'done' ? 'Ready' : slot.completesAt ? formatCountdown(slot.completesAt, now) : '…' }}</span>
                </div>
                <button
                  v-if="podState(slot) === 'idle' && bothPicked(slot.id)"
                  type="button"
                  class="mt-1.5 text-[11px] font-bold text-(--xg-muted) hover:text-(--xg-ink) inline-flex items-center gap-1"
                  @click="swapParents(slot.id)"
                >
                  <UIcon name="i-lucide-arrow-left-right" class="size-3" /> Swap
                </button>
              </div>
            </div>

            <!-- Odds: the whole roll in one bar -->
            <div v-if="podOdds(slot) && podState(slot) !== 'done'" class="flex flex-col gap-1.5">
              <div class="xg-odds" role="img" :aria-label="`Mutation chance ${formatPct(podOdds(slot)!.mutationTotal)}`">
                <i v-for="m in podOdds(slot)!.mutations" :key="m.offspring" :style="{ width: odd(m.chance), background: 'var(--xg-uv)' }" />
                <i v-for="(p, pi) in podOdds(slot)!.parents" :key="p.typeId" :style="{ width: odd(p.chance), background: pi === 0 ? 'var(--xg-edge2)' : 'var(--xg-faint)' }" />
              </div>
              <div class="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs">
                <span v-if="podOdds(slot)!.mutations.length" class="flex flex-wrap gap-x-2">
                  <UTooltip
                    v-for="m in podOdds(slot)!.mutations"
                    :key="m.offspring"
                    :text="`Base ${formatPct(m.base)}, +${formatPct(slotMutationBoost(slot))} from upgrades and this pod's artifact`"
                  >
                    <span>
                      <b class="xg-num" :class="m.chance > 0 ? 'text-(--xg-uv)' : 'text-(--xg-rose)'">{{ m.chance > 0 ? formatPct(m.chance) : `+${formatPct(-(m.base + slotMutationBoost(slot)))} needed` }}</b>
                      <span class="text-(--xg-muted)"> {{ discovered.has(m.offspring) ? plantName(m.offspring) : 'Unknown species' }}</span>
                    </span>
                  </UTooltip>
                </span>
                <span v-else class="text-(--xg-muted)">No mutation for this pair</span>
                <span class="text-(--xg-faint)">
                  <template v-for="(p, pi) in podOdds(slot)!.parents" :key="p.typeId">{{ pi ? ' · ' : '' }}{{ plantName(p.typeId) }} {{ formatPct(p.chance) }}</template>
                </span>
              </div>
            </div>

            <!-- Time and plants -->
            <div v-if="podState(slot) === 'idle' && bothPicked(slot.id)" class="flex flex-wrap items-center justify-between gap-2 text-xs text-(--xg-muted)">
              <span>
                Takes <b class="xg-num text-(--xg-ink)">{{ formatDuration(podBreedSecs(slot)) }}</b>
                <span v-if="podBreedSecs(slot) < podBaseSecs(slot)" class="line-through ml-1">{{ formatDuration(podBaseSecs(slot)) }}</span>
              </span>
              <span>Gives <b class="xg-num text-(--xg-ink)">×{{ 1 + slotExtraYield(slot) }}</b></span>
            </div>
            <p v-if="pairBlocked(slot.id)" class="text-xs font-bold text-(--xg-rose)">{{ pairBlocked(slot.id) }}</p>
            <p v-else-if="podState(slot) === 'idle' && !bothPicked(slot.id)" class="text-xs text-center text-(--xg-faint)">
              {{ selectedPlant ? 'Click a pot to put the held seed in it.' : 'Hold a seed and click a pot, or fill it from a recipe.' }}
            </p>

            <!-- Action -->
            <div class="flex gap-2 mt-auto">
              <template v-if="podState(slot) === 'done'">
                <XenoButton
                  variant="go"
                  size="sm"
                  block
                  waiting
                  icon="i-lucide-arrow-down-to-line"
                  :label="`Collect ×${slot.resultQuantity ?? 1}`"
                  :loading="collecting.has(slot.id)"
                  @click="doCollect(slot)"
                />
              </template>
              <template v-else-if="podState(slot) === 'breeding'">
                <XenoButton size="sm" block disabled :label="`Growing · ${Math.floor(podPct(slot))}%`" class="xg-status" />
                <XenoButton size="sm" label="Cancel" title="Stop and give both parents back" :loading="cancelling.has(slot.id)" @click="doCancel(slot.id)" />
              </template>
              <template v-else-if="bothPicked(slot.id)">
                <XenoButton
                  variant="go"
                  size="sm"
                  block
                  icon="i-lucide-play"
                  :label="`Start · ${formatDuration(podBreedSecs(slot))}`"
                  :disabled="!!pairBlocked(slot.id)"
                  :loading="starting.has(slot.id)"
                  @click="doStart(slot)"
                />
              </template>
              <template v-else>
                <XenoButton size="sm" block label="Choose parents" @click="openShelf(selectedPlant ? 'seeds' : 'extra')" />
              </template>
            </div>
          </article>

          <!-- Add a pod -->
          <article
            v-if="state.breeder.unlockedCount < state.breeder.maxSlots"
            class="xg-pane is-dashed p-4 flex flex-col items-center justify-center gap-2.5 min-h-[18rem] text-center"
            :style="{ borderColor: 'var(--xg-sun-edge)' }"
          >
            <UIcon name="i-lucide-flower-2" class="size-7 text-(--xg-sun)" />
            <b class="xg-h text-base">Pod {{ state.breeder.unlockedCount + 1 }}</b>
            <XenoButton
              variant="sun"
              size="sm"
              :loading="unlocking"
              :disabled="balanceNum < state.breeder.nextSlotCost"
              @click="doUnlock"
            >
              <span class="xg-coin" />Add pod · {{ formatNumber(state.breeder.nextSlotCost) }}
            </XenoButton>
            <span v-if="balanceNum < state.breeder.nextSlotCost" class="text-xs text-(--xg-faint)">You need {{ formatNumber(state.breeder.nextSlotCost - balanceNum) }} more coins</span>
          </article>
        </template>
      </section>

      <!-- Shelf + recipe finder (xl+) -->
      <aside class="hidden xl:flex xg-pane xg-pane-r flex-col w-[400px] 2xl:w-[440px] shrink-0 p-4 h-[calc(100svh-16.5rem)] min-h-[520px]" aria-label="Shelf">
        <XenoInventoryPanel
          v-model:tab="shelfTab"
          :inventory="breedableInventory"
          :free-artifacts="breederFreeArtifacts"
          artifact-domain="breeder"
          extra-label="Recipes"
          :selected-plant-key="selectedKey"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="onSelectPlant"
          @select-artifact="onSelectArtifact"
        >
          <template #extra>
            <ReuseRecipes />
          </template>
        </XenoInventoryPanel>
      </aside>
    </div>
  </div>

  <USlideover
    v-model:open="shelfOpen"
    title="Shelf"
    side="right"
    :ui="{ content: 'xeno max-w-md bg-(--xg-surface)', header: 'border-(--xg-edge)', body: 'flex flex-col min-h-0' }"
  >
    <template #body>
      <XenoInventoryPanel
        v-model:tab="shelfTab"
        :inventory="breedableInventory"
        :free-artifacts="breederFreeArtifacts"
        artifact-domain="breeder"
        extra-label="Recipes"
        :selected-plant-key="selectedKey"
        :selected-artifact-id="selectedArtifact?.id ?? null"
        @select-plant="(p) => { onSelectPlant(p); if (p) shelfOpen = false }"
        @select-artifact="(a) => { onSelectArtifact(a); if (a) shelfOpen = false }"
      >
        <template #extra>
          <ReuseRecipes />
        </template>
      </XenoInventoryPanel>
    </template>
  </USlideover>

  <XenoBreedReveal v-model:open="revealOpen" :result="reveal" />
  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" />
</template>
