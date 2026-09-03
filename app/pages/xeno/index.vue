<script setup lang="ts">
import { gridSlotUnlockCost, getArtifact, getPlantDisplay } from '#shared/utils/xeno'
import { formatCountdown, isDone } from '~/lib/xeno-format'
import type { HarvestDrop } from '~/components/xeno/HarvestSummary.vue'

const {
  state, pending, refresh, gridSlots, inventory, freeArtifacts,
  initGame, unlockGridSlot, plantInSlot, plantAllSlots, harvestSlot, removePlant,
  attachGridArtifact,
} = useXeno()
const sound = useXenoSound()
const fx = useXenoFx()
const toast = useToast()

const GRID_TOTAL = 36

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 500)
  onUnmounted(() => clearInterval(t))
})

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

// ── Selection ─────────────────────────────────────────────────────
const selectedPlant = ref<{ typeId: string; speed: number; yield: number; name: string; emoji: string; tier: number } | null>(null)
const selectedArtifact = ref<{ id: string; typeId: string; chargesRemaining: number } | null>(null)

// Deselect plant if the matching stack runs out
watch(inventory, (inv) => {
  if (!selectedPlant.value) return
  const { typeId, speed, yield: yld } = selectedPlant.value
  if (!(inv as any[]).find(i => i.typeId === typeId && i.speed === speed && i.yield === yld)) selectedPlant.value = null
})

const gridFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => getArtifact(a.typeId)?.effects.some(e => e.type.startsWith('grid_'))),
)

// Keep artifact selected after placing — switch to next of same type, clear only if none left
watch(gridFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!(arts as any[]).find(a => a.id === selectedArtifact.value?.id)) {
    const next = (arts as any[]).find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining } : null
  }
})

function onInventorySelectPlant(p: any) {
  selectedPlant.value = p
  if (p) selectedArtifact.value = null
  sound.play(p ? 'select' : 'deselect')
}
function onInventorySelectArtifact(a: any) {
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

// ── Grid model ────────────────────────────────────────────────────
const fullGrid = computed(() => {
  const slotMap = new Map((gridSlots.value as any[]).map(s => [s.slotIndex, s]))
  const unlockedCount = state.value?.grid?.unlockedCount ?? 0
  return Array.from({ length: GRID_TOTAL }, (_, i) => ({
    index: i,
    unlocked: i < unlockedCount,
    slot: i < unlockedCount ? (slotMap.get(i) ?? null) : null,
    isNextUnlock: i === unlockedCount,
    cost: gridSlotUnlockCost(i),
  }))
})

const readySlots = computed(() => {
  void now.value
  return (gridSlots.value as any[]).filter(s => s.plant && isDone(s.plant.completesAt))
})
const growingSlots = computed(() => {
  void now.value
  return (gridSlots.value as any[]).filter(s => s.plant && !isDone(s.plant.completesAt))
})
const emptySlots = computed(() => (gridSlots.value as any[]).filter(s => !s.plant))
const nextReadyAt = computed(() => {
  const times = growingSlots.value.map(s => new Date(s.plant.completesAt).getTime())
  return times.length ? Math.min(...times) : null
})
const seedCount = computed(() => (inventory.value as any[]).reduce((s, i) => s + i.quantity, 0))

// Chime once when a plot flips to ready while the page is open.
let lastReady = -1
watch(() => readySlots.value.length, (n) => {
  if (lastReady >= 0 && n > lastReady) sound.play('ready')
  lastReady = n
})

// ── Settings ──────────────────────────────────────────────────────
const autoReplant = useCookie<boolean>('xeno_auto_replant', { default: () => false })

// ── Actions ──────────────────────────────────────────────────────
const plantingSlot = ref<string | null>(null)
const attachingSlot = ref<string | null>(null)
const busySlots = ref(new Set<string>())
const unlocking = ref(false)
const initing = ref(false)
const plantingAll = ref(false)
const harvestingAll = ref(false)
const mobileInventoryOpen = ref(false)

const summaryOpen = ref(false)
const summaryDrops = ref<HarvestDrop[]>([])
const summarySlots = ref(0)
const summaryReplanted = ref(0)

function tileCenter(slotId: string) {
  return fx.centerOf(document.querySelector(`[data-plot="${slotId}"]`))
}

function isBusy(cell: any): boolean {
  const id = cell.slot?.id
  if (!id) return false
  return busySlots.value.has(id) || plantingSlot.value === id || attachingSlot.value === id
}

/**
 * Harvest one slot. Returns the drops and whether it was replanted. Refresh is
 * left to the caller so a full-grid harvest hits the state endpoint once.
 */
async function harvestOne(slot: any, opts: { refresh: boolean }): Promise<{ drops: HarvestDrop[]; replanted: boolean } | null> {
  const plant = slot.plant
  const res = await harvestSlot(slot.id, { refresh: false })
  if (!res) return null
  const drops: HarvestDrop[] = res.drops?.length
    ? res.drops
    : [{ id: plant.typeId, name: plant.name, count: res.harvested }]

  let replanted = false
  if (autoReplant.value) {
    // The harvest always returns at least one of the same stack (a hybrid
    // regrows itself), so the slot can go straight back into the ground.
    try {
      await plantInSlot(slot.id, plant.typeId, plant.speed, plant.yield, { refresh: false })
      replanted = true
    } catch { /* stack was consumed elsewhere — leave the plot empty */ }
  }
  if (opts.refresh) await refresh()
  return { drops, replanted }
}

function celebrateHarvest(slotId: string, plantId: string, drops: HarvestDrop[], at?: { x: number; y: number }) {
  const c = at ?? tileCenter(slotId)
  if (!c) return
  fx.burst(c.x, c.y, { plantId, count: 12 })
  fx.floatDrops(c.x, c.y, drops)
}

async function handleCellClick(cell: any, e: MouseEvent) {
  if (!cell.unlocked) {
    if (cell.isNextUnlock && balance.value >= cell.cost && !unlocking.value) {
      unlocking.value = true
      try {
        await unlockGridSlot()
        sound.play('unlock')
        fx.burst(e.clientX, e.clientY, { count: 14, spread: 60 })
      } catch { sound.play('error') } finally { unlocking.value = false }
    }
    return
  }
  const { slot } = cell
  if (!slot) return

  // Harvest done plants — always takes priority
  if (slot.plant && isDone(slot.plant.completesAt)) {
    if (busySlots.value.has(slot.id)) return
    busySlots.value.add(slot.id)
    const plantId = slot.plant.typeId
    const at = { x: e.clientX, y: e.clientY }
    try {
      const res = await harvestOne(slot, { refresh: true })
      if (res) {
        sound.play('harvest')
        if (res.replanted) setTimeout(() => sound.play('plant'), 220)
        celebrateHarvest(slot.id, plantId, res.drops, at)
      }
    } catch { sound.play('error') } finally { busySlots.value.delete(slot.id) }
    return
  }

  // Apply selected artifact to slot — replaces any artifact already attached
  if (selectedArtifact.value && !attachingSlot.value) {
    attachingSlot.value = slot.id
    try {
      await attachGridArtifact(slot.id, selectedArtifact.value.id)
      sound.play('attach')
    } catch { sound.play('error') } finally { attachingSlot.value = null }
    return
  }

  // Plant selected plant in empty slot
  if (selectedPlant.value && !slot.plant && !plantingSlot.value) {
    plantingSlot.value = slot.id
    try {
      await plantInSlot(slot.id, selectedPlant.value.typeId, selectedPlant.value.speed, selectedPlant.value.yield)
      sound.play('plant')
      fx.burst(e.clientX, e.clientY + 10, { count: 6, spread: 28, color: '#a16207' })
    } catch { sound.play('error') } finally { plantingSlot.value = null }
  }
}

async function doRemove(slotId: string) {
  if (busySlots.value.has(slotId)) return
  busySlots.value.add(slotId)
  try {
    await removePlant(slotId)
    sound.play('remove')
  } catch { sound.play('error') } finally { busySlots.value.delete(slotId) }
}

async function doInit() {
  initing.value = true
  try {
    await initGame()
    sound.play('unlock')
  } finally { initing.value = false }
}

async function doPlantAll() {
  if (!selectedPlant.value || plantingAll.value) return
  if (!emptySlots.value.length) {
    toast.add({ title: 'No empty plots to plant', color: 'neutral' })
    return
  }
  plantingAll.value = true
  try {
    await plantAllSlots(selectedPlant.value.typeId, selectedPlant.value.speed, selectedPlant.value.yield)
    sound.play('plant')
  } catch { sound.play('error') } finally { plantingAll.value = false }
}

async function doHarvestAll() {
  if (harvestingAll.value) return
  const targets = readySlots.value.filter(s => !busySlots.value.has(s.id))
  if (!targets.length) {
    toast.add({ title: 'Nothing is ready to harvest yet', color: 'neutral' })
    return
  }
  harvestingAll.value = true
  targets.forEach(s => busySlots.value.add(s.id))
  // Capture positions before the refresh re-renders the tiles.
  const centers = new Map(targets.map(s => [s.id, tileCenter(s.id)]))
  const aggregate = new Map<string, HarvestDrop>()
  let replanted = 0
  let harvested = 0
  try {
    const results = await Promise.allSettled(targets.map(s => harvestOne(s, { refresh: false })))
    results.forEach((r, i) => {
      const slot = targets[i]!
      if (r.status !== 'fulfilled' || !r.value) return
      harvested++
      if (r.value.replanted) replanted++
      for (const d of r.value.drops) {
        const key = `${d.id}${d.isHybrid ? ':hybrid' : ''}`
        const cur = aggregate.get(key)
        if (cur) cur.count += d.count
        else aggregate.set(key, { ...d })
      }
      const c = centers.get(slot.id)
      if (c) setTimeout(() => fx.burst(c.x, c.y, { plantId: slot.plant.typeId, count: 8, spread: 55 }), i * 45)
    })
    if (results.some(r => r.status === 'rejected')) sound.play('error')
    await refresh()
    if (harvested) {
      const drops = [...aggregate.values()].sort((a, b) => b.count - a.count)
      const all = centers.get(targets[0]!.id)
      if (harvested >= 3) {
        sound.play('harvest-big')
        fx.flash(all?.x, all?.y)
        summaryDrops.value = drops
        summarySlots.value = harvested
        summaryReplanted.value = replanted
        summaryOpen.value = true
      } else {
        sound.play('harvest')
        targets.forEach((s) => {
          const c = centers.get(s.id)
          const res = results[targets.indexOf(s)]
          if (c && res?.status === 'fulfilled' && res.value) fx.floatDrops(c.x, c.y, res.value.drops)
        })
      }
    }
  } finally {
    targets.forEach(s => busySlots.value.delete(s.id))
    harvestingAll.value = false
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
  if (summaryOpen.value || mobileInventoryOpen.value) return
  switch (e.key.toLowerCase()) {
    case 'h': e.preventDefault(); void doHarvestAll(); break
    case 'p': e.preventDefault(); void doPlantAll(); break
    case 'i': e.preventDefault(); mobileInventoryOpen.value = true; break
    case 'escape': clearSelection(); break
  }
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  onUnmounted(() => window.removeEventListener('keydown', onKey))
})

const selectedKey = computed(() => selectedPlant.value ? `${selectedPlant.value.typeId}:${selectedPlant.value.speed}:${selectedPlant.value.yield}` : null)
</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Grid area ──────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-4 md:p-6">

        <!-- Header -->
        <div class="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <p class="xeno-eyebrow">Cultivation deck</p>
            <h1 class="text-2xl font-black tracking-tight flex items-center gap-2">
              Garden
              <span v-if="readySlots.length" class="xeno-tab-badge text-[11px]">{{ readySlots.length }} ready</span>
            </h1>
          </div>
          <div class="flex items-center gap-2">
            <UTooltip text="Replant the same seed right after every harvest (A)">
              <label class="flex items-center gap-2 rounded-full border border-default/60 bg-elevated/50 px-3 py-1.5 text-xs font-semibold cursor-pointer select-none">
                <UIcon name="i-lucide-refresh-cw" class="size-3.5" :class="autoReplant ? 'text-primary' : 'text-muted'" />
                <span class="hidden sm:inline">Auto-replant</span>
                <USwitch v-model="autoReplant" size="xs" />
              </label>
            </UTooltip>
            <UButton
              v-if="state?.initialized"
              icon="i-lucide-sprout"
              label="Plant All"
              variant="soft"
              color="primary"
              size="sm"
              :disabled="!selectedPlant || !emptySlots.length"
              :loading="plantingAll"
              title="Plant the selected seed in every empty plot (P)"
              @click="doPlantAll"
            />
            <UButton
              v-if="state?.initialized"
              icon="i-lucide-package-2"
              :label="readySlots.length ? `Harvest All (${readySlots.length})` : 'Harvest All'"
              :variant="readySlots.length ? 'solid' : 'soft'"
              color="primary"
              size="sm"
              :class="readySlots.length ? 'xeno-cta-pulse' : ''"
              :disabled="!readySlots.length"
              :loading="harvestingAll"
              title="Harvest every ready plot (H)"
              @click="doHarvestAll"
            />
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
        </div>

        <!-- HUD stats -->
        <div v-if="state?.initialized" class="xeno-panel rounded-2xl px-3 py-2 mb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <div class="flex items-center gap-1.5">
            <span class="relative flex size-2">
              <span v-if="growingSlots.length" class="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
              <span class="relative inline-flex size-2 rounded-full" :class="growingSlots.length ? 'bg-primary' : 'bg-muted/40'" />
            </span>
            <span class="text-muted">Growing</span>
            <span class="font-black tabular-nums">{{ growingSlots.length }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-sparkles" class="size-3.5" :class="readySlots.length ? 'text-primary' : 'text-muted'" />
            <span class="text-muted">Ready</span>
            <span class="font-black tabular-nums" :class="readySlots.length ? 'text-primary' : ''">{{ readySlots.length }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-timer" class="size-3.5 text-muted" />
            <span class="text-muted">Next</span>
            <span class="font-black tabular-nums">{{ nextReadyAt ? formatCountdown(new Date(nextReadyAt), now) : '—' }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-square-dashed" class="size-3.5 text-muted" />
            <span class="text-muted">Empty</span>
            <span class="font-black tabular-nums" :class="emptySlots.length && selectedPlant ? 'text-primary' : ''">{{ emptySlots.length }}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-package" class="size-3.5 text-muted" />
            <span class="text-muted">Seeds</span>
            <span class="font-black tabular-nums">{{ formatNumber(seedCount, false) }}</span>
          </div>
          <div class="ml-auto hidden md:flex items-center gap-2 text-[10px] text-muted/70">
            <kbd class="rounded border border-default px-1">H</kbd> harvest all
            <kbd class="rounded border border-default px-1">P</kbd> plant all
            <kbd class="rounded border border-default px-1">Esc</kbd> deselect
          </div>
        </div>

        <!-- Init screen -->
        <div v-if="!pending && state && !state.initialized" class="xeno-panel xeno-panel-accent rounded-3xl flex flex-col items-center justify-center py-20 px-6 gap-5 text-center">
          <div class="relative">
            <div class="absolute inset-0 rounded-full bg-primary/20 blur-3xl scale-150" />
            <XenoLogo :size="120" class="relative xeno-pop-in" />
          </div>
          <div>
            <p class="xeno-eyebrow">Welcome, cultivator</p>
            <h2 class="text-3xl font-black tracking-tight mt-1">Your xenoflora garden awaits</h2>
            <p class="text-muted text-sm mt-2 max-w-sm mx-auto">
              You'll start with 6 open plots, 4 Sprouts and 4 Tendrils. Grow them, harvest, breed mutations and climb to Omega tier.
            </p>
          </div>
          <UButton label="Begin Growing" icon="i-lucide-sprout" size="xl" :loading="initing" class="xeno-cta-pulse" @click="doInit" />
        </div>

        <!-- 6×6 Grid -->
        <div v-else-if="state?.initialized" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 md:gap-2.5">
          <XenoGardenTile
            v-for="cell in fullGrid"
            :key="cell.index"
            :cell="cell"
            :now="now"
            :selected-plant="selectedPlant"
            :selected-artifact="selectedArtifact"
            :busy="isBusy(cell)"
            :unlocking="unlocking && cell.isNextUnlock"
            :can-afford-unlock="balance >= cell.cost"
            @click="(e) => handleCellClick(cell, e)"
            @remove="() => doRemove(cell.slot.id)"
          />
        </div>

        <!-- Skeleton -->
        <div v-else class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 md:gap-2.5">
          <USkeleton v-for="i in 36" :key="i" class="aspect-square rounded-2xl" />
        </div>
      </div>

      <!-- Selected plant / artifact bar -->
      <Transition
        enter-from-class="translate-y-full opacity-0"
        enter-active-class="transition-all duration-200 ease-out"
        leave-to-class="translate-y-full opacity-0"
        leave-active-class="transition-all duration-150 ease-in"
      >
        <div
          v-if="selectedPlant || selectedArtifact"
          class="shrink-0 border-t border-primary/30 bg-background/90 backdrop-blur-md px-4 md:px-6 py-3 flex items-center gap-3"
        >
          <template v-if="selectedPlant">
            <div class="relative">
              <XenoPlantIcon :id="selectedPlant.typeId" :size="34" class="xeno-pop-in" />
              <span class="absolute -inset-1 rounded-lg ring-2 ring-primary/50 pointer-events-none" />
            </div>
            <div class="flex items-center gap-2 min-w-0">
              <p class="text-sm font-bold truncate">{{ selectedPlant.name }}</p>
              <XenoTierLabel :tier="selectedPlant.tier" class="shrink-0" />
              <span class="text-xs text-muted shrink-0 hidden sm:inline">S{{ selectedPlant.speed }} · Y{{ selectedPlant.yield }}</span>
            </div>
            <div class="ml-auto flex items-center gap-3 shrink-0">
              <p class="text-xs text-muted hidden md:block">Click an empty plot to plant · <kbd class="rounded border border-default px-1">P</kbd> plants all</p>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="clearSelection" />
            </div>
          </template>

          <template v-else-if="selectedArtifact">
            <span class="xeno-orb size-9 text-lg xeno-pop-in">{{ getArtifact(selectedArtifact.typeId)?.emoji }}</span>
            <div class="flex items-center gap-2 min-w-0">
              <p class="text-sm font-bold truncate">{{ getArtifact(selectedArtifact.typeId)?.name }}</p>
              <span class="text-xs text-muted shrink-0">{{ selectedArtifact.chargesRemaining }} uses</span>
            </div>
            <div class="ml-auto flex items-center gap-3 shrink-0">
              <p class="text-xs text-muted hidden md:block">Click any plot to attach — occupied plots will be swapped</p>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="clearSelection" />
            </div>
          </template>
        </div>
      </Transition>
    </div>

    <!-- ── Right inventory sidebar (always visible lg+) ─────────── -->
    <USidebar
      collapsible="none"
      side="right"
      class="hidden lg:flex w-[26rem] border-l border-default/60 bg-background/40 backdrop-blur-sm"
    >
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="inventory"
          :free-artifacts="gridFreeArtifacts"
          artifact-domain="grid"
          :selected-plant-key="selectedKey"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="onInventorySelectPlant"
          @select-artifact="onInventorySelectArtifact"
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
          :free-artifacts="gridFreeArtifacts"
          artifact-domain="grid"
          :selected-plant-key="selectedKey"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="(p) => { onInventorySelectPlant(p); mobileInventoryOpen = false }"
          @select-artifact="(a) => { onInventorySelectArtifact(a); mobileInventoryOpen = false }"
        />
      </div>
    </template>
  </USlideover>

  <XenoHarvestFloat :items="fx.floats.value" />
  <XenoBurstLayer :particles="fx.particles.value" :flashes="fx.flashes.value" />
  <XenoHarvestSummary v-model:open="summaryOpen" :drops="summaryDrops" :slots="summarySlots" :replanted="summaryReplanted" />
</template>
