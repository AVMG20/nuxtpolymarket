<script setup lang="ts">
import type { GridCell, SymbolId } from '#shared/utils/gamelogic/cyber-cascade'

const props = defineProps<{
  cell: GridCell
  trailMultiplier?: number
  index?: number
}>()

const GRID_WIDTH = 6

const SYMBOL_META: Record<SymbolId, { icon: string, color: string }> = {
  CYBER_SKULL: { icon: 'i-lucide-skull', color: 'text-fuchsia-500' },
  NEON_7: { icon: 'i-lucide-zap', color: 'text-cyan-400' },
  PLASMA_ORB: { icon: 'i-lucide-disc-3', color: 'text-amber-400' },
  DATA_CUBE: { icon: 'i-lucide-box', color: 'text-blue-500' },
  CHIP: { icon: 'i-lucide-cpu', color: 'text-emerald-500' },
}

const hasTrail = computed(() => Boolean(props.trailMultiplier && props.trailMultiplier > 1))

const trailStyle = computed(() => {
  const m = props.trailMultiplier ?? 0
  if (m >= 64) return { bg: 'bg-red-900/40', text: 'text-red-500/40', gradient: 'rgba(239,68,68,0.3)' }
  if (m >= 20) return { bg: 'bg-amber-900/40', text: 'text-amber-500/40', gradient: 'rgba(245,158,11,0.3)' }
  if (m >= 8)  return { bg: 'bg-cyan-900/40', text: 'text-cyan-500/40', gradient: 'rgba(6,182,212,0.3)' }
  return { bg: 'bg-fuchsia-900/30', text: 'text-fuchsia-500/30', gradient: 'rgba(217,70,239,0.2)' }
})

const symbolMeta = computed(() =>
  props.cell.type === 'SYMBOL' && props.cell.symbolId ? SYMBOL_META[props.cell.symbolId] : null
)

// Column-based stagger: each column drops 40ms after the previous
const colDelay = computed(() => {
  if (props.index === undefined) return 0
  return (props.index % GRID_WIDTH) * 40
})

const wildDirectionIcon = computed(() => {
  if (props.cell.type !== 'WILD') return 'i-lucide-move-right'
  const dir = (props.cell as any).direction
  return dir === 1 ? 'i-lucide-move-right' : 'i-lucide-move-left'
})
</script>

<template>
  <div
    class="relative w-full h-full bg-zinc-900/80 border border-white/5 overflow-hidden group"
    :style="{ '--col-delay': colDelay + 'ms' }"
  >

    <!-- Trail Background Layer -->
    <div v-if="hasTrail && trailStyle" class="absolute inset-0 z-0 flex items-center justify-center overflow-hidden" :class="trailStyle.bg">
      <div
        class="absolute inset-0"
        :style="{ background: `radial-gradient(circle at center, ${trailStyle.gradient} 0%, transparent 70%)` }"
      />
      <span class="text-5xl md:text-7xl font-black select-none -rotate-12 transform scale-125 tracking-tighter" :class="trailStyle.text">
        x{{ trailMultiplier }}
      </span>
    </div>

    <!-- Match Highlight Layer -->
    <div
      v-if="cell.isMatch"
      class="absolute inset-0 z-10 border-2 border-white/80 bg-white/10 shadow-[inset_0_0_20px_rgba(255,255,255,0.4)]"
    />

    <!-- Symbol Layer -->
    <div class="absolute inset-0 z-20 p-1 md:p-2">
      <Transition name="sym" mode="out-in">
        <div v-if="cell.type === 'SCATTER'" :key="cell.id" class="w-full h-full flex items-center justify-center relative">
          <div class="absolute inset-0 bg-red-500/20 rounded-full blur-xl animate-pulse" />
          <UIcon
            name="i-lucide-radiation"
            class="w-4/5 h-4/5 text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-[spin_4s_linear_infinite]"
          />
          <div class="absolute inset-0 border-2 border-red-500/50 rounded-full animate-ping" />
        </div>

        <div
          v-else-if="cell.type === 'WILD'"
          :key="cell.id"
          class="wild-card w-full h-full border-2 bg-yellow-950/80 flex flex-col items-center justify-center relative overflow-hidden shadow-lg"
          :class="[
            cell.isMerged ? 'border-white animate-pulse' : 'border-yellow-500',
            (cell as any).direction === 1 ? 'wild-right' : 'wild-left'
          ]"
        >
          <div class="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(234,179,8,0.2)_50%,transparent_75%)] wild-sheen" />
          <span class="text-[7px] text-yellow-200 font-bold uppercase tracking-wider relative z-10">WILD</span>
          <span class="text-xl md:text-3xl font-black text-white drop-shadow-[0_2px_0_rgba(0,0,0,1)] relative z-10">
            {{ cell.multiplier }}x
          </span>
          <div class="absolute bottom-0.5 right-0.5 z-10 bg-black/50 p-0.5 rounded">
            <UIcon
              :name="wildDirectionIcon"
              class="size-2.5 text-yellow-400 wild-dir-bounce"
            />
          </div>
        </div>

        <div
          v-else-if="cell.type === 'SYMBOL' && symbolMeta"
          :key="cell.id"
          class="w-full h-full flex items-center justify-center relative"
        >
          <div class="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity bg-white blur-xl" />
          <UIcon :name="symbolMeta.icon" class="w-3/4 h-3/4 drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]" :class="symbolMeta.color" />
        </div>
      </Transition>
    </div>

  </div>
</template>

<style scoped>
/* Drop animation — enter from above with column stagger */
.sym-enter-active {
  transition: opacity 0.3s ease, transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: var(--col-delay, 0ms);
}
.sym-leave-active {
  transition: all 0.12s ease-in;
}
.sym-enter-from {
  opacity: 0;
  transform: translateY(-110%);
}
.sym-leave-to {
  opacity: 0;
  transform: scale(0.2) brightness(3);
}

/* WILD direction arrow — bounces toward its movement direction */
@keyframes bounce-right {
  0%, 100% { transform: translateX(0); }
  50%       { transform: translateX(4px); }
}
@keyframes bounce-left {
  0%, 100% { transform: translateX(0); }
  50%       { transform: translateX(-4px); }
}

.wild-right .wild-dir-bounce { animation: bounce-right 0.7s ease-in-out infinite; }
.wild-left  .wild-dir-bounce { animation: bounce-left  0.7s ease-in-out infinite; }

/* WILD card sheen that sweeps in the movement direction */
@keyframes sheen-right {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}
@keyframes sheen-left {
  0%   { background-position:  200% center; }
  100% { background-position: -200% center; }
}

.wild-right .wild-sheen {
  background: linear-gradient(90deg, transparent 25%, rgba(234,179,8,0.35) 50%, transparent 75%) !important;
  background-size: 200% 100% !important;
  animation: sheen-right 1.5s linear infinite;
}
.wild-left .wild-sheen {
  background: linear-gradient(90deg, transparent 25%, rgba(234,179,8,0.35) 50%, transparent 75%) !important;
  background-size: 200% 100% !important;
  animation: sheen-left 1.5s linear infinite;
}
</style>
