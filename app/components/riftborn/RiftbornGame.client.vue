<script setup lang="ts">
import { RIFTBORN_CLASSES, riftbornCleanSkills, riftbornClass, riftbornSkillsError } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassId, RiftbornRunReport, RiftbornSkillRanks } from '#shared/utils/gamelogic/riftborn'
import { createSfx } from './engine/audio'
import { createRiftbornEngine } from './engine/index'
import type { EngineEvents, EngineHandle, HudItem, RunHud, RunResult, UpgradeChoice } from './engine/types'
import RiftbornChest from './RiftbornChest.vue'
import RiftbornHud from './RiftbornHud.vue'
import RiftbornLevelUp from './RiftbornLevelUp.vue'
import RiftbornLobby from './RiftbornLobby.vue'
import RiftbornPause from './RiftbornPause.vue'
import RiftbornResults from './RiftbornResults.vue'
import { hex, isTypingTarget } from './riftborn-ui'
import type {
  RiftbornFinishResponse,
  RiftbornProgress,
  RiftbornSaveStatus,
  RiftbornStartResponse,
  RiftbornState
} from './riftborn-ui'

const toast = useToast()

// ─── Storage (per-viewer conveniences only) ─────────────────────────────

const MUTE_KEY = 'riftborn:muted'
const CLASS_KEY = 'riftborn:class'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode or blocked storage: the setting just doesn't stick
  }
}

// ─── Audio ───────────────────────────────────────────────────────────────

const sfx = createSfx()
const muted = ref(readStorage(MUTE_KEY) === '1')
sfx.setMuted(muted.value)

function toggleMute() {
  muted.value = !muted.value
  sfx.setMuted(muted.value)
  writeStorage(MUTE_KEY, muted.value ? '1' : '0')
  if (!muted.value) sfx.play('uiClick')
}

let audioUnlocked = false
function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  sfx.unlock()
  if (phase.value === 'lobby') sfx.music('lobby')
  window.removeEventListener('pointerdown', unlockAudio, true)
  window.removeEventListener('keydown', unlockAudio, true)
}

let lastHover = 0
function hoverSfx() {
  const now = performance.now()
  if (now - lastHover < 45) return
  lastHover = now
  sfx.play('uiHover', { volume: 0.5 })
}

// ─── Lobby state ─────────────────────────────────────────────────────────

const state = ref<RiftbornState | null>(null)
const loadError = ref<string | null>(null)
const loading = ref(false)
const starting = ref(false)
const selected = ref<RiftbornClassId>(riftbornClass(readStorage(CLASS_KEY))?.id ?? 'knight')
/* Classes and achievements a finished run just unlocked, celebrated in the lobby */
const freshClasses = ref<string[]>([])
const freshAchievements = ref<string[]>([])

function applyProgress(progress: RiftbornProgress) {
  if (!state.value) return
  state.value = { ...state.value, ...progress }
  if (skillStatus.value === 'saved') draft.value = { ...progress.skills }
}

async function loadState(silent = false) {
  if (loading.value) return
  loading.value = true
  if (!silent) loadError.value = null
  try {
    const data = await apiFetch<RiftbornState>('/api/riftborn/state')
    state.value = data
    if (skillStatus.value === 'saved') draft.value = { ...data.skills }
    if (!data.unlockedClasses.includes(selected.value)) {
      selected.value = RIFTBORN_CLASSES.find(c => data.unlockedClasses.includes(c.id))?.id ?? 'knight'
    }
  } catch (e) {
    if (!silent || !state.value) loadError.value = apiErrorMessage(e, 'Couldn\'t reach the rift')
  } finally {
    loading.value = false
  }
}

function selectClass(id: RiftbornClassId) {
  if (!state.value?.unlockedClasses.includes(id)) return
  if (selected.value !== id) sfx.play('cardSelect', { volume: 0.7 })
  selected.value = id
  writeStorage(CLASS_KEY, id)
}

function onCelebrated(id: RiftbornClassId) {
  sfx.play('legendary', { volume: 0.8 })
  freshClasses.value = freshClasses.value.filter(c => c !== id)
}

// ─── Skill tree (draft + debounced autosave) ─────────────────────────────

const draft = ref<RiftbornSkillRanks>({})
const skillStatus = ref<RiftbornSaveStatus>('saved')
let saveTimer: ReturnType<typeof setTimeout> | undefined
let saving: Promise<boolean> | null = null

function onSkills(ranks: RiftbornSkillRanks) {
  draft.value = riftbornCleanSkills(ranks)
  skillStatus.value = 'dirty'
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSkills(), 900)
}

const sameRanks = (a: RiftbornSkillRanks, b: RiftbornSkillRanks) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

/** Saves the draft if it changed; resolves true when the server holds it. */
async function saveSkills(): Promise<boolean> {
  clearTimeout(saveTimer)
  if (saving) {
    await saving
    if (skillStatus.value === 'saved') return true
  }
  if (!state.value || skillStatus.value === 'saved') return true
  const snapshot = { ...draft.value }
  const error = riftbornSkillsError(snapshot, state.value.skillPoints)
  if (error) {
    skillStatus.value = 'error'
    toast.add({ title: error, color: 'error' })
    return false
  }
  skillStatus.value = 'saving'
  saving = (async () => {
    try {
      const progress = await apiFetch<RiftbornProgress>('/api/riftborn/skills', { method: 'POST', body: { skills: snapshot } })
      if (sameRanks(draft.value, snapshot)) {
        skillStatus.value = 'saved'
        applyProgress(progress)
        return true
      }
      // Changed while saving: keep the newer draft and save it next
      applyProgress(progress)
      skillStatus.value = 'dirty'
      saveTimer = setTimeout(() => saveSkills(), 400)
      return false
    } catch (e) {
      skillStatus.value = 'error'
      toast.add({ title: apiErrorMessage(e, 'Couldn\'t save your skill tree'), color: 'error' })
      return false
    } finally {
      saving = null
    }
  })()
  return saving
}

// ─── Run ─────────────────────────────────────────────────────────────────

type Phase = 'lobby' | 'run'
const phase = ref<Phase>('lobby')
const canvasHost = ref<HTMLElement | null>(null)
const run = shallowRef<RiftbornStartResponse | null>(null)
const booting = ref(false)
const hud = shallowRef<RunHud | null>(null)
const levelUp = shallowRef<{ choices: UpgradeChoice[], rerolls: number, deal: number } | null>(null)
const chest = shallowRef<{ rewards: UpgradeChoice[], gold: number, id: number } | null>(null)
const paused = ref(false)
const result = shallowRef<RunResult | null>(null)
const finishData = shallowRef<RiftbornFinishResponse | null>(null)
const finishing = ref(false)
const finishError = ref<string | null>(null)

let engine: EngineHandle | null = null
let runToken = 0
let dealSeq = 0
let chestSeq = 0
let unmounted = false

const runClass = computed(() => riftbornClass(run.value?.classId) ?? RIFTBORN_CLASSES[0]!)
const runColor = computed(() => hex(runClass.value.color))
const overlayOpen = computed(() => !!(levelUp.value || chest.value || result.value))

const copyItems = (items: HudItem[]) => items.map(i => ({ ...i }))

function teardownEngine() {
  const handle = engine
  engine = null
  if (!handle) return
  try {
    handle.destroy()
  } catch (e) {
    console.error('[riftborn] engine destroy failed', e)
  }
}

function resetRunState() {
  hud.value = null
  levelUp.value = null
  chest.value = null
  paused.value = false
  result.value = null
  finishData.value = null
  finishError.value = null
  finishing.value = false
}

function makeEvents(token: number): EngineEvents {
  const live = () => token === runToken && !unmounted
  return {
    onHud(h) {
      if (!live() || result.value) return
      hud.value = {
        ...h,
        weapons: copyItems(h.weapons),
        passives: copyItems(h.passives),
        abilities: (h.abilities ?? []).map(a => ({ ...a })),
        abilitySlots: h.abilitySlots ?? 1,
        nextSlotAt: h.nextSlotAt ?? null,
        boss: h.boss ? { ...h.boss } : null
      }
    },
    onLevelUp(choices, rerolls) {
      if (!live() || result.value) return
      levelUp.value = { choices: choices.map(c => ({ ...c })), rerolls, deal: ++dealSeq }
    },
    onChest(rewards, gold) {
      if (!live() || result.value) return
      chest.value = { rewards: rewards.map(r => ({ ...r })), gold, id: ++chestSeq }
    },
    onPause(value) {
      if (!live()) return
      paused.value = value
    },
    onGameOver(r) {
      if (!live() || result.value) return
      levelUp.value = null
      chest.value = null
      paused.value = false
      result.value = {
        ...r,
        weapons: copyItems(r.weapons),
        passives: copyItems(r.passives),
        abilities: (r.abilities ?? []).map(a => ({ ...a })),
        damageBySource: (r.damageBySource ?? []).map(d => ({ ...d }))
      }
      sfx.music(r.victory ? 'victory' : 'defeat')
      submitFinish()
    }
  }
}

async function startRun(classId: RiftbornClassId) {
  if (starting.value) return
  if (!state.value?.unlockedClasses.includes(classId)) {
    sfx.play('uiError')
    return
  }
  starting.value = true
  sfx.play('uiClick')

  // The run deploys with the saved tree, so land any pending edits first
  if (skillStatus.value !== 'saved' && !(await saveSkills())) {
    sfx.play('uiError')
    starting.value = false
    return
  }

  let started: RiftbornStartResponse
  try {
    started = await apiFetch<RiftbornStartResponse>('/api/riftborn/start', { method: 'POST', body: { classId } })
  } catch (e) {
    sfx.play('uiError')
    toast.add({ title: apiErrorMessage(e, 'The rift wouldn\'t open'), color: 'error' })
    starting.value = false
    return
  }
  if (unmounted) return

  const token = ++runToken
  teardownEngine()
  resetRunState()
  freshClasses.value = []
  freshAchievements.value = []
  run.value = started
  phase.value = 'run'
  starting.value = false
  booting.value = true
  sfx.music('run')

  await nextTick()
  const host = canvasHost.value
  if (!host || token !== runToken || unmounted) return
  try {
    const handle = await createRiftbornEngine(host, {
      classId: started.classId,
      meta: started.effects,
      sfx,
      events: makeEvents(token)
    })
    if (token !== runToken || unmounted) {
      handle.destroy()
      return
    }
    engine = handle
    host.focus({ preventScroll: true })
  } catch (e) {
    console.error('[riftborn] engine failed to start', e)
    toast.add({ title: 'The rift collapsed while opening. Try again.', color: 'error' })
    if (token === runToken) backToLobby()
  } finally {
    if (token === runToken) booting.value = false
  }
}

async function submitFinish() {
  const r = result.value
  const current = run.value
  if (!r || !current || finishData.value || finishing.value) return
  finishing.value = true
  finishError.value = null
  const report: RiftbornRunReport = {
    time: r.time,
    kills: r.kills,
    eliteKills: r.eliteKills,
    bossKills: r.bossKills,
    level: r.level,
    shards: r.shards,
    victory: r.victory
  }
  try {
    const data = await apiFetch<RiftbornFinishResponse>('/api/riftborn/finish', { method: 'POST', body: { runId: current.runId, report } })
    if (unmounted) return
    finishData.value = data
    applyProgress(data.progress)
    freshAchievements.value = data.newAchievements.map(a => a.id)
    freshClasses.value = data.newAchievements.flatMap(a => a.unlocks ? [a.unlocks] : [])
  } catch (e) {
    finishError.value = apiErrorMessage(e, 'Couldn\'t record this run')
    toast.add({ title: finishError.value, color: 'error' })
  } finally {
    finishing.value = false
  }
}

function backToLobby() {
  runToken++
  teardownEngine()
  resetRunState()
  run.value = null
  booting.value = false
  phase.value = 'lobby'
  sfx.music('lobby')
  loadState(true)
}

function playAgain() {
  const classId = result.value?.classId ?? run.value?.classId ?? selected.value
  startRun(classId)
}

// ─── Engine controls ─────────────────────────────────────────────────────

function chooseUpgrade(index: number) {
  const handle = engine
  levelUp.value = null
  handle?.choose(index)
}

function rerollUpgrades() {
  engine?.reroll()
}

function closeChest() {
  chest.value = null
  engine?.closeChest()
}

function castAbility(slot: number) {
  if (!engine || overlayOpen.value || paused.value) return
  engine.castAbility?.(slot)
}

function pauseRun() {
  if (!engine || overlayOpen.value || paused.value) return
  paused.value = true
  sfx.play('uiClick')
  engine.pause()
}

function resumeRun() {
  if (!engine || !paused.value) return
  paused.value = false
  sfx.play('uiClick')
  engine.resume()
}

function forfeitRun() {
  if (!engine) return
  paused.value = false
  sfx.play('uiClick')
  engine.forfeit()
}

// ─── Global input ────────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (phase.value !== 'run' || isTypingTarget(e.target)) return
  if (e.key === 'Escape') {
    if (overlayOpen.value || booting.value) return
    e.preventDefault()
    if (paused.value) resumeRun()
    else pauseRun()
  } else if (e.code === 'Space') {
    // Space is dash: never let it scroll the page or press a focused button
    e.preventDefault()
  }
}

function onVisibility() {
  if (document.hidden && phase.value === 'run') pauseRun()
}

onMounted(() => {
  window.addEventListener('pointerdown', unlockAudio, true)
  window.addEventListener('keydown', unlockAudio, true)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibility)
  sfx.music('lobby')
  loadState()
})

onBeforeUnmount(() => {
  unmounted = true
  runToken++
  if (skillStatus.value === 'dirty') saveSkills()
  clearTimeout(saveTimer)
  teardownEngine()
  window.removeEventListener('pointerdown', unlockAudio, true)
  window.removeEventListener('keydown', unlockAudio, true)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibility)
  sfx.destroy()
})
</script>

<template>
  <div class="rb-root">
    <template v-if="phase === 'lobby'">
      <RiftbornLobby
        v-if="state"
        :state="state"
        :selected="selected"
        :starting="starting"
        :muted="muted"
        :ranks="draft"
        :save-status="skillStatus"
        :sfx="sfx"
        :fresh-classes="freshClasses"
        :fresh-achievements="freshAchievements"
        @select="selectClass"
        @start="startRun(selected)"
        @toggle-mute="toggleMute"
        @hover="hoverSfx"
        @skills="onSkills"
        @save-skills="saveSkills"
        @celebrated="onCelebrated"
      />
      <div v-else class="rb-gate">
        <h1 class="rb-gate-title">RIFTBORN</h1>
        <template v-if="loadError">
          <p class="rb-gate-text">{{ loadError }}</p>
          <button type="button" class="rb-gate-btn" @click="loadState()">
            <UIcon name="i-lucide-refresh-cw" class="size-4" /> Try again
          </button>
        </template>
        <p v-else class="rb-gate-text">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Opening the rift…
        </p>
      </div>
    </template>

    <div v-else class="rb-stage" :style="{ '--c': runColor }" @contextmenu.prevent>
      <div ref="canvasHost" class="rb-canvas" tabindex="-1" />

      <RiftbornHud v-if="hud && !result" :hud="hud" :color="runColor" :sfx="sfx" @cast="castAbility" />

      <div v-if="!result && !booting" class="rb-run-actions">
        <button type="button" class="rb-run-btn" :aria-label="muted ? 'Unmute' : 'Mute'" @click="toggleMute">
          <UIcon :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" class="size-4" />
        </button>
        <button type="button" class="rb-run-btn" aria-label="Pause" @click="pauseRun">
          <UIcon name="i-lucide-pause" class="size-4" />
        </button>
      </div>

      <RiftbornLevelUp
        v-if="levelUp && !result"
        :choices="levelUp.choices"
        :rerolls="levelUp.rerolls"
        :level="hud?.level ?? 1"
        :deal="levelUp.deal"
        :sfx="sfx"
        :abilities="hud?.abilities ?? []"
        @choose="chooseUpgrade"
        @reroll="rerollUpgrades"
      />

      <RiftbornChest
        v-if="chest && !levelUp && !result"
        :key="chest.id"
        :rewards="chest.rewards"
        :gold="chest.gold"
        :sfx="sfx"
        @close="closeChest"
      />

      <RiftbornPause
        v-if="paused && !overlayOpen"
        :hud="hud"
        :muted="muted"
        :class-name="runClass.name"
        @resume="resumeRun"
        @toggle-mute="toggleMute"
        @forfeit="forfeitRun"
        @hover="hoverSfx"
      />

      <RiftbornResults
        v-if="result"
        :result="result"
        :finish="finishData"
        :finishing="finishing"
        :error="finishError"
        :sfx="sfx"
        :class-name="runClass.name"
        :color="runColor"
        @retry="submitFinish"
        @play-again="playAgain"
        @lobby="backToLobby"
        @hover="hoverSfx"
      />

      <Transition name="rb-boot">
        <div v-if="booting" class="rb-boot">
          <div class="rb-boot-ring" />
          <p>Tearing open the rift…</p>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.rb-root {
  position: relative;
  min-height: calc(100dvh - 3.5rem);
  background:
    radial-gradient(120% 60% at 50% 0%, #140b2a 0%, transparent 60%),
    #07050f;
  color: #f0ecfa;
}
@media (min-width: 1024px) {
  .rb-root {
    min-height: 100dvh;
  }
}

.rb-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: inherit;
  padding: 16px;
  text-align: center;
}
.rb-gate-title {
  font-family: 'Unbounded', system-ui, sans-serif;
  font-size: clamp(40px, 9vw, 88px);
  font-weight: 900;
  line-height: 1;
  color: #fff;
  text-shadow: 0 0 30px rgba(178, 140, 255, 0.6);
  animation: rb-gate-pulse 1.8s ease-in-out infinite;
}
@keyframes rb-gate-pulse {
  50% { opacity: 0.55; }
}
.rb-gate-text {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.08em;
  color: rgba(220, 212, 240, 0.7);
}
.rb-gate-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 12px;
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #0b0716;
  background: linear-gradient(135deg, #8ef6ff, #b28cff);
  cursor: pointer;
}

.rb-stage {
  --c: #b28cff;
  position: relative;
  container-type: size;
  height: calc(100dvh - 3.5rem);
  min-height: 420px;
  overflow: hidden;
  background: #05030a;
  user-select: none;
}
@media (min-width: 1024px) {
  .rb-stage {
    height: 100dvh;
  }
}
.rb-canvas {
  position: absolute;
  inset: 0;
  outline: none;
}
.rb-run-actions {
  position: absolute;
  top: 24px;
  right: clamp(8px, 1.6vw, 18px);
  z-index: 20;
  display: flex;
  gap: 6px;
}
.rb-run-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(6, 4, 14, 0.65);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: color 0.15s ease, box-shadow 0.15s ease;
}
.rb-run-btn:hover {
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.rb-boot {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: radial-gradient(circle, color-mix(in srgb, var(--c) 18%, #05030a), #05030a 60%);
  font-family: 'Oxanium', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(240, 236, 250, 0.8);
}
.rb-boot-ring {
  width: 90px;
  height: 90px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, transparent, var(--c), #fff, transparent 70%);
  mask: radial-gradient(circle, transparent 54%, #000 57%, #000 66%, transparent 69%);
  animation: rb-boot-spin 0.9s linear infinite;
  filter: drop-shadow(0 0 14px var(--c));
}
@keyframes rb-boot-spin {
  to { transform: rotate(360deg); }
}
.rb-boot-leave-active {
  transition: opacity 0.5s ease, transform 0.6s ease;
}
.rb-boot-leave-to {
  opacity: 0;
  transform: scale(1.15);
}
</style>
