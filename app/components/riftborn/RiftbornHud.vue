<script setup lang="ts">
import type { HudAbility, RunHud, Sfx } from './engine/types'
import RiftbornItemIcon from './RiftbornItemIcon.vue'
import { formatClock, hex, isTypingTarget } from './riftborn-ui'

const props = defineProps<{
  hud: RunHud
  color: string
  sfx?: Sfx
}>()

const emit = defineEmits<{
  cast: [slot: number]
}>()

const hpPct = computed(() => props.hud.maxHp > 0 ? Math.max(0, Math.min(1, props.hud.hp / props.hud.maxHp)) : 0)
const xpPct = computed(() => props.hud.xpNext > 0 ? Math.max(0, Math.min(1, props.hud.xp / props.hud.xpNext)) : 0)
const lowHp = computed(() => hpPct.value > 0 && hpPct.value < 0.3)
/* The heart beats faster the closer to death you are */
const beat = computed(() => `${(0.42 + hpPct.value * 1.6).toFixed(2)}s`)

/* Damage trail: the ghost bar lingers where HP was, then drains after it */
const ghostPct = ref(hpPct.value)
const hurtKey = ref(0)
let lastHurtAt = 0
let ghostTimer: ReturnType<typeof setTimeout> | undefined
watch(hpPct, (now, before) => {
  if (now >= ghostPct.value) {
    clearTimeout(ghostTimer)
    ghostTimer = undefined
    ghostPct.value = now
    return
  }
  // Crowds chip HP many times a second; only flash for a real hit or a fresh one
  const drop = before - now
  const at = performance.now()
  if (drop > 0.004 && (drop > 0.08 || at - lastHurtAt > 900)) {
    lastHurtAt = at
    hurtKey.value++
  }
  if (!ghostTimer) {
    ghostTimer = setTimeout(() => {
      ghostTimer = undefined
      ghostPct.value = hpPct.value
    }, 450)
  }
})

/* Level-up pulse */
const levelKey = ref(0)
watch(() => props.hud.level, (now, before) => {
  if (now > before) levelKey.value++
})

/* Kills: the counter punches on every milestone */
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000]
const killKey = ref(0)
const milestone = ref<number | null>(null)
let milestoneTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.hud.kills, (now, before) => {
  const hit = MILESTONES.filter(m => before < m && now >= m).pop()
  if (!hit || before === 0) return
  killKey.value++
  milestone.value = hit
  props.sfx?.play('streak', { volume: 0.7 })
  clearTimeout(milestoneTimer)
  milestoneTimer = setTimeout(() => (milestone.value = null), 1900)
})

/* Combo */
const COMBO_TIERS = [
  { at: 400, label: 'Riftbreaker', color: '#ffffff' },
  { at: 200, label: 'Godlike', color: '#ff3fa4' },
  { at: 100, label: 'Massacre', color: '#ff4d4d' },
  { at: 50, label: 'Rampage', color: '#ff8a2b' },
  { at: 25, label: 'Savage', color: '#ffc54d' },
  { at: 10, label: 'Brutal', color: '#b28cff' },
  { at: 0, label: 'Combo', color: '#8ef6ff' }
]
const comboTierIndex = computed(() => COMBO_TIERS.findIndex(t => props.hud.combo >= t.at))
const comboTier = computed(() => COMBO_TIERS[comboTierIndex.value]!)
const nextTier = computed(() => comboTierIndex.value > 0 ? COMBO_TIERS[comboTierIndex.value - 1]! : null)
const tierProgress = computed(() => {
  const next = nextTier.value
  if (!next) return 1
  const from = comboTier.value.at
  return Math.max(0, Math.min(1, (props.hud.combo - from) / (next.at - from)))
})
const comboScale = computed(() => 1 + Math.min(0.6, Math.log10(Math.max(1, props.hud.combo)) * 0.24))
const tierBurst = ref(0)
watch(comboTierIndex, (now, before) => {
  if (now < before && props.hud.combo >= 10) tierBurst.value++
})
const RING = 2 * Math.PI * 34

/* Dash and ultimate */
const dashReady = computed(() => props.hud.dashCooldown <= 0.001)
const ultReady = computed(() => props.hud.ultimateCharge >= 0.999)
const DASH_RING = 2 * Math.PI * 21
const ULT_RING = 2 * Math.PI * 30

/* Abilities: three slots, Q / F / R */
const SLOT_KEYS = ['Q', 'F', 'R']
const SLOT_LEVELS = [1, 8, 18]
const abilities = computed<HudAbility[]>(() => props.hud.abilities ?? [])
const openSlots = computed(() => Math.max(1, Math.min(3, props.hud.abilitySlots ?? 1)))
const readyFlash = ref([0, 0, 0])
const slotBurst = ref([0, 0, 0])
const learnBurst = ref([0, 0, 0])
const pressKey = ref([0, 0, 0])
const deny = ref([0, 0, 0])

const slots = computed(() => [0, 1, 2].map((i) => {
  const a = abilities.value[i] ?? null
  const open = i < openSlots.value
  const unlockAt = i === openSlots.value && props.hud.nextSlotAt ? props.hud.nextSlotAt : SLOT_LEVELS[i]!
  const cooling = !!a && a.cooldown > 0.001
  return {
    i,
    key: a?.key || SLOT_KEYS[i]!,
    open,
    ability: a,
    unlockAt,
    cooling,
    ready: !!a && !cooling,
    color: a ? hex(a.color) : '#8ef6ff',
    seconds: a && cooling ? (a.cooldownSeconds >= 10 ? Math.ceil(a.cooldownSeconds).toString() : a.cooldownSeconds.toFixed(1)) : '',
    pips: a ? Math.min(a.maxLevel, 8) : 0
  }
}))

const bump = (arr: typeof readyFlash, i: number) => {
  const next = [...arr.value]
  next[i] = (next[i] ?? 0) + 1
  arr.value = next
}

/* Coming off cooldown flashes the slot; a new ability bursts in */
watch(() => abilities.value.map(a => `${a.id}:${a.cooldown > 0.001 ? 1 : 0}`), (now, before) => {
  now.forEach((cur, i) => {
    const prev = before?.[i]
    if (!prev) {
      if (before) bump(learnBurst, i)
      return
    }
    const [id, cd] = cur.split(':')
    const [prevId, prevCd] = prev.split(':')
    if (id !== prevId) bump(learnBurst, i)
    else if (prevCd === '1' && cd === '0') {
      bump(readyFlash, i)
      props.sfx?.play('abilityReady', { volume: 0.55, pitch: 1 + i * 0.06 })
    }
  })
})

/* A slot opening bursts its seal */
watch(openSlots, (now, before) => {
  if (now <= before) return
  for (let i = before; i < now; i++) bump(slotBurst, i)
  props.sfx?.play('slotUnlock')
})

function cast(i: number) {
  const s = slots.value[i]
  if (!s) return
  bump(pressKey, i)
  if (!s.open || !s.ability || s.cooling) {
    bump(deny, i)
    return
  }
  emit('cast', i)
}

/* Keyboard casts are handled by the engine; the HUD only shows the press */
function onKey(e: KeyboardEvent) {
  if (e.repeat || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
  const i = ['KeyQ', 'KeyF', 'KeyR'].indexOf(e.code)
  if (i < 0) return
  bump(pressKey, i)
  const s = slots.value[i]
  if (s && (!s.open || !s.ability || s.cooling)) bump(deny, i)
}

/* Boss: phase notches and a damage trail */
const bossPct = computed(() => props.hud.boss && props.hud.boss.maxHp > 0 ? Math.max(0, Math.min(1, props.hud.boss.hp / props.hud.boss.maxHp)) : 0)
const bossSoon = computed(() => props.hud.nextBossIn !== null && props.hud.nextBossIn <= 15)
const PHASES = [0.75, 0.5, 0.25]
const bossGhost = ref(1)
const bossHitKey = ref(0)
let bossTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.hud.boss?.name ?? null, () => {
  clearTimeout(bossTimer)
  bossTimer = undefined
  bossGhost.value = bossPct.value
})
watch(bossPct, (now, before) => {
  if (now >= bossGhost.value) {
    bossGhost.value = now
    return
  }
  if (PHASES.some(p => before > p && now <= p)) {
    bossHitKey.value++
    props.sfx?.play('explosion', { volume: 0.5, pitch: 0.7 })
  }
  if (!bossTimer) {
    bossTimer = setTimeout(() => {
      bossTimer = undefined
      bossGhost.value = bossPct.value
    }, 600)
  }
})

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(ghostTimer)
  clearTimeout(bossTimer)
  clearTimeout(milestoneTimer)
})
</script>

<template>
  <div class="rb-hud" :class="{ danger: lowHp }" :style="{ '--c': color, '--beat': beat }">
    <!-- screen feedback -->
    <div :key="hurtKey" class="rb-hurt" :class="{ on: hurtKey > 0 }" />
    <div class="rb-lowhp" :class="{ on: lowHp }" />

    <!-- XP -->
    <div class="rb-xp">
      <div :key="levelKey" class="rb-level" :class="{ pulse: levelKey > 0 }">
        <span class="rb-level-label">LV</span>
        <span class="rb-level-num">{{ hud.level }}</span>
      </div>
      <div class="rb-xp-track">
        <div class="rb-xp-fill" :style="{ width: `${xpPct * 100}%` }" />
        <div :key="levelKey" class="rb-xp-flash" :class="{ on: levelKey > 0 }" />
      </div>
    </div>

    <!-- left: vitals and build -->
    <div class="rb-left">
      <div class="rb-hp">
        <div class="rb-hp-track">
          <div class="rb-hp-ghost" :style="{ width: `${ghostPct * 100}%` }" />
          <div class="rb-hp-fill" :class="{ low: lowHp }" :style="{ width: `${hpPct * 100}%` }" />
          <div class="rb-hp-text">
            <UIcon name="i-lucide-heart" class="rb-hp-heart size-3" />
            {{ Math.ceil(Math.max(0, hud.hp)) }} / {{ Math.ceil(hud.maxHp) }}
          </div>
        </div>
        <div v-if="hud.revivals > 0" class="rb-revives" :title="`${hud.revivals} revival${hud.revivals === 1 ? '' : 's'} left`">
          <UIcon v-for="n in hud.revivals" :key="n" name="i-lucide-sparkles" class="size-3.5" />
        </div>
      </div>
      <div v-if="hud.weapons.length" class="rb-row">
        <RiftbornItemIcon v-for="w in hud.weapons" :key="w.id" :item="w" />
      </div>
      <div v-if="hud.passives.length" class="rb-row dim">
        <RiftbornItemIcon v-for="p in hud.passives" :key="p.id" :item="p" size="sm" />
      </div>
    </div>

    <!-- centre: clock, boss -->
    <div class="rb-center">
      <div class="rb-clock">{{ formatClock(hud.time) }}</div>
      <Transition name="rb-boss" mode="out-in">
        <div v-if="hud.boss" :key="`boss-${hud.boss.name}`" class="rb-boss">
          <div class="rb-boss-name">
            <UIcon name="i-lucide-skull" class="size-3.5" />
            <span>{{ hud.boss.name }}</span>
            <b class="rb-boss-pct">{{ Math.ceil(bossPct * 100) }}%</b>
          </div>
          <div :key="bossHitKey" class="rb-boss-track" :class="{ phase: bossHitKey > 0 }">
            <div class="rb-boss-ghost" :style="{ width: `${bossGhost * 100}%` }" />
            <div class="rb-boss-fill" :style="{ width: `${bossPct * 100}%` }" />
            <i
              v-for="p in PHASES"
              :key="p"
              class="rb-boss-notch"
              :class="{ broken: bossPct <= p }"
              :style="{ left: `${p * 100}%` }"
            />
          </div>
        </div>
        <div v-else-if="hud.nextBossIn !== null" key="next" class="rb-next" :class="{ soon: bossSoon }">
          <UIcon name="i-lucide-skull" class="size-3" />
          <span>{{ bossSoon ? 'Boss incoming' : 'Next boss' }}</span>
          <b>{{ formatClock(hud.nextBossIn) }}</b>
        </div>
      </Transition>
    </div>

    <!-- right: tallies -->
    <div class="rb-right">
      <div :key="killKey" class="rb-tally kills" :class="{ punch: killKey > 0 }">
        <UIcon name="i-lucide-skull" class="size-4 text-[#ff8a8a]" />
        <b>{{ formatNumber(hud.kills, hud.kills >= 100000) }}</b>
      </div>
      <Transition name="rb-mile">
        <div v-if="milestone" :key="milestone" class="rb-milestone">
          {{ formatNumber(milestone, false) }} kills
        </div>
      </Transition>
      <div class="rb-tally">
        <UIcon name="i-lucide-gem" class="size-4 text-[#8ef6ff]" />
        <b>{{ formatNumber(hud.shards) }}</b>
      </div>
      <div class="rb-tally">
        <UIcon name="i-lucide-orbit" class="size-4 text-[#b28cff]" />
        <b>+{{ formatNumber(hud.riftXp) }}<small class="rb-tally-unit">XP</small></b>
      </div>
    </div>

    <!-- combo -->
    <Transition name="rb-combo">
      <div
        v-if="hud.combo >= 3"
        class="rb-combo"
        :class="[`t${comboTierIndex}`]"
        :style="{ '--tc': comboTier.color, '--k': comboScale }"
      >
        <div v-if="tierBurst" :key="tierBurst" class="rb-combo-burst" />
        <svg viewBox="0 0 80 80" class="rb-combo-ring">
          <circle cx="40" cy="40" r="34" class="bg" />
          <circle cx="40" cy="40" r="34" class="fg" :stroke-dasharray="RING" :stroke-dashoffset="RING * (1 - hud.comboTimer)" />
        </svg>
        <div class="rb-combo-inner">
          <span :key="hud.combo" class="rb-combo-num">{{ hud.combo }}</span>
          <span :key="comboTier.label" class="rb-combo-tier">{{ comboTier.label }}</span>
        </div>
        <div v-if="nextTier" class="rb-combo-next">
          <i :style="{ width: `${tierProgress * 100}%`, background: nextTier.color }" />
        </div>
      </div>
    </Transition>

    <!-- action bar: dash, abilities, ultimate -->
    <div class="rb-bar">
      <div class="rb-ability" :class="{ ready: dashReady }">
        <svg viewBox="0 0 50 50" class="rb-ability-ring">
          <circle cx="25" cy="25" r="21" class="bg" />
          <circle cx="25" cy="25" r="21" class="fg" :stroke-dasharray="DASH_RING" :stroke-dashoffset="DASH_RING * Math.max(0, Math.min(1, hud.dashCooldown))" />
        </svg>
        <UIcon name="i-lucide-wind" class="rb-ability-icon" />
        <kbd class="rb-ability-key">Space</kbd>
      </div>

      <div class="rb-slots">
        <button
          v-for="s in slots"
          :key="s.i"
          type="button"
          class="rb-slot"
          :class="{ locked: !s.open, empty: s.open && !s.ability, cooling: s.cooling, ready: s.ready, active: s.ability?.active }"
          :style="{ '--ac': s.color, '--cd': s.ability ? Math.max(0, Math.min(1, s.ability.cooldown)) : 0 }"
          :title="s.ability ? `${s.ability.name} · Lv ${s.ability.level}` : s.open ? 'Empty slot: learn an ability on level up' : `Opens at level ${s.unlockAt}`"
          :aria-label="s.ability ? `Cast ${s.ability.name} (${s.key})` : `Ability slot ${s.key}`"
          tabindex="-1"
          @pointerdown.prevent.stop="cast(s.i)"
          @contextmenu.prevent
        >
          <span :key="`p${pressKey[s.i]}`" class="rb-slot-face" :class="{ press: pressKey[s.i]! > 0 }">
            <span :key="`d${deny[s.i]}`" class="rb-slot-inner" :class="{ deny: deny[s.i]! > 0 }">
              <template v-if="s.ability">
                <UIcon :name="s.ability.icon" class="rb-slot-icon" />
                <span class="rb-slot-sweep" />
                <span v-if="s.cooling" class="rb-slot-secs">{{ s.seconds }}</span>
              </template>
              <template v-else-if="s.open">
                <UIcon name="i-lucide-plus" class="rb-slot-icon ghost" />
              </template>
              <template v-else>
                <UIcon name="i-lucide-lock" class="rb-slot-lock" />
                <span class="rb-slot-lv">Lv {{ s.unlockAt }}</span>
              </template>
            </span>
          </span>
          <span v-if="readyFlash[s.i]" :key="`f${readyFlash[s.i]}`" class="rb-slot-flash" />
          <span v-if="learnBurst[s.i]" :key="`l${learnBurst[s.i]}`" class="rb-slot-learn" />
          <span v-if="slotBurst[s.i]" :key="`b${slotBurst[s.i]}`" class="rb-slot-burst">
            <i v-for="n in 8" :key="n" :style="{ '--a': `${n * 45}deg` }" />
          </span>
          <kbd class="rb-slot-key">{{ s.key }}</kbd>
          <span v-if="s.ability && s.pips > 1" class="rb-slot-pips">
            <i v-for="n in s.pips" :key="n" :class="{ on: n <= s.ability.level }" />
          </span>
        </button>
      </div>

      <div class="rb-ability ult" :class="{ ready: ultReady }">
        <svg viewBox="0 0 70 70" class="rb-ability-ring">
          <circle cx="35" cy="35" r="30" class="bg" />
          <circle cx="35" cy="35" r="30" class="fg" :stroke-dasharray="ULT_RING" :stroke-dashoffset="ULT_RING * (1 - Math.max(0, Math.min(1, hud.ultimateCharge)))" />
        </svg>
        <UIcon name="i-lucide-zap" class="rb-ability-icon" />
        <span v-if="ultReady" class="rb-ult-ready">Ready</span>
        <span v-else class="rb-ult-pct">{{ Math.floor(hud.ultimateCharge * 100) }}%</span>
        <kbd class="rb-ability-key">E</kbd>
        <span class="rb-ult-name">{{ hud.ultimateName }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rb-hud {
  --c: #b28cff;
  --beat: 1s;
  position: absolute;
  inset: 0;
  pointer-events: none;
  user-select: none;
  font-family: 'Oxanium', system-ui, sans-serif;
  color: #fff;
  --pad: clamp(8px, 1.6vw, 18px);
  /* 1px at laptop size, up to 1.6px on 1440p+ stages, a bit smaller on phones */
  --u: clamp(0.85px, min(0.13cqh, 0.09cqw), 1.6px);
}

/* feedback */
.rb-hurt {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: radial-gradient(ellipse at center, transparent 45%, rgba(255, 30, 50, 0.55) 100%);
}
.rb-hurt.on {
  animation: rb-hurt 0.45s ease-out;
}
@keyframes rb-hurt {
  0% { opacity: 0.7; }
  100% { opacity: 0; }
}
.rb-lowhp {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.4s ease;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(200, 0, 30, 0.45) 100%);
}
.rb-lowhp.on {
  opacity: 1;
  animation: rb-heartbeat var(--beat) ease-in-out infinite;
}
@keyframes rb-heartbeat {
  0%, 100% { opacity: 0.45; }
  12% { opacity: 1; }
  24% { opacity: 0.55; }
  36% { opacity: 0.9; }
  60% { opacity: 0.5; }
}

/* xp */
.rb-xp {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px var(--pad) 0;
}
.rb-xp-track {
  position: relative;
  flex: 1;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  background: rgba(6, 4, 14, 0.75);
  box-shadow: inset 0 0 0 1px rgba(142, 246, 255, 0.2);
}
.rb-xp-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4f7dff, #8ef6ff);
  box-shadow: 0 0 14px #8ef6ff;
  transition: width 0.2s ease-out;
  position: relative;
}
.rb-xp-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0 18px, rgba(255, 255, 255, 0.25) 18px 19px);
}
.rb-xp-flash {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: #fff;
}
.rb-xp-flash.on {
  animation: rb-xp-flash 0.7s ease-out;
}
@keyframes rb-xp-flash {
  0% { opacity: 0.95; }
  100% { opacity: 0; }
}
.rb-level {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-top: 4px;
  clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, #8ef6ff, #4f7dff 60%, #2a1a6e);
  color: #061026;
}
.rb-level.pulse {
  animation: rb-level-pulse 0.8s cubic-bezier(0.2, 1.6, 0.4, 1);
}
@keyframes rb-level-pulse {
  0% { transform: scale(1); filter: brightness(1); }
  30% { transform: scale(1.45); filter: brightness(2.2); }
  100% { transform: scale(1); filter: brightness(1); }
}
.rb-level-label {
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.1em;
  line-height: 1;
}
.rb-level-num {
  font-size: 17px;
  font-weight: 800;
  line-height: 1;
}

/* left */
.rb-left {
  position: absolute;
  top: 60px;
  left: var(--pad);
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: min(46%, calc(var(--u) * 300));
}
.rb-hp {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rb-hp-track {
  position: relative;
  width: clamp(150px, 22vw, 260px);
  height: 20px;
  border-radius: 6px;
  overflow: hidden;
  background: rgba(6, 4, 14, 0.8);
  box-shadow: inset 0 0 0 1px rgba(255, 90, 110, 0.3), 0 4px 14px rgba(0, 0, 0, 0.5);
}
.danger .rb-hp-track {
  animation: rb-hp-thump var(--beat) ease-in-out infinite;
}
@keyframes rb-hp-thump {
  0%, 36%, 100% { box-shadow: inset 0 0 0 1px rgba(255, 90, 110, 0.5), 0 0 0 rgba(255, 30, 60, 0); }
  12% { box-shadow: inset 0 0 0 1.5px #ff5a6e, 0 0 22px rgba(255, 30, 60, 0.8); }
  28% { box-shadow: inset 0 0 0 1px #ff5a6e, 0 0 14px rgba(255, 30, 60, 0.5); }
}
.rb-hp-ghost,
.rb-hp-fill {
  position: absolute;
  inset: 0 auto 0 0;
}
.rb-hp-ghost {
  background: #fff1c9;
  opacity: 0.85;
  transition: width 0.55s cubic-bezier(0.4, 0, 0.2, 1);
}
.rb-hp-fill {
  background: linear-gradient(180deg, #ff6a7d, #e01f45 60%, #a8102e);
  box-shadow: 0 0 12px rgba(255, 50, 80, 0.6);
  transition: width 0.12s ease-out;
}
.rb-hp-fill.low {
  animation: rb-hp-low 0.6s ease-in-out infinite alternate;
}
@keyframes rb-hp-low {
  to { filter: brightness(1.6); }
}
.rb-hp-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  font-size: 11.5px;
  font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
.danger .rb-hp-heart {
  animation: rb-heart var(--beat) ease-in-out infinite;
}
@keyframes rb-heart {
  0%, 36%, 100% { transform: scale(1); }
  12% { transform: scale(1.5); }
  24% { transform: scale(1.05); }
  30% { transform: scale(1.3); }
}
.rb-revives {
  display: flex;
  gap: 2px;
  color: #ffe08a;
  filter: drop-shadow(0 0 4px rgba(255, 224, 138, 0.8));
}
.rb-row {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 5);
}
.rb-row.dim {
  opacity: 0.8;
}
.rb-row :deep(.rb-item) {
  --s: calc(var(--u) * 34);
}
.rb-row :deep(.rb-item.sm) {
  --s: calc(var(--u) * 26);
}
.rb-row :deep(.rb-item-icon) {
  border-radius: calc(var(--u) * 9);
}
.rb-row :deep(.rb-item-pips span) {
  max-width: calc(var(--u) * 5);
  height: calc(var(--u) * 3);
}
.rb-row :deep(.rb-item-evo) {
  font-size: calc(var(--u) * 8);
}

/* centre */
.rb-center {
  position: absolute;
  top: 24px;
  left: 50%;
  translate: -50% 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.rb-clock {
  font-size: clamp(22px, 3vw, 34px);
  font-weight: 800;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 18px rgba(142, 246, 255, 0.5), 0 2px 4px rgba(0, 0, 0, 0.9);
}
.rb-next {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(240, 236, 250, 0.75);
  background: rgba(6, 4, 14, 0.65);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.rb-next b {
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.rb-next.soon {
  color: #ffb3b3;
  box-shadow: inset 0 0 0 1px rgba(255, 60, 80, 0.6), 0 0 18px rgba(255, 40, 60, 0.45);
  animation: rb-soon 0.8s ease-in-out infinite;
}
@keyframes rb-soon {
  50% { transform: scale(1.06); }
}
.rb-boss {
  width: clamp(240px, 42vw, 560px);
}
.rb-boss-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 4px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #ffd0d0;
  text-shadow: 0 0 12px rgba(255, 40, 60, 0.8), 0 2px 3px #000;
}
.rb-boss-pct {
  margin-left: 4px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.rb-boss-track {
  position: relative;
  height: 14px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(6, 4, 14, 0.85);
  box-shadow: inset 0 0 0 1px rgba(255, 60, 80, 0.45), 0 0 24px rgba(255, 30, 60, 0.35);
}
.rb-boss-track.phase {
  animation: rb-boss-phase 0.5s ease-out;
}
@keyframes rb-boss-phase {
  0% { transform: scaleY(1.8); filter: brightness(2.6); }
  40% { transform: translateX(-4px) scaleY(1.2); }
  70% { transform: translateX(3px); }
  100% { transform: none; filter: none; }
}
.rb-boss-ghost,
.rb-boss-fill {
  position: absolute;
  inset: 0 auto 0 0;
}
.rb-boss-ghost {
  background: linear-gradient(180deg, #fff2c4, #ffb36b);
  opacity: 0.8;
  transition: width 0.7s cubic-bezier(0.4, 0, 0.2, 1);
}
.rb-boss-fill {
  background: linear-gradient(180deg, #ff4d6a, #b1002a);
  transition: width 0.2s ease-out;
}
.rb-boss-fill::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), transparent 50%);
}
.rb-boss-notch {
  position: absolute;
  top: -1px;
  bottom: -1px;
  width: 3px;
  margin-left: -1.5px;
  background: #fff;
  box-shadow: 0 0 6px #fff;
  clip-path: polygon(0 0, 100% 0, 100% 30%, 50% 50%, 100% 70%, 100% 100%, 0 100%, 0 70%, 50% 50%, 0 30%);
}
.rb-boss-notch.broken {
  background: rgba(0, 0, 0, 0.65);
  box-shadow: none;
}
.rb-boss-enter-active,
.rb-boss-leave-active {
  transition: opacity 0.3s ease, transform 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.rb-boss-enter-from,
.rb-boss-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(-6px);
}

/* right */
.rb-right {
  position: absolute;
  top: 60px;
  right: var(--pad);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.rb-tally {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  border-radius: 9px;
  background: rgba(6, 4, 14, 0.6);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.rb-tally.punch {
  animation: rb-punch 0.7s cubic-bezier(0.2, 1.8, 0.4, 1);
}
@keyframes rb-punch {
  0% { transform: scale(1); }
  20% { transform: scale(1.5) rotate(-4deg); background: rgba(255, 60, 80, 0.5); box-shadow: 0 0 30px rgba(255, 60, 80, 0.8); }
  100% { transform: scale(1); }
}
.rb-tally-unit {
  margin-left: 3px;
  font-size: 10px;
  font-weight: 700;
  color: #b28cff;
}
.rb-tally b {
  min-width: 34px;
  text-align: right;
  font-size: 15px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.rb-milestone {
  padding: 3px 10px;
  border-radius: 999px;
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #2a0008;
  background: linear-gradient(90deg, #ffe08a, #ff5a6e);
  box-shadow: 0 0 20px rgba(255, 90, 110, 0.8);
}
.rb-mile-enter-active {
  animation: rb-mile-in 0.5s cubic-bezier(0.2, 1.8, 0.4, 1);
}
.rb-mile-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.rb-mile-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
@keyframes rb-mile-in {
  from { opacity: 0; transform: scale(2.4); }
}

/* combo */
.rb-combo {
  --tc: #8ef6ff;
  --k: 1;
  position: absolute;
  right: calc(var(--pad) + 6px);
  top: 46%;
  width: 92px;
  height: 92px;
  transform: scale(var(--k));
  transform-origin: right center;
  transition: transform 0.25s cubic-bezier(0.2, 1.5, 0.4, 1);
  filter: drop-shadow(0 0 calc(6px + var(--k) * 8px) var(--tc));
}
.rb-combo.t0 {
  animation: rb-rainbow 1.6s linear infinite;
}
@keyframes rb-rainbow {
  to { filter: drop-shadow(0 0 18px var(--tc)) hue-rotate(360deg); }
}
.rb-combo-ring {
  position: absolute;
  inset: 0;
  rotate: -90deg;
}
.rb-combo-ring circle {
  fill: rgba(6, 4, 14, 0.7);
  stroke-width: 5;
}
.rb-combo-ring .bg {
  stroke: rgba(255, 255, 255, 0.1);
}
.rb-combo-ring .fg {
  fill: none;
  stroke: var(--tc);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear, stroke 0.3s ease;
}
.rb-combo-burst {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid var(--tc);
  animation: rb-combo-burst 0.7s ease-out forwards;
}
@keyframes rb-combo-burst {
  0% { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; border-width: 0.5px; }
}
.rb-combo-inner {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.rb-combo-num {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: 26px;
  font-weight: 900;
  line-height: 1;
  color: #fff;
  text-shadow: 0 0 10px var(--tc);
  animation: rb-bump 0.18s ease-out;
}
.rb-combo-tier {
  margin-top: 3px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--tc);
  animation: rb-tier 0.5s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.rb-combo-next {
  position: absolute;
  left: 18px;
  right: 18px;
  bottom: -8px;
  height: 3px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
}
.rb-combo-next i {
  display: block;
  height: 100%;
  transition: width 0.15s ease-out;
}
@keyframes rb-bump {
  0% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
@keyframes rb-tier {
  0% { transform: scale(2.2); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.rb-combo-enter-active {
  transition: opacity 0.2s ease, translate 0.3s cubic-bezier(0.2, 1.5, 0.4, 1);
}
.rb-combo-leave-active {
  transition: opacity 0.5s ease, translate 0.5s ease;
}
.rb-combo-enter-from {
  opacity: 0;
  translate: 30px 0;
}
.rb-combo-leave-to {
  opacity: 0;
  translate: 0 20px;
}

/* action bar */
.rb-bar {
  position: absolute;
  bottom: calc(var(--pad) + calc(var(--u) * 10));
  left: 50%;
  translate: -50% 0;
  display: flex;
  align-items: flex-end;
  gap: calc(var(--u) * 12);
}
.rb-ability {
  position: relative;
  display: grid;
  place-items: center;
  width: calc(var(--u) * 50);
  height: calc(var(--u) * 50);
}
.rb-ability.ult {
  width: calc(var(--u) * 70);
  height: calc(var(--u) * 70);
}
.rb-ability-ring {
  position: absolute;
  inset: 0;
  rotate: -90deg;
}
.rb-ability-ring circle {
  fill: rgba(6, 4, 14, 0.75);
  stroke-width: 4;
}
.rb-ability-ring .bg {
  stroke: rgba(255, 255, 255, 0.1);
}
.rb-ability-ring .fg {
  fill: none;
  stroke: #8ef6ff;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}
.rb-ability.ult .fg {
  stroke: var(--c);
}
.rb-ability-icon {
  position: relative;
  width: calc(var(--u) * 20);
  height: calc(var(--u) * 20);
  color: rgba(255, 255, 255, 0.45);
  transition: color 0.2s ease;
}
.rb-ability.ult .rb-ability-icon {
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin-top: calc(var(--u) * -10);
}
.rb-ability.ready .rb-ability-icon {
  color: #fff;
  filter: drop-shadow(0 0 calc(var(--u) * 6) #8ef6ff);
}
.rb-ability.ult.ready {
  animation: rb-ult-ready 1.1s ease-in-out infinite;
}
.rb-ability.ult.ready .rb-ability-icon {
  filter: drop-shadow(0 0 calc(var(--u) * 8) var(--c));
}
.rb-ability.ult.ready::before {
  content: '';
  position: absolute;
  inset: calc(var(--u) * -6);
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--c) 55%, transparent), transparent 70%);
  animation: rb-ult-halo 1.1s ease-in-out infinite;
}
@keyframes rb-ult-ready {
  50% { transform: scale(1.07); }
}
@keyframes rb-ult-halo {
  50% { opacity: 0.4; transform: scale(1.25); }
}
.rb-ult-ready,
.rb-ult-pct {
  position: absolute;
  bottom: calc(var(--u) * 14);
  font-size: calc(var(--u) * 9);
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.rb-ult-ready {
  color: #fff;
  text-shadow: 0 0 calc(var(--u) * 8) var(--c);
}
.rb-ult-pct {
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}
.rb-ability-key,
.rb-slot-key {
  position: absolute;
  bottom: calc(var(--u) * -8);
  padding: calc(var(--u) * 2) calc(var(--u) * 5);
  border-radius: calc(var(--u) * 4);
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: calc(var(--u) * 8.5);
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(6, 4, 14, 0.9);
  box-shadow: inset 0 0 0 calc(var(--u) * 1) rgba(255, 255, 255, 0.2);
}
.rb-ult-name {
  position: absolute;
  left: calc(100% + calc(var(--u) * 8));
  bottom: calc(var(--u) * 18);
  white-space: nowrap;
  font-size: calc(var(--u) * 11);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--c) 70%, #fff);
  text-shadow: 0 calc(var(--u) * 2) calc(var(--u) * 4) #000;
}

/* ability slots */
.rb-slots {
  display: flex;
  align-items: flex-end;
  gap: calc(var(--u) * 8);
}
.rb-slot {
  --ac: #8ef6ff;
  --cd: 0;
  position: relative;
  width: calc(var(--u) * 56);
  height: calc(var(--u) * 56);
  margin-bottom: calc(var(--u) * 4);
  pointer-events: auto;
  touch-action: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  outline: none;
}
.rb-slot.locked {
  cursor: default;
}
.rb-slot-face {
  position: absolute;
  inset: 0;
  display: block;
  padding: calc(var(--u) * 2);
  clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%);
  background: linear-gradient(160deg, color-mix(in srgb, var(--ac) 80%, #fff), color-mix(in srgb, var(--ac) 40%, #0a0614));
  transition: filter 0.2s ease;
}
.rb-slot.cooling .rb-slot-face {
  background: linear-gradient(160deg, color-mix(in srgb, var(--ac) 40%, #3a3450), #16121f);
}
.rb-slot.locked .rb-slot-face,
.rb-slot.empty .rb-slot-face {
  background: rgba(255, 255, 255, 0.14);
}
.rb-slot-face.press {
  animation: rb-slot-press 0.22s ease-out;
}
@keyframes rb-slot-press {
  40% { transform: scale(0.86); filter: brightness(1.8); }
}
.rb-slot-inner {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  clip-path: inherit;
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--ac) 32%, #0a0614), #07050d 80%);
}
.rb-slot.locked .rb-slot-inner,
.rb-slot.empty .rb-slot-inner {
  background: rgba(6, 4, 14, 0.82);
}
.rb-slot-inner.deny {
  animation: rb-slot-deny 0.3s ease-in-out;
}
@keyframes rb-slot-deny {
  25% { transform: translateX(calc(var(--u) * -3)); }
  50% { transform: translateX(calc(var(--u) * 3)); background: rgba(80, 10, 20, 0.9); }
  75% { transform: translateX(calc(var(--u) * -2)); }
}
.rb-slot-icon {
  position: relative;
  width: calc(var(--u) * 26);
  height: calc(var(--u) * 26);
  color: var(--ac);
  filter: drop-shadow(0 0 calc(var(--u) * 6) var(--ac));
}
.rb-slot-icon.ghost {
  width: calc(var(--u) * 18);
  height: calc(var(--u) * 18);
  color: rgba(255, 255, 255, 0.35);
  filter: none;
}
.rb-slot.cooling .rb-slot-icon {
  color: rgba(255, 255, 255, 0.4);
  filter: none;
}
.rb-slot-sweep {
  position: absolute;
  inset: -20%;
  background: conic-gradient(rgba(4, 2, 10, 0.7) calc(var(--cd) * 360deg), transparent 0);
  pointer-events: none;
}
.rb-slot-secs {
  position: absolute;
  font-size: calc(var(--u) * 15);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 calc(var(--u) * 6) #000, 0 calc(var(--u) * 1) calc(var(--u) * 2) #000;
}
.rb-slot-lock {
  width: calc(var(--u) * 16);
  height: calc(var(--u) * 16);
  margin-top: calc(var(--u) * -8);
  color: rgba(255, 255, 255, 0.5);
}
.rb-slot-lv {
  position: absolute;
  bottom: calc(var(--u) * 11);
  font-size: calc(var(--u) * 9);
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
}
.rb-slot.ready:not(.active) {
  animation: rb-slot-idle 2.4s ease-in-out infinite;
}
@keyframes rb-slot-idle {
  50% { filter: brightness(1.25) drop-shadow(0 0 calc(var(--u) * 6) var(--ac)); }
}
.rb-slot.active {
  animation: rb-slot-active 0.5s ease-in-out infinite alternate;
}
@keyframes rb-slot-active {
  from { filter: brightness(1.3) drop-shadow(0 0 calc(var(--u) * 6) var(--ac)); }
  to { filter: brightness(1.9) drop-shadow(0 0 calc(var(--u) * 16) var(--ac)); }
}
.rb-slot.active::before {
  content: '';
  position: absolute;
  inset: calc(var(--u) * -8);
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--ac) 50%, transparent), transparent 70%);
  animation: rb-ult-halo 0.8s ease-in-out infinite;
}
.rb-slot-flash {
  position: absolute;
  inset: calc(var(--u) * -4);
  pointer-events: none;
  clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%);
  background: radial-gradient(circle, #fff, var(--ac) 50%, transparent 75%);
  mix-blend-mode: screen;
  animation: rb-slot-flash 0.55s ease-out forwards;
}
@keyframes rb-slot-flash {
  0% { opacity: 1; transform: scale(0.9); }
  100% { opacity: 0; transform: scale(1.35); }
}
.rb-slot-learn {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 50%;
  box-shadow: 0 0 0 calc(var(--u) * 3) var(--ac), 0 0 calc(var(--u) * 30) var(--ac);
  animation: rb-slot-learn 0.9s ease-out forwards;
}
@keyframes rb-slot-learn {
  0% { transform: scale(0.6); opacity: 1; }
  100% { transform: scale(2.4); opacity: 0; }
}
.rb-slot-burst {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.rb-slot-burst::before {
  content: '';
  position: absolute;
  inset: calc(var(--u) * -10);
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0, #8ef6ff 30%, transparent 70%);
  animation: rb-slot-flash 0.8s ease-out forwards;
}
.rb-slot-burst i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: calc(var(--u) * 8);
  height: calc(var(--u) * 5);
  margin: calc(var(--u) * -2.5) 0 0 calc(var(--u) * -4);
  background: #8ef6ff;
  box-shadow: 0 0 calc(var(--u) * 6) #8ef6ff;
  clip-path: polygon(0 0, 100% 40%, 50% 100%);
  animation: rb-slot-shard 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
}
@keyframes rb-slot-shard {
  0% { transform: rotate(var(--a)) translateX(0); opacity: 1; }
  100% { transform: rotate(var(--a)) translateX(calc(var(--u) * 56)) rotate(160deg); opacity: 0; }
}
.rb-slot-key {
  left: 50%;
  bottom: calc(var(--u) * -9);
  translate: -50% 0;
  min-width: calc(var(--u) * 16);
  text-align: center;
}
.rb-slot.ready .rb-slot-key,
.rb-slot.active .rb-slot-key {
  color: #fff;
  box-shadow: inset 0 0 0 calc(var(--u) * 1) var(--ac), 0 0 calc(var(--u) * 8) color-mix(in srgb, var(--ac) 60%, transparent);
}
.rb-slot-pips {
  position: absolute;
  left: 50%;
  top: calc(var(--u) * -7);
  translate: -50% 0;
  display: flex;
  gap: calc(var(--u) * 2);
}
.rb-slot-pips i {
  width: calc(var(--u) * 4);
  height: calc(var(--u) * 4);
  border-radius: calc(var(--u) * 1);
  rotate: 45deg;
  background: rgba(255, 255, 255, 0.2);
}
.rb-slot-pips i.on {
  background: var(--ac);
  box-shadow: 0 0 calc(var(--u) * 4) var(--ac);
}

@media (max-width: 640px) {
  .rb-ult-name { display: none; }
  .rb-left { top: 56px; }
  .rb-right { top: 96px; }
  .rb-tally b { font-size: 13px; }
}
@media (prefers-reduced-motion: reduce) {
  .rb-hud * { animation-duration: 0.01ms !important; }
}
</style>
