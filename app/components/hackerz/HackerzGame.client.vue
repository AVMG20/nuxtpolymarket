<script setup lang="ts">
import { HackerzGame } from '~/utils/hackerz-engine'
import { HackerzAutopilot } from '~/utils/hackerz-autopilot'
import type { HackerzAutopilotOffer } from '#shared/utils/gamelogic/hackerz-autopilot'
import type { HackerzWaveSummary, SysLogKind, SysLogLine } from '~/utils/hackerz-engine'
import {
  HACKERZ_BONUS_MS, HACKERZ_BONUS_MULTIPLIER, HACKERZ_DIFFICULTY_FULL_WAVE, HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_CODEX_ALWAYS, HACKERZ_DEPLOYABLES,
  hackerzCodexFromArmoury, hackerzCodexFromWave,
  HACKERZ_DEPLOYABLE_MAX, HACKERZ_MAX_WAVE, HACKERZ_TURRETS, HACKERZ_TURRET_REFUND, HACKERZ_UPGRADES,
  HACKERZ_WAVE_MS, HACKERZ_WEAPONS, HACKERZ_SAVE_VERSION,
  hackerzBonusEvent, hackerzBonusOffered, hackerzCooldownRushCost, hackerzDeployableCost, hackerzDifficulty,
  hackerzEmptyArmoury, hackerzEmptyLevels, hackerzEmptyMainframe, hackerzIsBossWave, hackerzLoadout, hackerzMainframeEffects, hackerzNetworkEvent,
  hackerzRepairCost, hackerzSlots, hackerzStock, hackerzTurret, hackerzUpgradeMax,
  hackerzUpgradeCost, hackerzWeapon, hackerzWeaponRuntime, hackerzWeaponUnlockWave,
  type HackerzArmoury, type HackerzDeployableId, type HackerzDifficultyId, type HackerzEnemyId, type HackerzEventId,
  type HackerzMainframeId, type HackerzMainframeLevels, type HackerzRunSave, type HackerzTab,
  type HackerzTurretId, type HackerzUpgradeId, type HackerzWeaponId
} from '#shared/utils/gamelogic/hackerz'

type Phase = 'loading' | 'lobby' | 'wave' | 'shop' | 'over' | 'won'

const { user, fetchSession } = useAuth()
const toast = useToast()


const host = ref<HTMLDivElement | null>(null)
const shell = ref<HTMLDivElement | null>(null)

const phase = ref<Phase>('loading')
const paused = ref(false)

// ─── Account state ──────────────────────────────────────────────────────────
// The Mainframe and the difficulty gate live on the server; everything below is
// a mirror of the last `state.get`, refreshed after anything that mutates it.

type HackerzStateResponse = Awaited<ReturnType<typeof loadState>>

const account = ref<HackerzStateResponse | null>(null)
const mainframeLevels = computed<HackerzMainframeLevels>(() => account.value?.levels ?? hackerzEmptyMainframe())
const effects = computed(() => hackerzMainframeEffects(mainframeLevels.value))
const bestWave = computed(() => account.value?.stats.bestWave ?? 0)
const busy = ref(false)

function loadState() {
  return $fetch('/api/hackerz/state')
}

async function refreshState() {
  account.value = await loadState()
}

// Uplink recharge cooldown — ticks once a second while visible.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

const cooldownRemainingMs = computed(() => {
  const until = account.value?.runCooldown?.until
  return until ? Math.max(0, new Date(until).getTime() - now.value) : 0
})
const isCoolingDown = computed(() => cooldownRemainingMs.value > 0)
const cooldownRushCost = computed(() => hackerzCooldownRushCost(cooldownRemainingMs.value))
const gems = computed(() => user.value?.gems ?? 0)
const rushingCooldown = ref(false)

const cooldownLabel = computed(() => {
  const totalSeconds = Math.ceil(cooldownRemainingMs.value / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  return `${seconds}s`
})

async function rushCooldown() {
  if (rushingCooldown.value || !isCoolingDown.value) return
  rushingCooldown.value = true
  try {
    await $fetch('/api/hackerz/rush-cooldown', { method: 'POST' })
    await Promise.all([refreshState(), fetchSession()])
  } catch (error: unknown) {
    toast.add({
      title: 'Could not clear uplink recharge',
      description: (error as { statusMessage?: string }).statusMessage ?? 'Try again in a moment.',
      color: 'error'
    })
  } finally {
    rushingCooldown.value = false
  }
}


// ─── Run state ──────────────────────────────────────────────────────────────
// Credits and the armoury live here rather than in the engine: the engine runs
// a wave, the uplink runs the economy, and the only thing that crosses between
// them is a derived loadout.

const difficultyId = ref<HackerzDifficultyId>('breach')
const armoury = ref<HackerzArmoury>(hackerzEmptyArmoury())
const credits = ref(0)
const coins = ref(0)
const wave = ref(0)
const totalKills = ref(0)
const lastSummary = ref<HackerzWaveSummary | null>(null)
const payout = ref<{
  awarded: number
  capped: boolean
  victory: boolean
  /** Deepest wave the *save* reached — see `settleRun`. */
  wave: number
  kills: number
  /** The fatal wave banked coins the save never got to store. */
  lostWave: boolean
} | null>(null)

/** The last cleared wave whose bonus offer was played or skipped; saved, so a reload cannot replay it. */
const bonusResolved = ref(0)
/** The network event being fought right now, if this round is a bonus. */
const bonusActive = ref<HackerzEventId | null>(null)
/** Length of the round in flight, for the HUD timer. */
const roundMs = ref(HACKERZ_WAVE_MS)
/** The deployable a click will place. */
const armed = ref<HackerzDeployableId | null>(null)

const difficulty = computed(() => hackerzDifficulty(difficultyId.value))
const loadout = computed(() => hackerzLoadout(armoury.value, mainframeLevels.value, difficultyId.value))
const levels = computed(() => armoury.value.levels)

// ─── Database ───────────────────────────────────────────────────────────────
// The Database opens an entry once its thing is bought into the armoury or met
// on the board. The server keeps what has been opened; what the best wave has
// already shown is worked out here. Openings go up in batches, a moment apart.

const codexOpened = ref(new Set<string>())
const codexKnown = computed(() => new Set([
  ...HACKERZ_CODEX_ALWAYS,
  ...(account.value?.codex ?? []),
  ...hackerzCodexFromWave(bestWave.value),
  ...codexOpened.value
]))
let codexPending = new Set<string>()
let codexTimer: ReturnType<typeof setTimeout> | null = null

function openCodex(ids: string[]) {
  const fresh = ids.filter(id => !codexKnown.value.has(id))
  if (!fresh.length) return
  codexOpened.value = new Set([...codexOpened.value, ...fresh])
  for (const id of fresh) codexPending.add(id)
  codexTimer ??= setTimeout(flushCodex, 1500)
}

async function flushCodex() {
  codexTimer = null
  const ids = [...codexPending]
  codexPending = new Set()
  if (!ids.length) return
  try {
    await $fetch('/api/hackerz/codex', { method: 'POST', body: { ids } })
  } catch {
    // Only what the Database shows: keep them for the next batch rather than nag.
    for (const id of ids) codexPending.add(id)
  }
}

watch(armoury, value => openCodex(hackerzCodexFromArmoury(value)), { deep: true })

// ─── Saving ─────────────────────────────────────────────────────────────────

const revision = ref(0)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const savedAt = ref<Date | null>(null)

/**
 * Freezes the run. Only ever called from the uplink, which is the one moment the
 * game has no wave in flight and is therefore the one moment worth storing.
 */
async function saveRun() {
  if (phase.value !== 'shop' || !game) return
  saveState.value = 'saving'
  const save: HackerzRunSave = {
    version: HACKERZ_SAVE_VERSION,
    difficulty: difficultyId.value,
    wave: wave.value,
    credits: Math.round(credits.value),
    coins: Math.round(coins.value),
    kills: totalKills.value,
    wallHp: game.currentWallHp,
    armoury: armoury.value,
    bonusWave: bonusResolved.value
  }
  try {
    const result = await $fetch('/api/hackerz/run', {
      method: 'PUT',
      body: { revision: revision.value, save }
    })
    revision.value = result.revision
    savedAt.value = new Date(result.updatedAt)
    saveState.value = 'saved'
  } catch {
    saveState.value = 'error'
    pushNotice('Could not reach the uplink — progress is not saved.', 'bad')
  }
}

// ─── Live HUD state ─────────────────────────────────────────────────────────

const wallHp = ref(0)
const wallMaxHp = ref(0)
const shield = ref(0)
const shieldMax = ref(0)
const mag = ref(0)
const magSize = ref(0)
const reloadProgress = ref(1)
const waveMsLeft = ref(HACKERZ_WAVE_MS)
const alive = ref(0)
const pulseCharge = ref(0)
const pulseCooldown = ref(1)
const overclockCharge = ref(0)
const overclockCooldown = ref(1)
const overclockLeft = ref(0)
const chain = ref(0)
const chainMultiplier = ref(1)
const pingCharge = ref(1)
const pingCooldown = ref(1)
const pingReady = computed(() => pingCharge.value >= pingCooldown.value)

const notices = ref<{ id: number, text: string, kind: 'good' | 'bad' | 'info', inTerminal: boolean }[]>([])
let noticeSeq = 0

/**
 * Mid-wave, a notice is a big warning line in the syslog terminal; the floating
 * toast is kept only for screens too small to show the terminal, and for
 * notices outside a wave, when the terminal is not up.
 */
function pushNotice(text: string, kind: 'good' | 'bad' | 'info') {
  const id = noticeSeq++
  const inTerminal = phase.value === 'wave'
  if (inTerminal) {
    pushLog({ id: -1 - id, stamp: '>>', text, kind: kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : 'warn', big: true })
  }
  notices.value = [...notices.value, { id, text, kind, inTerminal }].slice(-3)
  setTimeout(() => { notices.value = notices.value.filter(n => n.id !== id) }, 3800)
}

// ── Syslog terminal: the defence's running commentary beside the board ──
// Only the tail is shown in the HUD; older lines fade off the top of the panel.
const LOG_KEEP = 14
const logLines = ref<SysLogLine[]>([])
const visibleLog = computed(() => logLines.value)
const logClass: Record<SysLogKind, string> = {
  bad: 'text-red-400',
  warn: 'text-amber-300',
  good: 'text-cyan-300',
  info: 'text-lime-300/70'
}
/** A notice promoted into the log: bold, a size up, on a tinted bar. */
const bigLogClass: Record<SysLogKind, string> = {
  bad: 'my-0.5 border-l-2 border-red-400 bg-red-500/15 pl-1 text-[11px] font-bold tracking-wide text-red-300',
  warn: 'my-0.5 border-l-2 border-amber-300 bg-amber-400/10 pl-1 text-[11px] font-bold tracking-wide',
  good: 'my-0.5 border-l-2 border-cyan-300 bg-cyan-400/10 pl-1 text-[11px] font-bold tracking-wide',
  info: 'my-0.5 border-l-2 border-lime-300 bg-lime-400/10 pl-1 text-[11px] font-bold tracking-wide'
}

function pushLog(line: SysLogLine) {
  logLines.value = [...logLines.value, line].slice(-LOG_KEEP)
}

const integrity = computed(() => wallMaxHp.value > 0 ? wallHp.value / wallMaxHp.value : 0)
const integrityColor = computed(() =>
  integrity.value > 0.55 ? 'bg-cyan-400' : integrity.value > 0.25 ? 'bg-amber-400' : 'bg-red-400')
const shieldPercent = computed(() => shieldMax.value > 0 ? shield.value / shieldMax.value * 100 : 0)
const timePercent = computed(() => waveMsLeft.value / roundMs.value * 100)
const secondsLeft = computed(() => Math.ceil(waveMsLeft.value / 1000))
const reloading = computed(() => reloadProgress.value < 1)
const pulseReady = computed(() => loadout.value.pulseUnlocked && pulseCharge.value >= pulseCooldown.value)
const pulsePercent = computed(() => Math.min(100, pulseCharge.value / Math.max(1, pulseCooldown.value) * 100))
const overclockActive = computed(() => overclockLeft.value > 0)
const overclockReady = computed(() =>
  loadout.value.overclockUnlocked && !overclockActive.value && overclockCharge.value >= overclockCooldown.value)
const overclockPercent = computed(() => overclockActive.value
  ? 100
  : Math.min(100, overclockCharge.value / Math.max(1, overclockCooldown.value) * 100))

/** Weapons the player owns, in catalogue order, for the HUD switcher. */
const ownedWeapons = computed(() =>
  HACKERZ_WEAPONS.filter(w => armoury.value.owned.includes(w.id)))

// ─── Engine wiring ──────────────────────────────────────────────────────────

const hackerzSound = useFirewallSound()
const { soundEnabled, soundVolume } = hackerzSound

let game: HackerzGame | null = null

onMounted(async () => {
  hackerzSound.preload()
  game = new HackerzGame({
    onWall: (hp, maxHp, sh, shMax) => {
      wallHp.value = hp
      wallMaxHp.value = maxHp
      shield.value = sh
      shieldMax.value = shMax
    },
    onAmmo: (loaded, size, progress) => {
      mag.value = loaded
      magSize.value = size
      reloadProgress.value = progress
    },
    onWaveTime: (msLeft, count) => {
      waveMsLeft.value = msLeft
      alive.value = count
    },
    onCredits: (delta) => { credits.value += delta },
    onCoins: (delta) => { coins.value += delta },
    onPulse: (charge, cooldown) => {
      pulseCharge.value = charge
      pulseCooldown.value = cooldown
    },
    onOverclock: (charge, cooldown, activeMs) => {
      overclockCharge.value = charge
      overclockCooldown.value = cooldown
      overclockLeft.value = activeMs
    },
    onWeapon: (id) => { armoury.value = { ...armoury.value, active: id } },
    onWaveEnd: onWaveEnd,
    onGameOver: (stats) => {
      totalKills.value = stats.kills
      settleRun('defeat')
    },
    onBoss: name => pushNotice(`${name} detected`, 'bad'),
    onSighted: id => openCodex([id]),
    onNotice: pushNotice,
    onSound: (event) => hackerzSound.play(event),
    onChain: (length, multiplier) => {
      chain.value = length
      chainMultiplier.value = multiplier
    },
    onPing: (charge, cooldown) => {
      pingCharge.value = charge
      pingCooldown.value = cooldown
    },
    onArm: (id) => { armed.value = id },
    onLog: pushLog,
    onDeploy: (id, left) => {
      armoury.value = { ...armoury.value, deployables: { ...hackerzStock(armoury.value), [id]: left } }
    }
  })
  if (host.value) await game.mount(host.value)
  // Dev only: lets a test harness step frames in a background tab, where rAF never fires.
  if (import.meta.dev) (window as unknown as { __hackerz?: HackerzGame | null }).__hackerz = game

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('fullscreenchange', syncFullscreen)
  window.addEventListener('keydown', onHotkey)
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)

  await refreshState()
  phase.value = 'lobby'
})

onBeforeUnmount(() => {
  // Database openings still waiting on their batch go up now.
  if (codexTimer) clearTimeout(codexTimer)
  void flushCodex()
  hackerzSound.stop()
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  window.removeEventListener('keydown', onHotkey)
  if (clockTimer) clearInterval(clockTimer)
  autopilot?.stop()
  autopilot = null
  game?.destroy()
  game = null
})

/** A wave that keeps running in a hidden tab is a wave you lose to nothing. */
function onVisibility() {
  if (!game || phase.value !== 'wave') return
  if (document.hidden) {
    paused.value = true
    game.pause()
  }
}

/** P or Escape pause and resume; 1-5 swap weapons mid-fight, at the cost of a short reload. */
function onHotkey(event: KeyboardEvent) {
  if (phase.value !== 'wave') return
  const key = event.key.toLowerCase()
  if (key === 'p' || key === 'escape') {
    // Escape also puts away an armed deployable; pausing on it is what it does first.
    event.preventDefault()
    togglePause()
    return
  }
  if (paused.value) return
  const index = Number(event.key) - 1
  if (!Number.isInteger(index) || index < 0) return
  const weapon = ownedWeapons.value[index]
  if (weapon) selectWeapon(weapon.id)
}

function selectWeapon(id: HackerzWeaponId) {
  if (!armoury.value.owned.includes(id) || armoury.value.active === id) return
  armoury.value = { ...armoury.value, active: id }
  game?.swapWeapon(hackerzWeaponRuntime(id, levels.value, effects.value))
}

function togglePause() {
  if (!game || phase.value !== 'wave') return
  paused.value = !paused.value
  if (paused.value) game.pause()
  else game.resume()
}

// ─── Run flow ───────────────────────────────────────────────────────────────

/** Loads a save — fresh from `start-run` or resumed — onto the field. */
function hydrate(save: HackerzRunSave, rev: number) {
  difficultyId.value = save.difficulty
  // Upgrades added since the save was written come back at level 0.
  armoury.value = { ...save.armoury, levels: { ...hackerzEmptyLevels(), ...save.armoury.levels }, deployables: hackerzStock(save.armoury) }
  bonusResolved.value = save.bonusWave ?? 0
  bonusActive.value = null
  armed.value = null
  credits.value = save.credits
  coins.value = save.coins
  wave.value = save.wave
  totalKills.value = save.kills
  revision.value = rev
  lastSummary.value = null
  payout.value = null
  notices.value = []
  logLines.value = []
  paused.value = false
  activeTab.value = 'rail'
  game?.startRun({ loadout: loadout.value, wallHp: save.wallHp, kills: save.kills })
  // Every run — new or resumed — lands in the uplink. A fresh deploy gets to
  // spend its starting credits before wave one, which is also what makes the
  // resume path exactly the same code path as the start path.
  phase.value = 'shop'
  saveState.value = 'saved'
}

async function startRun() {
  if (busy.value || isCoolingDown.value) return
  busy.value = true
  try {
    const result = await $fetch('/api/hackerz/start-run', {
      method: 'POST',
      body: { difficultyId: difficultyId.value }
    })
    hydrate(result.save, result.revision)
    await refreshState()
  } catch (error) {
    toast.add({
      title: 'Could not deploy',
      description: (error as { statusMessage?: string }).statusMessage ?? 'The uplink refused the run.',
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

function resumeRun() {
  const active = account.value?.activeRun
  if (!active?.save) return
  hydrate(active.save, active.revision ?? 0)
  savedAt.value = active.savedAt ? new Date(active.savedAt) : null
}

function deployNextWave() {
  if (!game || phase.value !== 'shop') return
  // Moving on answers any open bonus offer.
  bonusResolved.value = Math.max(bonusResolved.value, wave.value)
  wave.value += 1
  paused.value = false
  bonusActive.value = null
  roundMs.value = HACKERZ_WAVE_MS
  waveMsLeft.value = HACKERZ_WAVE_MS
  game.startWave(wave.value, loadout.value)
  phase.value = 'wave'
}

// ── Bonus rounds ──

const bonusOffer = computed(() =>
  hackerzBonusOffered(wave.value, bonusResolved.value) ? hackerzBonusEvent(wave.value) : null)
const activeEvent = computed(() => bonusActive.value ? hackerzNetworkEvent(bonusActive.value) : null)

/**
 * Plays the offered bonus round. The offer is marked answered and saved before
 * the round starts, so quitting mid-round does not bring it back.
 */
async function playBonus() {
  const event = bonusOffer.value
  if (!game || !event || phase.value !== 'shop') return
  bonusResolved.value = wave.value
  await saveRun()
  if (phase.value !== 'shop') return
  paused.value = false
  bonusActive.value = event.id
  roundMs.value = HACKERZ_BONUS_MS
  waveMsLeft.value = HACKERZ_BONUS_MS
  // Fought at the next wave's strength, without moving the wave counter.
  game.startWave(wave.value + 1, loadout.value, event.id)
  phase.value = 'wave'
}

/** Dev server only: the uplink grows a Debug button that opens the test tools. */
const isDev = import.meta.dev
const debugOpen = ref(false)
const DEBUG_BONUSES: { id: HackerzEventId, label: string }[] = [
  { id: 'ddos', label: 'DDoS' },
  { id: 'blackout', label: 'Blackout' },
  { id: 'packetloss', label: 'Packet loss' }
]
const DEBUG_BOSSES: { id: HackerzEnemyId, label: string }[] = [
  { id: 'titan', label: 'ROOTKIT' },
  { id: 'leviathan', label: 'BLACK ICE' },
  { id: 'zeroday', label: 'ZERO DAY' }
]

/** Dev server only: 100k run credits in hand, saved with the run. Credits never reach the site economy. */
async function debugCredits() {
  if (!isDev) return
  credits.value += 100_000
  if (phase.value === 'shop') await saveRun()
}

/**
 * Starts a bonus round for testing. It leaves the run's own bonus offer alone,
 * so it can be played as often as needed; the uplink still saves after it.
 */
function debugBonus(id: HackerzEventId) {
  if (!isDev || !game || phase.value !== 'shop') return
  paused.value = false
  bonusActive.value = id
  roundMs.value = HACKERZ_BONUS_MS
  waveMsLeft.value = HACKERZ_BONUS_MS
  game.startWave(wave.value + 1, loadout.value, id)
  phase.value = 'wave'
}

/**
 * Dev server only: a boss fight on demand. A wave at the next wave's strength
 * with the boss sent in at once, without moving the wave counter — and never
 * the last wave, so a test fight can never count as winning the run.
 */
function debugBoss(id: HackerzEnemyId) {
  if (!isDev || !game || phase.value !== 'shop') return
  paused.value = false
  bonusActive.value = null
  roundMs.value = HACKERZ_WAVE_MS
  waveMsLeft.value = HACKERZ_WAVE_MS
  game.startWave(Math.min(wave.value + 1, HACKERZ_MAX_WAVE - 1), loadout.value)
  game.debugSpawn(id)
  phase.value = 'wave'
}

// ── Auto-play with Laya (dev server) ──
// Laya, running on this machine, plays the run: it names the target and the
// abilities mid-wave, and picks every purchase at the uplink before deploying
// the next wave. Without Laya nothing happens; see `hackerz-autopilot`.

const layaUrl = useRuntimeConfig().public.layaUrl as string
const autopilotOn = ref(false)
const autopilotLine = ref('')
/** Laya's own terminal under the syslog: every call it makes, newest at the bottom. */
const layaLog = ref<{ id: number, stamp: string, text: string, offline: boolean }[]>([])
let layaLogId = 0
function pushLaya(text: string, offline = false) {
  const now = new Date()
  const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
  layaLog.value = [...layaLog.value, { id: ++layaLogId, stamp, text: text.replace(/^Laya: /, ''), offline }].slice(-LOG_KEEP)
}

/** From the Debug modal: start Laya (closing the modal, so the board is in view), or stop her. */
function activateLaya() {
  debugOpen.value = false
  toggleAutopilot(!autopilotOn.value)
}
let autopilot: HackerzAutopilot | null = null
/** Bumped whenever auto-play is switched, so a shopping trip from before stops. */
let autopilotRun = 0
/** Pause between purchases and before deploying, so the uplink can be watched. */
const AUTOPILOT_STEP_MS = 600
const AUTOPILOT_DEPLOY_MS = 1800
/** While Laya is down at the uplink, how long to wait before asking again. */
const AUTOPILOT_RETRY_MS = 3000

function toggleAutopilot(on: boolean) {
  autopilotRun += 1
  autopilotOn.value = on
  if (!on || !game) {
    autopilot?.stop()
    autopilot = null
    autopilotLine.value = ''
    return
  }
  layaLog.value = []
  pushLaya(`laya --play ${difficulty.value.name.toLowerCase()} --url ${layaUrl}`)
  autopilot = new HackerzAutopilot(game, layaUrl, (status) => {
    autopilotLine.value = status.line
    pushLaya(status.line, !status.online)
  }, {
    guns: () => weaponRows.value.filter(row => row.owned).map(row => ({
      id: row.def.id,
      name: row.def.name,
      tag: row.def.tag,
      damageType: row.def.damageType,
      dps: row.dps,
      multi: (row.runtime.chain ?? 0) > 0 || (row.runtime.splashRadius ?? 0) > 0 || (row.runtime.pellets ?? 1) > 1
    })),
    current: () => armoury.value.active,
    swap: id => selectWeapon(id as HackerzWeaponId)
  })
  autopilot.start()
  if (phase.value === 'shop') void autopilotShop()
}

/** Everything the uplink sells right now that Laya may pick, each with how to buy it. */
function autopilotOffers() {
  const offers: (HackerzAutopilotOffer & { buy: () => void })[] = []
  for (const row of weaponRows.value) {
    if (!row.affordable) continue
    offers.push({ key: `w_${row.def.id}`, text: `the ${row.def.name} gun, ${Math.round(row.dps)} dps (${row.def.cost} credits)`, buy: () => buyWeapon(row.def.id) })
  }
  const empty = armoury.value.turrets.findIndex(id => id === null)
  const unlocked = turretRows.value.filter(row => !row.locked).map(row => row.def)
  for (const def of unlocked) {
    if (empty >= 0 && credits.value >= def.cost) {
      offers.push({ key: `t_${def.id}`, text: `a ${def.name} turret on an empty mount (${def.cost} credits)`, buy: () => installTurret(empty, def.id) })
    }
  }
  // Swapping the weakest mounted turret for the best one unlocked.
  const best = unlocked.reduce<typeof unlocked[number] | null>((top, def) => !top || def.cost > top.cost ? def : top, null)
  const mounted = armoury.value.turrets
    .map((id, slot) => ({ id, slot }))
    .filter((m): m is { id: HackerzTurretId, slot: number } => !!m.id && m.id !== best?.id)
    .sort((a, b) => hackerzTurret(a.id).cost - hackerzTurret(b.id).cost)[0]
  if (best && mounted) {
    const refund = Math.round(hackerzTurret(mounted.id).cost * HACKERZ_TURRET_REFUND)
    if (credits.value + refund >= best.cost) {
      offers.push({ key: `r_${best.id}`, text: `swap a ${hackerzTurret(mounted.id).name} turret for a ${best.name} (${best.cost - refund} credits)`, buy: () => installTurret(mounted.slot, best.id) })
    }
  }
  if (canRepair.value) offers.push({ key: 'repair', text: `repair the wall back to full (${repairCost.value} credits)`, buy: buyRepair })
  for (const row of deployableRows.value) {
    if (!row.affordable) continue
    offers.push({ key: `d_${row.def.id}`, text: `a ${row.def.name}, ${row.owned} in stock: ${row.def.description} (${row.cost} credits)`, buy: () => buyDeployable(row.def.id) })
  }
  for (const row of shopRows.value) {
    if (!row.affordable || (row.def.weapon && !armoury.value.owned.includes(row.def.weapon))) continue
    offers.push({ key: `u_${row.def.id}`, text: `${row.def.name} to ${row.next} (${row.cost} credits)`, buy: () => buy(row.def.id) })
  }
  return offers.slice(0, AUTOPILOT_OFFERS)
}
const AUTOPILOT_OFFERS = 14

/** At the uplink: buy what Laya picks, one at a time, until nothing is affordable, then deploy. */
async function autopilotShop() {
  const run = autopilotRun
  const live = () => run === autopilotRun && autopilotOn.value && phase.value === 'shop' && !!autopilot
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  await wait(AUTOPILOT_STEP_MS)
  for (let n = 0; n < 40 && live(); n++) {
    const offers = autopilotOffers()
    if (!offers.length) break
    const held = game?.autopilotView().view.held ?? 0
    const { online, pick } = await autopilot!.pickPurchase({
      nextWave: nextWave.value,
      wall: integrity.value,
      credits: credits.value,
      gun: hackerzWeapon(armoury.value.active).name,
      mounts: armoury.value.turrets.length,
      filled: armoury.value.turrets.filter(Boolean).length,
      held,
      nodes: 8
    }, offers)
    if (!live()) return
    // Laya down: the uplink waits and asks again (the player can still buy and deploy).
    if (!online) {
      await wait(AUTOPILOT_RETRY_MS)
      n -= 1
      continue
    }
    // Laya answered without naming a purchase: done shopping.
    if (!pick) break
    offers.find(offer => offer.key === pick.key)?.buy()
    await wait(AUTOPILOT_STEP_MS)
  }
  if (!live()) return
  // A bonus round on offer: Laya takes it or leaves it. Once it is over the
  // uplink opens again, the offer answered, and this runs again to deploy.
  while (bonusOffer.value && live()) {
    const event = bonusOffer.value
    const take = await autopilot!.decideBonus({
      name: event.name,
      tagline: event.tagline,
      failBelow: HACKERZ_BONUS_PASS_INTEGRITY,
      multiplier: HACKERZ_BONUS_MULTIPLIER,
      seconds: HACKERZ_BONUS_MS / 1000
    }, integrity.value, nextWave.value)
    if (take === null) {
      await wait(AUTOPILOT_RETRY_MS)
      continue
    }
    if (!live()) return
    if (take) {
      await wait(AUTOPILOT_STEP_MS)
      if (live()) await playBonus()
      return
    }
    break
  }
  if (!live()) return
  autopilot!.say(`Laya: deploying wave ${nextWave.value}`)
  await saveRun()
  await wait(AUTOPILOT_DEPLOY_MS)
  if (live()) deployNextWave()
}

watch(phase, (value) => {
  if (!autopilotOn.value) return
  if (value === 'shop') void autopilotShop()
  // A run that is over has nothing left to play.
  if (value === 'over' || value === 'won' || value === 'lobby') toggleAutopilot(false)
})

async function skipBonus() {
  if (!bonusOffer.value) return
  bonusResolved.value = wave.value
  await saveRun()
}

async function onWaveEnd(summary: HackerzWaveSummary) {
  lastSummary.value = summary
  bonusActive.value = null
  armed.value = null
  // The engine reports kills per wave and seeds its own running total from the
  // save, so accumulating here is what keeps the two in step across a resume.
  totalKills.value += summary.kills
  phase.value = 'shop'
  await saveRun()
  if (summary.victory) await settleRun('victory')
}

/**
 * Ends the run for good and banks the coins.
 *
 * The server settles from the stored save, not from anything sent here, so a run
 * that dies mid-wave banks what the last uplink saved and forfeits the wave it
 * was on. That is the stake the save points buy: retiring from the uplink is
 * always safe, and pushing one more wave is always a bet.
 */
async function settleRun(reason: 'victory' | 'defeat' | 'retire') {
  if (busy.value) return
  busy.value = true
  try {
    const result = await $fetch('/api/hackerz/finish-run', { method: 'POST', body: { reason } })
    payout.value = {
      awarded: result.awarded,
      capped: result.capped,
      victory: result.victory,
      wave: result.wave,
      kills: result.kills,
      lostWave: reason === 'defeat' && coins.value > result.awarded && !result.capped
    }
    phase.value = result.victory ? 'won' : 'over'
    // The balance moved server-side, so the header has to be told.
    await Promise.all([fetchSession(), refreshState()])
  } catch (error) {
    toast.add({
      title: 'Could not settle the run',
      description: (error as { statusMessage?: string }).statusMessage ?? 'Try again in a moment.',
      color: 'error'
    })
    phase.value = 'over'
  } finally {
    busy.value = false
  }
}

function backToLobby() {
  phase.value = 'lobby'
  payout.value = null
}

// ─── Uplink ─────────────────────────────────────────────────────────────────

const tabs: { id: HackerzTab, label: string, icon: string }[] = [
  { id: 'rail', label: 'Rail', icon: 'i-lucide-crosshair' },
  { id: 'turrets', label: 'Turrets', icon: 'i-lucide-cpu' },
  { id: 'bastion', label: 'Bastion', icon: 'i-lucide-shield' },
  { id: 'systems', label: 'Systems', icon: 'i-lucide-radio' }
]
const activeTab = ref<HackerzTab>('rail')
/** The threat and hardening database, opened from the uplink or the Mainframe. */
const codexOpen = ref(false)

const shopRows = computed(() => HACKERZ_UPGRADES.map((def) => {
  const level = levels.value[def.id]
  const max = hackerzUpgradeMax(def, effects.value.startingMounts)
  const maxed = level >= max
  const cost = hackerzUpgradeCost(def, level)
  return {
    def,
    level,
    max,
    maxed,
    cost,
    affordable: !maxed && credits.value >= cost,
    current: def.value(level),
    next: maxed ? null : def.value(level + 1)
  }
}))

// A gun's own upgrade (Superconductor for the Tesla Coil) is offered once that gun is owned.
const tabRows = computed(() => shopRows.value.filter(row => row.def.tab === activeTab.value
  && (!row.def.weapon || armoury.value.owned.includes(row.def.weapon))))

function buy(id: HackerzUpgradeId) {
  const def = HACKERZ_UPGRADES.find(u => u.id === id)
  if (!def) return
  const level = levels.value[id]
  if (level >= hackerzUpgradeMax(def, effects.value.startingMounts)) return
  const cost = hackerzUpgradeCost(def, level)
  if (credits.value < cost) return
  credits.value -= cost

  const next = { ...armoury.value, levels: { ...levels.value, [id]: level + 1 } }
  // A Spire level adds a mount, so the slot array has to grow with it or the new
  // mount exists in the shop and nowhere else.
  if (id === 'spire') {
    const slots = hackerzSlots(level + 1, effects.value.startingMounts)
    next.turrets = Array.from({ length: slots }, (_, i) => next.turrets[i] ?? null)
  }
  armoury.value = next
}

// ── Weapons ──

/**
 * The next wave is what a purchase is for, so gates read against it — buying the
 * Longbore in the uplink before wave 14 puts it on the wall *for* wave 14.
 */
const nextWave = computed(() => wave.value + 1)
const nextIsBoss = computed(() => hackerzIsBossWave(nextWave.value))
const isFinalWave = computed(() => nextWave.value >= HACKERZ_MAX_WAVE)

const weaponRows = computed(() => HACKERZ_WEAPONS.map((def) => {
  const owned = armoury.value.owned.includes(def.id)
  const runtime = hackerzWeaponRuntime(def.id, levels.value, effects.value)
  const unlockWave = hackerzWeaponUnlockWave(def, effects.value.arsenal)
  const locked = !owned && nextWave.value < unlockWave
  return {
    def,
    owned,
    locked,
    unlockWave,
    active: armoury.value.active === def.id,
    affordable: !owned && !locked && credits.value >= def.cost,
    dps: runtime.damage * runtime.pellets / (runtime.fireIntervalMs / 1000),
    runtime
  }
}))

function buyWeapon(id: HackerzWeaponId) {
  const row = weaponRows.value.find(r => r.def.id === id)
  if (!row || row.locked) return
  if (row.owned) {
    selectWeapon(id)
    return
  }
  const def = hackerzWeapon(id)
  if (credits.value < def.cost) return
  credits.value -= def.cost
  armoury.value = { ...armoury.value, owned: [...armoury.value.owned, id], active: id }
}

// ── Turret mounts ──

const turretRows = computed(() => HACKERZ_TURRETS.map(def => ({
  def,
  locked: nextWave.value < def.unlockWave
})))

const mountRows = computed(() => armoury.value.turrets.map((id, slot) => ({
  slot,
  installed: id ? hackerzTurret(id) : null
})))

function installTurret(slot: number, id: HackerzTurretId) {
  const row = turretRows.value.find(r => r.def.id === id)
  if (!row || row.locked) return
  const def = row.def
  const current = armoury.value.turrets[slot] ?? null
  if (current === id) return
  const refund = current ? Math.round(hackerzTurret(current).cost * HACKERZ_TURRET_REFUND) : 0
  if (credits.value + refund < def.cost) return
  credits.value += refund - def.cost
  const turrets = [...armoury.value.turrets]
  turrets[slot] = id
  armoury.value = { ...armoury.value, turrets }
}

function clearMount(slot: number) {
  const current = armoury.value.turrets[slot]
  if (!current) return
  credits.value += Math.round(hackerzTurret(current).cost * HACKERZ_TURRET_REFUND)
  const turrets = [...armoury.value.turrets]
  turrets[slot] = null
  armoury.value = { ...armoury.value, turrets }
}

// ── Deployables ──

const stock = computed(() => hackerzStock(armoury.value))

const deployableRows = computed(() => HACKERZ_DEPLOYABLES.map((def) => {
  const owned = stock.value[def.id]
  const cost = hackerzDeployableCost(def, nextWave.value)
  const full = owned >= HACKERZ_DEPLOYABLE_MAX
  return { def, owned, cost, full, affordable: !full && credits.value >= cost }
}))

function buyDeployable(id: HackerzDeployableId) {
  const row = deployableRows.value.find(r => r.def.id === id)
  if (!row || !row.affordable) return
  credits.value -= row.cost
  armoury.value = { ...armoury.value, deployables: { ...stock.value, [id]: row.owned + 1 } }
}

function armDeployable(id: HackerzDeployableId) {
  game?.arm(armed.value === id ? null : id)
}

const missingHp = computed(() => Math.max(0, wallMaxHp.value - wallHp.value))
const repairCost = computed(() => hackerzRepairCost(missingHp.value))
const canRepair = computed(() => missingHp.value > 4 && credits.value >= repairCost.value)

function buyRepair() {
  if (!game || !canRepair.value) return
  credits.value -= repairCost.value
  game.repairWall()
}

// ─── Mainframe ──────────────────────────────────────────────────────────────

async function buyMainframe(id: HackerzMainframeId) {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch('/api/hackerz/upgrade', { method: 'POST', body: { upgradeId: id } })
    await Promise.all([fetchSession(), refreshState()])
  } catch (error) {
    toast.add({
      title: 'Purchase failed',
      description: (error as { statusMessage?: string }).statusMessage ?? 'Not enough coins.',
      color: 'error'
    })
  } finally {
    busy.value = false
  }
}

// ─── Fullscreen ─────────────────────────────────────────────────────────────

const isFullscreen = ref(false)

function syncFullscreen() {
  isFullscreen.value = document.fullscreenElement === shell.value
}

async function toggleFullscreen() {
  // Either call rejects if the browser dislikes the gesture it came from, and a
  // rejected promise here is noise the player cannot act on.
  if (isFullscreen.value) await document.exitFullscreen().catch(() => {})
  else await shell.value?.requestFullscreen().catch(() => {})
}
</script>

<template>
  <div class="p-4 sm:p-6 max-w-[1500px] mx-auto">
    <div class="flex items-center justify-between gap-4 mb-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">
          HACKERZ
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Hold the core for {{ HACKERZ_MAX_WAVE }} waves. The uplink opens between each one — and saves.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-2.5 py-1.5 text-xs">
          <UButton
            :icon="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
            color="neutral"
            variant="ghost"
            size="xs"
            :title="soundEnabled ? 'Mute audio' : 'Unmute audio'"
            @click="soundEnabled = !soundEnabled; if (soundEnabled) hackerzSound.unlock()"
          />
          <USlider
            v-model="soundVolume"
            :min="0"
            :max="100"
            :disabled="!soundEnabled"
            size="xs"
            class="w-20 sm:w-28"
            aria-label="Sound volume"
          />
          <span class="w-8 text-right font-mono text-[11px] text-muted">{{ soundVolume }}%</span>
        </div>
        <UButton
          v-if="phase === 'wave'"
          :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
          color="neutral"
          variant="subtle"
          @click="togglePause"
        />
        <UButton
          :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
          color="neutral"
          variant="subtle"
          @click="toggleFullscreen"
        />
      </div>
    </div>

    <div
      ref="shell"
      class="relative w-full overflow-hidden rounded-xl border border-default bg-black"
      :class="isFullscreen ? 'flex items-center justify-center h-screen rounded-none' : ''"
    >
      <div
        ref="host"
        class="relative w-full aspect-[16/9] cursor-crosshair"
        :class="isFullscreen ? 'max-h-screen' : ''"
      />

      <!-- ── HUD ─────────────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'wave' || phase === 'shop'"
        class="pointer-events-none absolute inset-0 p-3 sm:p-4 flex flex-col justify-between"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-2">
            <div class="w-56 sm:w-72 rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 p-2.5">
              <div class="flex items-baseline justify-between text-[11px] uppercase tracking-widest text-white/50">
                <span>Integrity</span>
                <span class="font-mono text-white/80">{{ Math.round(wallHp) }} / {{ wallMaxHp }}</span>
              </div>
              <div class="mt-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class="h-full transition-[width] duration-150"
                  :class="integrityColor"
                  :style="{ width: `${integrity * 100}%` }"
                />
              </div>
              <div v-if="shieldMax > 0" class="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class="h-full bg-sky-300/80 transition-[width] duration-150"
                  :style="{ width: `${shieldPercent}%` }"
                />
              </div>
            </div>

            <!-- Syslog terminal: the defence's running commentary, newest at the bottom. -->
            <div
              v-if="phase === 'wave'"
              class="hidden sm:block w-72 h-36 lg:h-52 rounded-lg bg-black/45 backdrop-blur-sm border border-white/10 overflow-hidden font-mono text-[10px] leading-snug"
            >
              <div class="truncate border-b border-white/10 px-2 py-1 text-[9px] tracking-wider text-lime-300/60">
                root@firewall:~# tail -f /var/log/intrusion
              </div>
              <div class="flex h-[calc(100%-1.45rem)] flex-col justify-end overflow-hidden px-2 py-1 [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
                <p
                  v-for="line in visibleLog"
                  :key="line.id"
                  class="break-words"
                  :class="[logClass[line.kind], line.big ? bigLogClass[line.kind] : '']"
                >
                  <span class="text-white/25">{{ line.stamp }}</span> {{ line.big ? line.text.toUpperCase() : line.text }}
                </p>
              </div>
            </div>

            <!-- Laya's terminal: every call auto-play makes, newest at the bottom. -->
            <div
              v-if="autopilotOn"
              class="hidden sm:block mt-2 w-72 h-36 rounded-lg bg-black/45 backdrop-blur-sm border border-primary/30 overflow-hidden font-mono text-[10px] leading-snug"
            >
              <div class="flex items-center gap-1 truncate border-b border-primary/20 px-2 py-1 text-[9px] tracking-wider text-primary/70">
                <UIcon name="i-lucide-bot" class="size-3" /> laya@uplink:~$ tail -f /var/log/laya
              </div>
              <div class="flex h-[calc(100%-1.45rem)] flex-col justify-end overflow-hidden px-2 py-1 [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
                <p
                  v-for="line in layaLog"
                  :key="line.id"
                  class="break-words"
                  :class="line.offline ? 'text-red-400' : 'text-primary'"
                >
                  <span class="text-white/25">{{ line.stamp }}</span> {{ line.text }}
                </p>
              </div>
            </div>
          </div>

          <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 text-center">
            <div
              v-if="activeEvent && phase === 'wave'"
              class="text-[11px] font-bold uppercase tracking-widest"
              :style="{ color: `#${activeEvent.hex.toString(16).padStart(6, '0')}` }"
            >
              Bonus · {{ activeEvent.name }}
            </div>
            <div v-else class="text-[11px] uppercase tracking-widest text-white/50">
              Wave {{ wave }} / {{ HACKERZ_MAX_WAVE }}
            </div>
            <div class="font-mono text-2xl font-bold" :class="secondsLeft <= 8 ? 'text-amber-300' : 'text-white'">
              {{ phase === 'wave' ? secondsLeft : 0 }}s
            </div>
            <div class="mt-1 h-1 w-28 rounded-full bg-white/10 overflow-hidden">
              <div class="h-full bg-cyan-400" :style="{ width: `${timePercent}%` }" />
            </div>
            <div class="mt-1 text-[11px] text-white/45">
              {{ alive }} hostile{{ alive === 1 ? '' : 's' }}
            </div>
            <div
              v-if="chain >= 2"
              class="mt-1 font-mono text-xs font-bold text-lime-300"
              :class="chain >= 25 ? 'text-sm' : ''"
            >
              CHAIN {{ chain }} · ×{{ chainMultiplier.toFixed(2) }}
            </div>
          </div>

          <div class="w-40 sm:w-52 rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 p-2.5 text-right">
            <div class="text-[11px] uppercase tracking-widest text-white/50">
              Credits
            </div>
            <div class="font-mono text-xl font-bold text-lime-300">
              {{ formatNumber(credits, false) }}
            </div>
            <div class="mt-1 flex items-center justify-end gap-1 text-[11px] text-amber-300/90">
              <UIcon name="i-lucide-coins" class="size-3" />
              <span class="font-mono">{{ formatNumber(coins) }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-end justify-between gap-3">
          <div class="flex items-end gap-2">
            <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2">
              <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/50">
                {{ loadout.weapon.name }}
                <span
                  class="font-mono"
                  :class="loadout.weapon.damageType === 'kinetic' ? 'text-amber-300' : 'text-cyan-300'"
                >{{ loadout.weapon.damageType }}</span>
              </div>
              <div v-if="reloading" class="mt-1 w-32">
                <div class="text-xs text-amber-300 font-mono">
                  RELOADING
                </div>
                <div class="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div class="h-full bg-amber-300" :style="{ width: `${reloadProgress * 100}%` }" />
                </div>
              </div>
              <div v-else class="mt-1 flex flex-wrap gap-0.5 w-32">
                <span
                  v-for="i in magSize"
                  :key="i"
                  class="h-3.5 w-1.5 rounded-sm"
                  :class="i <= mag ? 'bg-cyan-300' : 'bg-white/15'"
                />
              </div>
            </div>

            <!-- Weapon switcher: the one HUD control that is interactive. -->
            <div v-if="ownedWeapons.length > 1" class="pointer-events-auto flex gap-1">
              <button
                v-for="(weapon, index) in ownedWeapons"
                :key="weapon.id"
                type="button"
                class="rounded-md border px-2 py-1.5 text-[11px] font-mono transition-colors"
                :class="armoury.active === weapon.id
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-200'
                  : 'border-white/15 bg-black/55 text-white/60 hover:text-white'"
                @click="selectWeapon(weapon.id)"
              >
                {{ index + 1 }}
              </button>
            </div>
          </div>

          <!-- Deploy bar: Z/X/C arm, a click places. -->
          <div v-if="phase === 'wave'" class="pointer-events-auto flex gap-1.5">
            <button
              v-for="row in deployableRows"
              :key="row.def.id"
              type="button"
              :disabled="row.owned <= 0"
              class="relative w-14 rounded-lg border px-1.5 py-1.5 text-center backdrop-blur-sm transition-colors"
              :class="armed === row.def.id
                ? 'border-lime-300 bg-lime-300/20'
                : row.owned > 0
                  ? 'border-white/15 bg-black/55 hover:bg-white/10'
                  : 'border-white/10 bg-black/40 opacity-40'"
              :title="`${row.def.name} — ${row.def.description}`"
              @click="armDeployable(row.def.id)"
            >
              <UIcon
                :name="row.def.icon"
                class="size-5"
                :style="{ color: `#${row.def.hex.toString(16).padStart(6, '0')}` }"
              />
              <div class="font-mono text-[10px] text-white/60">
                {{ row.def.key }} · {{ row.owned }}
              </div>
            </button>
          </div>

          <div class="flex items-end gap-2">
            <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 w-28">
              <div class="flex items-center justify-between text-[11px] uppercase tracking-widest">
                <span class="text-white/50">RMB</span>
                <span :class="pingReady ? 'text-lime-300' : 'text-white/40'">
                  {{ pingReady ? 'PING' : '···' }}
                </span>
              </div>
              <div class="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class="h-full"
                  :class="pingReady ? 'bg-lime-300' : 'bg-lime-300/40'"
                  :style="{ width: `${Math.min(100, pingCharge / Math.max(1, pingCooldown) * 100)}%` }"
                />
              </div>
            </div>
            <div
              v-if="loadout.overclockUnlocked"
              class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 w-28"
            >
              <div class="flex items-center justify-between text-[11px] uppercase tracking-widest">
                <span class="text-white/50">Q</span>
                <span :class="overclockActive ? 'text-orange-300' : overclockReady ? 'text-amber-300' : 'text-white/40'">
                  {{ overclockActive ? 'ON' : overclockReady ? 'READY' : '···' }}
                </span>
              </div>
              <div class="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class="h-full"
                  :class="overclockActive ? 'bg-orange-400' : overclockReady ? 'bg-amber-300' : 'bg-amber-300/40'"
                  :style="{ width: `${overclockPercent}%` }"
                />
              </div>
            </div>

            <div
              v-if="loadout.pulseUnlocked"
              class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 w-28"
            >
              <div class="flex items-center justify-between text-[11px] uppercase tracking-widest">
                <span class="text-white/50">Space</span>
                <span :class="pulseReady ? 'text-cyan-300' : 'text-white/40'">
                  {{ pulseReady ? 'READY' : '···' }}
                </span>
              </div>
              <div class="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class="h-full"
                  :class="pulseReady ? 'bg-cyan-300' : 'bg-cyan-300/40'"
                  :style="{ width: `${pulsePercent}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 flex flex-col items-center gap-1">
        <div
          v-for="notice in notices"
          :key="notice.id"
          class="rounded-md px-3 py-1 text-xs font-medium backdrop-blur-sm border"
          :class="[notice.inTerminal ? 'sm:hidden' : '', notice.kind === 'bad'
            ? 'bg-red-950/70 border-red-500/40 text-red-200'
            : notice.kind === 'good'
              ? 'bg-lime-950/70 border-lime-500/40 text-lime-200'
              : 'bg-black/60 border-white/15 text-white/80']"
        >
          {{ notice.text }}
        </div>
      </div>

      <!-- ── Paused ──────────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'wave' && paused"
        class="absolute inset-0 grid place-items-center bg-black/70 backdrop-blur-sm"
      >
        <div class="text-center">
          <div class="text-3xl font-bold tracking-widest text-white">
            PAUSED
          </div>
          <UButton class="mt-4" icon="i-lucide-play" color="primary" @click="togglePause">
            Resume
          </UButton>
        </div>
      </div>

      <!-- ── Loading ─────────────────────────────────────────────────────── -->
      <div v-if="phase === 'loading'" class="absolute inset-0 grid place-items-center bg-black/85">
        <UIcon name="i-lucide-loader-circle" class="size-8 animate-spin text-cyan-300" />
      </div>

      <!-- ── Lobby: difficulty, Mainframe, resume ────────────────────────── -->
      <div
        v-else-if="phase === 'lobby'"
        class="hz-console absolute inset-0 flex flex-col"
      >
        <div class="flex items-center justify-between gap-4 border-b border-cyan-400/15 px-4 py-3">
          <div>
            <div class="flex items-center gap-3">
              <div class="hz-title text-2xl">
                HACKERZ
              </div>
              <button type="button" class="hz-tab" @click="codexOpen = true">
                <UIcon name="i-lucide-database" class="size-3.5" /> Database
              </button>
              <UButton v-if="isDev" color="warning" variant="outline" size="xs" icon="i-lucide-bug" @click="debugOpen = true">
                Debug
              </UButton>
              <UBadge
                v-if="isCoolingDown"
                :label="`Recharging ${cooldownLabel}`"
                icon="i-lucide-battery-charging"
                color="warning"
                variant="subtle"
              />
            </div>
            <p class="text-[11px] text-white/50 mt-0.5">
              Click or hold to fire · hold on a hostile to track it · RMB radar ping · Z/X/C/M deploy · V portscan · B blip · N white hat · R reload · 1-5 swap · Space pulse · Q overclock · P/Esc pause
            </p>
          </div>
          <div class="flex items-center gap-4 text-right">
            <div>
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Best wave
              </div>
              <div class="font-mono text-lg font-bold text-white">
                {{ bestWave }}
              </div>
            </div>
            <div>
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Banked
              </div>
              <div class="font-mono text-lg font-bold text-amber-300">
                {{ formatNumber(Number(account?.stats.totalCoinsEarned ?? 0)) }}
              </div>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- A run in progress takes priority over starting a new one. -->
          <div
            v-if="account?.activeRun?.save"
            class="hz-card hz-card--active !p-3 flex items-center justify-between gap-4"
          >
            <div>
              <div class="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                <UIcon name="i-lucide-save" class="size-4" />
                Run in progress — wave {{ account.activeRun.save.wave }} cleared
              </div>
              <div class="mt-0.5 font-mono text-[11px] text-white/50">
                {{ hackerzDifficulty(account.activeRun.save.difficulty).name }} ·
                {{ formatNumber(account.activeRun.save.credits, false) }} credits ·
                {{ formatNumber(account.activeRun.save.coins) }} coins banked
              </div>
            </div>
            <UButton color="primary" size="lg" icon="i-lucide-play" @click="resumeRun">
              Resume
            </UButton>
          </div>

          <div v-else-if="isCoolingDown" class="hz-card hz-card--warn !p-4 text-center">
            <p class="flex items-center justify-center gap-2 font-black text-warning">
              <UIcon name="i-lucide-battery-charging" class="size-5" /> UPLINK RECHARGING
            </p>
            <p class="mt-1 text-sm text-muted">
              The uplink is recharging after your last run. Next run in <span class="font-black tabular-nums text-highlighted">{{ cooldownLabel }}</span>.
            </p>
            <UButton
              class="mt-3"
              color="secondary"
              variant="subtle"
              icon="i-lucide-gem"
              :loading="rushingCooldown"
              :disabled="gems < cooldownRushCost"
              @click="rushCooldown"
            >
              Clear recharge · {{ cooldownRushCost }} gem{{ cooldownRushCost === 1 ? '' : 's' }}
            </UButton>
            <p v-if="gems < cooldownRushCost" class="mt-2 text-xs text-muted">
              Need {{ cooldownRushCost }} gems; you have {{ gems }}.
            </p>
            <p v-else class="mt-2 text-xs text-muted">
              1 gem per started 10 minutes remaining.
            </p>
          </div>

          <div v-else>
            <div class="hz-label mb-2">
              // threat level — coins scale with it, and so does everything trying to get in
            </div>
            <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="entry in account?.difficulties ?? []"
                :key="entry.id"
                type="button"
                :disabled="!entry.unlocked"
                class="hz-card"
                :class="difficultyId === entry.id
                  ? 'hz-card--active'
                  : entry.unlocked ? 'hz-card--owned' : 'hz-card--locked'"
                @click="difficultyId = entry.id"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-bold" :style="{ color: entry.color }">{{ entry.name }}</span>
                  <span v-if="!entry.unlocked" class="font-mono text-[10px] text-white/40">
                    <UIcon name="i-lucide-lock" class="size-3" /> w{{ entry.requiredBestWave }}
                  </span>
                </div>
                <p class="mt-1 text-[11px] text-white/50 leading-snug">
                  {{ entry.tagline }}
                </p>
                <div class="mt-2 font-mono text-[11px] text-white/60">
                  <span class="text-amber-300">×{{ entry.reward }} coins</span>
                  · ×{{ entry.enemyHp }} HP<template v-if="entry.enemyHp > 1"> by wave {{ HACKERZ_DIFFICULTY_FULL_WAVE }}</template>
                </div>
              </button>
            </div>
            <UButton
              class="mt-4"
              size="xl"
              icon="i-lucide-power"
              color="primary"
              :loading="busy"
              @click="startRun"
            >
              Deploy — {{ difficulty.name }}
            </UButton>
          </div>

          <!-- The Mainframe: permanent, coin-bought, offline during a run. -->
          <div>
            <div class="flex items-baseline justify-between gap-3 mb-2">
              <div class="hz-label">
                // mainframe — permanent, bought with coins
              </div>
              <div class="font-mono text-sm font-bold text-amber-300">
                {{ formatNumber(Number(account?.balance ?? 0)) }}
              </div>
            </div>
            <p v-if="account?.activeRun" class="mb-2 text-[11px] text-white/40">
              Offline while a run is in progress. Finish or retire first.
            </p>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div
                v-for="entry in account?.mainframe ?? []"
                :key="entry.id"
                class="hz-bloom grid"
                :class="{ 'hz-bloom--dim': entry.cost === null || !!account?.activeRun || Number(account?.balance ?? 0) < entry.cost }"
              >
              <button
                type="button"
                :disabled="busy || !!account?.activeRun || entry.cost === null
                  || Number(account?.balance ?? 0) < entry.cost"
                class="hz-card"
                :class="entry.cost === null
                  ? 'hz-card--off'
                  : !account?.activeRun && Number(account?.balance ?? 0) >= entry.cost
                    ? 'hz-card--gold'
                    : 'hz-card--locked'"
                @click="buyMainframe(entry.id)"
              >
                <div class="flex items-center gap-2">
                  <UIcon :name="entry.icon" class="hz-glow-gold size-4 shrink-0 text-amber-300" />
                  <span class="hz-glow-text text-sm font-semibold text-white truncate">{{ entry.name }}</span>
                  <span class="hz-glow-gold ml-auto font-mono text-[11px] shrink-0 text-amber-300">
                    {{ entry.cost === null ? 'MAX' : formatNumber(entry.cost) }}
                  </span>
                </div>
                <p class="hz-glow-text mt-1 text-[11px] text-white/45 leading-snug">
                  {{ entry.description }}
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <span class="hz-glow-text font-mono text-[10px] text-white/40">{{ entry.level }}/{{ entry.max }}</span>
                  <div class="flex flex-1 flex-wrap gap-0.5">
                    <span
                      v-for="i in entry.max"
                      :key="i"
                      class="hz-pip"
                      :class="{ 'hz-pip--gold': i <= entry.level }"
                    />
                  </div>
                </div>
                <div class="hz-glow-text mt-1 font-mono text-[11px] text-white/60 truncate">
                  {{ entry.next ?? entry.current }}
                </div>
              </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Uplink ──────────────────────────────────────────────────────── -->
      <div
        v-else-if="phase === 'shop'"
        class="hz-console absolute inset-0 flex flex-col"
      >
        <div class="flex items-center justify-between gap-4 border-b border-cyan-400/15 px-4 py-2.5">
          <div class="flex items-center gap-3">
            <div class="flex flex-col leading-tight">
              <span class="hz-title text-lg">UPLINK</span>
              <span class="hz-prompt hidden lg:inline">root@uplink:~$ ./deploy --wave {{ nextWave }}</span>
            </div>
            <button type="button" class="hz-tab" @click="codexOpen = true">
              <UIcon name="i-lucide-database" class="size-3.5" /> Database
            </button>
            <span
              v-if="lastSummary?.bonus"
              class="text-xs font-mono font-bold"
              :class="lastSummary.passed ? 'text-lime-300' : 'text-red-300'"
            >
              {{ lastSummary.passed ? `BONUS ×${HACKERZ_BONUS_MULTIPLIER}` : 'BONUS FAILED' }}
              · {{ lastSummary.kills }} kills · +{{ lastSummary.credits }}c
            </span>
            <span v-else-if="lastSummary" class="text-xs text-white/45 font-mono">
              w{{ lastSummary.wave }} · {{ lastSummary.kills }} kills · +{{ lastSummary.credits }}c
              · +{{ formatNumber(lastSummary.coins) }} coins
            </span>
            <!-- The whole point of the uplink phase: it is where the run is safe. -->
            <span
              class="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium"
              :class="saveState === 'saved'
                ? 'border-lime-500/40 bg-lime-950/60 text-lime-200'
                : saveState === 'saving'
                  ? 'border-white/15 bg-black/60 text-white/60'
                  : 'border-red-500/40 bg-red-950/60 text-red-200'"
            >
              <UIcon
                :name="saveState === 'saving' ? 'i-lucide-loader-circle'
                  : saveState === 'saved' ? 'i-lucide-check' : 'i-lucide-triangle-alert'"
                class="size-3.5"
                :class="saveState === 'saving' ? 'animate-spin' : ''"
              />
              {{ saveState === 'saved' ? 'Progress saved — you can leave'
                : saveState === 'saving' ? 'Saving…' : 'Not saved' }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right leading-none">
              <div class="font-mono text-xl font-bold text-lime-300">
                {{ formatNumber(credits, false) }}
              </div>
              <div class="font-mono text-[11px] text-amber-300/90">
                {{ formatNumber(coins) }} coins
              </div>
            </div>
            <UButton v-if="isDev" color="warning" variant="outline" size="xs" icon="i-lucide-bug" @click="debugOpen = true">
              Debug
            </UButton>
            <UButton
              color="neutral"
              variant="subtle"
              size="sm"
              icon="i-lucide-door-open"
              :loading="busy"
              @click="settleRun('retire')"
            >
              Retire
            </UButton>
            <UButton
              :color="canRepair ? 'warning' : 'neutral'"
              variant="subtle"
              size="sm"
              icon="i-lucide-wrench"
              :disabled="!canRepair"
              @click="buyRepair"
            >
              {{ Math.round(missingHp) }} HP · {{ repairCost }}
            </UButton>
            <UButton
              size="lg"
              :color="isFinalWave || nextIsBoss ? 'error' : 'primary'"
              trailing-icon="i-lucide-chevron-right"
              @click="deployNextWave"
            >
              Wave {{ nextWave }}{{ isFinalWave ? ' · FINAL' : nextIsBoss ? ' · BOSS' : '' }}
            </UButton>
          </div>
        </div>

        <div class="flex items-center gap-1 border-b border-cyan-400/10 px-4 py-1.5">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="hz-tab"
            :class="{ 'hz-tab--on': activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            <UIcon :name="tab.icon" class="size-4" />
            {{ tab.label }}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- A bonus round on offer: play it for double credits, or skip it. -->
          <div
            v-if="bonusOffer"
            class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            :style="{
              borderColor: `#${bonusOffer.hex.toString(16).padStart(6, '0')}66`,
              backgroundColor: `#${bonusOffer.hex.toString(16).padStart(6, '0')}14`
            }"
          >
            <div class="flex items-center gap-3 min-w-0">
              <UIcon
                :name="bonusOffer.icon"
                class="size-7 shrink-0"
                :style="{ color: `#${bonusOffer.hex.toString(16).padStart(6, '0')}` }"
              />
              <div class="min-w-0">
                <div class="text-sm font-black tracking-widest text-white">
                  BONUS ROUND · {{ bonusOffer.name }}
                </div>
                <div class="text-[11px] text-white/60">
                  {{ bonusOffer.tagline }}
                </div>
                <div class="mt-0.5 font-mono text-[11px] text-lime-300">
                  Hold integrity above {{ Math.round(HACKERZ_BONUS_PASS_INTEGRITY * 100) }}% for ×{{ HACKERZ_BONUS_MULTIPLIER }} credits
                  <span class="text-white/40">· {{ HACKERZ_BONUS_MS / 1000 }}s · wall restored after · no coins</span>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton color="neutral" variant="ghost" size="sm" @click="skipBonus">
                Skip
              </UButton>
              <UButton color="primary" size="sm" icon="i-lucide-zap" :disabled="saveState === 'saving'" @click="playBonus">
                Play
              </UButton>
            </div>
          </div>

          <!-- Deployables: bought here, dropped mid-wave with Z/X/C. -->
          <div v-if="activeTab === 'systems'" class="mb-4 grid gap-2 sm:grid-cols-3">
            <button
              v-for="row in deployableRows"
              :key="row.def.id"
              type="button"
              :disabled="!row.affordable"
              class="hz-card"
              :class="row.full ? 'hz-card--off' : row.affordable ? 'hz-card--buy' : 'hz-card--locked'"
              @click="buyDeployable(row.def.id)"
            >
              <div class="flex items-center gap-2">
                <UIcon
                  :name="row.def.icon"
                  class="size-5 shrink-0"
                  :style="{ color: `#${row.def.hex.toString(16).padStart(6, '0')}` }"
                />
                <span class="text-sm font-semibold text-white truncate">{{ row.def.name }}</span>
                <span class="font-mono text-[10px] text-white/40">{{ row.def.key }}</span>
                <span class="ml-auto font-mono text-xs" :class="row.full ? 'text-white/40' : row.affordable ? 'text-lime-300' : 'text-white/40'">
                  {{ row.full ? 'FULL' : row.cost }}
                </span>
              </div>
              <p class="mt-1 text-[11px] text-white/45 leading-snug">
                {{ row.def.description }}
              </p>
              <div class="mt-1.5 flex gap-0.5">
                <span
                  v-for="i in HACKERZ_DEPLOYABLE_MAX"
                  :key="i"
                  class="hz-pip"
                  :class="{ 'hz-pip--lime': i <= row.owned }"
                />
              </div>
            </button>
          </div>

          <!-- Weapons live at the top of the rail tab. -->
          <div v-if="activeTab === 'rail'" class="mb-4">
            <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="row in weaponRows"
                :key="row.def.id"
                type="button"
                :disabled="!row.owned && !row.affordable"
                class="hz-card"
                :class="row.active
                  ? 'hz-card--active'
                  : row.owned
                    ? 'hz-card--owned'
                    : !row.locked && row.affordable ? 'hz-card--buy' : 'hz-card--locked'"
                @click="buyWeapon(row.def.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <UIcon :name="row.def.icon" class="size-4 shrink-0 text-cyan-300" />
                    <span class="text-sm font-semibold text-white truncate">{{ row.def.name }}</span>
                  </div>
                  <span
                    class="font-mono text-[11px] shrink-0"
                    :class="row.active ? 'text-cyan-300' : row.owned ? 'text-white/40' : row.locked ? 'text-white/40' : 'text-lime-300'"
                  >
                    {{ row.active ? 'ACTIVE' : row.owned ? 'OWNED' : row.locked ? `W${row.unlockWave}` : `${row.def.cost}` }}
                  </span>
                </div>
                <div class="mt-1 font-mono text-[11px] text-white/60">
                  {{ Math.round(row.runtime.damage) }} dmg
                  <span v-if="row.runtime.pellets > 1">×{{ row.runtime.pellets }}</span>
                  · {{ Math.round(row.dps) }} dps
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
                  <span :class="row.def.damageType === 'kinetic' ? 'text-amber-300' : 'text-cyan-300'">
                    {{ row.def.damageType }}
                  </span>
                  <span class="text-white/35">· {{ row.def.tag }}</span>
                </div>
              </button>
            </div>
            <p class="mt-2 text-[11px] text-white/35">
              Kinetic deals +25% to plated targets, energy +25% to unarmoured. Neither is ever
              penalised — the wrong type still deals full damage.
            </p>
          </div>

          <!-- Mounts: pick a turret per slot. -->
          <div v-if="activeTab === 'turrets'" class="mb-4 space-y-1.5">
            <div
              v-for="mount in mountRows"
              :key="mount.slot"
              class="hz-row flex items-center gap-2 p-2"
            >
              <div class="w-16 shrink-0 font-mono text-[11px] uppercase tracking-widest text-white/40">
                M{{ mount.slot + 1 }}
              </div>
              <div class="flex flex-1 flex-wrap gap-1.5">
                <button
                  v-for="turret in turretRows"
                  :key="turret.def.id"
                  type="button"
                  :disabled="turret.locked"
                  class="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors"
                  :class="mount.installed?.id === turret.def.id
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : turret.locked
                      ? 'border-white/10 bg-black/30 text-white/25 cursor-not-allowed'
                      : credits >= turret.def.cost
                        ? 'border-white/15 bg-black/40 text-white/70 hover:bg-white/10 cursor-pointer'
                        : 'border-white/10 bg-black/30 text-white/30 cursor-not-allowed'"
                  @click="installTurret(mount.slot, turret.def.id)"
                >
                  <UIcon :name="turret.def.icon" class="size-3.5" />
                  <span class="font-semibold">{{ turret.def.name }}</span>
                  <span class="font-mono opacity-70">
                    {{ turret.locked ? `W${turret.def.unlockWave}` : turret.def.cost }}
                  </span>
                  <span
                    class="font-mono"
                    :class="turret.def.damageType === 'kinetic' ? 'text-amber-300' : 'text-cyan-300'"
                  >{{ turret.def.damageType === 'kinetic' ? 'KIN' : 'NRG' }}</span>
                </button>
              </div>
              <UButton
                v-if="mount.installed"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="clearMount(mount.slot)"
              />
            </div>
            <p class="text-[11px] text-white/35">
              Rack Expansion opens more mounts. Swapping refunds half.
            </p>
          </div>

          <!-- Upgrade rows: name, cost, pips, and the stat. Nothing else. -->
          <div class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="row in tabRows"
              :key="row.def.id"
              type="button"
              :disabled="row.maxed || !row.affordable"
              class="hz-card"
              :class="row.maxed ? 'hz-card--off' : row.affordable ? 'hz-card--buy' : 'hz-card--locked'"
              @click="buy(row.def.id)"
            >
              <div class="flex items-center gap-2.5">
                <UIcon :name="row.def.icon" class="size-5 shrink-0 text-cyan-300" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-semibold text-white truncate">{{ row.def.name }}</span>
                    <span
                      class="font-mono text-xs shrink-0"
                      :class="row.maxed ? 'text-white/40' : row.affordable ? 'text-lime-300' : 'text-white/40'"
                    >
                      {{ row.maxed ? 'MAX' : row.cost }}
                    </span>
                  </div>
                  <div class="mt-1 flex items-center gap-2">
                    <div class="flex gap-0.5">
                      <span
                        v-for="i in row.max"
                        :key="i"
                        class="hz-pip"
                        :class="{ 'hz-pip--on': i <= row.level }"
                      />
                    </div>
                    <span class="font-mono text-[11px] text-white/60 truncate">
                      <template v-if="row.next">{{ row.next }}</template>
                      <template v-else>{{ row.current }}</template>
                    </span>
                  </div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- ── Run over ────────────────────────────────────────────────────── -->
      <div
        v-else-if="phase === 'over' || phase === 'won'"
        class="absolute inset-0 grid place-items-center bg-black/85 backdrop-blur-sm p-6"
      >
        <div class="max-w-md w-full text-center">
          <div
            class="text-4xl font-black tracking-[0.2em]"
            :class="phase === 'won' ? 'text-lime-300' : 'text-red-400'"
          >
            {{ phase === 'won' ? 'REPELLED' : 'BREACHED' }}
          </div>
          <p class="mt-2 text-sm text-white/60">
            {{ phase === 'won'
              ? `All ${HACKERZ_MAX_WAVE} waves held on ${difficulty.name}.`
              : `They were through the wall on wave ${wave}.` }}
          </p>
          <div class="mt-5 grid grid-cols-3 gap-3">
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Waves held
              </div>
              <div class="font-mono text-xl font-bold text-white">
                {{ payout?.wave ?? 0 }}
              </div>
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Purged
              </div>
              <div class="font-mono text-xl font-bold text-white">
                {{ payout?.kills ?? totalKills }}
              </div>
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Paid out
              </div>
              <div class="font-mono text-xl font-bold text-amber-300">
                {{ formatNumber(payout?.awarded ?? 0) }}
              </div>
            </div>
          </div>
          <p v-if="payout?.lostWave" class="mt-3 text-[11px] text-white/40">
            The wall fell mid-wave, so wave {{ wave }}'s coins went with it. Only waves that
            reached the uplink were banked.
          </p>
          <p v-else-if="payout?.capped" class="mt-3 text-[11px] text-white/40">
            Payout capped at the ceiling for the depth this run reached.
          </p>
          <UButton class="mt-6" size="xl" icon="i-lucide-rotate-ccw" color="primary" @click="backToLobby">
            Back to the Mainframe
          </UButton>
        </div>
      </div>

      <HackerzCodex v-if="codexOpen && (phase === 'lobby' || phase === 'shop')" :known="codexKnown" @close="codexOpen = false" />
    <UModal v-if="isDev" v-model:open="debugOpen" title="Debug" description="Dev server only. Rounds, fights and credits need a run at the uplink.">
      <template #body>
        <div class="space-y-4">
          <div>
            <div class="mb-2 text-xs text-muted">
              Run
            </div>
            <UButton color="success" variant="outline" size="sm" icon="i-lucide-coins" :disabled="phase !== 'shop'" @click="debugCredits">
              +100k credits
            </UButton>
          </div>
          <div>
            <div class="mb-2 text-xs text-muted">
              Auto-play
            </div>
            <UButton
              :color="autopilotOn ? 'error' : 'primary'"
              variant="outline"
              size="sm"
              icon="i-lucide-bot"
              :disabled="phase !== 'shop' && phase !== 'wave'"
              @click="activateLaya"
            >
              {{ autopilotOn ? 'Stop Laya' : 'Activate Laya' }}
            </UButton>
            <p class="mt-1 text-xs text-muted">
              Needs Laya on this machine: <code>bun scripts/laya-server.ts</code>. It shoots, fires abilities, shops and deploys every wave.
            </p>
          </div>
          <div>
            <div class="mb-2 text-xs text-muted">
              Bonus rounds
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="b in DEBUG_BONUSES"
                :key="b.id"
                color="warning"
                variant="outline"
                size="sm"
                icon="i-lucide-bug"
                :disabled="phase !== 'shop'"
                @click="debugOpen = false; debugBonus(b.id)"
              >
                {{ b.label }}
              </UButton>
            </div>
          </div>
          <div>
            <div class="mb-2 text-xs text-muted">
              Boss fights
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="b in DEBUG_BOSSES"
                :key="b.id"
                color="error"
                variant="outline"
                size="sm"
                icon="i-lucide-skull"
                :disabled="phase !== 'shop'"
                @click="debugOpen = false; debugBoss(b.id)"
              >
                {{ b.label }}
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>
    </div>
  </div>
</template>

<style>
@import '~/assets/css/hackerz.css';
</style>
