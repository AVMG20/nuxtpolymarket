<script setup lang="ts">
// Free spins intro: announces the spins, then draws the bonus symbol on a
// spinning strip. The symbol was already decided (and paid) by the server;
// the strip only decelerates onto it.
import type { BonusTier } from '#shared/utils/gamelogic/bookofshadows'
import { BONUS_TIERS, PAYTABLE } from '#shared/utils/gamelogic/bookofshadows'
import { bosIconStyle } from '~/utils/bookofshadows-sprite'

const props = defineProps<{
  tier: BonusTier
  spins: number
  bet: number
  auto?: boolean
  fast?: boolean
}>()

const emit = defineEmits<{
  tick: []
  reveal: []
  done: []
}>()

const TILE = 104
const GAP = 12
const STEP = TILE + GAP
const TARGET_INDEX = 34

// Cosmetic strip: shuffled tiers with the real result at TARGET_INDEX.
const strip: BonusTier[] = []
for (let i = 0; i < TARGET_INDEX + 4; i++) strip.push(BONUS_TIERS[Math.floor(Math.random() * BONUS_TIERS.length)]!)
strip[TARGET_INDEX] = props.tier

const phase = ref<'ready' | 'rolling' | 'revealed'>('ready')
const offset = ref(0)
const viewport = ref<HTMLDivElement | null>(null)
const viewportW = ref(560)
let raf = 0
let autoTimer: ReturnType<typeof setTimeout> | null = null
let resizeObserver: ResizeObserver | null = null

const stripStyle = computed(() => ({ transform: `translate3d(${viewportW.value / 2 - TILE / 2 - offset.value}px, 0, 0)` }))
const wildPays = computed(() => PAYTABLE.bonuswild.map(p => p * props.tier.multiplier * props.bet))

function roll() {
  if (phase.value !== 'ready') return
  phase.value = 'rolling'
  const start = performance.now()
  const duration = props.fast ? 2000 : 3400
  const end = TARGET_INDEX * STEP
  let lastIndex = 0
  const frame = (now: number) => {
    const k = Math.min(1, (now - start) / duration)
    const eased = 1 - Math.pow(1 - k, 4)
    offset.value = end * eased
    const index = Math.round(offset.value / STEP)
    if (index !== lastIndex) {
      lastIndex = index
      emit('tick')
    }
    if (k < 1) {
      raf = requestAnimationFrame(frame)
    } else {
      phase.value = 'revealed'
      emit('reveal')
      autoTimer = setTimeout(() => emit('done'), props.fast ? 1400 : 2600)
    }
  }
  raf = requestAnimationFrame(frame)
}

function press() {
  if (phase.value === 'ready') roll()
  else if (phase.value === 'revealed') {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
    emit('done')
  }
}

defineExpose({ press })

onMounted(() => {
  if (viewport.value) {
    viewportW.value = viewport.value.clientWidth
    resizeObserver = new ResizeObserver(() => {
      if (viewport.value) viewportW.value = viewport.value.clientWidth
    })
    resizeObserver.observe(viewport.value)
  }
  if (props.auto) autoTimer = setTimeout(roll, 1200)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (autoTimer) clearTimeout(autoTimer)
  resizeObserver?.disconnect()
})
</script>

<template>
  <div class="bos-intro">
    <div class="bos-intro-glow" />
    <p class="bos-intro-kicker">
      The book opens
    </p>
    <h2 class="bos-intro-title">
      <span class="bos-intro-count">{{ spins }}</span>
      Free Spins
    </h2>

    <div
      ref="viewport"
      class="bos-intro-viewport"
    >
      <div
        class="bos-intro-strip"
        :style="stripStyle"
      >
        <div
          v-for="(t, i) in strip"
          :key="i"
          class="bos-intro-tile"
          :class="{ 'bos-intro-tile-win': phase === 'revealed' && i === TARGET_INDEX }"
        >
          <span
            class="bos-intro-art"
            :style="bosIconStyle(t.symbol, true, 76)"
          />
          <span class="bos-intro-mult">×{{ t.multiplier }}</span>
        </div>
      </div>
      <div class="bos-intro-marker" />
    </div>

    <div class="bos-intro-copy">
      <template v-if="phase === 'revealed'">
        <p class="bos-intro-result">
          {{ tier.label }} <strong>×{{ tier.multiplier }}</strong>
        </p>
        <p class="bos-intro-line">
          Wild runs pay {{ formatNumber(wildPays[0]!) }} · {{ formatNumber(wildPays[1]!) }} · {{ formatNumber(wildPays[2]!) }}
          <span class="bos-intro-dim">(3 · 4 · 5 reels)</span>
        </p>
      </template>
      <p
        v-else
        class="bos-intro-line"
      >
        Draw a symbol. Its multiplier applies to every wild run in the feature.
      </p>
    </div>

    <button
      type="button"
      class="bos-intro-btn"
      :disabled="phase === 'rolling'"
      @click="press"
    >
      {{ phase === 'ready' ? 'Draw symbol' : phase === 'rolling' ? 'Drawing…' : 'Start' }}
    </button>
  </div>
</template>

<style scoped>
.bos-intro {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  overflow: hidden;
  padding: 16px;
  background: radial-gradient(ellipse 80% 70% at 50% 40%, rgba(30, 44, 14, 0.9), rgba(4, 3, 2, 0.96) 72%);
  border-radius: inherit;
  text-align: center;
}

.bos-intro-glow {
  position: absolute;
  left: 50%;
  top: 30%;
  width: 520px;
  height: 520px;
  translate: -50% -50%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(157, 255, 106, 0.22), transparent 62%);
  animation: bos-intro-breathe 2.6s ease-in-out infinite alternate;
  pointer-events: none;
}

@keyframes bos-intro-breathe {
  to {
    opacity: 0.55;
    scale: 1.12;
  }
}

.bos-intro-kicker {
  position: relative;
  color: #b6d98e;
  font-family: Cinzel, Georgia, serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.34em;
  text-transform: uppercase;
}

.bos-intro-title {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 14px;
  font-family: 'Cinzel Decorative', Cinzel, Georgia, serif;
  font-size: clamp(30px, 5vw, 58px);
  font-weight: 900;
  line-height: 1;
  background: linear-gradient(180deg, #fffbe6, #ffe08a 35%, #d9951f 70%, #7a430a);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 3px 0 #1d0e03) drop-shadow(0 0 22px rgba(255, 190, 80, 0.45));
  animation: bos-intro-in 700ms cubic-bezier(0.2, 1.5, 0.4, 1) both;
}

.bos-intro-count {
  font-size: 1.5em;
}

@keyframes bos-intro-in {
  from {
    opacity: 0;
    transform: scale(1.8);
  }
}

.bos-intro-viewport {
  position: relative;
  width: min(560px, 100%);
  height: 136px;
  overflow: hidden;
  border: 1px solid rgba(214, 170, 90, 0.5);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), rgba(20, 12, 6, 0.75));
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.8), 0 0 30px rgba(157, 255, 106, 0.12);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}

.bos-intro-strip {
  position: absolute;
  top: 10px;
  left: 0;
  display: flex;
  gap: 12px;
  will-change: transform;
}

.bos-intro-tile {
  display: flex;
  width: 104px;
  height: 116px;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: transform 300ms ease, filter 300ms ease;
}

.bos-intro-art {
  display: block;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.7));
}

.bos-intro-mult {
  color: #ffe2a0;
  font-family: Cinzel, Georgia, serif;
  font-size: 15px;
  font-weight: 900;
  text-shadow: 0 2px 0 #1d0e03;
}

.bos-intro-tile-win {
  transform: scale(1.12);
  filter: drop-shadow(0 0 16px rgba(157, 255, 106, 0.8));
}

.bos-intro-marker {
  position: absolute;
  inset: 4px auto 4px 50%;
  width: 112px;
  translate: -50% 0;
  border: 2px solid rgba(255, 214, 120, 0.9);
  border-radius: 12px;
  box-shadow: 0 0 18px rgba(255, 190, 80, 0.55), inset 0 0 18px rgba(255, 190, 80, 0.25);
  pointer-events: none;
}

.bos-intro-copy {
  position: relative;
  min-height: 44px;
}

.bos-intro-result {
  color: #fff1cf;
  font-family: Cinzel, Georgia, serif;
  font-size: 22px;
  font-weight: 900;
}

.bos-intro-result strong {
  color: #b8ff8a;
  text-shadow: 0 0 14px rgba(157, 255, 106, 0.6);
}

.bos-intro-line {
  margin-top: 2px;
  color: #d8c6a4;
  font-size: 13px;
  font-weight: 600;
}

.bos-intro-dim {
  color: rgba(216, 198, 164, 0.55);
}

.bos-intro-btn {
  position: relative;
  min-width: 190px;
  border: 1px solid #f0c36a;
  border-radius: 999px;
  background: linear-gradient(180deg, #6a8f2a, #2a4410 60%, #1a2a08);
  padding: 11px 28px;
  color: #fff8e0;
  font-family: Cinzel, Georgia, serif;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.5), 0 0 24px rgba(157, 255, 106, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: transform 140ms ease, filter 140ms ease;
}

.bos-intro-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  filter: brightness(1.12);
}

.bos-intro-btn:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
