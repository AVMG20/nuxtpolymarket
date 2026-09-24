<script setup lang="ts">
import { sfx } from '~/utils/polymasters/audio'
import { PM_TIERS } from '~/composables/polymasters'

const { state, money, dismissResult } = usePolyMastersGame()
const TIERS = PM_TIERS

const shown = ref(0)
let raf = 0

const r = computed(() => (state.phase === 'result' ? state.result : null))

watch(r, (res) => {
  cancelAnimationFrame(raf)
  if (!res || res.win <= 0) return
  const dur = 700 + res.tier * 700
  const t0 = performance.now()
  let lastTick = 0
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur)
    shown.value = res.win * (1 - Math.pow(1 - k, 3))
    if (now - lastTick > 70 && k < 1) {
      lastTick = now
      sfx.countTick()
    }
    if (k < 1) raf = requestAnimationFrame(step)
  }
  shown.value = 0
  raf = requestAnimationFrame(step)
})

onBeforeUnmount(() => cancelAnimationFrame(raf))

const title = computed(() => (r.value && r.value.win > 0 ? TIERS[r.value.tier] : 'SPLASH!'))
</script>

<template>
  <Transition name="result">
    <div v-if="r" class="result" :class="r.win > 0 ? `win tier${r.tier}` : 'loss'" @click="dismissResult">
      <div v-if="r.win > 0" class="burst" />
      <div class="card">
        <div class="title display">{{ title }}</div>
        <template v-if="r.win > 0">
          <div class="amount display">{{ money(shown) }}</div>
          <div class="sub">
            <span class="x display">x{{ r.mult >= 100 ? r.mult.toFixed(0) : r.mult.toFixed(2) }}</span>
            <span>{{ r.landing === 'buoy' ? 'Saved by the Life Buoy!' : r.landing === 'max' ? 'Maximum win reached!' : 'Safe touchdown on the island' }}</span>
          </div>
        </template>
        <template v-else>
          <div class="sub lost">The plane came down in the sea</div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.result {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 10;
  cursor: pointer;
  padding-bottom: 120px;
}
.win {
  background: radial-gradient(ellipse at center, rgba(10, 30, 70, 0.35), transparent 70%);
}
.burst {
  position: absolute;
  width: 900px;
  height: 900px;
  left: 50%;
  top: 50%;
  margin: -510px 0 0 -450px;
  background: repeating-conic-gradient(from 0deg, rgba(255, 220, 120, 0.22) 0deg 9deg, transparent 9deg 22.5deg);
  mask: radial-gradient(circle, #000 20%, transparent 65%);
  -webkit-mask: radial-gradient(circle, #000 20%, transparent 65%);
  animation: rot 14s linear infinite;
  pointer-events: none;
}
@keyframes rot {
  to {
    transform: rotate(360deg);
  }
}
.card {
  position: relative;
  text-align: center;
}
.title {
  font-size: clamp(54px, 9cqw, 110px);
  line-height: 1;
  background: linear-gradient(180deg, #fffbe0 0%, #ffe066 35%, #f5a623 60%, #fff0a8 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 5px 0 #6a3a00) drop-shadow(0 12px 18px rgba(0, 0, 0, 0.55));
  animation: slam 0.6s cubic-bezier(0.2, 1.8, 0.4, 1) both;
}
.tier2 .title,
.tier3 .title {
  background: linear-gradient(180deg, #ffffff 0%, #ffd6ff 30%, #c77dff 60%, #ffe066 100%);
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 5px 0 #3a0a6a) drop-shadow(0 0 30px rgba(199, 125, 255, 0.6));
}
.tier4 .title {
  animation:
    slam 0.6s cubic-bezier(0.2, 1.8, 0.4, 1) both,
    pulse 0.8s 0.6s ease-in-out infinite;
}
.amount {
  margin-top: 6px;
  font-size: clamp(40px, 6cqw, 72px);
  color: #fff;
  text-shadow:
    0 4px 0 #0a2a55,
    0 10px 24px rgba(0, 0, 0, 0.55);
  font-variant-numeric: tabular-nums;
  animation: rise 0.5s 0.15s both;
}
.sub {
  margin-top: 10px;
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 16px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
  animation: rise 0.5s 0.3s both;
}
.x {
  padding: 2px 14px;
  border-radius: 999px;
  font-size: 22px;
  font-weight: 400;
  color: #3a2200;
  background: linear-gradient(180deg, var(--gold-1), var(--gold-2) 50%, var(--gold-3));
  text-shadow: none;
}
.loss .title {
  background: linear-gradient(180deg, #e8fbff 0%, #7fe8ff 40%, #1a8fe0 70%, #0a3d6b 100%);
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(0 5px 0 #06203d) drop-shadow(0 12px 18px rgba(0, 0, 0, 0.55));
  font-size: clamp(48px, 7cqw, 86px);
}
.lost {
  font-size: 18px;
}
@keyframes slam {
  0% {
    transform: scale(3);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes rise {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
}
@keyframes pulse {
  50% {
    transform: scale(1.07);
  }
}
.result-enter-active {
  transition: opacity 0.3s;
}
.result-leave-active {
  transition: opacity 0.35s;
}
.result-enter-from,
.result-leave-to {
  opacity: 0;
}
</style>
