<script setup lang="ts">
import { RIFTBORN_ACHIEVEMENTS, RIFTBORN_BOSS_TIMES, RIFTBORN_CLASSES, RIFTBORN_RUN_SECONDS, riftbornClass, riftbornSkillPointsSpent } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassId, RiftbornSkillRanks } from '#shared/utils/gamelogic/riftborn'
import type { Sfx } from './engine/types'
import RiftbornAccount from './RiftbornAccount.vue'
import RiftbornAchievements from './RiftbornAchievements.vue'
import RiftbornClassCard from './RiftbornClassCard.vue'
import RiftbornCodex from './RiftbornCodex.vue'
import RiftbornPortrait from './RiftbornPortrait.vue'
import RiftbornShowcase from './RiftbornShowcase.vue'
import RiftbornSkillTree from './RiftbornSkillTree.vue'
import { formatClock, hex } from './riftborn-ui'
import type { RiftbornSaveStatus, RiftbornState } from './riftborn-ui'

const props = defineProps<{
  state: RiftbornState
  selected: RiftbornClassId
  starting: boolean
  muted: boolean
  ranks: RiftbornSkillRanks
  saveStatus: RiftbornSaveStatus
  sfx: Sfx
  freshClasses: string[]
  freshAchievements: string[]
}>()

const emit = defineEmits<{
  select: [id: RiftbornClassId]
  start: []
  toggleMute: []
  hover: []
  skills: [ranks: RiftbornSkillRanks]
  saveSkills: []
  celebrated: [id: RiftbornClassId]
}>()

const selectedDef = computed(() => riftbornClass(props.selected) ?? RIFTBORN_CLASSES[0]!)
const selectedColor = computed(() => hex(selectedDef.value.color))
const isUnlocked = (id: string) => props.state.unlockedClasses.includes(id)
const available = computed(() => props.state.skillPoints - riftbornSkillPointsSpent(props.ranks))
const featsDone = computed(() => RIFTBORN_ACHIEVEMENTS.filter(a => props.state.achievements.includes(a.id)).length)

type Tab = 'vessels' | 'tree' | 'feats' | 'codex'
const tab = ref<Tab>(props.freshAchievements.length && !props.freshClasses.length ? 'feats' : 'vessels')
const tabs = computed(() => [
  { id: 'vessels' as const, label: 'Vessels', icon: 'i-lucide-users', badge: `${props.state.unlockedClasses.length}/${RIFTBORN_CLASSES.length}`, hot: false },
  { id: 'tree' as const, label: 'Skill tree', icon: 'i-lucide-git-fork', badge: available.value > 0 ? `${available.value}` : '', hot: available.value > 0 },
  { id: 'feats' as const, label: 'Achievements', icon: 'i-lucide-trophy', badge: `${featsDone.value}/${RIFTBORN_ACHIEVEMENTS.length}`, hot: props.freshAchievements.length > 0 },
  { id: 'codex' as const, label: 'Codex', icon: 'i-lucide-book-open', badge: '', hot: false }
])
const tabsEl = ref<HTMLElement | null>(null)
function openTab(id: Tab, scroll = false) {
  if (tab.value !== id) props.sfx.play('uiClick')
  tab.value = id
  if (scroll) nextTick(() => tabsEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

const lifetime = computed(() => {
  const s = props.state.stats
  return [
    { label: 'Runs', value: formatNumber(s.runsPlayed), icon: 'i-lucide-swords' },
    { label: 'Victories', value: formatNumber(s.victories), icon: 'i-lucide-crown' },
    { label: 'Best time', value: formatClock(s.bestTime), icon: 'i-lucide-hourglass' },
    { label: 'Best kills', value: formatNumber(s.bestKills), icon: 'i-lucide-skull' },
    { label: 'Best level', value: formatNumber(s.bestLevel), icon: 'i-lucide-trending-up' },
    { label: 'Total kills', value: formatNumber(s.totalKills), icon: 'i-lucide-flame' },
    { label: 'Total Rift XP', value: formatNumber(props.state.xp), icon: 'i-lucide-orbit' }
  ]
})

const controls = [
  { keys: ['W', 'A', 'S', 'D'], label: 'Move' },
  { keys: ['Space'], label: 'Dash' },
  { keys: ['Q', 'F', 'R'], label: 'Abilities' },
  { keys: ['E', 'RMB'], label: 'Ultimate' },
  { keys: ['Esc'], label: 'Pause' }
]

const rules = [
  { icon: 'i-lucide-crosshair', color: '#8ef6ff', text: 'Weapons fire on their own. Move and dash.' },
  { icon: 'i-lucide-sparkles', color: '#b28cff', text: 'Level up to draft weapons, passives and abilities.' },
  { icon: 'i-lucide-flame', color: '#ff8a2b', text: 'Max a weapon with its passive to evolve it.' },
  { icon: 'i-lucide-hexagon', color: '#5ef0ff', text: 'Ability slots open at level 1, 8 and 18.' },
  { icon: 'i-lucide-zap', color: '#ffc54d', text: 'Kills build combo and charge your ultimate.' },
  { icon: 'i-lucide-orbit', color: '#8ef6ff', text: 'Every run earns Rift XP for the skill tree.' }
]

const runMinutes = Math.round(RIFTBORN_RUN_SECONDS / 60)
const bossCount = RIFTBORN_BOSS_TIMES.length

const stars = Array.from({ length: 40 }, (_, i) => ({
  left: `${(i * 37.7) % 100}%`,
  top: `${(i * 61.3) % 100}%`,
  size: `${1 + (i % 3)}px`,
  delay: `${(i * 0.37) % 5}s`
}))
</script>

<template>
  <div class="rb-lobby" :style="{ '--c': selectedColor }">
    <div class="rb-sky" aria-hidden="true">
      <div class="rb-nebula" />
      <span v-for="(s, i) in stars" :key="i" class="rb-star" :style="{ left: s.left, top: s.top, width: s.size, height: s.size, animationDelay: s.delay }" />
    </div>

    <div class="relative mx-auto w-full max-w-[1400px] px-4 pb-32 pt-6 sm:px-6 sm:pt-10">
      <!-- top bar -->
      <div class="flex items-start justify-between gap-2">
        <RiftbornAccount
          :level="state.level"
          :xp-into-level="state.xpIntoLevel"
          :xp-for-next="state.xpForNext"
          :available="available"
          @open-tree="openTab('tree', true)"
        />
        <button type="button" class="rb-icon-btn shrink-0" :aria-label="muted ? 'Unmute' : 'Mute'" @click="emit('toggleMute')">
          <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
        </button>
      </div>

      <!-- title -->
      <header class="rb-hero">
        <div class="rb-portal" aria-hidden="true">
          <div class="rb-portal-core" />
          <div class="rb-portal-swirl" />
          <div class="rb-portal-swirl b" />
        </div>
        <p class="rb-kicker">Horde survival roguelike</p>
        <h1 class="rb-title" data-text="RIFTBORN">RIFTBORN</h1>
        <svg class="rb-tear" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 20 L80 18 L110 26 L150 12 L200 22 L240 16 L270 28 L300 8 L330 30 L360 15 L400 23 L440 13 L480 24 L520 17 L600 20" />
        </svg>
        <p class="rb-tagline">
          Survive {{ runMinutes }} minutes · Break {{ bossCount }} bosses · Kill the Rift Heart
        </p>
      </header>

      <!-- lifetime -->
      <div class="rb-lifetime">
        <div v-for="(s, i) in lifetime" :key="s.label" class="rb-life" :style="{ animationDelay: `${0.15 + i * 0.05}s` }">
          <UIcon :name="s.icon" class="size-3.5 opacity-70" />
          <span class="rb-life-label">{{ s.label }}</span>
          <b class="rb-life-value">{{ s.value }}</b>
        </div>
      </div>

      <!-- tabs -->
      <nav ref="tabsEl" class="rb-tabs" role="tablist" aria-label="Riftborn menu">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          role="tab"
          class="rb-tab"
          :class="{ active: tab === t.id, hot: t.hot }"
          :aria-selected="tab === t.id"
          @click="openTab(t.id)"
          @mouseenter="emit('hover')"
        >
          <UIcon :name="t.icon" class="size-4" />
          <span>{{ t.label }}</span>
          <span v-if="t.badge" class="rb-tab-badge">{{ t.badge }}</span>
        </button>
      </nav>

      <section v-if="tab === 'vessels'" class="rb-tab-panel">
        <RiftbornShowcase :cls="selectedDef" :unlocked="isUnlocked(selected)" />
        <div class="mb-4 mt-8 flex flex-wrap items-end justify-between gap-2">
          <h2 class="rb-h2">Classes</h2>
          <span class="rb-hint">Unlock with achievements</span>
        </div>
        <div class="rb-classes">
          <RiftbornClassCard
            v-for="(c, i) in RIFTBORN_CLASSES"
            :key="c.id"
            :cls="c"
            :unlocked="isUnlocked(c.id)"
            :selected="selected === c.id"
            :celebrate="freshClasses.includes(c.id)"
            class="rb-rise"
            :style="{ animationDelay: `${0.1 + i * 0.06}s` }"
            @select="emit('select', c.id)"
            @hover="emit('hover')"
            @celebrated="emit('celebrated', c.id)"
          />
        </div>

        <aside class="rb-howto mt-8">
          <h2 class="rb-h2">How to survive</h2>
          <div class="rb-howto-grid">
            <ul class="rb-controls">
              <li v-for="c in controls" :key="c.label">
                <span class="flex flex-wrap gap-1">
                  <kbd v-for="k in c.keys" :key="k" class="rb-kbd">{{ k }}</kbd>
                </span>
                <span>{{ c.label }}</span>
              </li>
            </ul>
            <ol class="rb-rules">
              <li v-for="r in rules" :key="r.text">
                <UIcon :name="r.icon" class="size-4 shrink-0" :style="{ color: r.color }" />{{ r.text }}
              </li>
            </ol>
          </div>
        </aside>
      </section>

      <section v-else-if="tab === 'tree'" class="rb-tab-panel">
        <RiftbornSkillTree
          :ranks="ranks"
          :points="state.skillPoints"
          :status="saveStatus"
          :sfx="sfx"
          @change="emit('skills', $event)"
          @save="emit('saveSkills')"
          @hover="emit('hover')"
        />
      </section>

      <section v-else-if="tab === 'codex'" class="rb-tab-panel">
        <RiftbornCodex :sfx="sfx" :unlocked-classes="state.unlockedClasses" @hover="emit('hover')" />
      </section>

      <section v-else class="rb-tab-panel">
        <RiftbornAchievements :achievements="state.achievements" :fresh="freshAchievements" @hover="emit('hover')" />
      </section>
    </div>

    <!-- launch bar -->
    <div class="rb-launch">
      <div class="rb-launch-inner">
        <div class="rb-launch-portrait">
          <RiftbornPortrait :class-id="selectedDef.id" :color="selectedColor" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="rb-launch-name">{{ selectedDef.name }}</div>
          <div class="rb-launch-sub">
            <UIcon name="i-lucide-zap" class="size-3 shrink-0" />
            <span class="truncate">{{ selectedDef.ultimate }}</span>
          </div>
        </div>
        <button
          type="button"
          class="rb-start"
          :disabled="starting || !isUnlocked(selected)"
          @click="emit('start')"
          @mouseenter="emit('hover')"
        >
          <span class="rb-start-shine" />
          <UIcon v-if="starting" name="i-lucide-loader-circle" class="size-5 animate-spin" />
          <UIcon v-else name="i-lucide-play" class="size-5" />
          <span>Start run</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-lobby {
  --c: #b28cff;
  position: relative;
  min-height: 100%;
  isolation: isolate;
  overflow-x: clip;
}
.rb-sky {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.rb-nebula {
  position: absolute;
  inset: -20% -10% auto;
  height: 900px;
  background:
    radial-gradient(40% 35% at 50% 20%, color-mix(in srgb, var(--c) 28%, transparent), transparent 70%),
    radial-gradient(30% 30% at 20% 40%, rgba(255, 63, 164, 0.14), transparent 70%),
    radial-gradient(30% 30% at 82% 30%, rgba(94, 240, 255, 0.12), transparent 70%);
  filter: blur(10px);
  transition: background 0.8s ease;
  animation: rb-breathe 9s ease-in-out infinite alternate;
}
@keyframes rb-breathe {
  to { transform: scale(1.08) translateY(20px); opacity: 0.8; }
}
.rb-star {
  position: absolute;
  border-radius: 50%;
  background: #fff;
  opacity: 0.4;
  animation: rb-twinkle 4s ease-in-out infinite;
}
@keyframes rb-twinkle {
  50% { opacity: 0.05; }
}

.rb-icon-btn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  color: rgba(240, 236, 250, 0.85);
  background: rgba(10, 7, 20, 0.7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
}
.rb-icon-btn:hover {
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.rb-hero {
  position: relative;
  margin-top: 18px;
  text-align: center;
}
.rb-portal {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(560px, 110vw);
  aspect-ratio: 1;
  translate: -50% -55%;
  z-index: -1;
  pointer-events: none;
}
.rb-portal-core {
  position: absolute;
  inset: 32%;
  border-radius: 50%;
  background: radial-gradient(circle, #000 30%, color-mix(in srgb, var(--c) 40%, transparent) 60%, transparent 72%);
  filter: blur(6px);
}
.rb-portal-swirl {
  position: absolute;
  inset: 18%;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, color-mix(in srgb, var(--c) 45%, transparent), transparent 30%, rgba(255, 63, 164, 0.35), transparent 60%, rgba(94, 240, 255, 0.3), transparent 85%);
  mask: radial-gradient(circle, transparent 38%, #000 42%, #000 58%, transparent 70%);
  filter: blur(3px);
  animation: rb-swirl 14s linear infinite;
}
.rb-portal-swirl.b {
  inset: 8%;
  opacity: 0.5;
  animation-duration: 22s;
  animation-direction: reverse;
}
@keyframes rb-swirl {
  to { transform: rotate(360deg); }
}
.rb-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.4em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.6);
}
.rb-title {
  position: relative;
  margin-top: 14px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(44px, 11vw, 120px);
  font-weight: 900;
  line-height: 0.9;
  letter-spacing: -0.02em;
  color: #fff;
  background: linear-gradient(180deg, #fff 30%, color-mix(in srgb, var(--c) 70%, #fff) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 30px color-mix(in srgb, var(--c) 55%, transparent));
  animation: rb-title-in 1s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
.rb-title::before,
.rb-title::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  -webkit-text-fill-color: currentColor;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.7;
}
.rb-title::before {
  color: #ff3fa4;
  animation: rb-glitch-a 4.5s steps(1) infinite;
}
.rb-title::after {
  color: #5ef0ff;
  animation: rb-glitch-b 4.5s steps(1) infinite;
}
@keyframes rb-title-in {
  from { opacity: 0; letter-spacing: 0.3em; filter: blur(12px); }
}
@keyframes rb-glitch-a {
  0%, 88%, 100% { transform: translate(0); clip-path: inset(0 0 100% 0); }
  89% { transform: translate(-6px, 1px); clip-path: inset(20% 0 55% 0); }
  91% { transform: translate(5px, -1px); clip-path: inset(60% 0 10% 0); }
  93% { transform: translate(-3px, 0); clip-path: inset(40% 0 35% 0); }
}
@keyframes rb-glitch-b {
  0%, 89%, 100% { transform: translate(0); clip-path: inset(0 0 100% 0); }
  90% { transform: translate(6px, 0); clip-path: inset(10% 0 70% 0); }
  92% { transform: translate(-5px, 1px); clip-path: inset(70% 0 5% 0); }
  94% { transform: translate(3px, 0); clip-path: inset(30% 0 50% 0); }
}
.rb-tear {
  display: block;
  width: min(520px, 90%);
  height: 26px;
  margin: 6px auto 0;
  overflow: visible;
}
.rb-tear path {
  fill: none;
  stroke: #fff;
  stroke-width: 2;
  filter: drop-shadow(0 0 6px var(--c)) drop-shadow(0 0 14px #ff3fa4);
  stroke-dasharray: 700;
  stroke-dashoffset: 700;
  animation: rb-tear 1.2s 0.4s cubic-bezier(0.6, 0, 0.2, 1) forwards, rb-tear-flicker 3s 1.6s ease-in-out infinite;
}
@keyframes rb-tear {
  to { stroke-dashoffset: 0; }
}
@keyframes rb-tear-flicker {
  50% { opacity: 0.55; }
}
.rb-tagline {
  max-width: 560px;
  margin: 16px auto 0;
  font-size: 14px;
  line-height: 1.55;
  color: rgba(220, 212, 240, 0.72);
}

.rb-lifetime {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 26px;
}
.rb-life {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 10px;
  color: rgba(220, 212, 240, 0.7);
  background: rgba(14, 10, 28, 0.7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  animation: rb-rise 0.5s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
.rb-life-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.rb-life-value {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  color: #fff;
}

.rb-h2 {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
}
.rb-hint {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-classes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 16px;
}
.rb-rise {
  animation: rb-rise 0.6s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
@keyframes rb-rise {
  from { opacity: 0; transform: translateY(18px); }
}

.rb-tabs {
  display: flex;
  gap: 6px;
  margin-top: 34px;
  padding: 5px;
  border-radius: 16px;
  overflow-x: auto;
  scroll-margin-top: 16px;
  background: rgba(10, 7, 20, 0.7);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  scrollbar-width: none;
}
.rb-tab {
  position: relative;
  display: inline-flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 11px 14px;
  border-radius: 12px;
  white-space: nowrap;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.6);
  cursor: pointer;
  transition: color 0.2s ease, background 0.2s ease;
}
.rb-tab:hover {
  color: #fff;
}
.rb-tab.active {
  color: #fff;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 26%, transparent), color-mix(in srgb, var(--c) 10%, transparent));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent);
}
.rb-tab-badge {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.08);
}
.rb-tab.hot .rb-tab-badge {
  color: #061026;
  background: #8ef6ff;
  box-shadow: 0 0 12px #8ef6ff;
  animation: rb-hot 1.4s ease-in-out infinite;
}
@keyframes rb-hot {
  50% { transform: scale(1.12); }
}
.rb-tab-panel {
  margin-top: 18px;
  animation: rb-rise 0.4s cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
.rb-howto-grid {
  display: grid;
  gap: 18px;
}
@media (min-width: 900px) {
  .rb-howto-grid { grid-template-columns: 320px minmax(0, 1fr); }
  .rb-howto-grid .rb-rules { margin-top: 14px; padding-top: 0; border-top: 0; }
}
.rb-howto {
  border-radius: 20px;
  padding: 18px;
  background: linear-gradient(180deg, rgba(20, 14, 38, 0.85), rgba(10, 7, 20, 0.85));
  box-shadow: inset 0 0 0 1px rgba(160, 130, 255, 0.14);
}
.rb-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 14px;
}
.rb-controls li {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: rgba(220, 212, 240, 0.7);
}
.rb-kbd {
  min-width: 24px;
  padding: 4px 6px;
  border-radius: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.14);
}
.rb-rules {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
.rb-rules {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
}
.rb-rules li {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(220, 212, 240, 0.75);
}

.rb-launch {
  position: sticky;
  bottom: 0;
  z-index: 10;
  padding: 0 16px 16px;
  pointer-events: none;
}
.rb-launch-inner {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: 900px;
  margin: 0 auto;
  padding: 10px 10px 10px 10px;
  border-radius: 20px;
  background: rgba(10, 7, 20, 0.82);
  backdrop-filter: blur(14px);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 35%, transparent), 0 20px 50px -10px rgba(0, 0, 0, 0.9), 0 0 50px -20px var(--c);
}
.rb-launch-portrait {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 50%, transparent);
}
.rb-launch-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.1;
  color: #fff;
}
.rb-launch-sub {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 12px;
  color: color-mix(in srgb, var(--c) 60%, #fff);
}
.rb-start {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 16px 28px;
  border-radius: 14px;
  overflow: hidden;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 16px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #0b0716;
  background: linear-gradient(135deg, #fff, var(--c) 55%, color-mix(in srgb, var(--c) 60%, #ff3fa4));
  box-shadow: 0 0 34px -4px var(--c), inset 0 -3px 0 rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: transform 0.15s ease, filter 0.15s ease, box-shadow 0.2s ease;
  animation: rb-start-pulse 2.4s ease-in-out infinite;
}
.rb-start:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  filter: brightness(1.1);
}
.rb-start:active:not(:disabled) {
  transform: scale(0.97);
}
.rb-start:disabled {
  animation: none;
  cursor: not-allowed;
  filter: grayscale(0.7) brightness(0.7);
}
.rb-start-shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.7) 50%, transparent 70%);
  transform: translateX(-120%);
  animation: rb-shine 3s ease-in-out infinite;
}
@keyframes rb-shine {
  60%, 100% { transform: translateX(120%); }
}
@keyframes rb-start-pulse {
  50% { box-shadow: 0 0 54px 0 var(--c), inset 0 -3px 0 rgba(0, 0, 0, 0.25); }
}
@media (max-width: 560px) {
  .rb-launch-sub { display: none; }
  .rb-start { padding: 14px 18px; font-size: 14px; }
  .rb-controls { grid-template-columns: 1fr 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-lobby * { animation: none !important; }
}
</style>
