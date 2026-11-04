<script setup lang="ts">
import { RIFTBORN_BOSS_TIMES, riftbornClass, riftbornLevelForXp } from '#shared/utils/gamelogic/riftborn'
import type { DamageShare, RunResult, Sfx } from './engine/types'
import RiftbornItemIcon from './RiftbornItemIcon.vue'
import RiftbornPortrait from './RiftbornPortrait.vue'
import { formatClock, hex } from './riftborn-ui'
import type { RiftbornFinishResponse } from './riftborn-ui'

const props = defineProps<{
  result: RunResult
  finish: RiftbornFinishResponse | null
  finishing: boolean
  error: string | null
  sfx: Sfx
  className: string
  color: string
}>()

const emit = defineEmits<{
  retry: []
  playAgain: []
  lobby: []
  hover: []
}>()

const victory = computed(() => props.result.victory)

const stats = computed(() => [
  { label: 'Survived', value: formatClock(props.result.time), icon: 'i-lucide-hourglass', best: props.finish?.newBest.time },
  { label: 'Kills', value: formatNumber(props.result.kills, props.result.kills >= 100000), icon: 'i-lucide-skull', best: props.finish?.newBest.kills },
  { label: 'Level', value: String(props.result.level), icon: 'i-lucide-trending-up' },
  { label: 'Bosses', value: `${props.result.bossKills}/${RIFTBORN_BOSS_TIMES.length}`, icon: 'i-lucide-crown' },
  { label: 'Elites', value: formatNumber(props.result.eliteKills), icon: 'i-lucide-swords' },
  { label: 'Shards', value: formatNumber(props.result.shards), icon: 'i-lucide-gem' },
  { label: 'Best combo', value: formatNumber(props.result.highestCombo), icon: 'i-lucide-flame' },
  { label: 'Damage', value: formatNumber(props.result.damageDealt), icon: 'i-lucide-sword' }
])

/* Damage by source: the top sources as bars, the long tail folded into one row */
const MAX_SOURCES = 8
const BAR_START_MS = 950
const BAR_STEP_MS = 110
const BAR_GROW_MS = 700

interface SourceRow extends DamageShare {
  share: number
  width: number
  hex: string
  tag: string
}

const abilities = computed(() => props.result.abilities ?? [])
const damageTotal = computed(() => (props.result.damageBySource ?? []).reduce((n, s) => n + Math.max(0, s.damage), 0))
const sources = computed<SourceRow[]>(() => {
  const list = (props.result.damageBySource ?? []).filter(s => s.damage > 0).sort((a, b) => b.damage - a.damage)
  const total = damageTotal.value
  if (!list.length || total <= 0) return []
  let rows: DamageShare[] = list
  if (list.length > MAX_SOURCES) {
    const rest = list.slice(MAX_SOURCES - 1)
    rows = [...list.slice(0, MAX_SOURCES - 1), {
      id: '__other',
      name: `Other (${rest.length})`,
      icon: 'i-lucide-ellipsis',
      color: 0x8a84a0,
      damage: rest.reduce((n, s) => n + s.damage, 0),
      kind: 'other'
    }]
  }
  const top = Math.max(...rows.map(r => r.damage))
  return rows.map((r) => {
    const key = r.kind === 'ability' ? abilities.value.find(a => a.id === r.id)?.key : undefined
    return {
      ...r,
      share: r.damage / total,
      width: Math.max(0.02, r.damage / top),
      hex: hex(r.color),
      tag: r.kind === 'ability' ? (key ? `Ability · ${key}` : 'Ability') : r.kind === 'ultimate' ? 'Ultimate' : ''
    }
  })
})
const sharePct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`
const barDelay = (i: number) => `${BAR_START_MS + i * BAR_STEP_MS}ms`
const hasSide = computed(() => sources.value.length > 0 || abilities.value.length > 0)
/* A click finishes every entrance animation at once */
const instant = ref(false)

/*
 * The payout: Rift XP pours into the account bar, which bursts once per
 * level gained (+1 skill point each), then each new achievement pops in.
 */
const INTRO_MS = Math.max(1500, BAR_START_MS + Math.min(MAX_SOURCES, (props.result.damageBySource ?? []).length) * BAR_STEP_MS + BAR_GROW_MS * 0.6)
const introDone = ref(false)
const xpShown = ref(0)
const barXp = ref(0)
const shownLevel = ref(1)
const levelBursts = ref(0)
const pointsGained = ref(0)
const xpDone = ref(false)
const revealed = ref(0)
const finished = ref(false)
let raf = 0
let timers: ReturnType<typeof setTimeout>[] = []
let introTimer: ReturnType<typeof setTimeout> | undefined
let barTimers: ReturnType<typeof setTimeout>[] = []
const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

const xpBefore = computed(() => props.finish ? Math.max(0, props.finish.progress.xp - props.finish.xpGained) : 0)
const bar = computed(() => riftbornLevelForXp(barXp.value))
const barPct = computed(() => bar.value.xpForNext ? Math.min(1, bar.value.xpIntoLevel / bar.value.xpForNext) : 1)
const achievements = computed(() => props.finish?.newAchievements ?? [])
const bonusPoints = computed(() => achievements.value.slice(0, revealed.value).reduce((n, a) => n + a.points, 0))

watch(() => props.finish, (f) => {
  if (!f) return
  barXp.value = xpBefore.value
  shownLevel.value = riftbornLevelForXp(xpBefore.value).level
  runPayout()
}, { immediate: true })

let started = false
function runPayout() {
  const f = props.finish
  if (!f || !introDone.value || started) return
  started = true
  const from = xpBefore.value
  const gain = f.xpGained
  const levels = Math.max(0, f.progress.level - riftbornLevelForXp(from).level)
  if (gain <= 0) return finishXp()
  const duration = Math.min(4200, 1300 + levels * 650)
  const start = performance.now()
  let lastTick = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    const eased = 1 - (1 - t) ** 2
    xpShown.value = Math.round(gain * eased)
    barXp.value = from + gain * eased
    const level = riftbornLevelForXp(barXp.value).level
    if (level > shownLevel.value) levelUp(level - shownLevel.value)
    shownLevel.value = level
    if (t < 1 && now - lastTick > 65) {
      lastTick = now
      props.sfx.play('countTick', { pitch: 0.85 + t * 0.8, volume: 0.5 })
    }
    if (t < 1) raf = requestAnimationFrame(step)
    else finishXp()
  }
  raf = requestAnimationFrame(step)
}

function levelUp(count: number) {
  levelBursts.value++
  pointsGained.value += count
  props.sfx.play('levelUp')
}

function finishXp() {
  const f = props.finish
  if (!f) return
  xpShown.value = f.xpGained
  barXp.value = f.progress.xp
  shownLevel.value = f.progress.level
  xpDone.value = true
  props.sfx.play('shard')
  revealNext(500)
}

function revealNext(delay: number) {
  if (revealed.value >= achievements.value.length) {
    later(delay, () => (finished.value = true))
    return
  }
  later(delay, () => {
    const a = achievements.value[revealed.value]!
    revealed.value++
    props.sfx.play(a.unlocks ? 'legendary' : 'chestReward')
    revealNext(a.unlocks ? 1500 : 850)
  })
}

/* A click jumps straight to the end */
function skip() {
  if (!instant.value) {
    instant.value = true
    barTimers.forEach(clearTimeout)
    barTimers = []
  }
  if (!introDone.value) {
    clearTimeout(introTimer)
    introDone.value = true
    runPayout()
  }
  const f = props.finish
  if (!f || !started || finished.value) return
  cancelAnimationFrame(raf)
  timers.forEach(clearTimeout)
  timers = []
  const levels = f.progress.level - shownLevel.value
  if (levels > 0) levelUp(levels)
  xpShown.value = f.xpGained
  barXp.value = f.progress.xp
  shownLevel.value = f.progress.level
  xpDone.value = true
  if (revealed.value < achievements.value.length) props.sfx.play('chestReward')
  revealed.value = achievements.value.length
  finished.value = true
}

onMounted(() => {
  later(140, () => props.sfx.play(victory.value ? 'victory' : 'defeat'))
  introTimer = setTimeout(() => {
    introDone.value = true
    runPayout()
  }, INTRO_MS)
  // A soft tick as each bar lands
  sources.value.forEach((_, i) => {
    barTimers.push(setTimeout(() => {
      props.sfx.play('countTick', { pitch: 1.25 - i * 0.05, volume: 0.32 })
    }, BAR_START_MS + i * BAR_STEP_MS + BAR_GROW_MS * 0.7))
  })
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  timers.forEach(clearTimeout)
  barTimers.forEach(clearTimeout)
  clearTimeout(introTimer)
})

const busy = computed(() => props.finishing || (!props.finish && !props.error))
const anyBest = computed(() => !!props.finish && (props.finish.newBest.time || props.finish.newBest.kills))
const classOf = (id: string | null) => {
  const c = riftbornClass(id)
  return c ? { id: c.id, name: c.name, title: c.title, color: hex(c.color) } : null
}

const sparks = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2
  const d = 50 + (i % 3) * 18
  return { '--dx': `${Math.cos(a) * d}px`, '--dy': `${Math.sin(a) * d}px` }
})
</script>

<template>
  <div class="rb-res" :class="[victory ? 'win' : 'loss', { instant, wide: hasSide }]" :style="{ '--c': color }" @click="skip" @contextmenu.prevent>
    <div class="rb-res-backdrop" />
    <div class="rb-res-panel">
      <div class="rb-banner">
        <div class="rb-banner-glow" />
        <p class="rb-banner-kicker">{{ className }}</p>
        <h2 class="rb-banner-title">{{ victory ? 'Victory' : 'Defeat' }}</h2>
      </div>

      <div class="rb-res-body" :class="{ split: hasSide }">
        <div class="rb-res-main">
          <div class="rb-res-stats">
            <div v-for="(s, i) in stats" :key="s.label" class="rb-res-stat" :style="{ animationDelay: `${0.55 + i * 0.07}s` }">
              <UIcon :name="s.icon" class="size-4 opacity-60" />
              <span class="rb-res-stat-label">{{ s.label }}</span>
              <b class="rb-res-stat-value">{{ s.value }}</b>
              <span v-if="s.best && xpDone" class="rb-best">New best</span>
            </div>
          </div>

          <div v-if="result.weapons.length || result.passives.length" class="rb-res-build">
            <RiftbornItemIcon v-for="w in result.weapons" :key="w.id" :item="w" size="lg" />
            <span v-if="result.weapons.length && result.passives.length" class="rb-res-sep" />
            <RiftbornItemIcon v-for="p in result.passives" :key="p.id" :item="p" />
          </div>
        </div>

        <div v-if="hasSide" class="rb-res-side">
          <section v-if="sources.length" class="rb-dmg">
            <header class="rb-side-head" :style="{ animationDelay: `${BAR_START_MS - 200}ms` }">
              <span class="rb-side-title"><UIcon name="i-lucide-swords" class="size-3.5" /> Damage by source</span>
              <span class="rb-side-total">{{ formatNumber(damageTotal) }}</span>
            </header>
            <ol class="rb-dmg-list">
              <li
                v-for="(s, i) in sources"
                :key="s.id"
                class="rb-dmg-row"
                :class="[s.kind, { top: i === 0 }]"
                :style="{ '--sc': s.hex, '--w': s.width, '--d': barDelay(i) }"
              >
                <span class="rb-dmg-icon">
                  <UIcon :name="s.icon" class="size-4" />
                  <UIcon v-if="i === 0" name="i-lucide-crown" class="rb-dmg-crown" />
                </span>
                <div class="rb-dmg-body">
                  <div class="rb-dmg-line">
                    <span class="rb-dmg-name">{{ s.name }}</span>
                    <span v-if="s.tag" class="rb-dmg-tag">{{ s.tag }}</span>
                    <span class="rb-dmg-share">{{ sharePct(s.share) }}</span>
                  </div>
                  <div class="rb-dmg-track">
                    <div class="rb-dmg-fill" />
                  </div>
                </div>
                <span class="rb-dmg-total">{{ formatNumber(s.damage) }}</span>
              </li>
            </ol>
          </section>

          <section v-if="abilities.length" class="rb-abil" :style="{ animationDelay: `${BAR_START_MS + sources.length * BAR_STEP_MS}ms` }">
            <header class="rb-side-head">
              <span class="rb-side-title"><UIcon name="i-lucide-sparkles" class="size-3.5" /> Abilities used</span>
            </header>
            <div class="rb-abil-list">
              <div v-for="a in abilities" :key="a.id" class="rb-abil-chip" :style="{ '--ac': hex(a.color) }" :title="`${a.name} · Lv ${a.level}`">
                <span class="rb-abil-icon">
                  <UIcon :name="a.icon" class="size-4" />
                  <kbd class="rb-abil-key">{{ a.key }}</kbd>
                </span>
                <span class="rb-abil-text">
                  <span class="rb-abil-name">{{ a.name }}</span>
                  <span class="rb-abil-pips">
                    <i v-for="n in Math.min(a.maxLevel, 8)" :key="n" :class="{ on: n <= a.level }" />
                  </span>
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div class="rb-payout">
        <div v-if="finish" class="rb-xp" :class="{ done: xpDone }">
          <div class="rb-xp-badge-wrap">
            <div :key="levelBursts" class="rb-xp-badge" :class="{ burst: levelBursts > 0 }">
              <span class="rb-xp-badge-label">Rank</span>
              <span class="rb-xp-badge-num">{{ shownLevel }}</span>
            </div>
            <div v-if="levelBursts" :key="`b${levelBursts}`" class="rb-xp-burst">
              <span class="rb-xp-ring" />
              <span v-for="(s, i) in sparks" :key="i" class="rb-xp-spark" :style="s" />
            </div>
          </div>
          <div class="rb-xp-body">
            <div class="rb-xp-row">
              <span class="rb-xp-gain">+{{ formatNumber(xpShown, false) }} <small>Rift XP</small></span>
              <span class="rb-xp-next">
                <template v-if="bar.xpForNext">{{ formatNumber(Math.floor(bar.xpIntoLevel), false) }} / {{ formatNumber(bar.xpForNext, false) }}</template>
                <template v-else>Max level</template>
              </span>
            </div>
            <div class="rb-xp-track">
              <div class="rb-xp-fill" :style="{ width: `${barPct * 100}%` }" />
              <div v-if="levelBursts" :key="`f${levelBursts}`" class="rb-xp-flash" />
            </div>
            <div v-if="pointsGained + bonusPoints > 0" :key="pointsGained + bonusPoints" class="rb-xp-points">
              <UIcon name="i-lucide-git-fork" class="size-3.5" />
              +{{ pointsGained + bonusPoints }} skill point{{ pointsGained + bonusPoints === 1 ? '' : 's' }}
            </div>
            <div v-if="levelBursts" :key="`l${levelBursts}`" class="rb-xp-levelup">Level up!</div>
          </div>
        </div>
        <div v-else-if="error" class="rb-pay-error">
          <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" />
          <span class="flex-1">{{ error }}</span>
          <button type="button" class="rb-res-btn small" :disabled="finishing" @click.stop="emit('retry')">
            <UIcon name="i-lucide-refresh-cw" class="size-4" :class="{ 'animate-spin': finishing }" />
            Retry
          </button>
        </div>
        <div v-else class="rb-pay-wait">
          <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" />
          Saving…
        </div>
      </div>

      <div v-if="revealed" class="rb-feats">
        <template v-for="a in achievements.slice(0, revealed)" :key="a.id">
          <div v-if="a.unlocks && classOf(a.unlocks)" class="rb-unlock" :style="{ '--uc': classOf(a.unlocks)!.color }">
            <div class="rb-unlock-rays" />
            <div class="rb-unlock-portrait">
              <RiftbornPortrait :class-id="classOf(a.unlocks)!.id" :color="classOf(a.unlocks)!.color" />
            </div>
            <div class="rb-unlock-text">
              <p class="rb-unlock-kicker">New class unlocked</p>
              <p class="rb-unlock-name">{{ classOf(a.unlocks)!.name }}</p>
              <p class="rb-unlock-sub">{{ classOf(a.unlocks)!.title }} · {{ a.name }} · +{{ a.points }} pt{{ a.points === 1 ? '' : 's' }}</p>
            </div>
          </div>
          <div v-else class="rb-feat">
            <span class="rb-feat-icon"><UIcon :name="a.icon" class="size-5" /></span>
            <div class="min-w-0 flex-1 text-left">
              <p class="rb-feat-kicker">Achievement unlocked</p>
              <p class="rb-feat-name">{{ a.name }}</p>
              <p class="rb-feat-desc">{{ a.description }}</p>
            </div>
            <span class="rb-feat-points">+{{ a.points }} pt{{ a.points === 1 ? '' : 's' }}</span>
          </div>
        </template>
      </div>

      <Transition name="rb-bestbar">
        <p v-if="anyBest && xpDone" class="rb-res-bestline">
          <UIcon name="i-lucide-trophy" class="size-4" /> Personal record!
        </p>
      </Transition>

      <div class="rb-res-actions">
        <button type="button" class="rb-res-btn primary" :disabled="busy" @mouseenter="emit('hover')" @click.stop="emit('playAgain')">
          <UIcon name="i-lucide-rotate-ccw" class="size-4" />
          Play again
        </button>
        <button type="button" class="rb-res-btn" :disabled="busy" @mouseenter="emit('hover')" @click.stop="emit('lobby')">
          <UIcon name="i-lucide-house" class="size-4" />
          Lobby
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-res {
  --c: #b28cff;
  --tone: #ffc54d;
  --tone2: #ff8a2b;
  position: absolute;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  overflow-y: auto;
  padding: 16px;
}
.rb-res.loss {
  --tone: #ff4d6a;
  --tone2: #8a0f2a;
}
.rb-res-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 20%, color-mix(in srgb, var(--tone) 22%, transparent), rgba(4, 2, 10, 0.92) 60%);
  backdrop-filter: blur(6px) saturate(0.6);
  animation: rb-fade 0.6s ease-out;
}
@keyframes rb-fade {
  from { opacity: 0; }
}
.rb-res-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  width: min(100%, 760px);
  text-align: center;
}
.rb-banner {
  position: relative;
  padding: 10px 0;
}
.rb-banner-glow {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 520px;
  max-width: 120vw;
  height: 160px;
  translate: -50% -50%;
  z-index: -1;
  background: radial-gradient(ellipse, color-mix(in srgb, var(--tone) 50%, transparent), transparent 70%);
  filter: blur(10px);
  animation: rb-glow-in 1s ease-out backwards;
}
@keyframes rb-glow-in {
  from { opacity: 0; transform: scaleX(0.2); }
}
.rb-banner-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--tone) 70%, #fff);
  animation: rb-fade 0.5s 0.5s ease-out backwards;
}
.rb-banner-title {
  position: relative;
  margin-top: 10px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(48px, 11vw, 104px);
  font-weight: 900;
  line-height: 0.95;
  text-transform: uppercase;
  letter-spacing: -0.01em;
  background: linear-gradient(180deg, #fff 20%, var(--tone) 70%, var(--tone2));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 26px color-mix(in srgb, var(--tone) 70%, transparent)) drop-shadow(0 6px 0 rgba(0, 0, 0, 0.6));
  animation: rb-slam 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
}
@keyframes rb-slam {
  0% { opacity: 0; transform: scale(3.2); filter: blur(14px); }
  55% { opacity: 1; transform: scale(0.94); }
  100% { transform: scale(1); }
}
.rb-res.loss .rb-banner-title {
  animation: rb-slam 0.7s cubic-bezier(0.2, 1.4, 0.4, 1) backwards, rb-crack 0.4s 0.7s steps(2) 2;
}
@keyframes rb-crack {
  50% { transform: translateX(-4px) skewX(-4deg); }
}

.rb-res-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
.rb-res-stat {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  min-width: 92px;
  padding: 12px 10px 10px;
  border-radius: 14px;
  background: rgba(14, 10, 28, 0.85);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  animation: rb-stat-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
}
@keyframes rb-stat-in {
  from { opacity: 0; transform: translateY(16px) scale(0.9); }
}
.rb-res-stat-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.55);
}
.rb-res-stat-value {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 19px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
}
.rb-best {
  position: absolute;
  top: -9px;
  left: 50%;
  translate: -50% 0;
  white-space: nowrap;
  padding: 3px 7px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #2a1400;
  background: linear-gradient(90deg, #ffe08a, #ffb627);
  box-shadow: 0 0 14px rgba(255, 182, 39, 0.8);
  animation: rb-best 0.5s cubic-bezier(0.2, 1.8, 0.4, 1);
}
@keyframes rb-best {
  from { transform: scale(0) rotate(-20deg); }
}

.rb-res-build {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 6px;
  animation: rb-fade 0.5s 1.1s ease-out backwards;
}
.rb-res-sep {
  width: 1px;
  height: 40px;
  margin: 0 6px;
  background: rgba(255, 255, 255, 0.12);
}

.rb-payout {
  display: flex;
  justify-content: center;
  width: 100%;
  min-height: 92px;
  animation: rb-fade 0.4s 1.3s ease-out backwards;
}
.rb-xp {
  display: flex;
  align-items: center;
  gap: 16px;
  width: min(100%, 560px);
  padding: 14px 18px 14px 14px;
  border-radius: 18px;
  text-align: left;
  background: rgba(14, 10, 28, 0.9);
  box-shadow: inset 0 0 0 1px rgba(178, 140, 255, 0.3);
  transition: box-shadow 0.4s ease;
}
.rb-xp.done {
  box-shadow: inset 0 0 0 1.5px rgba(142, 246, 255, 0.6), 0 0 30px -8px #8ef6ff;
}
.rb-xp-badge-wrap {
  position: relative;
  flex-shrink: 0;
}
.rb-xp-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 64px;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, #8ef6ff, #6b5cff 60%, #2a1a6e);
  color: #061026;
}
.rb-xp-badge.burst {
  animation: rb-badge-burst 0.7s cubic-bezier(0.2, 1.6, 0.4, 1);
}
@keyframes rb-badge-burst {
  0% { transform: scale(1); filter: brightness(1); }
  30% { transform: scale(1.4); filter: brightness(2.4); }
  100% { transform: scale(1); filter: brightness(1); }
}
.rb-xp-badge-label {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.rb-xp-badge-num {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
}
.rb-xp-burst {
  position: absolute;
  left: 50%;
  top: 50%;
  pointer-events: none;
}
.rb-xp-ring {
  position: absolute;
  left: -32px;
  top: -32px;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid #8ef6ff;
  animation: rb-xp-ring 0.8s ease-out forwards;
}
@keyframes rb-xp-ring {
  0% { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(2.6); opacity: 0; border-width: 0.5px; }
}
.rb-xp-spark {
  position: absolute;
  left: -3px;
  top: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 10px #8ef6ff, 0 0 18px #b28cff;
  animation: rb-xp-spark 0.8s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
}
@keyframes rb-xp-spark {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; }
}
.rb-xp-body {
  position: relative;
  flex: 1;
  min-width: 0;
}
.rb-xp-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.rb-xp-gain {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 24px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  color: #d9c8ff;
  text-shadow: 0 0 16px rgba(178, 140, 255, 0.7);
}
.rb-xp-gain small {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.65);
  text-shadow: none;
}
.rb-xp-next {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: rgba(220, 212, 240, 0.6);
}
.rb-xp-track {
  position: relative;
  height: 12px;
  margin-top: 8px;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.2);
}
.rb-xp-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6b5cff, #8ef6ff);
  box-shadow: 0 0 14px #8ef6ff;
}
.rb-xp-flash {
  position: absolute;
  inset: 0;
  background: #fff;
  animation: rb-xp-flash 0.6s ease-out forwards;
}
@keyframes rb-xp-flash {
  0% { opacity: 0.95; }
  100% { opacity: 0; }
}
.rb-xp-points {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 3px 9px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #061026;
  background: #8ef6ff;
  box-shadow: 0 0 16px -2px #8ef6ff;
  animation: rb-points-pop 0.45s cubic-bezier(0.2, 1.8, 0.4, 1);
}
@keyframes rb-points-pop {
  from { transform: scale(0.4); }
}
.rb-xp-levelup {
  position: absolute;
  right: 0;
  bottom: 2px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 0 14px #8ef6ff, 0 0 28px #b28cff;
  pointer-events: none;
  animation: rb-levelup-float 1.1s ease-out forwards;
}
@keyframes rb-levelup-float {
  0% { opacity: 0; transform: translateY(10px) scale(0.6); }
  20% { opacity: 1; transform: translateY(0) scale(1.15); }
  100% { opacity: 0; transform: translateY(-26px) scale(1); }
}

.rb-feats {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.rb-feat {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(100%, 520px);
  padding: 12px 14px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(255, 197, 77, 0.14), rgba(14, 10, 28, 0.95) 60%);
  box-shadow: inset 0 0 0 1px rgba(255, 197, 77, 0.45), 0 0 26px -10px #ffc54d;
  animation: rb-feat-in 0.5s cubic-bezier(0.2, 1.5, 0.4, 1);
}
@keyframes rb-feat-in {
  0% { opacity: 0; transform: translateX(-40px) scale(0.9); }
  100% { opacity: 1; transform: none; }
}
.rb-feat-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: #2a1400;
  background: linear-gradient(160deg, #ffe08a, #ff9b3d);
}
.rb-feat-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ffc54d;
}
.rb-feat-name {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 800;
  color: #fff;
}
.rb-feat-desc {
  font-size: 12px;
  color: rgba(240, 230, 210, 0.7);
}
.rb-feat-points {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 999px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  color: #061026;
  background: #8ef6ff;
}
.rb-unlock {
  --uc: #fff;
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  width: min(100%, 580px);
  padding: 14px 20px 14px 14px;
  border-radius: 20px;
  overflow: hidden;
  text-align: left;
  background: linear-gradient(120deg, color-mix(in srgb, var(--uc) 30%, #0b0716), #0b0716 70%);
  box-shadow: inset 0 0 0 2px var(--uc), 0 0 50px -10px var(--uc);
  animation: rb-unlock-in 0.8s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes rb-unlock-in {
  0% { opacity: 0; transform: scale(1.6); filter: brightness(3) blur(6px); }
  50% { opacity: 1; filter: brightness(1.6); }
  100% { transform: none; filter: none; }
}
.rb-unlock-rays {
  position: absolute;
  left: 60px;
  top: 50%;
  width: 500px;
  height: 500px;
  translate: -50% -50%;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--uc) 30%, transparent) 0 6deg, transparent 6deg 18deg);
  mask: radial-gradient(circle, #000 5%, transparent 60%);
  animation: rb-unlock-spin 12s linear infinite;
  pointer-events: none;
}
@keyframes rb-unlock-spin {
  to { rotate: 360deg; }
}
.rb-unlock-portrait {
  position: relative;
  flex-shrink: 0;
  width: 84px;
  height: 84px;
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 0 0 2px var(--uc), 0 0 24px var(--uc);
}
.rb-unlock-text {
  position: relative;
  min-width: 0;
}
.rb-unlock-kicker {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--uc) 65%, #fff);
}
.rb-unlock-name {
  margin-top: 4px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(26px, 5vw, 38px);
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  color: #fff;
  text-shadow: 0 0 24px var(--uc);
}
.rb-unlock-sub {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(240, 236, 250, 0.7);
}
.rb-pay-error,
.rb-pay-wait {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 520px);
  padding: 14px 16px;
  border-radius: 14px;
  font-size: 13px;
  text-align: left;
}
.rb-pay-error {
  color: #ffc2cb;
  background: rgba(120, 10, 30, 0.35);
  box-shadow: inset 0 0 0 1px rgba(255, 80, 100, 0.35);
}
.rb-pay-wait {
  justify-content: center;
  color: rgba(220, 212, 240, 0.7);
  background: rgba(14, 10, 28, 0.7);
}
.rb-res-bestline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #ffd34d;
  text-shadow: 0 0 14px rgba(255, 211, 77, 0.8);
}
.rb-bestbar-enter-active {
  transition: opacity 0.3s ease, transform 0.4s cubic-bezier(0.2, 1.8, 0.4, 1);
}
.rb-bestbar-enter-from {
  opacity: 0;
  transform: scale(0.5);
}

.rb-res-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  animation: rb-fade 0.4s 1.4s ease-out backwards;
}
.rb-res-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 14px 22px;
  border-radius: 14px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: transform 0.15s ease, filter 0.15s ease, background 0.15s ease;
}
.rb-res-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.12);
}
.rb-res-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.rb-res-btn:disabled {
  opacity: 0.45;
  cursor: wait;
}
.rb-res-btn.primary {
  color: #0b0716;
  background: linear-gradient(135deg, #fff, var(--c) 60%);
  box-shadow: 0 0 28px -6px var(--c);
}
.rb-res-btn.primary:hover:not(:disabled) {
  filter: brightness(1.1);
  background: linear-gradient(135deg, #fff, var(--c) 60%);
}
.rb-res-btn.small {
  padding: 8px 12px;
  font-size: 12px;
}
/* layout: stats + build on the left, the damage breakdown on the right */
.rb-res.wide .rb-res-panel {
  width: min(100%, 920px);
}
.rb-res-body {
  display: grid;
  gap: 18px;
  width: 100%;
}
.rb-res-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  min-width: 0;
}
.rb-res-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  text-align: left;
}
@media (min-width: 860px) {
  .rb-res-body.split {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}

.rb-dmg,
.rb-abil {
  padding: 12px 14px 14px;
  border-radius: 16px;
  background: rgba(14, 10, 28, 0.85);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
}
.rb-abil {
  animation: rb-stat-in 0.45s cubic-bezier(0.2, 1.4, 0.4, 1) backwards;
}
.rb-side-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  animation: rb-fade 0.4s ease-out backwards;
}
.rb-side-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgba(220, 212, 240, 0.65);
}
.rb-side-total {
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.rb-dmg-list {
  display: grid;
  gap: 8px;
}
.rb-dmg-row {
  --sc: #fff;
  --w: 1;
  --d: 0ms;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  animation: rb-row-in 0.4s var(--d) cubic-bezier(0.2, 1.3, 0.4, 1) backwards;
}
@keyframes rb-row-in {
  from { opacity: 0; transform: translateX(18px); }
}
.rb-dmg-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: var(--sc);
  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--sc) 32%, #0a0614), #0a0614 80%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc) 50%, transparent);
}
.rb-dmg-icon > :first-child {
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--sc) 80%, transparent));
}
.rb-dmg-crown {
  position: absolute;
  top: -9px;
  right: -7px;
  width: 15px;
  height: 15px;
  color: #ffd34d;
  filter: drop-shadow(0 0 5px rgba(255, 211, 77, 0.9));
  rotate: 18deg;
  animation: rb-crown 0.5s calc(var(--d) + 650ms) cubic-bezier(0.2, 1.8, 0.4, 1) backwards;
}
@keyframes rb-crown {
  from { transform: scale(0) translateY(6px); opacity: 0; }
}
.rb-dmg-row.top .rb-dmg-icon {
  box-shadow: inset 0 0 0 1.5px var(--sc), 0 0 14px -2px var(--sc);
}
.rb-dmg-body {
  min-width: 0;
}
.rb-dmg-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.rb-dmg-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.2;
  color: rgba(240, 236, 250, 0.92);
}
.rb-dmg-row.other .rb-dmg-name {
  color: rgba(220, 212, 240, 0.6);
}
.rb-dmg-tag {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--sc) 70%, #fff);
  background: color-mix(in srgb, var(--sc) 16%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc) 40%, transparent);
}
.rb-dmg-share {
  flex-shrink: 0;
  margin-left: auto;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: color-mix(in srgb, var(--sc) 55%, #fff);
}
.rb-dmg-track {
  position: relative;
  height: 7px;
  margin-top: 5px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}
.rb-dmg-fill {
  position: relative;
  width: calc(var(--w) * 100%);
  height: 100%;
  border-radius: inherit;
  overflow: hidden;
  transform-origin: left center;
  background: linear-gradient(90deg, color-mix(in srgb, var(--sc) 45%, transparent), var(--sc));
  box-shadow: 0 0 10px color-mix(in srgb, var(--sc) 70%, transparent);
  animation: rb-bar-grow 0.7s var(--d) cubic-bezier(0.2, 0.9, 0.3, 1) backwards;
}
@keyframes rb-bar-grow {
  from { transform: scaleX(0); }
}
.rb-dmg-row.top .rb-dmg-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, transparent 30%, rgba(255, 255, 255, 0.75) 50%, transparent 70%);
  transform: translateX(-100%);
  animation: rb-bar-shine 2.6s calc(var(--d) + 700ms) ease-in-out infinite;
}
@keyframes rb-bar-shine {
  45%, 100% { transform: translateX(100%); }
}
.rb-dmg-total {
  min-width: 44px;
  text-align: right;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fff;
}

.rb-abil-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rb-abil-chip {
  --ac: #fff;
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 6px 12px 6px 6px;
  border-radius: 12px;
  background: linear-gradient(120deg, color-mix(in srgb, var(--ac) 16%, transparent), transparent 70%);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ac) 35%, transparent);
}
.rb-abil-icon {
  position: relative;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--ac);
  background: radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--ac) 35%, #0a0614), #0a0614 80%);
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--ac) 60%, transparent), 0 0 12px -4px var(--ac);
}
.rb-abil-key {
  position: absolute;
  right: -5px;
  bottom: -5px;
  padding: 2px 4px;
  border-radius: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 8.5px;
  font-weight: 800;
  line-height: 1;
  color: #fff;
  background: rgba(6, 4, 14, 0.95);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}
.rb-abil-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.rb-abil-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.1;
  color: #fff;
}
.rb-abil-pips {
  display: flex;
  gap: 2px;
}
.rb-abil-pips i {
  width: 8px;
  height: 3px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.14);
}
.rb-abil-pips i.on {
  background: var(--ac);
  box-shadow: 0 0 4px var(--ac);
}

/* click-to-skip: every entrance lands at once */
.rb-res.instant .rb-banner-glow,
.rb-res.instant .rb-banner-kicker,
.rb-res.instant .rb-banner-title,
.rb-res.instant .rb-res-stat,
.rb-res.instant .rb-res-build,
.rb-res.instant .rb-payout,
.rb-res.instant .rb-res-actions,
.rb-res.instant .rb-side-head,
.rb-res.instant .rb-dmg-row,
.rb-res.instant .rb-dmg-fill,
.rb-res.instant .rb-dmg-crown,
.rb-res.instant .rb-abil {
  animation: none;
}
@media (prefers-reduced-motion: reduce) {
  .rb-res * { animation-duration: 0.01ms !important; }
}
</style>
