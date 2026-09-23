<script setup lang="ts">
import { FITH_FREE_SPINS, FITH_MAX_LINES } from '#shared/utils/gamelogic/fireinthehole'
import FithSymbolIcon from './FithSymbolIcon.vue'

// Free spins intro and outro cards over the reel window. Both return a
// promise that settles when the player continues or the card times out.

const mode = ref<'intro' | 'outro' | null>(null)
const rows = ref(3)
const multiplier = ref(0)
const amount = ref(0)
const bought = ref(false)
let resolveDone: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function done() {
    if (timer) clearTimeout(timer)
    timer = null
    mode.value = null
    resolveDone?.()
    resolveDone = null
}

function open(next: 'intro' | 'outro', autoMs: number): Promise<void> {
    mode.value = next
    timer = setTimeout(done, autoMs)
    return new Promise((resolve) => {
        resolveDone = resolve
    })
}

function intro(openRows: number, options: { bought?: boolean, autoMs?: number } = {}) {
    rows.value = openRows
    bought.value = options.bought ?? false
    return open('intro', options.autoMs ?? 5000)
}

function outro(totalMultiplier: number, win: number, autoMs = 3200) {
    multiplier.value = totalMultiplier
    amount.value = win
    return open('outro', autoMs)
}

function onKey(e: KeyboardEvent) {
    if (!mode.value || (e.code !== 'Space' && e.key !== 'Enter')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    done()
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, true)
    if (timer) clearTimeout(timer)
    resolveDone?.()
})

defineExpose({ intro, outro })
</script>

<template>
  <Transition name="fith-banner">
    <div
      v-if="mode"
      class="fith-banner"
      :class="`mode-${mode}`"
      @click="done"
    >
      <div class="burst" />
      <div
        v-if="mode === 'intro'"
        class="card"
      >
        <p class="kicker">
          {{ bought ? 'Bonus bought' : 'Fire in the hole!' }}
        </p>
        <div class="lanterns">
          <FithSymbolIcon
            v-for="i in 3"
            :key="i"
            symbol="scatter"
            :size="70"
            :style="{ animationDelay: `${i * 0.12}s` }"
            class="lantern"
          />
        </div>
        <h2><span>{{ FITH_FREE_SPINS }}</span> free spins</h2>
        <div class="depth">
          <span
            v-for="r in FITH_MAX_LINES"
            :key="r"
            :class="{ open: r <= rows }"
          />
        </div>
        <p class="sub">
          {{ rows }} of {{ FITH_MAX_LINES }} rows open
        </p>
        <button class="go">
          Light the fuse
        </button>
      </div>
      <div
        v-else
        class="card"
      >
        <p class="kicker">
          Bonus complete
        </p>
        <h2 class="total">
          {{ formatNumber(multiplier, false, 2) }}x
        </h2>
        <p class="win">
          {{ formatNumber(amount) }}
        </p>
        <p class="sub">
          {{ amount > 0 ? 'Added to your balance' : 'The seam ran dry this time' }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fith-banner {
  position: absolute;
  inset: 0;
  z-index: 28;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(ellipse at center, rgba(90, 30, 4, 0.78), rgba(8, 3, 1, 0.92) 72%);
  cursor: pointer;
}

.burst {
  position: absolute;
  inset: -40%;
  background: repeating-conic-gradient(from 0deg, rgba(255, 150, 40, 0.14) 0deg 6deg, transparent 6deg 18deg);
  mask-image: radial-gradient(circle, #000 5%, transparent 55%);
  animation: fith-burst 18s linear infinite;
}

.card {
  position: relative;
  text-align: center;
  padding: 0 16px;
  animation: fith-card-in 0.55s cubic-bezier(0.2, 1.5, 0.4, 1) both;
}

.kicker {
  margin: 0 0 6px;
  font-family: 'Rye', Georgia, serif;
  font-size: clamp(18px, 3.4vw, 26px);
  color: #ffb238;
  text-shadow: 0 2px 0 #4a1d03;
}

h2 {
  margin: 8px 0 0;
  font-family: 'Rye', Georgia, serif;
  font-size: clamp(34px, 7vw, 62px);
  line-height: 1;
  text-transform: uppercase;
  background: linear-gradient(180deg, #fff6c9 10%, #ffc238 55%, #c2410c 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 4px 0 #3d1402) drop-shadow(0 0 22px rgba(255, 150, 40, 0.6));
}

h2 span {
  font-family: 'Alfa Slab One', Georgia, serif;
}

.lanterns {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.lantern {
  animation: fith-lantern 1.6s ease-in-out infinite;
  filter: drop-shadow(0 0 16px rgba(255, 180, 60, 0.8));
}

.depth {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 16px;
}

.depth span {
  width: 26px;
  height: 8px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

.depth span.open {
  background: linear-gradient(180deg, #ffd66b, #e0780f);
  box-shadow: 0 0 10px rgba(255, 170, 50, 0.7);
}

.sub {
  margin: 8px 0 0;
  color: #e6cfa6;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.go {
  margin-top: 18px;
  padding: 12px 28px;
  border-radius: 999px;
  background: linear-gradient(180deg, #ff6a3d, #b8260f);
  color: #fff4e0;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: 0 8px 22px rgba(200, 40, 10, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  animation: fith-pulse 1.2s ease-in-out infinite;
}

.total {
  font-family: 'Alfa Slab One', Georgia, serif;
}

.win {
  margin: 10px 0 0;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: clamp(26px, 5vw, 40px);
  color: #fff6d8;
  text-shadow: 0 3px 0 #5a2d06, 0 0 22px rgba(255, 170, 50, 0.6);
}

@keyframes fith-burst {
  to {
    transform: rotate(360deg);
  }
}

@keyframes fith-card-in {
  0% {
    transform: scale(0.4);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes fith-lantern {
  0%,
  100% {
    transform: translateY(0) rotate(-3deg);
  }
  50% {
    transform: translateY(-6px) rotate(3deg);
  }
}

@keyframes fith-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.06);
  }
}

.fith-banner-enter-active,
.fith-banner-leave-active {
  transition: opacity 240ms ease;
}

.fith-banner-enter-from,
.fith-banner-leave-to {
  opacity: 0;
}
</style>
