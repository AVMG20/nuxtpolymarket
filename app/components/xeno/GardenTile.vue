<script setup lang="ts">
import { getArtifact, getEffectValueFor, getPlant, getPlantDisplay, plantStageForProgress } from '#shared/utils/xeno'
import { formatCountdown, progressPct, isDone } from '~/lib/xeno-format'
import { artifactFamily, levelClass, roman } from '~/lib/xeno-ui'

const props = defineProps<{
  cell: any
  now: number
  selectedPlant: any | null
  selectedArtifact: any | null
  unlocking: boolean
  canAffordUnlock: boolean
  /** The held seed is a void plant and this plot has no tier II+ artifact. */
  voidBlocked?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  click: [e: MouseEvent]
  paint: [e: PointerEvent]
  remove: [e: MouseEvent]
}>()

const slot = computed(() => props.cell.slot)
const plant = computed(() => slot.value?.plant ?? null)
const artifact = computed(() => slot.value?.artifact ?? null)
const artDef = computed(() => artifact.value ? getArtifact(artifact.value.typeId) : undefined)

const done = computed(() => {
  void props.now
  return !!plant.value && isDone(plant.value.completesAt)
})
const pct = computed(() => plant.value ? progressPct(plant.value.startedAt, plant.value.completesAt, props.now) : 0)
/** Overall growth 0..1 for the plant art. */
const growth = computed(() => done.value ? 1 : Math.min(0.99, pct.value / 100))
const isVoidPlant = computed(() => !!plant.value && !!getPlant(plant.value.typeId)?.voidPlant)

const yieldBonus = computed(() => {
  const a = artifact.value
  return a && artDef.value ? getEffectValueFor(artDef.value, 'grid_yield_bonus', a.gemCrafted) : 0
})
const speedBoost = computed(() => {
  const a = artifact.value
  return a && artDef.value ? getEffectValueFor(artDef.value, 'grid_speed_boost', a.gemCrafted) : 0
})

const artifactTargetable = computed(() => !!props.selectedArtifact && props.cell.unlocked && !!slot.value)
const artifactReplacing = computed(() => artifactTargetable.value && !!artifact.value)
const plantTargetable = computed(() => !!props.selectedPlant && props.cell.unlocked && !!slot.value && !plant.value && !props.voidBlocked)
const dimmed = computed(() => !!props.selectedPlant && props.cell.unlocked && !plant.value && !!props.voidBlocked)

const harvestRange = computed(() => {
  if (!plant.value) return ''
  return `×1–${1 + (plant.value.isHybrid ? 0 : plant.value.yield) + yieldBonus.value}`
})

const incoming = computed(() => props.selectedArtifact ? getArtifact(props.selectedArtifact.typeId)?.name ?? 'artifact' : '')

const label = computed(() => {
  const n = props.cell.index + 1
  if (!props.cell.unlocked) {
    if (!props.cell.isNextUnlock) return `Planter ${n}, locked`
    return props.canAffordUnlock ? `Add planter ${n} for ${formatNumber(props.cell.cost, false)} coins` : `Planter ${n} costs ${formatNumber(props.cell.cost, false)} coins`
  }
  if (artifactTargetable.value) {
    return artifactReplacing.value
      ? `Swap ${artDef.value?.name ?? 'artifact'} for ${incoming.value} on planter ${n}`
      : `Fit ${incoming.value} to planter ${n}`
  }
  if (plant.value) {
    if (done.value) return `${plant.value.name}, ready to harvest`
    return `${plant.value.name}, ${formatCountdown(plant.value.completesAt, props.now)} left`
  }
  if (plantTargetable.value) return `Plant ${props.selectedPlant.name} in planter ${n}`
  if (dimmed.value) return `Planter ${n}: void seeds need a tier II+ artifact here`
  return `Empty planter ${n}`
})

const classes = computed(() => {
  const c: string[] = []
  if (!props.cell.unlocked) {
    c.push('locked')
    if (props.cell.isNextUnlock) c.push('next', props.canAffordUnlock ? 'affordable' : '')
    return c
  }
  if (plant.value) {
    // A planted stack always shows its corner tags; the art moves down to clear them.
    c.push('has-tags')
    if (done.value) c.push('ready')
    if (isVoidPlant.value) c.push('void')
  } else {
    c.push('empty')
  }
  if (artifactReplacing.value) c.push('replace')
  else if (artifactTargetable.value || plantTargetable.value) c.push('target')
  if (plantTargetable.value) c.push('paintable')
  if (dimmed.value) c.push('dim')
  return c
})

const tierVar = computed(() => plant.value ? `var(--xg-t${Math.min(9, plant.value.tier)})` : undefined)

// Drag-planting is for mouse and pen. On touch a press may be the start of a
// scroll, so a tap plants through the regular click instead.
function onPointerDown(e: PointerEvent) {
  if (plantTargetable.value && e.button === 0 && e.pointerType !== 'touch') emit('paint', e)
}

/** Shelf-style details for the planted stack, shown on hover. */
const display = computed(() => plant.value ? getPlantDisplay(plant.value.typeId) : null)
const tooltipOff = computed(() => !plant.value || !display.value || !!props.selectedPlant || !!props.selectedArtifact)
const tooltipUi = { content: 'h-auto p-0 bg-transparent ring-0 shadow-none' }
</script>

<template>
  <div class="xg-plot-wrap relative" :class="done ? 'is-ready' : ''">
    <UTooltip :disabled="tooltipOff" :delay-duration="450" :content="{ side: 'top', sideOffset: 6 }" :ui="tooltipUi">
      <template #content>
        <XenoPlantTooltipContent
          v-if="plant && display"
          :id="plant.typeId"
          :name="plant.name"
          :tier="plant.tier"
          :speed="plant.speed"
          :yield="plant.yield"
          :base-time="display.baseTime"
          :value="plant.value"
          :description="display.description"
          :is-hybrid="plant.isHybrid"
          :resources="plant.resources"
        />
      </template>
    <button
      type="button"
      class="xg-plot"
      :class="classes"
      :data-plot="slot?.id"
      :data-cell="cell.index"
      :style="plant ? { '--p': done ? 100 : pct, '--tc': isVoidPlant ? 'var(--xg-uv)' : tierVar } : undefined"
      :aria-label="label"
      :title="tooltipOff ? label : undefined"
      :disabled="!cell.unlocked && (!cell.isNextUnlock || !canAffordUnlock)"
      @pointerdown="onPointerDown"
      @click="emit('click', $event)"
    >
      <!-- Planted -->
      <template v-if="cell.unlocked && plant">
        <span class="xg-plot-art">
          <XenoPlantIcon :id="plant.typeId" size="100%" :stage="plantStageForProgress(growth)" :progress="growth" />
        </span>
        <span class="xg-plot-foot">
          <span class="xg-plot-meta">
            <!-- Small tiles keep one value per state: the harvest range, or the time left. -->
            <template v-if="done">
              <span class="truncate max-sm:hidden">Ready</span>
              <span class="max-sm:mx-auto">{{ harvestRange }}</span>
            </template>
            <template v-else>
              <span class="truncate max-sm:mx-auto">{{ formatCountdown(plant.completesAt, now) }}</span>
              <span v-if="speedBoost > 0" class="text-(--xg-faint) max-sm:hidden">−{{ Math.round(speedBoost * 100) }}%</span>
              <span v-else class="max-sm:hidden">{{ Math.floor(pct) }}%</span>
            </template>
          </span>
          <span class="xg-root"><span /></span>
        </span>
      </template>

      <!-- Empty -->
      <template v-else-if="cell.unlocked">
        <span v-if="plantTargetable" class="xg-plot-center text-(--xg-accent-text)">
          <UIcon name="i-lucide-plus" class="size-5" />
          <span>Plant</span>
        </span>
        <span v-else-if="artifactTargetable" class="xg-plot-center" :class="artifactReplacing ? 'text-(--xg-sun)' : 'text-(--xg-accent-text)'">
          <UIcon :name="artifactReplacing ? 'i-lucide-repeat' : 'i-lucide-plus'" class="size-5" />
          <span>{{ artifactReplacing ? 'Swap' : 'Fit' }}</span>
        </span>
        <span v-else-if="dimmed" class="xg-plot-center text-(--xg-faint)">
          <UIcon name="i-lucide-ban" class="size-4.5" />
        </span>
      </template>

      <!-- Next unlock -->
      <span v-else-if="cell.isNextUnlock" class="xg-plot-center" :class="canAffordUnlock ? 'text-(--xg-sun)' : 'text-(--xg-faint)'">
        <UIcon :name="unlocking ? 'i-lucide-loader-circle' : canAffordUnlock ? 'i-lucide-plus' : 'i-lucide-lock'" class="size-5" :class="unlocking ? 'animate-spin' : ''" />
        <span>{{ canAffordUnlock ? 'Add planter' : 'Planter' }}</span>
        <span class="flex items-center gap-1 xg-num text-[11px]"><span class="xg-coin" />{{ formatNumber(cell.cost) }}</span>
      </span>

      <!-- Locked -->
      <span v-else class="xg-plot-center text-(--xg-faint)">
        <UIcon name="i-lucide-lock" class="size-4" />
      </span>

      <span v-if="cell.unlocked && (artifact || plant)" class="xg-plot-tl">
        <!-- Fitted artifact -->
        <span
          v-if="artifact"
          class="xg-tag"
          :class="[artifactFamily(artifact.typeId).cls, artifact.gemCrafted ? 'gem' : '']"
          :title="`${artDef?.name ?? 'Artifact'}${artifact.gemCrafted ? ' (gem-crafted)' : ''} · ${artifact.chargesRemaining} charges left`"
        >
          <UIcon :name="artifactFamily(artifact.typeId).icon" class="size-3 text-(--gc)" />
          <span>{{ roman(artDef?.level ?? 1) }}</span>
          <span class="text-(--xg-faint)">·</span>
          <span>{{ artifact.chargesRemaining }}</span>
        </span>
        <!-- Planted stack: hybrid genes, or speed and yield levels -->
        <span v-if="plant?.isHybrid" class="xg-tag lv" :title="`Hybrid of ${plant.resources?.map((r: any) => r.name).join(', ')}`">
          <UIcon name="i-lucide-dna" class="ic size-3" />
          <span class="sm:hidden">{{ plant.resources?.length ?? 0 }}</span>
          <XenoPlantIcon v-for="(r, i) in plant.resources" :key="i" :id="r.id" :size="12" class="max-sm:hidden" />
        </span>
        <span v-else-if="plant" class="xg-tag lv" :title="`Speed ${plant.speed} · Yield ${plant.yield}`">
          <span class="inline-flex items-center gap-0.5" :class="levelClass(plant.speed)"><UIcon name="i-lucide-zap" class="size-3" />{{ plant.speed }}</span>
          <span class="sep" />
          <span class="inline-flex items-center gap-0.5" :class="levelClass(plant.yield)"><UIcon name="i-lucide-droplet" class="size-3" />{{ plant.yield }}</span>
        </span>
      </span>

      <span v-if="busy" class="xg-busy" />
    </button>
    </UTooltip>

    <button
      v-if="cell.unlocked && plant && !selectedArtifact"
      type="button"
      class="xg-plot-x"
      :aria-label="`Remove ${plant.name} (back to the shelf)`"
      title="Remove plant (back to the shelf)"
      @click.stop="emit('remove', $event)"
    >
      <UIcon name="i-lucide-x" class="size-3.5" />
    </button>
  </div>
</template>
