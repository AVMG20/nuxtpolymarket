<script setup lang="ts">
import type { Sfx, UpgradeChoice } from './engine/types'
import { RARITY, hex, isTypingTarget } from './riftborn-ui'

const props = defineProps<{
  rewards: UpgradeChoice[]
  gold: number
  sfx: Sfx
}>()

const emit = defineEmits<{
  close: []
}>()

type Phase = 'shake' | 'open' | 'done'
const phase = ref<Phase>('shake')
const revealed = ref(0)
const goldShown = ref(0)
let timers: ReturnType<typeof setTimeout>[] = []
let goldRaf = 0
let doneAt = 0

const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

const SPIN_MS = 750
const STEP_MS = 520

const bestRarity = computed(() => {
  const order = ['common', 'rare', 'epic', 'legendary'] as const
  return props.rewards.reduce<typeof order[number]>((best, r) => order.indexOf(r.rarity) > order.indexOf(best) ? r.rarity : best, 'common')
})
const glow = computed(() => RARITY[bestRarity.value].color)

/* The reels: a blur of decoy icons that lands on the real reward */
const DECOYS = ['i-lucide-sword', 'i-lucide-flame', 'i-lucide-zap', 'i-lucide-shield', 'i-lucide-heart', 'i-lucide-gem', 'i-lucide-skull', 'i-lucide-wind', 'i-lucide-star', 'i-lucide-crosshair']
const reels = computed(() => props.rewards.map((r, i) => {
  const strip = Array.from({ length: 9 }, (_, j) => DECOYS[(i * 3 + j * 7) % DECOYS.length]!)
  strip.push(r.icon)
  return strip
}))

function open() {
  if (phase.value !== 'shake') return
  phase.value = 'open'
  props.sfx.play('chestOpen')
  props.rewards.forEach((r, i) => {
    later(380 + i * STEP_MS, () => props.sfx.play('reroll', { pitch: 1.3, volume: 0.5 }))
    later(380 + i * STEP_MS + SPIN_MS, () => {
      revealed.value = i + 1
      props.sfx.play('chestReward', { pitch: 1 + i * 0.08 })
      if (r.rarity === 'legendary' || r.kind === 'evolution') props.sfx.play('legendary')
      if (r.kind === 'ability') props.sfx.play('abilityUnlock', { volume: 0.8 })
    })
  })
  later(380 + Math.max(0, props.rewards.length - 1) * STEP_MS + SPIN_MS + 200, countGold)
}

function countGold() {
  if (props.gold <= 0) return finish()
  const start = performance.now()
  const duration = 900
  let lastTick = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    goldShown.value = Math.round(props.gold * (1 - (1 - t) ** 3))
    if (now - lastTick > 55 && t < 1) {
      lastTick = now
      props.sfx.play('countTick', { pitch: 1 + t * 0.6, volume: 0.6 })
    }
    if (t < 1) goldRaf = requestAnimationFrame(step)
    else {
      props.sfx.play('shard')
      finish()
    }
  }
  goldRaf = requestAnimationFrame(step)
}

function finish() {
  phase.value = 'done'
  revealed.value = props.rewards.length
  goldShown.value = props.gold
  doneAt = performance.now()
}

function skip() {
  timers.forEach(clearTimeout)
  timers = []
  cancelAnimationFrame(goldRaf)
  if (revealed.value < props.rewards.length) props.sfx.play('chestReward')
  if (props.gold > 0) props.sfx.play('shard')
  finish()
}

function advance() {
  if (phase.value === 'shake') open()
  else if (phase.value === 'open') skip()
  else if (performance.now() - doneAt > 250) {
    props.sfx.play('uiClick')
    emit('close')
  }
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target) || e.repeat) return
  if (e.code === 'Space' || e.key === 'Enter') {
    e.preventDefault()
    advance()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  later(1100, open)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  timers.forEach(clearTimeout)
  cancelAnimationFrame(goldRaf)
})

/* Cosmetic only */
const coins = Array.from({ length: 34 }, () => ({
  left: `${Math.random() * 100}%`,
  animationDelay: `${Math.random() * 1.4}s`,
  animationDuration: `${1.3 + Math.random() * 1.2}s`,
  '--rot': `${Math.random() * 720 - 360}deg`,
  '--sz': `${8 + Math.random() * 10}px`
}))
</script>

<template>
  <div class="rb-chest" :class="phase" :style="{ '--g': glow }" @click="advance" @contextmenu.prevent>
    <div class="rb-chest-backdrop" />

    <div v-if="phase !== 'shake'" class="rb-gold-rain" aria-hidden="true">
      <i v-for="(c, i) in coins" :key="i" :style="c" />
    </div>

    <div class="rb-chest-stage">
      <h2 class="rb-chest-title">{{ phase === 'shake' ? 'Treasure' : 'Rift Cache' }}</h2>

      <div class="rb-chest-art">
        <div class="rb-chest-rays" />
        <div class="rb-chest-flash" />
        <svg viewBox="0 0 160 130" class="rb-chest-svg">
          <defs>
            <linearGradient id="rb-chest-wood" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#6b3a1f" />
              <stop offset="1" stop-color="#2e160a" />
            </linearGradient>
            <linearGradient id="rb-chest-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#ffe9a0" />
              <stop offset="1" stop-color="#c98a1b" />
            </linearGradient>
          </defs>
          <g class="rb-chest-body">
            <rect x="18" y="62" width="124" height="60" rx="6" fill="url(#rb-chest-wood)" />
            <rect x="18" y="62" width="124" height="8" fill="url(#rb-chest-gold)" />
            <rect x="34" y="62" width="10" height="60" fill="url(#rb-chest-gold)" />
            <rect x="116" y="62" width="10" height="60" fill="url(#rb-chest-gold)" />
            <rect x="18" y="114" width="124" height="8" rx="3" fill="url(#rb-chest-gold)" />
            <rect x="68" y="70" width="24" height="26" rx="4" fill="url(#rb-chest-gold)" />
            <circle cx="80" cy="81" r="4" fill="#2e160a" />
            <rect x="78.5" y="82" width="3" height="8" fill="#2e160a" />
          </g>
          <g class="rb-chest-lid">
            <path d="M18 64 V44 C18 22 46 12 80 12 C114 12 142 22 142 44 V64 Z" fill="url(#rb-chest-wood)" />
            <path d="M34 64 V26 C38 22 42 20 44 19 V64 Z M116 19 C118 20 122 22 126 26 V64 H116 Z" fill="url(#rb-chest-gold)" />
            <rect x="18" y="56" width="124" height="8" fill="url(#rb-chest-gold)" />
            <path d="M68 64 V54 H92 V64 Z" fill="url(#rb-chest-gold)" />
          </g>
        </svg>
      </div>

      <div v-if="phase !== 'shake'" class="rb-rewards">
        <div
          v-for="(r, i) in rewards"
          :key="i"
          class="rb-reward"
          :class="[r.rarity, `k-${r.kind}`, { landed: revealed > i }]"
          :style="{ '--r': RARITY[r.rarity].color, '--rg': RARITY[r.rarity].glow, '--ic': hex(r.color), '--delay': `${380 + i * STEP_MS}ms`, '--spin': `${SPIN_MS}ms` }"
        >
          <div class="rb-reel">
            <span v-if="r.rarity !== 'common'" class="rb-reel-shine" />
            <div class="rb-reel-strip">
              <div v-for="(icon, j) in reels[i]" :key="j" class="rb-reel-cell">
                <UIcon :name="icon" class="size-8" />
              </div>
            </div>
          </div>
          <div class="rb-reward-info">
            <span class="rb-reward-rarity">{{ r.kind === 'evolution' ? 'Evolution' : r.kind === 'ability' ? (r.isNew ? 'New ability' : 'Ability') : RARITY[r.rarity].label }}</span>
            <span class="rb-reward-name">{{ r.name }}</span>
            <span v-if="r.maxLevel > 1" class="rb-reward-level">Lv {{ r.level }}</span>
          </div>
        </div>
      </div>

      <div v-if="phase !== 'shake' && gold > 0" class="rb-chest-gold" :class="{ done: phase === 'done' }">
        <UIcon name="i-lucide-gem" class="size-6" />
        +{{ formatNumber(goldShown, false) }}
        <span class="rb-chest-gold-unit">shards<small>bonus Rift XP</small></span>
      </div>

      <p class="rb-chest-hint">
        <template v-if="phase === 'shake'"><kbd>Space</kbd> Open</template>
        <template v-else-if="phase === 'open'">Skip</template>
        <template v-else><kbd>Space</kbd> Collect</template>
      </p>
    </div>
  </div>
</template>

<style scoped>
.rb-chest {
  --g: #ffb627;
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
  padding: 16px;
}
.rb-chest-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 42%, rgba(60, 34, 6, 0.6), rgba(4, 2, 10, 0.9) 70%);
  backdrop-filter: blur(4px);
  animation: rb-fade 0.3s ease-out;
}
@keyframes rb-fade {
  from { opacity: 0; }
}
.rb-chest-stage {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 720px;
}
.rb-chest-title {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(28px, 5vw, 48px);
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  color: #ffe9a0;
  text-shadow: 0 0 24px rgba(255, 182, 39, 0.8), 0 4px 0 #6b3a1f;
  animation: rb-title-drop 0.5s cubic-bezier(0.2, 1.5, 0.4, 1);
}
@keyframes rb-title-drop {
  from { transform: translateY(-40px) scale(1.4); opacity: 0; }
}

.rb-chest-art {
  position: relative;
  width: 200px;
  height: 162px;
  transition: transform 0.5s cubic-bezier(0.2, 1.3, 0.4, 1);
}
.rb-chest.open .rb-chest-art,
.rb-chest.done .rb-chest-art {
  transform: scale(0.72) translateY(-10px);
}
.rb-chest-svg {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.7));
}
.rb-chest.shake .rb-chest-svg {
  animation: rb-shake 0.5s ease-in-out infinite, rb-drop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) backwards;
}
@keyframes rb-drop {
  from { transform: translateY(-160px) scale(0.6); }
}
@keyframes rb-shake {
  0%, 100% { transform: rotate(0) translateY(0); }
  15% { transform: rotate(-5deg) translateY(-3px); }
  30% { transform: rotate(4deg) translateY(0); }
  45% { transform: rotate(-3deg) translateY(-4px); }
  60% { transform: rotate(5deg) translateY(0); }
  80% { transform: rotate(-2deg) translateY(-2px); }
}
.rb-chest-lid {
  transform-origin: 18px 64px;
  transition: transform 0.55s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.rb-chest.open .rb-chest-lid,
.rb-chest.done .rb-chest-lid {
  transform: translate(-6px, -34px) rotate(-28deg);
}
.rb-chest-rays {
  position: absolute;
  left: 50%;
  top: 46%;
  width: 640px;
  height: 640px;
  translate: -50% -50%;
  opacity: 0;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--g) 55%, transparent) 0 7deg, transparent 7deg 20deg);
  mask: radial-gradient(circle, #000 5%, transparent 62%);
  transition: opacity 0.4s ease;
  animation: rb-rays 10s linear infinite;
}
.rb-chest.open .rb-chest-rays,
.rb-chest.done .rb-chest-rays {
  opacity: 1;
}
@keyframes rb-rays {
  to { rotate: 360deg; }
}
.rb-chest-flash {
  position: absolute;
  left: 50%;
  top: 40%;
  width: 60px;
  height: 60px;
  translate: -50% -50%;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 60px 30px var(--g);
  opacity: 0;
}
.rb-chest.open .rb-chest-flash {
  animation: rb-burst 0.7s ease-out;
}
.rb-chest.done .rb-chest-flash {
  opacity: 0.6;
  transform: scale(0.6);
}
@keyframes rb-burst {
  0% { opacity: 1; transform: scale(0.2); }
  30% { opacity: 1; transform: scale(3); }
  100% { opacity: 0.6; transform: scale(0.6); }
}

.rb-gold-rain {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.rb-gold-rain i {
  position: absolute;
  top: -30px;
  width: var(--sz);
  height: var(--sz);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #fff6c8, #ffc54d 45%, #a86a0f);
  box-shadow: 0 0 8px rgba(255, 197, 77, 0.7);
  animation: rb-coin-fall linear infinite;
}
@keyframes rb-coin-fall {
  0% { transform: translateY(0) rotate(0) scaleX(1); opacity: 0; }
  10% { opacity: 1; }
  50% { transform: translateY(55vh) rotate(calc(var(--rot) / 2)) scaleX(0.3); }
  100% { transform: translateY(110vh) rotate(var(--rot)) scaleX(1); opacity: 0.8; }
}

.rb-rewards {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: -18px;
}
.rb-reward {
  --r: #fff;
  --rg: transparent;
  --ic: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 140px;
  animation: rb-reward-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
  animation-delay: calc(var(--delay) - 200ms);
}
@keyframes rb-reward-in {
  from { opacity: 0; transform: translateY(20px) scale(0.8); }
}
.rb-reel {
  position: relative;
  width: 76px;
  height: 76px;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(180deg, #0a0614, #1a1030 50%, #0a0614);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.12), inset 0 10px 14px -8px #000, inset 0 -10px 14px -8px #000;
  transition: box-shadow 0.3s ease;
}
.rb-reward.landed .rb-reel {
  box-shadow: inset 0 0 0 2px var(--r), 0 0 26px var(--rg);
  animation: rb-land 0.4s cubic-bezier(0.2, 1.8, 0.4, 1);
}
@keyframes rb-land {
  0% { transform: scale(1.25); }
}
.rb-reel-strip {
  display: flex;
  flex-direction: column;
  animation: rb-reel var(--spin) cubic-bezier(0.15, 0.6, 0.25, 1) forwards;
  animation-delay: var(--delay);
  filter: blur(0);
}
@keyframes rb-reel {
  0% { transform: translateY(0); filter: blur(2px); }
  70% { filter: blur(1px); }
  100% { transform: translateY(calc(-76px * 9)); filter: blur(0); }
}
.rb-chest.done .rb-reel-strip {
  animation: none;
  transform: translateY(calc(-76px * 9));
}
.rb-reel-cell {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 76px;
  height: 76px;
  color: rgba(255, 255, 255, 0.5);
}
.rb-reward.landed .rb-reel-cell:last-child {
  color: var(--ic);
  filter: drop-shadow(0 0 8px var(--ic));
}
.rb-reward-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-align: center;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.2, 1.5, 0.4, 1);
}
.rb-reward.landed .rb-reward-info {
  opacity: 1;
  transform: none;
}
.rb-reward-rarity {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--r);
}
.rb-reward-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.2;
  color: #fff;
}
.rb-reward-level {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
  color: rgba(255, 255, 255, 0.6);
}
.rb-reward.legendary.landed .rb-reel {
  animation: rb-land 0.4s cubic-bezier(0.2, 1.8, 0.4, 1), rb-legend 1s 0.4s ease-in-out infinite alternate;
}
@keyframes rb-legend {
  to { box-shadow: inset 0 0 0 2px #fff4c2, 0 0 40px var(--rg); }
}

.rb-chest-gold {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(26px, 4vw, 40px);
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #8ef6ff;
  text-shadow: 0 0 22px rgba(142, 246, 255, 0.8), 0 3px 0 #123a52;
  animation: rb-fade 0.3s ease-out;
}
.rb-chest-gold-unit {
  display: flex;
  flex-direction: column;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
}
.rb-chest-gold-unit small {
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.12em;
  color: rgba(220, 240, 255, 0.6);
  text-shadow: none;
}
.rb-chest-gold.done {
  animation: rb-gold-pop 0.45s cubic-bezier(0.2, 1.8, 0.4, 1);
}
@keyframes rb-gold-pop {
  40% { transform: scale(1.3); }
}
.rb-chest-hint {
  margin-top: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 240, 210, 0.65);
  animation: rb-hint 1.4s ease-in-out infinite;
}
.rb-chest-hint kbd {
  padding: 2px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.12);
}
@keyframes rb-hint {
  50% { opacity: 0.45; }
}
/* rarity shine, ability hex, burning evolution */
.rb-reel-shine {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0;
  background: linear-gradient(115deg, transparent 35%, rgba(255, 255, 255, 0.6) 50%, transparent 65%);
  transform: translateX(-110%);
}
.rb-reward.landed .rb-reel-shine {
  opacity: 1;
  animation: rb-reel-shine 2.6s 0.2s ease-in-out infinite;
}
.rb-reward.legendary.landed .rb-reel-shine {
  animation-duration: 1.6s;
}
@keyframes rb-reel-shine {
  0% { transform: translateX(-110%); }
  45%, 100% { transform: translateX(110%); }
}
.rb-reward.k-ability .rb-reel {
  border-radius: 0;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
}
.rb-reward.k-ability.landed .rb-reel {
  background: radial-gradient(circle, color-mix(in srgb, var(--ic) 40%, #0a0614), #0a0614 75%);
  filter: drop-shadow(0 0 14px var(--ic));
}
.rb-reward.k-ability .rb-reward-rarity {
  color: var(--ic);
}
.rb-reward.k-evolution.landed .rb-reel {
  box-shadow: inset 0 0 0 2px #ff8a2b, 0 0 34px rgba(255, 110, 30, 0.9);
  background: radial-gradient(circle at 50% 100%, rgba(255, 90, 20, 0.6), #1a0a06 70%);
  animation: rb-land 0.4s cubic-bezier(0.2, 1.8, 0.4, 1), rb-burn 0.8s 0.4s ease-in-out infinite alternate;
}
@keyframes rb-burn {
  to { box-shadow: inset 0 0 0 2px #ffe08a, 0 0 50px rgba(255, 150, 40, 1); }
}
.rb-reward.k-evolution .rb-reward-rarity {
  color: #ff9b3d;
}
@media (prefers-reduced-motion: reduce) {
  .rb-gold-rain { display: none; }
}
</style>
