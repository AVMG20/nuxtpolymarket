<script setup lang="ts">
import {
  gridSlotUnlockCost, getArtifact, getEffectValue, getPlantDisplay,
} from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone } from '~/utils/xeno-format'

const {
  state, pending, gridSlots, inventory, freeArtifacts,
  initGame, unlockGridSlot, plantInSlot, harvestSlot, removePlant,
  attachGridArtifact,
} = useXeno()

const GRID_TOTAL = 36

const now = ref(Date.now())
onMounted(() => {
  const t = setInterval(() => { now.value = Date.now() }, 500)
  onUnmounted(() => clearInterval(t))
})

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

// ── Selected plant ────────────────────────────────────────────────
const selectedPlant = ref<{
  typeId: string
  speed: number
  yield: number
  name: string
  emoji: string
  tier: number
} | null>(null)

// ── Selected artifact ─────────────────────────────────────────────
const selectedArtifact = ref<{
  id: string
  typeId: string
  chargesRemaining: number
} | null>(null)

// Deselect plant if the matching stack runs out
watch(inventory, (inv) => {
  if (!selectedPlant.value) return
  const { typeId, speed, yield: yld } = selectedPlant.value as any
  const found = (inv as any[]).find(i => i.typeId === typeId && i.speed === speed && i.yield === yld)
  if (!found) selectedPlant.value = null
})
// Only grid artifacts are relevant in the garden panel
const gridFreeArtifacts = computed(() =>
  (freeArtifacts.value as any[]).filter(a => {
    const art = getArtifact(a.typeId)
    return art?.effects.some(e => e.type.startsWith('grid_'))
  }),
)

// Keep artifact selected after placing — switch to next of same type, clear only if none left
watch(gridFreeArtifacts, (arts) => {
  if (!selectedArtifact.value) return
  if (!(arts as any[]).find(a => a.id === selectedArtifact.value?.id)) {
    const next = (arts as any[]).find(a => a.typeId === selectedArtifact.value?.typeId)
    selectedArtifact.value = next ? { id: next.id, typeId: next.typeId, chargesRemaining: next.chargesRemaining } : null
  }
})

// ── Inventory panel callbacks ─────────────────────────────────────
function onInventorySelectPlant(p: any) {
  selectedPlant.value = p
  if (p) selectedArtifact.value = null
}
function onInventorySelectArtifact(a: any) {
  selectedArtifact.value = a
  if (a) selectedPlant.value = null
}

// ── Full 6×6 grid ────────────────────────────────────────────────
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

// ── Actions ──────────────────────────────────────────────────────
const plantingSlot = ref<string | null>(null)
const attachingSlot = ref<string | null>(null)
const harvesting = ref(new Set<string>())
const removing = ref(new Set<string>())
const unlocking = ref(false)
const initing = ref(false)
const plantingAll = ref(false)
const harvestingAll = ref(false)
const mobileInventoryOpen = ref(false)

const hasReadySlots = computed(() =>
  (gridSlots.value as any[]).some(s => s.plant && isDone(s.plant.completesAt)),
)

// ── Floating harvest numbers ──────────────────────────────────────
let floatSeq = 0
const harvestFloats = ref<Array<{ id: number; x: number; y: number; text: string; colorClass: string }>>([])

function spawnFloat(e: MouseEvent, text: string, colorClass: string) {
  const id = ++floatSeq
  harvestFloats.value.push({ id, x: e.clientX, y: e.clientY - 10, text, colorClass })
  setTimeout(() => {
    harvestFloats.value = harvestFloats.value.filter(f => f.id !== id)
  }, 1500)
}

/** Spawn one floating number per harvest drop (resources + the regrown hybrid), stacked. */
function spawnDrops(x: number, y: number, drops: Array<{ emoji: string; count: number; isHybrid?: boolean }>) {
  drops.forEach((d, i) => {
    const id = ++floatSeq
    harvestFloats.value.push({
      id, x, y: y - 10 - i * 22,
      text: `+${d.count} ${d.emoji}`,
      colorClass: d.isHybrid ? 'text-sky-300' : 'text-primary',
    })
    setTimeout(() => {
      harvestFloats.value = harvestFloats.value.filter(f => f.id !== id)
    }, 1500)
  })
}

async function handleCellClick(cell: any, e: MouseEvent) {
  if (!cell.unlocked) {
    if (cell.isNextUnlock && balance.value >= cell.cost && !unlocking.value) {
      unlocking.value = true
      try { await unlockGridSlot() } finally { unlocking.value = false }
    }
    return
  }
  const { slot } = cell
  if (!slot) return

  // Harvest done plants — always takes priority
  if (slot.plant && isDone(slot.plant.completesAt) && !harvesting.value.has(slot.id)) {
    const plantType = getPlantDisplay(slot.plant.typeId)
    harvesting.value.add(slot.id)
    try {
      const res = await harvestSlot(slot.id)
      if (res?.drops?.length) {
        spawnDrops(e.clientX, e.clientY, res.drops)
      } else if (res && plantType) {
        spawnFloat(e, `+${res.harvested} ${plantType.emoji}`, 'text-primary')
      }
    } finally { harvesting.value.delete(slot.id) }
    return
  }

  // Apply selected artifact to slot (if it has no artifact yet)
  if (selectedArtifact.value && !slot.artifact && !attachingSlot.value) {
    attachingSlot.value = slot.id
    try { await attachGridArtifact(slot.id, selectedArtifact.value.id) }
    finally { attachingSlot.value = null }
    return
  }

  // Plant selected plant in empty slot
  if (selectedPlant.value && !slot.plant && !plantingSlot.value) {
    plantingSlot.value = slot.id
    try { await plantInSlot(slot.id, selectedPlant.value.typeId, selectedPlant.value.speed, selectedPlant.value.yield) }
    finally { plantingSlot.value = null }
  }
}

async function doRemove(slotId: string, e: MouseEvent) {
  e.stopPropagation()
  if (removing.value.has(slotId)) return
  removing.value.add(slotId)
  try { await removePlant(slotId) } finally { removing.value.delete(slotId) }
}

async function doInit() {
  initing.value = true
  try { await initGame() } finally { initing.value = false }
}

async function doPlantAll() {
  if (!selectedPlant.value || plantingAll.value) return
  plantingAll.value = true
  try {
    const emptySlots = (gridSlots.value as any[]).filter(s => !s.plant)
    for (const slot of emptySlots) {
      if (!selectedPlant.value) break
      try { await plantInSlot(slot.id, selectedPlant.value.typeId, selectedPlant.value.speed, selectedPlant.value.yield) }
      catch { break }
    }
  } finally { plantingAll.value = false }
}

async function doHarvestAll() {
  if (harvestingAll.value) return
  harvestingAll.value = true
  try {
    const readySlots = (gridSlots.value as any[]).filter(s => s.plant && isDone(s.plant.completesAt))
    await Promise.all(readySlots.map(async (slot: any) => {
      const plantType = getPlantDisplay(slot.plant.typeId)
      // Capture rect before harvesting — element is removed after state refresh
      const el = document.querySelector(`[data-slot="${slot.id}"]`)
      const rect = el?.getBoundingClientRect()
      const res = await harvestSlot(slot.id)
      if (rect && res?.drops?.length) {
        spawnDrops(rect.left + rect.width / 2, rect.top + rect.height / 2, res.drops)
      } else if (res && plantType && rect) {
        spawnFloat(
          { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 } as MouseEvent,
          `+${res.harvested} ${plantType.emoji}`,
          'text-primary',
        )
      }
    }))
  } finally { harvestingAll.value = false }
}

// Cell interactivity helpers
function cellCursor(cell: any): string {
  if (!cell.unlocked) return cell.isNextUnlock ? 'cursor-pointer' : 'cursor-default'
  const { slot } = cell
  if (!slot) return 'cursor-default'
  if (slot.plant && isDone(slot.plant.completesAt)) return 'cursor-pointer'
  if (selectedArtifact.value && !slot.artifact) return 'cursor-pointer'
  if (selectedPlant.value && !slot.plant) return 'cursor-pointer'
  return 'cursor-default'
}

function isArtifactTargetable(cell: any): boolean {
  return !!selectedArtifact.value && cell.unlocked && cell.slot && !cell.slot.artifact
}

function slotYieldBonus(slot: any): number {
  if (!slot?.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValue(art, 'grid_yield_bonus') : 0
}

function slotSpeedBoost(slot: any): number {
  if (!slot?.artifact) return 0
  const art = getArtifact(slot.artifact.typeId)
  return art ? getEffectValue(art, 'grid_speed_boost') : 0
}

</script>

<template>
  <div class="flex h-full min-h-0">

    <!-- ── Grid area ──────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">

      <div class="flex-1 overflow-y-auto p-4 md:p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-5">
          <div>
            <h1 class="text-xl font-semibold flex items-center gap-2">
              <UIcon name="i-lucide-leaf" class="size-5 text-primary" />
              Xeno Garden
            </h1>
            <p class="text-xs text-muted mt-0.5">Grow, harvest, and evolve xenoflora.</p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              v-if="state?.initialized"
              icon="i-lucide-sprout"
              label="Plant All"
              variant="soft"
              color="primary"
              size="sm"
              :disabled="!selectedPlant"
              :loading="plantingAll"
              @click="doPlantAll"
            />
            <UButton
              v-if="state?.initialized"
              icon="i-lucide-package-2"
              label="Harvest All"
              variant="soft"
              color="primary"
              size="sm"
              :loading="harvestingAll"
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

        <!-- Init screen -->
        <div v-if="!pending && state && !state.initialized" class="flex flex-col items-center justify-center py-24 gap-4">
          <div class="text-6xl">🌱</div>
          <h2 class="text-xl font-bold">Welcome to Xeno</h2>
          <p class="text-muted text-sm text-center max-w-xs">
            Start your xenoflora garden. You'll receive starter plants and 6 open grid slots.
          </p>
          <UButton label="Begin Growing" icon="i-lucide-sprout" size="lg" :loading="initing" @click="doInit" />
        </div>

        <!-- 6×6 Grid -->
        <div v-else-if="state?.initialized" class="grid grid-cols-3 md:grid-cols-6 gap-2">
          <template v-for="cell in fullGrid" :key="cell.index">

            <!-- UNLOCKED — has plant -->
            <div
              v-if="cell.unlocked && cell.slot?.plant"
              :data-slot="cell.slot.id"
              class="group relative rounded-xl border aspect-square flex flex-col p-2 overflow-hidden select-none transition-all duration-100"
              :class="[
                isDone(cell.slot.plant.completesAt)
                  ? 'bg-primary/15 border-primary/40 hover:bg-primary/20 hover:border-primary/60'
                  : ['bg-elevated/50', 'border-default/40', isArtifactTargetable(cell) ? 'ring-1 ring-primary/50 hover:ring-primary' : ''],
                cellCursor(cell),
                (harvesting.has(cell.slot.id) || removing.has(cell.slot.id) || attachingSlot === cell.slot.id) ? 'opacity-50 pointer-events-none' : '',
              ]"
              @click="(e) => handleCellClick(cell, e)"
            >
              <!-- Remove -->
              <button
                class="absolute top-1.5 right-1.5 z-10 size-5 flex items-center justify-center rounded bg-black/30 opacity-0 group-hover:opacity-100 hover:bg-black/60 transition-opacity"
                @click="doRemove(cell.slot.id, $event)"
              >
                <UIcon name="i-lucide-x" class="size-3" />
              </button>

              <!-- Top-left: artifact badge + effect dots -->
              <XenoGridArtifactBadge :slot="cell.slot" />

              <!-- S# Y# badges (normal) / hybrid marker -->
              <div class="absolute top-1.5 right-7 flex flex-col gap-0.5 z-10">
                <template v-if="!cell.slot.plant.isHybrid">
                  <XenoLevelBadge prefix="S" :level="cell.slot.plant.speed" />
                  <XenoLevelBadge prefix="Y" :level="cell.slot.plant.yield" />
                </template>
                <span v-else class="text-[8px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-primary/20 text-primary leading-none">🧬</span>
              </div>

              <!-- Center: emoji + name -->
              <div class="flex-1 flex flex-col items-center justify-center gap-0.5 mt-2">
                <XenoPlantIcon :id="cell.slot.plant.id" :size="44" />
                <p class="text-xs font-medium opacity-60 truncate w-full text-center mt-0.5">{{ cell.slot.plant.name }}</p>
                <div v-if="cell.slot.plant.isHybrid" class="flex items-center gap-0.5 leading-none">
                  <XenoPlantIcon v-for="(r, i) in cell.slot.plant.resources" :key="i" :id="r.id" :size="14" />
                </div>
                <div
                  v-else-if="isDone(cell.slot.plant.completesAt)"
                  class="text-xs font-black text-primary mt-0.5"
                >
                  ×1–{{ 1 + cell.slot.plant.yield + slotYieldBonus(cell.slot) }}
                </div>
              </div>

              <!-- Progress bar -->
              <div class="shrink-0 mt-1">
                <div class="h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-primary"
                    :style="{ width: `${progressPct(cell.slot.plant.startedAt, cell.slot.plant.completesAt, now)}%` }"
                  />
                </div>
                <div class="flex items-center justify-center gap-1 mt-0.5">
                  <p
                    class="text-xs font-medium"
                    :class="isDone(cell.slot.plant.completesAt) ? 'text-primary font-bold' : 'text-muted'"
                  >
                    {{ formatCountdown(cell.slot.plant.completesAt, now) }}
                  </p>
                  <span
                    v-if="!isDone(cell.slot.plant.completesAt) && slotSpeedBoost(cell.slot) > 0"
                    class="text-[9px] font-bold text-primary leading-none"
                  >⚡−{{ Math.round(slotSpeedBoost(cell.slot) * 100) }}%</span>
                </div>
              </div>
            </div>

            <!-- UNLOCKED — empty -->
            <div
              v-else-if="cell.unlocked"
              class="relative rounded-xl border aspect-square flex flex-col items-center justify-center gap-1 select-none transition-all duration-100"
              :class="[
                cellCursor(cell),
                selectedArtifact && !cell.slot?.artifact
                  ? 'border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/70'
                  : selectedPlant
                    ? 'border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/70'
                    : 'border-dashed border-default/40 bg-elevated/20',
                plantingSlot === cell.slot?.id || attachingSlot === cell.slot?.id ? 'opacity-40 pointer-events-none' : '',
              ]"
              @click="(e) => handleCellClick(cell, e)"
            >
              <!-- Slot already has artifact attached (no plant yet) -->
              <template v-if="cell.slot?.artifact">
                <XenoGridArtifactBadge :slot="cell.slot" />
                <p v-if="selectedPlant" class="text-xs text-primary/70 font-medium">Plant here</p>
              </template>
              <!-- No artifact: show preview or empty state -->
              <template v-else>
                <span v-if="isArtifactTargetable(cell)" class="text-lg opacity-50">{{ getArtifact(selectedArtifact!.typeId)?.emoji }}</span>
                <UIcon
                  v-else-if="selectedPlant || selectedArtifact"
                  name="i-lucide-circle-plus"
                  class="size-5 text-primary"
                />
                <UIcon v-else name="i-lucide-plus" class="size-3.5 text-muted/40" />
                <p v-if="selectedPlant" class="text-xs text-primary/70 font-medium">Plant here</p>
                <p v-else-if="selectedArtifact" class="text-xs text-primary/70 font-medium">Attach here</p>
              </template>
            </div>

            <!-- LOCKED — next to unlock -->
            <div
              v-else-if="cell.isNextUnlock"
              class="rounded-xl border border-dashed aspect-square flex flex-col items-center justify-center gap-1.5 select-none transition-all duration-100"
              :class="balance >= cell.cost
                ? 'border-default/50 cursor-pointer hover:bg-elevated/60 hover:border-default'
                : 'border-default/25 cursor-not-allowed opacity-35'"
              @click="(e) => handleCellClick(cell, e)"
            >
              <UIcon
                :name="unlocking ? 'i-lucide-loader-circle' : 'i-lucide-lock'"
                class="size-4 text-muted"
                :class="unlocking ? 'animate-spin' : ''"
              />
              <CoinBalance :value="cell.cost" :compact="false" class="text-xs text-muted/70" />
            </div>

            <!-- LOCKED — future -->
            <div
              v-else
              class="rounded-xl border border-dashed border-default/15 aspect-square flex items-center justify-center opacity-15"
            >
              <UIcon name="i-lucide-lock" class="size-3 text-muted" />
            </div>

          </template>
        </div>

        <!-- Skeleton -->
        <div v-else class="grid grid-cols-3 md:grid-cols-6 gap-2">
          <USkeleton v-for="i in 36" :key="i" class="aspect-square rounded-xl" />
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
          class="shrink-0 border-t border-default bg-background/95 backdrop-blur-sm px-4 md:px-6 py-3 flex items-center gap-3"
        >
          <!-- Plant selected -->
          <template v-if="selectedPlant">
            <XenoPlantIcon :id="selectedPlant.typeId" :size="28" />
            <div class="flex items-center gap-2 min-w-0">
              <p class="text-sm font-semibold truncate">{{ selectedPlant.name }}</p>
              <XenoTierLabel :tier="selectedPlant.tier" class="shrink-0" />
              <span class="text-xs text-muted shrink-0 hidden sm:inline">S{{ selectedPlant.speed }} · Y{{ selectedPlant.yield }}</span>
            </div>
            <div class="ml-auto flex items-center gap-3 shrink-0">
              <p class="text-xs text-muted hidden md:block">Click an empty slot to plant</p>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="selectedPlant = null" />
            </div>
          </template>

          <!-- Artifact selected -->
          <template v-else-if="selectedArtifact">
            <span class="text-xl leading-none">{{ getArtifact(selectedArtifact.typeId)?.emoji }}</span>
            <div class="flex items-center gap-2 min-w-0">
              <p class="text-sm font-semibold truncate">{{ getArtifact(selectedArtifact.typeId)?.name }}</p>
              <span class="text-xs text-muted shrink-0">{{ selectedArtifact.chargesRemaining }} uses</span>
            </div>
            <div class="ml-auto flex items-center gap-3 shrink-0">
              <p class="text-xs text-muted hidden md:block">Click a grid slot to attach</p>
              <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" @click="selectedArtifact = null" />
            </div>
          </template>
        </div>
      </Transition>
    </div>

    <!-- ── Right inventory sidebar (always visible lg+) ─────────── -->
    <USidebar
      collapsible="none"
      side="right"
      class="hidden lg:flex w-[26rem] border-l border-default"
    >
      <div class="flex flex-col h-full overflow-hidden">
        <XenoInventoryPanel
          :inventory="inventory"
          :free-artifacts="gridFreeArtifacts"
          :selected-plant-key="selectedPlant ? `${selectedPlant.typeId}:${selectedPlant.speed}:${selectedPlant.yield}` : null"
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
          :selected-plant-key="selectedPlant ? `${selectedPlant.typeId}:${selectedPlant.speed}:${selectedPlant.yield}` : null"
          :selected-artifact-id="selectedArtifact?.id ?? null"
          @select-plant="onInventorySelectPlant"
          @select-artifact="(a) => { onInventorySelectArtifact(a); mobileInventoryOpen = false }"
        />
      </div>
    </template>
  </USlideover>

  <XenoHarvestFloat :items="harvestFloats" />
</template>
