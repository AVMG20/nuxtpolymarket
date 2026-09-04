<script setup lang="ts">
import { getArtifact, getEffectValueFor } from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone } from '~/lib/xeno-format'

const props = defineProps<{
  cell: any
  now: number
  selectedPlant: any | null
  selectedArtifact: any | null
  busy: boolean
  unlocking: boolean
  canAffordUnlock: boolean
}>()

const emit = defineEmits<{
  click: [e: MouseEvent]
  remove: [e: MouseEvent]
}>()

const slot = computed(() => props.cell.slot)
const plant = computed(() => slot.value?.plant ?? null)

const done = computed(() => {
  void props.now
  return !!plant.value && isDone(plant.value.completesAt)
})
const pct = computed(() => plant.value ? progressPct(plant.value.startedAt, plant.value.completesAt, props.now) : 0)
/** Sprite scale: seedling (0.45) → fully grown (1). */
const growth = computed(() => done.value ? 1 : 0.45 + 0.55 * (pct.value / 100))
const stageLabel = computed(() => {
  if (done.value) return 'Ready'
  if (pct.value < 25) return 'Seedling'
  if (pct.value < 60) return 'Growing'
  if (pct.value < 90) return 'Budding'
  return 'Ripening'
})

const yieldBonus = computed(() => {
  const a = slot.value?.artifact
  if (!a) return 0
  const art = getArtifact(a.typeId)
  return art ? getEffectValueFor(art, 'grid_yield_bonus', a.gemCrafted) : 0
})
const speedBoost = computed(() => {
  const a = slot.value?.artifact
  if (!a) return 0
  const art = getArtifact(a.typeId)
  return art ? getEffectValueFor(art, 'grid_speed_boost', a.gemCrafted) : 0
})

const artifactTargetable = computed(() => !!props.selectedArtifact && props.cell.unlocked && !!slot.value)
const artifactReplacing = computed(() => artifactTargetable.value && !!slot.value?.artifact)
const plantTargetable = computed(() => !!props.selectedPlant && props.cell.unlocked && !!slot.value && !plant.value)

const interactive = computed(() => {
  if (!props.cell.unlocked) return props.cell.isNextUnlock && props.canAffordUnlock
  if (!slot.value) return false
  return done.value || artifactTargetable.value || plantTargetable.value
})

const title = computed(() => {
  if (artifactTargetable.value) {
    const incoming = getArtifact(props.selectedArtifact!.typeId)?.name ?? 'artifact'
    if (slot.value?.artifact) {
      const current = getArtifact(slot.value.artifact.typeId)?.name ?? 'artifact'
      return `Replace ${current} with ${incoming} — ${current} returns to your inventory`
    }
    return `Attach ${incoming} to this plot`
  }
  if (done.value) return 'Click to harvest'
  if (plantTargetable.value) return `Plant ${props.selectedPlant!.name} here`
  if (plant.value) return `${plant.value.name} · ${stageLabel.value}`
  return undefined
})

// Per-tile sway timing so a full grid doesn't move in lockstep. Derived from
// the plot index (not Math.random) so the server and client render the same
// style attribute and hydration stays clean.
const swayStyle = computed(() => {
  const i = props.cell.index as number
  return {
    '--sway-dur': `${3.6 + ((i * 7) % 11) / 5}s`,
    '--sway-delay': `${-((i * 13) % 17) / 4}s`,
  }
})

const SPARKLES = [
  { style: { top: '22%', left: '20%', '--delay': '0s' } },
  { style: { top: '34%', right: '18%', '--delay': '0.9s', '--dur': '2.3s' } },
]
</script>

<template>
  <!-- ── Unlocked, planted ── -->
  <div
    v-if="cell.unlocked && plant"
    :data-plot="slot.id"
    class="xeno-plot group aspect-square select-none flex flex-col"
    :class="[
      done ? 'xeno-plot-ready' : '',
      interactive ? 'xeno-plot-interactive' : '',
      artifactReplacing ? 'xeno-plot-replace' : artifactTargetable ? 'xeno-plot-target' : '',
      busy ? 'xeno-plot-busy' : '',
    ]"
    :title="title"
    @click="emit('click', $event)"
  >
    <!-- Remove -->
    <button
      class="absolute top-1.5 right-1.5 z-20 size-5 flex items-center justify-center rounded-md bg-black/40 text-white/70 opacity-0 group-hover:opacity-100 hover:bg-error hover:text-white transition-all"
      title="Remove plant (returned to inventory)"
      @click.stop="emit('remove', $event)"
    >
      <UIcon name="i-lucide-x" class="size-3" />
    </button>

    <!-- Replace-artifact indicator -->
    <div v-if="artifactReplacing" class="absolute bottom-1.5 right-1.5 z-20 size-5 flex items-center justify-center rounded-full bg-warning text-inverted shadow">
      <UIcon name="i-lucide-repeat" class="size-3" />
    </div>

    <XenoGridArtifactBadge :slot="slot" />

    <!-- S / Y badges -->
    <div class="absolute top-1.5 right-1.5 group-hover:right-7 flex flex-col gap-0.5 z-10 transition-all">
      <template v-if="!plant.isHybrid">
        <XenoLevelBadge prefix="S" :level="plant.speed" />
        <XenoLevelBadge prefix="Y" :level="plant.yield" />
      </template>
      <span v-else class="text-[9px] font-black uppercase tracking-wider px-1 py-0.5 rounded bg-primary/20 text-primary leading-none">🧬</span>
    </div>

    <!-- Sparkles when ready -->
    <template v-if="done">
      <span v-for="(s, i) in SPARKLES" :key="i" class="xeno-sparkle" :style="s.style" />
    </template>

    <!-- Plant -->
    <div class="relative flex-1 flex items-center justify-center min-h-0 pt-5">
      <div class="xeno-plant-stage" :style="{ '--growth': growth }">
        <div :class="done ? 'xeno-ready-bounce' : 'xeno-sway'" :style="done ? undefined : swayStyle">
          <XenoPlantIcon :id="plant.typeId" :size="52" />
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="relative z-10 shrink-0 px-2 pb-1.5 text-center leading-tight">
      <p class="text-[11px] font-semibold truncate opacity-80">{{ plant.name }}</p>
      <div v-if="plant.isHybrid" class="flex items-center justify-center gap-0.5 leading-none mt-0.5">
        <XenoPlantIcon v-for="(r, i) in plant.resources" :key="i" :id="r.id" :size="12" />
      </div>
      <p v-if="done" class="text-xs font-black text-primary mt-0.5">
        Harvest <span class="opacity-80">×1–{{ 1 + (plant.isHybrid ? 0 : plant.yield) + yieldBonus }}</span>
      </p>
      <template v-else>
        <div class="h-1 rounded-full bg-white/10 overflow-hidden mt-1">
          <div class="h-full rounded-full bg-primary transition-[width] duration-500 ease-linear" :style="{ width: `${pct}%` }" />
        </div>
        <p class="text-[11px] font-semibold text-muted tabular-nums mt-0.5">
          {{ formatCountdown(plant.completesAt, now) }}
          <span v-if="speedBoost > 0" class="text-[9px] font-bold text-primary">⚡−{{ Math.round(speedBoost * 100) }}%</span>
        </p>
      </template>
    </div>
  </div>

  <!-- ── Unlocked, empty ── -->
  <div
    v-else-if="cell.unlocked"
    :data-plot="slot?.id"
    class="xeno-plot xeno-plot-empty aspect-square select-none flex flex-col items-center justify-center gap-1"
    :class="[
      artifactReplacing ? 'xeno-plot-replace' : (plantTargetable || artifactTargetable) ? 'xeno-plot-target xeno-plot-interactive' : '',
      busy ? 'xeno-plot-busy' : '',
    ]"
    :title="title"
    @click="emit('click', $event)"
  >
    <XenoGridArtifactBadge v-if="slot?.artifact" :slot="slot" />
    <div v-if="artifactReplacing" class="absolute bottom-1.5 right-1.5 z-20 size-5 flex items-center justify-center rounded-full bg-warning text-inverted shadow">
      <UIcon name="i-lucide-repeat" class="size-3" />
    </div>

    <!-- Ghost preview of the selected seed -->
    <template v-if="plantTargetable">
      <div class="relative flex items-center justify-center">
        <XenoPlantIcon :id="selectedPlant.typeId" :size="44" class="opacity-40 grayscale-[30%]" />
        <UIcon name="i-lucide-plus" class="absolute -bottom-1 -right-1 size-4 text-primary bg-background rounded-full" />
      </div>
      <p class="text-[11px] text-primary font-semibold">Plant here</p>
    </template>
    <template v-else-if="artifactTargetable">
      <span class="text-2xl opacity-60">{{ getArtifact(selectedArtifact.typeId)?.emoji }}</span>
      <p class="text-[11px] font-semibold text-center px-1" :class="artifactReplacing ? 'text-warning' : 'text-primary'">
        {{ artifactReplacing ? 'Replace artifact' : 'Attach here' }}
      </p>
    </template>
    <template v-else>
      <svg width="34" height="22" viewBox="0 0 34 22" class="opacity-30" aria-hidden="true">
        <path d="M17 21V9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M17 13C13 13 9 10 9 5C13 5 17 8 17 13Z" fill="currentColor" />
        <path d="M17 11C21 11 25 8 25 3C21 3 17 6 17 11Z" fill="currentColor" />
      </svg>
      <p class="text-[10px] text-muted/50 font-medium">Empty plot</p>
    </template>
  </div>

  <!-- ── Locked, next ── -->
  <div
    v-else-if="cell.isNextUnlock"
    class="xeno-plot xeno-plot-locked aspect-square select-none flex flex-col items-center justify-center gap-1.5 transition-all"
    :class="canAffordUnlock ? 'xeno-plot-locked-affordable xeno-plot-interactive' : 'opacity-50 cursor-not-allowed'"
    :title="canAffordUnlock ? 'Unlock this plot' : 'Not enough coins'"
    @click="emit('click', $event)"
  >
    <div class="size-9 rounded-full border flex items-center justify-center" :class="canAffordUnlock ? 'border-primary/40 bg-primary/10 text-primary' : 'border-default text-muted'">
      <UIcon :name="unlocking ? 'i-lucide-loader-circle' : canAffordUnlock ? 'i-lucide-lock-open' : 'i-lucide-lock'" class="size-4" :class="unlocking ? 'animate-spin' : ''" />
    </div>
    <CoinBalance :value="cell.cost" :compact="cell.cost >= 100000" class="text-xs font-semibold" :class="canAffordUnlock ? 'text-default' : 'text-muted'" />
    <p class="text-[10px] uppercase tracking-wider font-bold" :class="canAffordUnlock ? 'text-primary' : 'text-muted/60'">{{ canAffordUnlock ? 'Unlock' : 'Locked' }}</p>
  </div>

  <!-- ── Locked, future ── -->
  <div v-else class="xeno-plot xeno-plot-locked aspect-square flex items-center justify-center opacity-25">
    <UIcon name="i-lucide-lock" class="size-3.5 text-muted" />
  </div>
</template>
