<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { tierColor, tierBg } from '#shared/utils/xeno'
import { MAX_RESEARCH_LEVEL, MAX_TOTAL_SPEED_PCT, MAX_YIELD_LEVEL, getBug } from '#shared/utils/colony'

const colony = useColony()
const { research } = colony
const sound = useColonySound()
const fx = useColonyFx()

const { user } = useAuth()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const sacrificing = ref<string | null>(null)
const justLeveled = ref<string | null>(null)

const totalLevels = computed(() => research.value.reduce((s: number, r: any) => s + r.level, 0))
const maxLevels = computed(() => research.value.length * MAX_RESEARCH_LEVEL)

function jarColor(typeId: string): string {
  const c = getBug(typeId)?.color
  return c !== undefined ? `#${c.toString(16).padStart(6, '0')}` : 'var(--ui-primary)'
}

async function handleSacrifice(species: any, ev: MouseEvent) {
  if (sacrificing.value) return
  sacrificing.value = species.typeId
  const el = ev.currentTarget as Element
  try {
    await colony.sacrificeForResearch(species.typeId)
    sound.play('research')
    justLeveled.value = species.typeId
    setTimeout(() => { justLeveled.value = null }, 900)
    const card = el.closest('.colony-card')
    fx.celebrate(card ?? el, { emoji: ['🧬', '⚗️', '✨', species.emoji], count: 16, text: `Lv ${species.level + 1}!`, flash: true, color: jarColor(species.typeId) })
  } catch {
    sound.play('error')
  } finally {
    sacrificing.value = null
  }
}

function onHover() {
  sound.play('hover')
}

/** 0..100 width of a range bar for a [min,max] window over the global max. */
function rangeStyle(min: number, max: number, cap: number) {
  return { left: `${(min / cap) * 100}%`, width: `${((max - min) / cap) * 100}%` }
}
</script>

<template>
  <div class="p-3 md:p-5 w-full space-y-4">
    <div class="colony-panel colony-panel-accent p-4 flex flex-col sm:flex-row sm:items-center gap-4 colony-slide-in relative overflow-hidden">
      <div class="colony-shine" />
      <div class="flex items-center gap-3 shrink-0">
        <span class="text-5xl colony-bob">🧪</span>
        <div>
          <p class="colony-eyebrow">
            The lab
          </p>
          <h1 class="text-2xl colony-title">
            Species <span class="text-primary colony-glow-text">Research</span>
          </h1>
        </div>
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-xs text-muted">
          Pour coins into a species to permanently widen its speed and yield rolls for every future purchase, and multiply everything it forages by <span class="font-black text-primary">+25% per level</span> colony-wide — bugs you already own included. Each level costs a multiple of the species' Market price.
        </p>
        <div class="mt-2 flex items-center gap-3">
          <div class="colony-bar flex-1">
            <div
              class="colony-bar-fill"
              :style="{ width: `${maxLevels ? (totalLevels / maxLevels) * 100 : 0}%` }"
            />
          </div>
          <span class="colony-chip colony-chip-amber">{{ totalLevels }} / {{ maxLevels }} discoveries</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <div
        v-for="(species, idx) in research"
        :key="species.typeId"
        class="colony-card colony-slide-in"
        :class="[species.atMax ? 'colony-card-max' : '', justLeveled === species.typeId ? 'colony-levelup' : '']"
        :style="{ animationDelay: `${idx * 50}ms` }"
      >
        <span
          v-if="species.atMax"
          class="colony-ribbon"
        >Mastered</span>

        <div class="p-3.5 flex gap-3">
          <div class="shrink-0 relative">
            <div
              class="absolute inset-0 rounded-full blur-xl opacity-30"
              :style="{ background: jarColor(species.typeId) }"
            />
            <ColonySpecimenJar
              :emoji="species.emoji"
              :fill="Math.max(0.12, species.level / MAX_RESEARCH_LEVEL)"
              :color="jarColor(species.typeId)"
              :boiling="sacrificing === species.typeId || justLeveled === species.typeId"
              :size="96"
              class="relative"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-black text-sm truncate">
                  {{ species.name }}
                </p>
                <span
                  class="text-[10px] font-black rounded-full border px-1.5 py-0.5"
                  :class="[tierColor(species.tier), tierBg(species.tier)]"
                >T{{ species.tier }}</span>
              </div>
              <div class="text-right shrink-0">
                <p class="colony-eyebrow">
                  Level
                </p>
                <p class="text-2xl font-black leading-none text-primary tabular-nums">
                  {{ species.level }}<span class="text-xs text-muted">/{{ MAX_RESEARCH_LEVEL }}</span>
                </p>
              </div>
            </div>

            <!-- Vials -->
            <div class="flex gap-1 mt-2">
              <span
                v-for="i in MAX_RESEARCH_LEVEL"
                :key="i"
                class="h-2.5 flex-1 rounded-full border border-default transition-all"
                :class="i <= species.level ? 'bg-primary shadow-[0_0_8px_var(--colony-glow)]' : i === species.level + 1 ? 'colony-pip-next bg-primary/30' : 'bg-elevated'"
              />
            </div>

            <div class="mt-2.5 space-y-2">
              <!-- Multiplier -->
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted font-bold">Forage multiplier</span>
                <span class="font-mono font-black">
                  <span class="text-highlighted">×{{ species.resourceMultiplier }}</span>
                  <template v-if="species.nextResourceMultiplier">
                    <span class="text-muted"> → </span><span class="text-primary">×{{ species.nextResourceMultiplier }}</span>
                  </template>
                </span>
              </div>
              <!-- Speed range bar -->
              <div>
                <div class="flex items-center justify-between text-[10px] font-bold text-muted mb-0.5">
                  <span>⚡ Speed roll</span>
                  <span class="font-mono">
                    {{ species.speedMin }}–{{ species.speedMax }}%
                    <template v-if="species.nextSpeedRange"><span class="text-primary"> → {{ species.nextSpeedRange[0] }}–{{ species.nextSpeedRange[1] }}%</span></template>
                  </span>
                </div>
                <div class="colony-bar !h-2 relative">
                  <div
                    v-if="species.nextSpeedRange"
                    class="absolute inset-y-0 rounded-full bg-primary/25"
                    :style="rangeStyle(species.nextSpeedRange[0], species.nextSpeedRange[1], MAX_TOTAL_SPEED_PCT)"
                  />
                  <div
                    class="absolute inset-y-0 rounded-full bg-warning shadow-[0_0_8px_rgba(245,179,66,.6)]"
                    :style="rangeStyle(species.speedMin, species.speedMax, MAX_TOTAL_SPEED_PCT)"
                  />
                </div>
              </div>
              <!-- Yield range bar -->
              <div>
                <div class="flex items-center justify-between text-[10px] font-bold text-muted mb-0.5">
                  <span>💎 Yield roll</span>
                  <span class="font-mono">
                    {{ species.yieldMin }}–{{ species.yieldMax }}
                    <template v-if="species.nextYieldRange"><span class="text-primary"> → {{ species.nextYieldRange[0] }}–{{ species.nextYieldRange[1] }}</span></template>
                  </span>
                </div>
                <div class="colony-bar !h-2 relative">
                  <div
                    v-if="species.nextYieldRange"
                    class="absolute inset-y-0 rounded-full bg-primary/25"
                    :style="rangeStyle(species.nextYieldRange[0] - 1, species.nextYieldRange[1], MAX_YIELD_LEVEL)"
                  />
                  <div
                    class="absolute inset-y-0 rounded-full bg-info shadow-[0_0_8px_rgba(56,189,248,.6)]"
                    :style="rangeStyle(species.yieldMin - 1, species.yieldMax, MAX_YIELD_LEVEL)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="colony-divider" />
        <div class="p-3.5">
          <button
            v-if="!species.atMax"
            class="colony-btn colony-btn-block"
            :class="balance >= (species.cost ?? 0) ? 'colony-btn-primary' : 'colony-btn-ghost'"
            :disabled="balance < (species.cost ?? 0) || sacrificing === species.typeId"
            @click="handleSacrifice(species, $event)"
            @mouseenter="onHover"
          >
            <UIcon
              name="i-lucide-dna"
              class="size-4"
              :class="sacrificing === species.typeId ? 'animate-spin' : ''"
            />
            <span class="flex items-center gap-1">
              Sequence Lv {{ species.level + 1 }} · <CoinBalance
                :value="species.cost ?? 0"
                :show-icon="false"
              /> 🪙
            </span>
          </button>
          <p
            v-else
            class="text-xs colony-amber-text font-black flex items-center justify-center gap-1.5 py-1"
          >
            <UIcon
              name="i-lucide-crown"
              class="size-4"
            />
            Genome fully mapped
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
