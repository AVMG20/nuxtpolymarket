<script setup lang="ts">
// Big-win showcase over the board. The dimming, portal flare and ember
// fountain are drawn in the Pixi canvas underneath; this layer is the title
// and the counting amount. `tier` 0..4 = BIG … LEGENDARY.
const props = defineProps<{
  label: string
  tier: number
  amount: number
  multiple: number
}>()

defineEmits<{ skip: [] }>()

const TIER_STYLE = [
  { from: '#fff4d6', mid: '#ffb347', to: '#b8430c', glow: 'rgba(255,150,40,0.85)' },
  { from: '#ffe3d1', mid: '#ff6a2b', to: '#8f1d06', glow: 'rgba(255,90,30,0.85)' },
  { from: '#e3f6ff', mid: '#43c8ff', to: '#0b5d99', glow: 'rgba(67,200,255,0.85)' },
  { from: '#f6e6ff', mid: '#c77dff', to: '#5a1a8f', glow: 'rgba(199,125,255,0.85)' },
  { from: '#ffffff', mid: '#ffe066', to: '#ff4d1a', glow: 'rgba(255,220,100,0.95)' }
]

const style = computed(() => {
  const s = TIER_STYLE[Math.max(0, Math.min(TIER_STYLE.length - 1, props.tier))]!
  return { '--bw-from': s.from, '--bw-mid': s.mid, '--bw-to': s.to, '--bw-glow': s.glow }
})
</script>

<template>
  <button type="button" class="ep-bw" :style="style" aria-label="Skip win count-up" @click="$emit('skip')">
    <span class="ep-bw__ring" aria-hidden="true" />
    <Transition name="ep-bw-label" mode="out-in">
      <span :key="label" class="ep-bw__label">
        {{ label }}
      </span>
    </Transition>
    <span class="ep-bw__amount">
      {{ formatNumber(amount) }}
    </span>
    <span class="ep-bw__mult">
      {{ formatNumber(multiple, false) }}× bet
    </span>
    <span class="ep-bw__hint">Tap to skip</span>
  </button>
</template>

<style scoped>
.ep-bw {
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
  container-type: inline-size;
}

.ep-bw:focus-visible { outline: 3px solid var(--bw-mid); outline-offset: -6px; }

.ep-bw::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 86%;
  height: 60%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(6, 8, 22, 0.88) 0%, rgba(6, 8, 22, 0.55) 48%, transparent 72%);
  pointer-events: none;
}

.ep-bw__ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 120%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--bw-mid) 26%, transparent) 0deg 6deg, transparent 6deg 15deg);
  mask-image: radial-gradient(circle, transparent 18%, #000 30%, rgba(0, 0, 0, 0.5) 42%, transparent 58%);
  animation: ep-bw-spin 18s linear infinite;
  pointer-events: none;
}

.ep-bw__label {
  position: relative;
  font-family: var(--ep-display, Georgia, serif);
  font-size: clamp(38px, 11cqw, 96px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: linear-gradient(180deg, #ffffff 0%, var(--bw-from) 20%, var(--bw-mid) 55%, var(--bw-to) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 2px #140a06;
  paint-order: stroke fill;
  filter: drop-shadow(0 4px 0 #140a06) drop-shadow(0 0 26px var(--bw-glow));
  animation: ep-bw-throb 1s ease-in-out infinite;
}

.ep-bw__amount {
  position: relative;
  font-family: var(--ep-number, Georgia, serif);
  font-size: clamp(32px, 8cqw, 64px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fff4dc;
  -webkit-text-stroke: 3px #140a06;
  paint-order: stroke fill;
  text-shadow: 0 4px 0 #140a06, 0 0 26px var(--bw-glow);
}

.ep-bw__mult {
  position: relative;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #e6ecff;
  text-shadow: 0 1px 3px #000;
}

.ep-bw__hint {
  position: relative;
  margin-top: 14px;
  font-family: var(--ep-ui, system-ui, sans-serif);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: rgba(230, 236, 255, 0.7);
}

.ep-bw-label-enter-active { animation: ep-bw-in 0.5s cubic-bezier(0.2, 1.4, 0.4, 1); }
.ep-bw-label-leave-active { transition: opacity 0.12s, transform 0.12s; }
.ep-bw-label-leave-to { opacity: 0; transform: scale(1.3); }

@keyframes ep-bw-in {
  0% { opacity: 0; transform: scale(2.6) rotate(-6deg); filter: brightness(3); }
  60% { opacity: 1; transform: scale(0.92) rotate(1deg); }
  100% { opacity: 1; transform: scale(1); filter: brightness(1); }
}

@keyframes ep-bw-throb {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}

@keyframes ep-bw-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .ep-bw__ring, .ep-bw__label { animation: none; }
}
</style>
