<script setup lang="ts">
import { gridSlotUnlockCost, getArtifact, getPlant, XENO_MAX_GRID_SLOTS } from '#shared/utils/xeno'
import { isDone } from '~/lib/xeno-format'
import { roman, tierClass } from '~/lib/xeno-ui'
import type { HarvestDrop } from '~/components/xeno/HarvestSummary.vue'

const {
  state, pending, gridSlots, inventory, freeArtifacts,
  initGame, unlockGridSlot, plantInSlot, plantAllSlots, harvestSlot, removePlant,
  attachGridArtifact
} = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()

const GRID_TOTAL = XENO_MAX_GRID_SLOTS

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 500)
  onUnmounted(() => clearInterval(t))
})

const { balanceNum } = useAuth()

// ── Selection ─────────────────────────────────────────────────────
type HeldPlant = { typeId: string, speed: number, yield: number, name: string, emoji: string, tier: number }
type HeldArtifact = { id: string, typeId: string, chargesRemaining: number, gemCrafted?: boolean }
const selectedPlant = ref<HeldPlant | null>(null)
const selectedArtifact = ref<HeldArtifact | null>(null)

const heldStack = computed(() => {
  const p = selectedPlant.value
  if (!p) return null
  return (inventory.value as any[]).find(i => i.typeId === p.typeId && i.speed === p.speed && i.yield === p.yield) ?? null
})

// Put the seed down once its stack runs out.
watch(inventory, () => {
  if (selectedPlant.value && !heldStack.value) selectedPlant.value = null
})

const gridFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => getArtifact(a.typeId)?.effects.some(e => e.type.startsWith('grid_')))
)

// Keep an artifact held after fitting it: move to the next of the same type, drop it only when none are left.
watch(gridFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!arts.find(a => a.id === selectedArtifact.value?.id)) {
    const next = arts.find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining, gemCrafted: next.gemCrafted } : null
  }
})

function onInventorySelectPlant(p: HeldPlant | null) {
  selectedPlant.value = p
  if (p) selectedArtifact.value = null
  sound.play(p ? 'select' : 'deselect')
}
function onInventorySelectArtifact(a: HeldArtifact | null) {
  selectedArtifact.value = a
  if (a) selectedPlant.value = null
  sound.play(a ? 'select' : 'deselect')
}
function clearSelection() {
  if (!selectedPlant.value && !selectedArtifact.value) return
  selectedPlant.value = null
  selectedArtifact.value = null
  sound.play('deselect')
}

// ── Garden model ──────────────────────────────────────────────────
const fullGrid = computed(() => {
  const slotMap = new Map((gridSlots.value as any[]).map(s => [s.slotIndex, s]))
  const unlockedCount = state.value?.grid?.unlockedCount ?? 0
  return Array.from({ length: GRID_TOTAL }, (_, i) => ({
    index: i,
    unlocked: i < unlockedCount,
    slot: i < unlockedCount ? (slotMap.get(i) ?? null) : null,
    isNextUnlock: i === unlockedCount,
    cost: gridSlotUnlockCost(i)
  }))
})

const readySlots = computed(() => {
  void now.value
  return (gridSlots.value as any[]).filter(s => s.plant && isDone(s.plant.completesAt))
})
const emptySlots = computed(() => (gridSlots.value as any[]).filter(s => !s.plant))
const growingCount = computed(() => (gridSlots.value as any[]).length - readySlots.value.length - emptySlots.value.length)
const unlockedCount = computed(() => state.value?.grid?.unlockedCount ?? 0)

/** Mirrors the server's void rule: void seeds only grow next to a tier II+ artifact. */
const heldIsVoid = computed(() => !!selectedPlant.value && !!getPlant(selectedPlant.value.typeId)?.voidPlant)
function canHostHeld(slot: any): boolean {
  if (!heldIsVoid.value) return true
  return (getArtifact(slot?.artifact?.typeId ?? '')?.level ?? 0) >= 2
}
const plantableCount = computed(() => {
  if (!selectedPlant.value) return 0
  const n = emptySlots.value.filter(s => canHostHeld(s) && !busySlots.value.has(s.id)).length
  return Math.min(n, heldStack.value?.quantity ?? 0)
})

// Chime once when a plot flips to ready while the page is open.
let lastReady = -1
watch(() => readySlots.value.length, (n) => {
  if (lastReady >= 0 && n > lastReady) sound.play('ready')
  lastReady = n
})

// ── Settings ──────────────────────────────────────────────────────
const autoReplant = useCookie<boolean>('xeno_auto_replant', { default: () => false })
function toggleReplant() {
  autoReplant.value = !autoReplant.value
  sound.play('select')
}

// ── Actions ──────────────────────────────────────────────────────
// Plant, harvest, remove and attach update the garden at once (see useXeno), so
// sounds and effects play on the click. busySlots only stops a second action
// on a plot whose request is still out.
const busySlots = ref(new Set<string>())
const unlocking = ref(false)
const initing = ref(false)
const harvestingAll = ref(false)
const shelfOpen = ref(false)

const summaryOpen = ref(false)
const summaryDrops = ref<HarvestDrop[]>([])
const summarySlots = ref(0)
const summaryReplanted = ref(0)

function tileCenter(slotId: string) {
  return fx.centerOf(document.querySelector(`[data-plot="${slotId}"]`))
}

async function withSlot<T>(slotId: string, run: () => Promise<T>): Promise<T> {
  busySlots.value.add(slotId)
  try {
    return await run()
  } finally {
    busySlots.value.delete(slotId)
  }
}

/** Harvest one slot (replanting it when auto-replant is on). Resolves with the server-rolled drops. */
async function harvestOne(slot: any): Promise<{ drops: HarvestDrop[], replanted: boolean }> {
  const plant = slot.plant
  const res = await withSlot(slot.id, () => harvestSlot(slot.id, { replant: autoReplant.value }))
  const drops: HarvestDrop[] = res.drops?.length
    ? res.drops
    : [{ id: plant.typeId, name: plant.name, count: res.harvested }]
  return { drops, replanted: res.replanted }
}

function celebrateHarvest(slotId: string, plantId: string, drops: HarvestDrop[], at?: { x: number, y: number }) {
  const c = at ?? tileCenter(slotId)
  if (!c) return
  fx.burst(c.x, c.y, { plantId, count: 6, spread: 50 })
  fx.floatDrops(c.x, c.y, drops)
}

async function plantOne(slot: any, at: { x: number, y: number }) {
  const p = selectedPlant.value
  // The optimistic plant takes a seed off the stack at once, so an empty stack
  // means every seed is already on its way to a planter.
  if (!p || (heldStack.value?.quantity ?? 0) < 1) return
  sound.play('plant')
  fx.burst(at.x, at.y + 10, { count: 4, spread: 24 })
  try {
    await withSlot(slot.id, () => plantInSlot(slot.id, p.typeId, p.speed, p.yield))
  } catch { sound.play('error') }
}

async function handleCellClick(cell: any, e: MouseEvent) {
  if (!cell.unlocked) {
    if (cell.isNextUnlock && balanceNum.value >= cell.cost && !unlocking.value) {
      unlocking.value = true
      try {
        await unlockGridSlot()
        sound.play('unlock')
        fx.burst(e.clientX, e.clientY, { count: 8, spread: 50 })
      } catch { sound.play('error') } finally { unlocking.value = false }
    }
    return
  }
  const { slot } = cell
  if (!slot) return
  // The press that started a drag already planted this plot.
  if (strokePlanted.delete(slot.id)) return
  if (busySlots.value.has(slot.id)) return

  // Harvest ripe plants — always takes priority
  if (slot.plant && isDone(slot.plant.completesAt)) {
    const plantId = slot.plant.typeId
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : undefined
    sound.play('harvest')
    if (autoReplant.value) setTimeout(() => sound.play('plant'), 220)
    try {
      const res = await harvestOne(slot)
      celebrateHarvest(slot.id, plantId, res.drops, at)
    } catch { sound.play('error') }
    return
  }

  // Fit the held artifact — replaces any artifact already fitted
  if (selectedArtifact.value) {
    const artifactId = selectedArtifact.value.id
    sound.play('attach')
    try {
      await withSlot(slot.id, () => attachGridArtifact(slot.id, artifactId))
    } catch { sound.play('error') }
    return
  }

  // Plant the held seed in an empty plot
  if (selectedPlant.value && !slot.plant) {
    if (!canHostHeld(slot)) {
      sound.play('error')
      return
    }
    const c = tileCenter(slot.id) ?? { x: e.clientX, y: e.clientY }
    await plantOne(slot, c)
  }
}

// ── Drag to plant ─────────────────────────────────────────────────
// Holding a seed, press on an empty planter and sweep across others to plant
// a row. Mouse and pen only (touch taps plant through the click, so the garden
// still scrolls); the pointer is released so moves can be hit-tested against
// whatever planter is under it.
const strokePlanted = new Set<string>()
let painting = false

function paintTarget(slot: any): boolean {
  return !!slot && !slot.plant && (heldStack.value?.quantity ?? 0) > 0 && !busySlots.value.has(slot.id) && !strokePlanted.has(slot.id) && canHostHeld(slot)
}

function onPaintStart(cell: any, e: PointerEvent) {
  if (!selectedPlant.value || !paintTarget(cell.slot)) return
  strokePlanted.clear()
  painting = true
  lastPoint = { x: e.clientX, y: e.clientY }
  const el = e.currentTarget as Element | null
  if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  strokePlanted.add(cell.slot.id)
  void plantOne(cell.slot, tileCenter(cell.slot.id) ?? { x: e.clientX, y: e.clientY })
  window.addEventListener('pointermove', onPaintMove)
  window.addEventListener('pointerup', onPaintEnd)
  window.addEventListener('pointercancel', onPaintEnd)
}

let lastPoint: { x: number, y: number } | null = null

function paintAt(x: number, y: number) {
  const el = document.elementFromPoint(x, y)?.closest('[data-plot]') as HTMLElement | null
  const id = el?.dataset.plot
  if (!id) return
  const slot = (gridSlots.value as any[]).find(s => s.id === id)
  if (!paintTarget(slot)) return
  strokePlanted.add(id)
  void plantOne(slot, tileCenter(id) ?? { x, y })
}

function onPaintMove(e: PointerEvent) {
  if (!painting || !selectedPlant.value) return
  // Sample the path since the last event so a fast sweep can't skip a planter.
  const from = lastPoint ?? { x: e.clientX, y: e.clientY }
  const steps = Math.max(1, Math.ceil(Math.hypot(e.clientX - from.x, e.clientY - from.y) / 24))
  for (let i = 1; i <= steps; i++) {
    paintAt(from.x + ((e.clientX - from.x) * i) / steps, from.y + ((e.clientY - from.y) * i) / steps)
  }
  lastPoint = { x: e.clientX, y: e.clientY }
}

function onPaintEnd() {
  painting = false
  lastPoint = null
  window.removeEventListener('pointermove', onPaintMove)
  window.removeEventListener('pointerup', onPaintEnd)
  window.removeEventListener('pointercancel', onPaintEnd)
  // A click follows pointerup on the first plot only; forget the rest.
  setTimeout(() => strokePlanted.clear(), 0)
}
onUnmounted(onPaintEnd)

async function doRemove(slotId: string) {
  if (busySlots.value.has(slotId)) return
  sound.play('remove')
  try {
    await withSlot(slotId, () => removePlant(slotId))
  } catch { sound.play('error') }
}

async function doInit() {
  initing.value = true
  try {
    await initGame()
    sound.play('unlock')
  } catch { sound.play('error') } finally { initing.value = false }
}

async function doPlantAll() {
  if (!selectedPlant.value || !plantableCount.value) return
  // Hold every empty plot until the request is back, so a quick remove can't overtake the plant.
  const held = emptySlots.value.map(s => s.id as string).filter(id => !busySlots.value.has(id))
  held.forEach(id => busySlots.value.add(id))
  sound.play('plant')
  try {
    await plantAllSlots(selectedPlant.value.typeId, selectedPlant.value.speed, selectedPlant.value.yield)
  } catch { sound.play('error') } finally { held.forEach(id => busySlots.value.delete(id)) }
}

async function doHarvestAll() {
  if (harvestingAll.value) return
  const targets = readySlots.value.filter(s => !busySlots.value.has(s.id))
  if (!targets.length) return
  harvestingAll.value = true
  // Capture positions and plants before the optimistic update re-renders the tiles.
  const centers = new Map(targets.map(s => [s.id, tileCenter(s.id)]))
  const plantIds = new Map(targets.map(s => [s.id, s.plant.typeId as string]))
  targets.forEach((s, i) => {
    const c = centers.get(s.id)
    if (c) setTimeout(() => fx.burst(c.x, c.y, { plantId: plantIds.get(s.id), count: 4, spread: 40 }), i * 40)
  })
  const aggregate = new Map<string, HarvestDrop>()
  let replanted = 0
  let harvested = 0
  try {
    const results = await Promise.allSettled(targets.map(s => harvestOne(s)))
    results.forEach((r) => {
      if (r.status !== 'fulfilled') return
      harvested++
      if (r.value.replanted) replanted++
      for (const d of r.value.drops) {
        const key = `${d.id}${d.isHybrid ? ':hybrid' : ''}`
        const cur = aggregate.get(key)
        if (cur) cur.count += d.count
        else aggregate.set(key, { ...d })
      }
    })
    if (results.some(r => r.status === 'rejected')) sound.play('error')
    if (harvested) {
      // The receipt is the feedback; floats would land where the plots were
      // before it pushed the garden down.
      sound.play(harvested >= 3 ? 'harvest-big' : 'harvest')
      summaryDrops.value = [...aggregate.values()].sort((a, b) => b.count - a.count)
      summarySlots.value = harvested
      summaryReplanted.value = replanted
      summaryOpen.value = true
    }
  } finally {
    harvestingAll.value = false
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────
function openShelf() {
  if (window.matchMedia('(min-width: 1280px)').matches) {
    document.querySelector<HTMLInputElement>('#xeno-shelf input')?.focus()
    return
  }
  shelfOpen.value = true
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (shelfOpen.value) return
  switch (e.key.toLowerCase()) {
    case 'h': e.preventDefault(); void doHarvestAll(); break
    case 'p': e.preventDefault(); void doPlantAll(); break
    case 'i': e.preventDefault(); openShelf(); break
    case 'escape': clearSelection(); break
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  onUnmounted(() => window.removeEventListener('keydown', onKey))
})

const selectedKey = computed(() => selectedPlant.value ? `${selectedPlant.value.typeId}:${selectedPlant.value.speed}:${selectedPlant.value.yield}` : null)
const heldArtifactDef = computed(() => selectedArtifact.value ? getArtifact(selectedArtifact.value.typeId) : undefined)

// Quick picks in the command bar on smaller screens, where the shelf is a sheet.
const quickSeeds = computed(() => [...(inventory.value as any[])]
  .sort((a, b) => b.tier - a.tier || b.quantity - a.quantity)
  .slice(0, 8))
function quickPick(item: any) {
  onInventorySelectPlant({ typeId: item.typeId, speed: item.speed, yield: item.yield, name: item.name, emoji: item.emoji, tier: item.tier })
}
</script>

<template>
  <div class="mx-auto max-w-[1440px] px-4 md:px-6 pt-5 md:pt-6 flex gap-6 items-start">
    <!-- ── Garden ──────────────────────────────────────────────── -->
    <main class="flex-1 min-w-0 flex flex-col gap-4">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="xg-label">Garden · {{ unlockedCount }} of {{ GRID_TOTAL }} planters</p>
          <h1 class="xg-h text-2xl md:text-3xl mt-1">Your garden</h1>
          <p v-if="state?.initialized" class="xg-stats mt-1.5">
            <b class="!text-(--xg-accent-text)">{{ readySlots.length }}</b> ready ·
            <b>{{ growingCount }}</b> growing ·
            <b>{{ emptySlots.length }}</b> empty
          </p>
        </div>
        <div v-if="state?.initialized" class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="xg-btn sm !pl-2.5"
            :aria-pressed="autoReplant"
            title="Replant the same seed right after every harvest"
            @click="toggleReplant"
          >
            <span class="xg-sw" :class="autoReplant ? 'on' : ''" aria-hidden="true" />
            <span class="hidden sm:inline">Auto-replant</span>
            <span class="sm:hidden">Replant</span>
          </button>
          <XenoButton
            size="sm"
            icon="i-lucide-sprout"
            class="xl:!hidden"
            label="Shelf"
            @click="shelfOpen = true"
          />
          <XenoButton
            :variant="readySlots.length ? 'go' : 'default'"
            size="sm"
            icon="i-lucide-arrow-down-to-line"
            :label="`Harvest ${readySlots.length}`"
            :disabled="!readySlots.length"
            :loading="harvestingAll"
            :waiting="readySlots.length > 0"
            title="Harvest every ripe planter (H)"
            @click="doHarvestAll"
          />
        </div>
      </div>

      <!-- Command bar: what you are holding, and the bulk action for it. Always
           rendered above the planters at one fixed height, so the grid never moves. -->
      <div v-if="state?.initialized" class="xg-cmd flow h-14 max-sm:!gap-2">
        <template v-if="selectedPlant">
          <span class="xg-thumb size-10 shrink-0"><XenoPlantIcon :id="selectedPlant.typeId" :size="34" stage="ready" /></span>
          <span class="flex flex-col min-w-0 mr-1 flex-1">
            <b class="text-[13.5px] truncate flex items-center gap-1.5">
              {{ selectedPlant.name }}
              <span class="xg-tier" :class="tierClass(selectedPlant.tier, heldIsVoid)">{{ roman(selectedPlant.tier) }}</span>
              <span class="xg-faint font-bold text-xs xg-num">×{{ heldStack?.quantity ?? 0 }}</span>
            </b>
            <span class="text-xs text-(--xg-faint) truncate">
              <template v-if="heldIsVoid">Void: only planters with a tier II+ artifact</template>
              <template v-else><span class="sm:hidden">Tap empty planters</span><span class="max-sm:hidden">Click or drag across empty planters</span></template>
            </span>
          </span>
          <XenoButton
            size="sm"
            class="shrink-0"
            :variant="plantableCount ? 'go' : 'default'"
            :disabled="!plantableCount"
            :aria-label="`Plant ${plantableCount} empty`"
            title="Plant the held seed in every empty planter (P)"
            @click="doPlantAll"
          >
            Plant {{ plantableCount }}<span class="max-sm:hidden"> empty</span>
          </XenoButton>
          <XenoButton size="sm" variant="ghost" class="shrink-0 max-sm:!px-2.5" aria-label="Put down (Esc)" @click="clearSelection">
            <UIcon name="i-lucide-x" class="size-4 sm:hidden" /><span class="max-sm:hidden">Put down</span> <span class="xg-kbd hidden sm:inline-flex">Esc</span>
          </XenoButton>
        </template>

        <template v-else-if="selectedArtifact">
          <XenoArtifactGlyph :type-id="selectedArtifact.typeId" :gem-crafted="!!selectedArtifact.gemCrafted" :size="40" />
          <span class="flex flex-col min-w-0 mr-1 flex-1">
            <b class="text-[13.5px] truncate">{{ heldArtifactDef?.name }} <span class="xg-faint font-bold text-xs xg-num">· {{ selectedArtifact.chargesRemaining }} charges</span></b>
            <span class="text-xs text-(--xg-faint) truncate">Click a planter to fit it; a fitted one goes back to the shelf</span>
          </span>
          <XenoButton size="sm" variant="ghost" class="shrink-0 max-sm:!px-2.5" aria-label="Put down (Esc)" @click="clearSelection">
            <UIcon name="i-lucide-x" class="size-4 sm:hidden" /><span class="max-sm:hidden">Put down</span> <span class="xg-kbd hidden sm:inline-flex">Esc</span>
          </XenoButton>
        </template>

        <template v-else>
          <span class="hidden xl:block text-[13px] text-(--xg-muted) px-2 leading-snug">
            Pick a seed or artifact on the shelf, then click empty planters. Drag across planters to plant a row.
          </span>
          <div class="xl:hidden flex flex-1 items-center gap-1.5 min-w-0 overflow-x-auto [scrollbar-width:none]">
            <span v-if="!inventory.length" class="text-xs text-(--xg-muted) px-2">No seeds yet</span>
            <button
              v-for="item in quickSeeds"
              :key="`${item.typeId}:${item.speed}:${item.yield}`"
              type="button"
              class="relative shrink-0 flex flex-col items-center rounded-xl px-1 py-0.5 hover:bg-(--xg-hover)"
              :aria-label="`Hold ${item.name}, speed ${item.speed}, yield ${item.yield}`"
              @click="quickPick(item)"
            >
              <XenoPlantIcon :id="item.typeId" :size="34" stage="ready" />
              <span class="xg-q text-[10.5px] leading-tight">×{{ formatNumber(item.quantity) }}</span>
            </button>
          </div>
          <XenoButton class="xl:!hidden shrink-0" size="sm" icon="i-lucide-panel-right-open" label="All" @click="shelfOpen = true" />
        </template>
      </div>
      <USkeleton v-else-if="!state" class="h-14 rounded-full" />

      <XenoHarvestSummary
        v-if="summaryOpen"
        :drops="summaryDrops"
        :slots="summarySlots"
        :replanted="summaryReplanted"
        @close="summaryOpen = false"
      />

      <!-- Start screen -->
      <section v-if="!pending && state && !state.initialized" class="xg-pane flex flex-col items-center text-center gap-5 px-6 py-16">
        <XenoLogo :size="72" />
        <div>
          <h2 class="xg-h text-2xl md:text-3xl">Start your garden</h2>
          <p class="text-sm text-(--xg-muted) mt-2 max-w-sm mx-auto">
            You start with 6 planters, 4 Sprouts and 4 Tendrils. Grow and harvest them, cross them in the Nursery, and work your way up to tier IX.
          </p>
        </div>
        <XenoButton variant="go" size="lg" icon="i-lucide-sprout" label="Start growing" :loading="initing" @click="doInit" />
      </section>

      <!-- Planters -->
      <section v-else-if="state?.initialized" class="xg-pane p-2.5 sm:p-4" aria-label="Planters">
        <div class="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-2.5">
          <XenoGardenTile
            v-for="cell in fullGrid"
            :key="cell.index"
            :cell="cell"
            :now="now"
            :selected-plant="selectedPlant"
            :selected-artifact="selectedArtifact"
            :unlocking="unlocking && cell.isNextUnlock"
            :can-afford-unlock="balanceNum >= cell.cost"
            :void-blocked="heldIsVoid && cell.unlocked && !!cell.slot && !cell.slot.plant && !canHostHeld(cell.slot)"
            :busy="!!cell.slot && busySlots.has(cell.slot.id) && !harvestingAll"
            @click="(e) => handleCellClick(cell, e)"
            @paint="(e) => onPaintStart(cell, e)"
            @remove="() => doRemove(cell.slot.id)"
          />
        </div>
      </section>

      <!-- Skeleton -->
      <section v-else class="xg-pane p-2.5 sm:p-4">
        <div class="grid grid-cols-4 sm:grid-cols-6 gap-2 sm:gap-2.5">
          <USkeleton v-for="i in GRID_TOTAL" :key="i" class="aspect-[1/1.08] rounded-[18px_18px_18px_6px]" />
        </div>
      </section>

    </main>

    <!-- ── Shelf (xl+) ─────────────────────────────────────────── -->
    <aside
      id="xeno-shelf"
      class="hidden xl:flex xg-pane xg-pane-r flex-col w-[400px] 2xl:w-[440px] shrink-0 p-4 h-[calc(100svh-10.5rem)] min-h-[520px]"
      aria-label="Shelf"
    >
      <XenoInventoryPanel
        :inventory="inventory"
        :free-artifacts="gridFreeArtifacts"
        artifact-domain="grid"
        :selected-plant-key="selectedKey"
        :selected-artifact-id="selectedArtifact?.id ?? null"
        @select-plant="onInventorySelectPlant"
        @select-artifact="onInventorySelectArtifact"
      />
    </aside>
  </div>

  <!-- Shelf sheet below xl -->
  <USlideover
    v-model:open="shelfOpen"
    title="Shelf"
    side="right"
    :ui="{ content: 'xeno max-w-md bg-(--xg-surface)', header: 'border-(--xg-edge)', body: 'flex flex-col min-h-0' }"
  >
    <template #body>
      <XenoInventoryPanel
        :inventory="inventory"
        :free-artifacts="gridFreeArtifacts"
        artifact-domain="grid"
        :selected-plant-key="selectedKey"
        :selected-artifact-id="selectedArtifact?.id ?? null"
        @select-plant="(p) => { onInventorySelectPlant(p); if (p) shelfOpen = false }"
        @select-artifact="(a) => { onInventorySelectArtifact(a); if (a) shelfOpen = false }"
      />
    </template>
  </USlideover>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" />
</template>
