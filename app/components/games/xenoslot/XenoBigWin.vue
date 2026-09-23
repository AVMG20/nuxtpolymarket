<script setup lang="ts">
// Big-win showcase text over the reel window. The dimming, coin fountain and
// bursts are drawn in the Pixi canvas underneath; this layer is the label and
// the counting amount. `tier` 0..3 = BIG, MEGA, EPIC, COSMIC.
const props = defineProps<{
  label: string
  tier: number
  amount: number
  multiple: number
}>()

defineEmits<{ skip: [] }>()

const TIER_STYLE = [
  { from: '#ecfeff', mid: '#22d3ee', to: '#0e7490', glow: 'rgba(34,211,238,0.8)' },
  { from: '#fdf4ff', mid: '#e879f9', to: '#86198f', glow: 'rgba(232,121,249,0.8)' },
  { from: '#fefce8', mid: '#facc15', to: '#b45309', glow: 'rgba(250,204,21,0.85)' },
  { from: '#f7fee7', mid: '#a3e635', to: '#3f6212', glow: 'rgba(163,230,53,0.9)' }
]

const style = computed(() => {
  const s = TIER_STYLE[Math.max(0, Math.min(3, props.tier))]!
  return {
    '--bw-from': s.from,
    '--bw-mid': s.mid,
    '--bw-to': s.to,
    '--bw-glow': s.glow
  }
})
</script>

<template>
  <div class="xs-bw" :style="style" @click="$emit('skip')">
    <div class="xs-bw__rays" />
    <Transition name="xs-bw-label" mode="out-in">
      <p :key="label" class="xs-bw__label">
        {{ label }}
      </p>
    </Transition>
    <p class="xs-bw__amount">
      {{ formatNumber(amount) }}
    </p>
    <p class="xs-bw__mult">
      {{ formatNumber(multiple, false) }}× bet
    </p>
  </div>
</template>

<style scoped>
.xs-bw {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
}

.xs-bw::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 78%;
  height: 62%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(5, 1, 15, 0.85) 0%, rgba(5, 1, 15, 0.55) 45%, transparent 72%);
  pointer-events: none;
}

.xs-bw__rays {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 180%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--bw-mid) 22%, transparent) 0deg 8deg, transparent 8deg 20deg);
  mask-image: radial-gradient(circle, #000 0%, rgba(0, 0, 0, 0.6) 25%, transparent 55%);
  animation: xs-bw-spin 14s linear infinite;
  pointer-events: none;
}

.xs-bw__label {
  position: relative;
  font-family: 'Audiowide', 'Orbitron', sans-serif;
  font-size: clamp(38px, 9cqw, 86px);
  line-height: 1;
  letter-spacing: 0.02em;
  background: linear-gradient(180deg, #ffffff 0%, var(--bw-from) 20%, var(--bw-mid) 55%, var(--bw-to) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(255, 255, 255, 0.35);
  filter: drop-shadow(0 4px 0 rgba(0, 0, 0, 0.55)) drop-shadow(0 0 26px var(--bw-glow));
  animation: xs-bw-throb 0.9s ease-in-out infinite;
}

.xs-bw__amount {
  position: relative;
  font-family: 'Chakra Petch', 'Orbitron', monospace;
  font-weight: 900;
  font-size: clamp(30px, 6.5cqw, 60px);
  font-variant-numeric: tabular-nums;
  color: #fff7d1;
  -webkit-text-stroke: 2px #5b2a02;
  paint-order: stroke fill;
  text-shadow: 0 0 6px rgba(250, 204, 21, 0.9), 0 0 24px rgba(250, 204, 21, 0.6), 0 4px 0 #3b1a02;
}

.xs-bw__mult {
  position: relative;
  font-family: 'Orbitron', monospace;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #f5f3ff;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(0, 0, 0, 0.8);
}

.xs-bw-label-enter-active { animation: xs-bw-in 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
.xs-bw-label-leave-active { transition: opacity 0.12s, transform 0.12s; }
.xs-bw-label-leave-to { opacity: 0; transform: scale(1.3); }

@keyframes xs-bw-in {
  from { opacity: 0; transform: scale(0.3) rotate(-6deg); }
  to { opacity: 1; transform: scale(1) rotate(0); }
}

@keyframes xs-bw-throb {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

@keyframes xs-bw-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .xs-bw__rays, .xs-bw__label { animation: none; }
}
</style>
