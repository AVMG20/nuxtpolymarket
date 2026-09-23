<script setup lang="ts">
import { FITH_WIN_TIERS, fithWinTier, type FithWinTier } from '~/utils/fireinthehole-paytable'

// Tiered big-win celebration over the reel window. show() counts the amount
// up from zero and climbs Big > Mega > Epic > Motherlode as the count passes
// each threshold. A click or Space skips to the end; it closes on its own.

const emit = defineEmits<{ tier: [tier: FithWinTier] }>()
const props = defineProps<{ turbo: boolean }>()
const { play } = useFireInTheHoleSound()

const visible = ref(false)
const shown = ref(0)
const tier = ref<FithWinTier | null>(null)
const subtitle = ref('')
const bump = ref(0)

let target = 0
let bet = 1
let raf = 0
let resolveDone: (() => void) | null = null
let finished = false
let closeTimer: ReturnType<typeof setTimeout> | null = null

const TIER_SECONDS: Record<FithWinTier['id'], number> = { big: 2.6, mega: 3.6, epic: 4.8, motherlode: 6 }

// Cosmetic coin rain, laid out once.
const coins = Array.from({ length: 36 }, () => ({
    left: Math.random() * 100,
    delay: Math.random() * 2.4,
    duration: 1.6 + Math.random() * 1.4,
    size: 14 + Math.random() * 16,
    spin: 0.5 + Math.random() * 0.9
}))

function setTier(next: FithWinTier | null) {
    if (!next || next.id === tier.value?.id) return
    tier.value = next
    bump.value++
    play(`win-${next.id}`)
    emit('tier', next)
}

function finish() {
    if (finished) return
    finished = true
    cancelAnimationFrame(raf)
    shown.value = target
    setTier(fithWinTier(target / bet))
    closeTimer = setTimeout(close, props.turbo ? 1200 : 2200)
}

function close() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = null
    visible.value = false
    resolveDone?.()
    resolveDone = null
}

function skip() {
    if (!visible.value) return
    if (!finished) finish()
    else close()
}

function show(amount: number, betAmount: number, label = ''): Promise<void> {
    target = amount
    bet = Math.max(betAmount, 0.0001)
    subtitle.value = label
    shown.value = 0
    tier.value = null
    finished = false
    visible.value = true
    const finalTier = fithWinTier(amount / bet)
    const seconds = (finalTier ? TIER_SECONDS[finalTier.id] : 2) * (props.turbo ? 0.55 : 1)
    const start = performance.now()
    let lastTick = 0
    setTier(FITH_WIN_TIERS[0]!)
    const frame = (now: number) => {
        if (finished) return
        const t = Math.min(1, (now - start) / (seconds * 1000))
        // Ease out, but keep moving to the end so each tier gets its moment.
        const eased = 1 - (1 - t) ** 2.2
        shown.value = target * eased
        const current = fithWinTier(shown.value / bet)
        if (current) setTier(current)
        if (now - lastTick > 70) {
            lastTick = now
            play('tick', { intensity: t })
        }
        if (t < 1) raf = requestAnimationFrame(frame)
        else finish()
    }
    raf = requestAnimationFrame(frame)
    return new Promise((resolve) => {
        resolveDone = resolve
    })
}

function onKey(e: KeyboardEvent) {
    if (!visible.value || (e.code !== 'Space' && e.key !== 'Enter')) return
    e.preventDefault()
    e.stopImmediatePropagation()
    skip()
}

onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, true)
    cancelAnimationFrame(raf)
    if (closeTimer) clearTimeout(closeTimer)
    resolveDone?.()
})

defineExpose({ show, skip, visible })
</script>

<template>
  <Transition name="fith-win">
    <div
      v-if="visible"
      class="fith-win"
      :class="`tier-${tier?.id ?? 'big'}`"
      @click="skip"
    >
      <div class="rays" />
      <div class="coins">
        <span
          v-for="(c, i) in coins"
          :key="i"
          :style="{ 'left': `${c.left}%`, 'animationDelay': `${c.delay}s`, 'animationDuration': `${c.duration}s`, 'width': `${c.size}px`, 'height': `${c.size}px`, '--spin': `${c.spin}s` }"
        />
      </div>
      <div class="content">
        <p
          :key="bump"
          class="label"
        >
          {{ tier?.label ?? 'Big Win' }}
        </p>
        <strong class="amount">{{ formatNumber(shown, false, 2) }}</strong>
        <p
          v-if="subtitle"
          class="subtitle"
        >
          {{ subtitle }}
        </p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fith-win {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(ellipse at center, rgba(60, 22, 4, 0.72), rgba(8, 3, 1, 0.9) 70%);
  cursor: pointer;
  --tier-a: #fff3b0;
  --tier-b: #ffb238;
  --tier-c: #c2410c;
  --tier-glow: rgba(255, 170, 50, 0.7);
}

.tier-mega {
  --tier-a: #ffe0b0;
  --tier-b: #ff7a2a;
  --tier-c: #b91c1c;
  --tier-glow: rgba(255, 100, 40, 0.75);
}

.tier-epic {
  --tier-a: #fff;
  --tier-b: #ff5a4a;
  --tier-c: #7f1d1d;
  --tier-glow: rgba(255, 70, 60, 0.8);
}

.tier-motherlode {
  --tier-a: #ffffff;
  --tier-b: #7ef0ff;
  --tier-c: #1d4ed8;
  --tier-glow: rgba(120, 220, 255, 0.85);
}

.rays {
  position: absolute;
  inset: -50%;
  background: repeating-conic-gradient(from 0deg, rgba(255, 190, 80, 0.13) 0deg 8deg, transparent 8deg 20deg);
  animation: fith-rays 14s linear infinite;
  mask-image: radial-gradient(circle, #000 10%, transparent 60%);
}

.tier-motherlode .rays {
  background: repeating-conic-gradient(from 0deg, rgba(140, 230, 255, 0.16) 0deg 8deg, transparent 8deg 20deg);
}

.coins span {
  position: absolute;
  top: -40px;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, #fff7c2, #f6c945 45%, #a8660c);
  box-shadow: inset 0 0 0 2px rgba(124, 74, 6, 0.8);
  animation-name: fith-coin-fall;
  animation-timing-function: cubic-bezier(0.4, 0, 0.9, 0.6);
  animation-iteration-count: infinite;
}

.content {
  position: relative;
  text-align: center;
  padding: 0 12px;
}

.label {
  margin: 0;
  font-family: 'Rye', Georgia, serif;
  font-size: clamp(40px, 9vw, 84px);
  line-height: 1;
  text-transform: uppercase;
  background: linear-gradient(180deg, var(--tier-a) 10%, var(--tier-b) 55%, var(--tier-c) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 4px 0 rgba(40, 10, 0, 0.9)) drop-shadow(0 0 24px var(--tier-glow));
  animation: fith-label-in 0.6s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}

.amount {
  display: block;
  margin-top: 14px;
  font-family: 'Alfa Slab One', Georgia, serif;
  font-size: clamp(34px, 7vw, 64px);
  font-weight: 400;
  line-height: 1;
  color: #fff6d8;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 3px 0 #5a2d06, 0 0 30px var(--tier-glow);
}

.subtitle {
  margin: 12px 0 0;
  color: #f1d9a8;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

@keyframes fith-rays {
  to {
    transform: rotate(360deg);
  }
}

@keyframes fith-coin-fall {
  0% {
    transform: translateY(0) rotateY(0deg);
  }
  100% {
    transform: translateY(900px) rotateY(720deg);
  }
}

@keyframes fith-label-in {
  0% {
    transform: scale(2.4);
    opacity: 0;
  }
  60% {
    transform: scale(0.92);
    opacity: 1;
  }
  100% {
    transform: scale(1);
  }
}

.fith-win-enter-active,
.fith-win-leave-active {
  transition: opacity 260ms ease;
}

.fith-win-enter-from,
.fith-win-leave-to {
  opacity: 0;
}
</style>
