<script setup lang="ts">
import type { HudAbility, Sfx, UpgradeChoice } from './engine/types'
import { ABILITY_KEYS, RARITY, cardBlocks, choiceBaseId, hex, isTypingTarget } from './riftborn-ui'

const props = withDefaults(defineProps<{
  choices: UpgradeChoice[]
  rerolls: number
  level: number
  deal: number
  sfx: Sfx
  /** Learned abilities, to show which key an ability card lands on */
  abilities?: HudAbility[]
}>(), {
  abilities: () => []
})

const emit = defineEmits<{
  choose: [index: number]
  reroll: []
}>()

const STAGGER = 140
const FLIP_AT = 260
const picked = ref<number | null>(null)
const ready = ref(false)
let timers: ReturnType<typeof setTimeout>[] = []

function clearTimers() {
  timers.forEach(clearTimeout)
  timers = []
}

/* Every deal (first open and each reroll) drops the cards face down, then flips them one by one */
function dealCards() {
  clearTimers()
  picked.value = null
  ready.value = false
  props.choices.forEach((c, i) => {
    timers.push(setTimeout(() => {
      props.sfx.play('cardReveal', { pitch: 0.92 + i * 0.07 })
      if (c.rarity === 'legendary' || c.kind === 'evolution') props.sfx.play('legendary')
      if (c.kind === 'ability' && c.isNew) props.sfx.play('abilityUnlock', { volume: 0.7 })
    }, FLIP_AT + i * STAGGER))
  })
  timers.push(setTimeout(() => (ready.value = true), FLIP_AT + props.choices.length * STAGGER + 260))
}

watch(() => props.deal, dealCards, { immediate: true })

function pick(i: number) {
  if (!ready.value || picked.value !== null || !props.choices[i]) return
  picked.value = i
  props.sfx.play('cardSelect')
  timers.push(setTimeout(() => emit('choose', i), 440))
}

function reroll() {
  if (!ready.value || picked.value !== null) return
  if (props.rerolls <= 0) {
    props.sfx.play('uiError')
    return
  }
  ready.value = false
  props.sfx.play('reroll')
  emit('reroll')
  // The new hand arrives through onLevelUp; if it never does, don't lock the cards
  const dealt = props.deal
  timers.push(setTimeout(() => {
    if (props.deal === dealt) ready.value = true
  }, 900))
}

function onKey(e: KeyboardEvent) {
  if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
  const n = Number.parseInt(e.key, 10)
  if (n >= 1 && n <= props.choices.length) {
    e.preventDefault()
    pick(n - 1)
  } else if (e.key === 'r' || e.key === 'R') {
    e.preventDefault()
    reroll()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimers()
})

/* Holographic tilt: written straight to CSS vars, no reactivity per pointer move */
function tilt(e: PointerEvent) {
  if (e.pointerType === 'touch') return
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  const py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
  el.style.setProperty('--rx', `${((0.5 - py) * 18).toFixed(2)}deg`)
  el.style.setProperty('--ry', `${((px - 0.5) * 22).toFixed(2)}deg`)
  el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
  el.style.setProperty('--hp', `${(px * 360).toFixed(0)}deg`)
}

function untilt(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  for (const p of ['--rx', '--ry']) el.style.setProperty(p, '0deg')
  el.style.setProperty('--mx', '50%')
  el.style.setProperty('--my', '50%')
}

const keyFor = (c: UpgradeChoice) => {
  if (c.kind !== 'ability') return null
  const id = choiceBaseId(c.id)
  const owned = props.abilities.find(a => a.id === id || a.id === c.id)
  if (owned) return owned.key
  return ABILITY_KEYS[Math.min(props.abilities.length, ABILITY_KEYS.length - 1)]!
}

const cards = computed(() => props.choices.map((c, i) => ({
  c,
  i,
  key: keyFor(c),
  blocks: cardBlocks(c.description),
  kindLabel: c.kind === 'evolution' ? 'Evolution' : c.kind === 'ability' ? 'Ability' : c.kind === 'heal' ? 'Heal' : c.kind === 'shards' ? 'Shards' : c.kind === 'weapon' ? 'Weapon' : 'Passive',
  style: {
    '--r': c.kind === 'evolution' ? '#ff8a2b' : RARITY[c.rarity].color,
    '--rg': c.kind === 'evolution' ? 'rgba(255, 110, 30, 0.7)' : RARITY[c.rarity].glow,
    '--ic': hex(c.color),
    '--d': `${FLIP_AT + i * STAGGER}ms`
  }
})))

const sparks = Array.from({ length: 16 }, (_, i) => ({
  left: `${4 + ((i * 53) % 92)}%`,
  animationDelay: `${(i * 0.27) % 2.4}s`,
  animationDuration: `${1.6 + (i % 4) * 0.4}s`
}))
</script>

<template>
  <div class="rb-lu" @contextmenu.prevent>
    <div class="rb-lu-backdrop" />
    <div class="rb-lu-content">
      <div class="rb-lu-head">
        <div class="rb-lu-rays" />
        <h2 class="rb-lu-title">Level {{ level }}</h2>
      </div>

      <div :key="deal" class="rb-lu-cards">
        <button
          v-for="card in cards"
          :key="`${deal}-${card.c.id}-${card.i}`"
          type="button"
          class="rb-card"
          :class="[card.c.rarity, `k-${card.c.kind}`, { picked: picked === card.i, dismissed: picked !== null && picked !== card.i, live: ready }]"
          :style="card.style"
          @pointerenter="ready && picked === null && sfx.play('uiHover')"
          @pointermove="tilt"
          @pointerleave="untilt"
          @click="pick(card.i)"
        >
          <span v-if="card.c.rarity === 'legendary' || card.c.kind === 'evolution'" class="rb-card-aura" />
          <span class="rb-card-tilt">
            <span class="rb-card-flip">
              <!-- back -->
              <span class="rb-card-back">
                <span class="rb-card-back-sigil">
                  <UIcon name="i-lucide-orbit" class="size-10" />
                </span>
              </span>

              <!-- front -->
              <span class="rb-card-front">
                <span class="rb-card-frame" />
                <span class="rb-card-face">
                  <span class="rb-card-holo" />
                  <span v-if="card.c.rarity !== 'common'" class="rb-card-shine" />
                  <span v-if="card.c.rarity === 'legendary' || card.c.kind === 'evolution'" class="rb-card-sparks">
                    <i v-for="(s, j) in sparks" :key="j" :style="s" />
                  </span>

                  <span v-if="card.c.kind === 'evolution'" class="rb-ribbon evo">Evolve</span>

                  <span class="rb-card-top">
                    <span class="rb-card-rarity">{{ RARITY[card.c.rarity].label }}</span>
                    <kbd class="rb-card-num">{{ card.i + 1 }}</kbd>
                  </span>

                  <span class="rb-card-badge">
                    <span v-if="card.c.kind === 'ability'" class="rb-pill ability">{{ card.c.isNew ? 'New ability' : 'Ability up' }}</span>
                    <span v-else-if="card.c.isNew" class="rb-pill new">New</span>
                  </span>

                  <span class="rb-card-emblem">
                    <svg v-if="card.c.kind === 'ability'" class="rb-card-runes" viewBox="0 0 100 100" aria-hidden="true">
                      <polygon points="50,3 91,26.5 91,73.5 50,97 9,73.5 9,26.5" />
                      <circle cx="50" cy="50" r="44" />
                    </svg>
                    <span class="rb-card-emblem-ring" />
                    <UIcon :name="card.c.icon" class="rb-card-icon" />
                    <kbd v-if="card.key" class="rb-card-key">{{ card.key }}</kbd>
                  </span>

                  <span class="rb-card-name">{{ card.c.name }}</span>
                  <span class="rb-card-kind">{{ card.kindLabel }}</span>

                  <span class="rb-card-desc">
                    <template v-for="(b, bi) in card.blocks" :key="bi">
                      <span v-if="b.kind === 'text'" class="rb-card-text">{{ b.text }}</span>
                      <span v-else class="rb-card-stats">
                        <span v-for="(s, si) in b.stats" :key="si" class="rb-stat">
                          <template v-if="s.from">
                            <span class="rb-stat-label">{{ s.label }}</span>
                            <span class="rb-stat-from">{{ s.from }}</span>
                            <UIcon name="i-lucide-arrow-right" class="rb-stat-arrow" />
                            <b class="rb-stat-to">{{ s.value }}</b>
                          </template>
                          <template v-else>
                            <b class="rb-stat-to">{{ s.value }}</b>
                            <span class="rb-stat-label">{{ s.label }}</span>
                          </template>
                        </span>
                      </span>
                    </template>
                  </span>

                  <span v-if="card.c.maxLevel > 1" class="rb-card-pips">
                    <i
                      v-for="n in card.c.maxLevel"
                      :key="n"
                      :class="{ on: n < card.c.level, next: n === card.c.level }"
                    />
                  </span>
                  <span v-if="card.c.maxLevel > 1" class="rb-card-level">Lv {{ card.c.level }}<span class="opacity-50"> / {{ card.c.maxLevel }}</span></span>
                </span>
              </span>
            </span>
          </span>
        </button>
      </div>

      <div class="rb-lu-foot">
        <button type="button" class="rb-reroll" :disabled="rerolls <= 0 || picked !== null" @click="reroll">
          <UIcon name="i-lucide-refresh-cw" class="size-4" />
          Reroll
          <kbd>R</kbd>
          <span class="rb-reroll-count">{{ rerolls }}</span>
        </button>
        <span class="rb-lu-hint"><kbd>1</kbd>–<kbd>{{ choices.length }}</kbd> to pick</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-lu {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}
.rb-lu-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 40%, rgba(40, 20, 80, 0.55), rgba(4, 2, 10, 0.88) 70%);
  backdrop-filter: blur(4px) saturate(0.7);
  animation: rb-fade 0.25s ease-out;
}
@keyframes rb-fade {
  from { opacity: 0; }
}
.rb-lu-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(14px, 3vh, 28px);
  width: 100%;
  max-width: 1100px;
}
.rb-lu-head {
  position: relative;
  text-align: center;
  animation: rb-head-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes rb-head-in {
  from { opacity: 0; transform: scale(1.6); filter: blur(8px); }
}
.rb-lu-rays {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 420px;
  height: 420px;
  translate: -50% -50%;
  z-index: -1;
  background: repeating-conic-gradient(from 0deg, rgba(142, 246, 255, 0.12) 0 6deg, transparent 6deg 18deg);
  mask: radial-gradient(circle, #000 10%, transparent 65%);
  animation: rb-rays 18s linear infinite;
}
@keyframes rb-rays {
  to { rotate: 360deg; }
}
.rb-lu-title {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(34px, 6vw, 60px);
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 0 30px rgba(142, 246, 255, 0.7), 0 0 60px rgba(178, 140, 255, 0.5);
}

.rb-lu-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 240px));
  justify-content: center;
  gap: clamp(12px, 1.8vw, 22px);
  width: 100%;
  perspective: 1100px;
}

/* card shell */
.rb-card {
  --r: #fff;
  --rg: transparent;
  --ic: #fff;
  --d: 0ms;
  --rx: 0deg;
  --ry: 0deg;
  --mx: 50%;
  --my: 50%;
  --hp: 0deg;
  --shape: inset(0 round 18px);
  position: relative;
  display: block;
  text-align: center;
  cursor: pointer;
  transform-style: preserve-3d;
  animation: rb-card-drop 0.42s cubic-bezier(0.2, 1.2, 0.4, 1) backwards;
  animation-delay: calc(var(--d) - 200ms);
  transition: transform 0.2s cubic-bezier(0.2, 1.4, 0.4, 1), opacity 0.3s ease;
  outline: none;
}
@keyframes rb-card-drop {
  from { opacity: 0; transform: translateY(-110px) rotateZ(-6deg) scale(1.08); }
}
.rb-card.live:hover:not(.dismissed):not(.picked),
.rb-card:focus-visible {
  transform: translateY(-10px) scale(1.03);
}
.rb-card.picked {
  z-index: 2;
  animation: rb-card-pick 0.45s cubic-bezier(0.2, 1.2, 0.4, 1) forwards;
}
@keyframes rb-card-pick {
  0% { transform: translateY(-10px) scale(1.03); }
  40% { transform: translateY(-24px) scale(1.14); filter: brightness(1.8); }
  100% { transform: translateY(-40px) scale(1.2); opacity: 0; filter: brightness(3) blur(2px); }
}
.rb-card.dismissed {
  animation: rb-card-out 0.4s ease-in forwards;
}
@keyframes rb-card-out {
  to { transform: translateY(80px) rotate(6deg) scale(0.9); opacity: 0; }
}
.rb-card-tilt {
  position: relative;
  height: 100%;
  display: block;
  transform-style: preserve-3d;
  transform: rotateX(var(--rx)) rotateY(var(--ry));
  transition: transform 0.35s cubic-bezier(0.2, 0.9, 0.3, 1);
}
.rb-card:hover .rb-card-tilt {
  transition: transform 0.08s linear;
}
.rb-card-flip {
  position: relative;
  height: 100%;
  display: block;
  transform-style: preserve-3d;
  animation: rb-flip 0.62s cubic-bezier(0.3, 1.25, 0.45, 1) backwards;
  animation-delay: var(--d);
}
@keyframes rb-flip {
  0% { transform: rotateY(180deg) scale(0.96); }
  55% { transform: rotateY(-12deg) scale(1.05); }
  100% { transform: rotateY(0) scale(1); }
}
.rb-card-back,
.rb-card-front {
  display: block;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}
.rb-card-back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
  display: grid;
  place-items: center;
  clip-path: var(--shape);
  background:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--r) 40%, transparent), transparent 60%),
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.05) 0 2px, transparent 2px 12px),
    repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.05) 0 2px, transparent 2px 12px),
    linear-gradient(180deg, #1a1030, #0a0716);
  box-shadow: inset 0 0 0 2px var(--r), inset 0 0 40px var(--rg);
}
.rb-card-back-sigil {
  display: grid;
  place-items: center;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  color: var(--r);
  border: 1px dashed color-mix(in srgb, var(--r) 70%, transparent);
  box-shadow: 0 0 30px var(--rg), inset 0 0 20px var(--rg);
  filter: drop-shadow(0 0 10px var(--r));
}
.rb-card-front {
  position: relative;
  height: 100%;
  filter: drop-shadow(0 0 18px var(--rg)) drop-shadow(0 12px 22px rgba(0, 0, 0, 0.6));
}
.rb-card.common .rb-card-front {
  position: relative;
  height: 100%;
  filter: drop-shadow(0 12px 22px rgba(0, 0, 0, 0.6));
}
.rb-card-frame {
  position: absolute;
  inset: 0;
  clip-path: var(--shape);
  background: conic-gradient(from var(--rb-card-a, 0deg), var(--r), color-mix(in srgb, var(--r) 20%, transparent) 25%, var(--r) 50%, color-mix(in srgb, var(--r) 20%, transparent) 75%, var(--r));
  animation: rb-card-orbit 4s linear infinite;
}
.rb-card.common .rb-card-frame {
  animation: none;
  background: linear-gradient(160deg, rgba(184, 194, 214, 0.6), rgba(184, 194, 214, 0.15));
}
.rb-card.legendary .rb-card-frame {
  animation-duration: 1.8s;
}
@property --rb-card-a {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
@keyframes rb-card-orbit {
  to { --rb-card-a: 360deg; }
}
.rb-card-face {
  position: relative;
  min-height: 326px;
  height: calc(100% - 4px);
  margin: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 14px 16px 16px;
  overflow: hidden;
  clip-path: var(--shape);
  background:
    radial-gradient(90% 60% at 50% 28%, color-mix(in srgb, var(--ic) 22%, transparent), transparent 70%),
    linear-gradient(180deg, #160f2a, #0a0716);
}

/* legendary aura behind the card */
.rb-card-aura {
  position: absolute;
  inset: -14px;
  border-radius: 30px;
  background: conic-gradient(from var(--rb-card-a, 0deg), #ffb627, #fff4c2, #ff6a2b, #ffb627, #fff4c2, #ff6a2b, #ffb627);
  filter: blur(18px);
  opacity: 0.75;
  animation: rb-card-orbit 3s linear infinite, rb-aura 1.6s ease-in-out infinite alternate;
  animation-delay: 0s, var(--d);
}
@keyframes rb-aura {
  from { opacity: 0.45; transform: scale(0.97); }
  to { opacity: 0.9; transform: scale(1.03); }
}

/* holo foil + shine */
.rb-card-holo {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  mix-blend-mode: color-dodge;
  background:
    radial-gradient(circle at var(--mx) var(--my), rgba(255, 255, 255, 0.45), transparent 42%),
    linear-gradient(calc(115deg + var(--hp) * 0.1), transparent 20%, hsl(calc(var(--hp) + 0deg) 90% 65% / 0.35) 38%, hsl(calc(var(--hp) + 120deg) 90% 65% / 0.35) 52%, hsl(calc(var(--hp) + 240deg) 90% 65% / 0.35) 66%, transparent 82%);
  transition: opacity 0.25s ease;
}
.rb-card.live:hover .rb-card-holo {
  opacity: 0.55;
}
.rb-card.epic.live:hover .rb-card-holo,
.rb-card.legendary.live:hover .rb-card-holo {
  opacity: 0.9;
}
.rb-card.legendary .rb-card-holo {
  opacity: 0.25;
}
.rb-card-shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 38%, color-mix(in srgb, var(--r) 40%, transparent) 47%, rgba(255, 255, 255, 0.55) 50%, color-mix(in srgb, var(--r) 40%, transparent) 53%, transparent 62%);
  transform: translateX(-110%);
  animation: rb-shine 4.2s ease-in-out infinite;
  animation-delay: calc(var(--d) + 500ms);
}
.rb-card.epic .rb-card-shine {
  animation-duration: 3.2s;
}
.rb-card.legendary .rb-card-shine {
  animation-duration: 2.2s;
}
@keyframes rb-shine {
  0% { transform: translateX(-110%); }
  45%, 100% { transform: translateX(110%); }
}
.rb-card-sparks i {
  position: absolute;
  bottom: -6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ffe08a;
  box-shadow: 0 0 8px #ffb627;
  animation: rb-spark-up linear infinite;
}
@keyframes rb-spark-up {
  0% { transform: translateY(0) scale(1); opacity: 0; }
  15% { opacity: 1; }
  100% { transform: translateY(-340px) scale(0.3); opacity: 0; }
}

/* badges */
.rb-card-badge {
  position: relative;
  display: block;
  height: 20px;
  margin-top: 8px;
}
.rb-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  animation: rb-pill 0.9s ease-in-out infinite alternate;
}
@keyframes rb-pill {
  to { transform: scale(1.08); }
}
.rb-pill.new {
  color: #061418;
  background: #8ef6ff;
  box-shadow: 0 0 12px rgba(142, 246, 255, 0.7);
}
.rb-pill.ability {
  color: #061418;
  background: linear-gradient(90deg, var(--ic), color-mix(in srgb, var(--ic) 45%, #fff));
  box-shadow: 0 0 14px var(--ic);
}
.rb-ribbon {
  position: absolute;
  z-index: 2;
}
.rb-ribbon.evo {
  top: 0;
  right: 0;
  left: 0;
  width: auto;
  rotate: none;
  padding: 6px 0;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.4em;
  color: #fff;
  background: linear-gradient(90deg, #7a1400, #ff4d1a, #ffb627, #ff4d1a, #7a1400);
  background-size: 200% 100%;
  text-shadow: 0 0 8px #ffe08a, 0 1px 0 #7a1400;
  animation: rb-fire-band 1.4s linear infinite;
}
@keyframes rb-fire-band {
  to { background-position: -200% 0; }
}

.rb-card-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.k-evolution .rb-card-top {
  margin-top: 24px;
}
.rb-card-rarity {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--r);
  text-shadow: 0 0 10px var(--rg);
}
.rb-card-num {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

/* emblem */
.rb-card-emblem {
  position: relative;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  margin: 6px 0 12px;
}
.rb-card-emblem-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--ic) 35%, transparent), transparent 70%);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ic) 50%, transparent);
}
.rb-card-emblem-ring::after {
  content: '';
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px dashed color-mix(in srgb, var(--r) 55%, transparent);
  animation: rb-rays 12s linear infinite;
}
.rb-card-icon {
  position: relative;
  width: 40px;
  height: 40px;
  color: var(--ic);
  filter: drop-shadow(0 0 10px var(--ic));
}
.rb-card.live:hover .rb-card-icon {
  animation: rb-icon-wobble 0.5s ease-in-out;
}
@keyframes rb-icon-wobble {
  30% { transform: rotate(-10deg) scale(1.15); }
  60% { transform: rotate(6deg) scale(1.1); }
}

/* ability: chamfered rune frame, hex emblem, key badge */
.rb-card.k-ability {
  --shape: polygon(16px 0, calc(100% - 16px) 0, 100% 16px, 100% calc(100% - 16px), calc(100% - 16px) 100%, 16px 100%, 0 calc(100% - 16px), 0 16px);
  --r: var(--ic);
  --rg: color-mix(in srgb, var(--ic) 55%, transparent);
}
.k-ability .rb-card-face {
  background:
    radial-gradient(90% 55% at 50% 30%, color-mix(in srgb, var(--ic) 28%, transparent), transparent 70%),
    repeating-linear-gradient(60deg, color-mix(in srgb, var(--ic) 7%, transparent) 0 1px, transparent 1px 14px),
    repeating-linear-gradient(-60deg, color-mix(in srgb, var(--ic) 7%, transparent) 0 1px, transparent 1px 14px),
    linear-gradient(180deg, #0f1428, #070912);
}
.k-ability .rb-card-emblem {
  width: 96px;
  height: 96px;
}
.k-ability .rb-card-emblem-ring {
  inset: 10px;
  border-radius: 0;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: radial-gradient(circle, color-mix(in srgb, var(--ic) 45%, #0a0614), #0a0614 75%);
  box-shadow: none;
}
.k-ability .rb-card-emblem-ring::after {
  display: none;
}
.rb-card-runes {
  position: absolute;
  inset: 0;
  overflow: visible;
  fill: none;
  stroke: var(--ic);
  animation: rb-rays 16s linear infinite;
}
.rb-card-runes polygon {
  stroke-width: 2;
  filter: drop-shadow(0 0 6px var(--ic));
}
.rb-card-runes circle {
  stroke-width: 1;
  stroke-dasharray: 2 5 10 5;
  opacity: 0.6;
}
.rb-card-key {
  position: absolute;
  right: -6px;
  bottom: -4px;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 900;
  line-height: 1;
  color: #07050d;
  background: linear-gradient(160deg, #fff, var(--ic));
  box-shadow: 0 0 14px var(--ic), inset 0 -2px 0 rgba(0, 0, 0, 0.3);
}

/* evolution: burning frame */
.k-evolution .rb-card-frame {
  background: linear-gradient(0deg, #ff2a00, #ff8a2b, #ffe08a, #ff8a2b, #ff2a00);
  background-size: 100% 300%;
  animation: rb-fire-frame 1.2s linear infinite;
}
@keyframes rb-fire-frame {
  to { background-position: 0 -300%; }
}
.k-evolution .rb-card-face {
  background:
    radial-gradient(120% 60% at 50% 110%, rgba(255, 90, 20, 0.55), transparent 65%),
    radial-gradient(90% 55% at 50% 34%, color-mix(in srgb, var(--ic) 26%, transparent), transparent 70%),
    linear-gradient(180deg, #1c0d10, #0b0608);
}
.k-evolution .rb-card-emblem-ring {
  box-shadow: inset 0 0 0 2px #ff8a2b, 0 0 24px rgba(255, 110, 30, 0.8);
  animation: rb-ember-ring 0.9s ease-in-out infinite alternate;
}
@keyframes rb-ember-ring {
  to { box-shadow: inset 0 0 0 2px #ffe08a, 0 0 40px rgba(255, 150, 40, 1); }
}
.k-evolution .rb-card-sparks i {
  background: #ff9b3d;
  box-shadow: 0 0 8px #ff4d1a;
}
.k-evolution .rb-card-name {
  background: linear-gradient(180deg, #fff 30%, #ffb627 70%, #ff4d1a);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 8px rgba(255, 110, 30, 0.8));
}

.rb-card-name {
  position: relative;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.15;
  color: #fff;
}
.rb-card-kind {
  margin-top: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.5);
}
.rb-card-desc {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.rb-card-text {
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(235, 230, 250, 0.82);
}
.rb-card-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 5px;
}
.rb-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 7px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11.5px;
  line-height: 1.1;
  background: color-mix(in srgb, var(--ic) 12%, rgba(255, 255, 255, 0.04));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ic) 30%, transparent);
}
.rb-stat-to {
  font-weight: 800;
  color: #fff;
  text-shadow: 0 0 8px color-mix(in srgb, var(--ic) 70%, transparent);
}
.rb-stat-label {
  color: rgba(220, 212, 240, 0.72);
}
.rb-stat-from {
  color: rgba(220, 212, 240, 0.5);
  text-decoration: line-through;
  text-decoration-color: rgba(255, 255, 255, 0.25);
}
.rb-stat-arrow {
  width: 11px;
  height: 11px;
  align-self: center;
  color: var(--ic);
}
.rb-card-pips {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-top: auto;
  padding-top: 14px;
}
.rb-card-pips i {
  width: 12px;
  height: 5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
}
.rb-card-pips i.on {
  background: var(--ic);
  box-shadow: 0 0 6px var(--ic);
}
.rb-card-pips i.next {
  background: #fff;
  box-shadow: 0 0 10px #fff;
  animation: rb-next-pip 0.7s ease-in-out infinite alternate;
}
@keyframes rb-next-pip {
  to { opacity: 0.35; }
}
.rb-card-level {
  position: relative;
  margin-top: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.8);
}

.rb-lu-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 14px;
  animation: rb-fade 0.4s 0.6s ease-out backwards;
}
.rb-reroll {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 12px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.3);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
}
.rb-reroll:hover:not(:disabled) {
  background: rgba(142, 246, 255, 0.12);
}
.rb-reroll:hover:not(:disabled) .iconify {
  animation: rb-spin-once 0.5s ease;
}
@keyframes rb-spin-once {
  to { transform: rotate(360deg); }
}
.rb-reroll:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.rb-reroll kbd,
.rb-lu-hint kbd {
  padding: 2px 6px;
  border-radius: 5px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  background: rgba(255, 255, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}
.rb-reroll-count {
  min-width: 18px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 11px;
  color: #061026;
  background: #8ef6ff;
}
.rb-lu-hint {
  font-size: 12px;
  color: rgba(220, 212, 240, 0.55);
}
@media (max-width: 640px) {
  .rb-lu { place-items: start center; }
  .rb-lu-cards { grid-template-columns: minmax(0, 340px); }
  .rb-card { min-height: 0; }
  .rb-card-face { min-height: 0; }
  .rb-card-emblem { width: 60px; height: 60px; margin: 8px 0 8px; }
  .k-ability .rb-card-emblem { width: 70px; height: 70px; }
  .rb-card-icon { width: 28px; height: 28px; }
  .rb-card-pips { padding-top: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-lu * { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; }
}
</style>
