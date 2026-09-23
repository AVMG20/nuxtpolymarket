<script setup lang="ts">
// Big-win showcase over the reel window. The dimming, coin fountain and
// bursts are drawn in the Pixi canvas underneath; this layer is the comic
// lettering and the counting amount. `tier` 0..4 = BIG … LEGENDARY.
const props = defineProps<{
  label: string
  tier: number
  amount: number
  multiple: number
}>()

defineEmits<{ skip: [] }>()

const TIER_STYLE = [
  { from: '#fef9c3', mid: '#facc15', to: '#b45309', glow: 'rgba(250,204,21,0.85)' },
  { from: '#dcfce7', mid: '#4ade80', to: '#15803d', glow: 'rgba(74,222,128,0.85)' },
  { from: '#e0f2fe', mid: '#38bdf8', to: '#0369a1', glow: 'rgba(56,189,248,0.85)' },
  { from: '#fae8ff', mid: '#e879f9', to: '#86198f', glow: 'rgba(232,121,249,0.85)' },
  { from: '#ffe4e6', mid: '#fb7185', to: '#9f1239', glow: 'rgba(251,113,133,0.9)' }
]

const style = computed(() => {
  const s = TIER_STYLE[Math.max(0, Math.min(TIER_STYLE.length - 1, props.tier))]!
  return { '--bw-from': s.from, '--bw-mid': s.mid, '--bw-to': s.to, '--bw-glow': s.glow }
})
</script>

<template>
  <button type="button" class="tph-bw" :style="style" aria-label="Skip win count-up" @click="$emit('skip')">
    <span class="tph-bw__rays" aria-hidden="true" />
    <Transition name="tph-bw-label" mode="out-in">
      <span :key="label" class="tph-bw__label">
        {{ label }}
      </span>
    </Transition>
    <span class="tph-bw__amount">
      {{ formatNumber(amount) }}
    </span>
    <span class="tph-bw__mult">
      {{ formatNumber(multiple, false) }}× bet
    </span>
    <span class="tph-bw__hint">Tap to skip count-up</span>
  </button>
</template>

<style scoped>
.tph-bw__hint { position: relative; margin-top: 18px; font-family: 'Fredoka', sans-serif; font-size: 11px; letter-spacing: 0.08em; color: var(--ui-primary); }
.tph-bw:focus-visible { outline: 3px solid var(--ui-primary); outline-offset: -6px; }

.tph-bw {
  position: absolute;
  inset: 0;
  width: 100%;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  overflow: hidden;
  user-select: none;
  container-type: inline-size;
}

.tph-bw::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 82%;
  height: 64%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(12, 6, 30, 0.85) 0%, rgba(12, 6, 30, 0.55) 45%, transparent 72%);
  pointer-events: none;
}

.tph-bw__rays {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 180%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--bw-mid) 24%, transparent) 0deg 9deg, transparent 9deg 22deg);
  mask-image: radial-gradient(circle, #000 0%, rgba(0, 0, 0, 0.6) 25%, transparent 55%);
  animation: tph-bw-spin 14s linear infinite;
  pointer-events: none;
}

.tph-bw__label {
  position: relative;
  font-family: 'Bangers', 'Arial Black', sans-serif;
  font-size: clamp(44px, 12cqw, 104px);
  line-height: 1;
  letter-spacing: 0.04em;
  color: var(--bw-mid);
  background: linear-gradient(180deg, #ffffff 0%, var(--bw-from) 22%, var(--bw-mid) 55%, var(--bw-to) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  -webkit-text-stroke: 3px #1a1030;
  paint-order: stroke fill;
  filter: drop-shadow(4px 6px 0 #1a1030) drop-shadow(0 0 24px var(--bw-glow));
  transform: rotate(-3deg);
  animation: tph-bw-throb 0.9s ease-in-out infinite;
}

.tph-bw__amount {
  position: relative;
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: clamp(34px, 8cqw, 66px);
  font-variant-numeric: tabular-nums;
  color: #fff7d1;
  -webkit-text-stroke: 4px #1a1030;
  paint-order: stroke fill;
  text-shadow: 3px 5px 0 #1a1030, 0 0 26px rgba(250, 204, 21, 0.6);
}

.tph-bw__mult {
  position: relative;
  font-family: 'Fredoka', system-ui, sans-serif;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #f5f3ff;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(0, 0, 0, 0.8);
}

.tph-bw-label-enter-active { animation: tph-bw-in 0.45s cubic-bezier(0.2, 1.6, 0.4, 1); }
.tph-bw-label-leave-active { transition: opacity 0.12s, transform 0.12s; }
.tph-bw-label-leave-to { opacity: 0; transform: scale(1.3); }

@keyframes tph-bw-in {
  from { opacity: 0; transform: scale(0.3) rotate(-14deg); }
  to { opacity: 1; transform: scale(1) rotate(-3deg); }
}

@keyframes tph-bw-throb {
  0%, 100% { transform: rotate(-3deg) scale(1); }
  50% { transform: rotate(-3deg) scale(1.07); }
}

@keyframes tph-bw-spin {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .tph-bw__rays, .tph-bw__label { animation: none; }
}
</style>
