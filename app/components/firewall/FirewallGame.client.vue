<script setup lang="ts">
import { FirewallGame } from '~/utils/firewall-engine'
import type { FirewallWaveSummary } from '~/utils/firewall-engine'
import {
  FIREWALL_MAX_WAVE, FIREWALL_TURRETS, FIREWALL_TURRET_REFUND, FIREWALL_UPGRADES,
  FIREWALL_WAVE_MS, FIREWALL_WEAPONS, FIREWALL_SAVE_VERSION,
  firewallCooldownRushCost, firewallDifficulty, firewallEmptyArmoury, firewallIsBossWave, firewallLoadout,
  firewallMainframeEffects, firewallRepairCost, firewallSlots, firewallTurret,
  firewallUpgradeCost, firewallWeapon, firewallWeaponRuntime, firewallWeaponUnlockWave,
  type FirewallArmoury, type FirewallDifficultyId, type FirewallMainframeId,
  type FirewallMainframeLevels, type FirewallRunSave, type FirewallTab,
  type FirewallTurretId, type FirewallUpgradeId, type FirewallWeaponId
} from '#shared/utils/gamelogic/firewall'

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

type FirewallStateResponse = Awaited<ReturnType<typeof loadState>>

const account = ref<FirewallStateResponse | null>(null)
const mainframeLevels = computed<FirewallMainframeLevels>(() =>
  account.value?.levels ?? {
    bulwark: 0, munitions: 0, foundry: 0, grant: 0, salvage: 0, capacitor: 0, charter: 0, arsenal: 0
  })
const effects = computed(() => firewallMainframeEffects(mainframeLevels.value))
const bestWave = computed(() => account.value?.stats.bestWave ?? 0)
const busy = ref(false)

// Direct index into the generated route map: the conditional-type route
// inference behind a bare $fetch call now exceeds TS's instantiation depth.
type FirewallStatePayload = import('nitropack/types').InternalApi['/api/firewall/state']['get']

type FirewallApi = import('nitropack/types').InternalApi
const fwFetch = $fetch as unknown as <T>(url: string, opts?: Record<string, unknown>) => Promise<T>

function loadState(): Promise<FirewallStatePayload> {
  return fwFetch<FirewallStatePayload>('/api/firewall/state')
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
const cooldownRushCost = computed(() => firewallCooldownRushCost(cooldownRemainingMs.value))
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
    const response = await fwFetch<FirewallApi['/api/firewall/rush-cooldown']['post']>('/api/firewall/rush-cooldown', { method: 'POST' })
    toast.add({ title: `Uplink recharge cleared for ${response.cost} gem${response.cost === 1 ? '' : 's'}`, color: 'success' })
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

const difficultyId = ref<FirewallDifficultyId>('breach')
const armoury = ref<FirewallArmoury>(firewallEmptyArmoury())
const credits = ref(0)
const coins = ref(0)
const wave = ref(0)
const totalKills = ref(0)
const lastSummary = ref<FirewallWaveSummary | null>(null)
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

const difficulty = computed(() => firewallDifficulty(difficultyId.value))
const loadout = computed(() => firewallLoadout(armoury.value, mainframeLevels.value, difficultyId.value))
const levels = computed(() => armoury.value.levels)

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
  const save: FirewallRunSave = {
    version: FIREWALL_SAVE_VERSION,
    difficulty: difficultyId.value,
    wave: wave.value,
    credits: Math.round(credits.value),
    coins: Math.round(coins.value),
    kills: totalKills.value,
    wallHp: game.currentWallHp,
    armoury: armoury.value
  }
  try {
    const result = await fwFetch<FirewallApi['/api/firewall/run']['put']>('/api/firewall/run', {
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
const waveMsLeft = ref(FIREWALL_WAVE_MS)
const alive = ref(0)
const pulseCharge = ref(0)
const pulseCooldown = ref(1)
const overclockCharge = ref(0)
const overclockCooldown = ref(1)
const overclockLeft = ref(0)

const notices = ref<{ id: number, text: string, kind: 'good' | 'bad' | 'info' }[]>([])
let noticeSeq = 0

function pushNotice(text: string, kind: 'good' | 'bad' | 'info') {
  const id = noticeSeq++
  notices.value = [...notices.value, { id, text, kind }].slice(-3)
  setTimeout(() => { notices.value = notices.value.filter(n => n.id !== id) }, 3800)
}

const integrity = computed(() => wallMaxHp.value > 0 ? wallHp.value / wallMaxHp.value : 0)
const integrityColor = computed(() =>
  integrity.value > 0.55 ? 'bg-cyan-400' : integrity.value > 0.25 ? 'bg-amber-400' : 'bg-red-400')
const shieldPercent = computed(() => shieldMax.value > 0 ? shield.value / shieldMax.value * 100 : 0)
const timePercent = computed(() => waveMsLeft.value / FIREWALL_WAVE_MS * 100)
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
  FIREWALL_WEAPONS.filter(w => armoury.value.owned.includes(w.id)))

// ─── Engine wiring ──────────────────────────────────────────────────────────

const firewallSound = useFirewallSound()
const { soundEnabled, soundVolume } = firewallSound

let game: FirewallGame | null = null

onMounted(async () => {
  firewallSound.preload()
  game = new FirewallGame({
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
    onNotice: pushNotice,
    onSound: (event) => firewallSound.play(event)
  })
  if (host.value) await game.mount(host.value)

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('fullscreenchange', syncFullscreen)
  window.addEventListener('keydown', onHotkey)
  clockTimer = setInterval(() => { now.value = Date.now() }, 1000)

  await refreshState()
  phase.value = 'lobby'
})

onBeforeUnmount(() => {
  firewallSound.stop()
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  window.removeEventListener('keydown', onHotkey)
  if (clockTimer) clearInterval(clockTimer)
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

/** 1-5 swap weapons mid-fight; the engine charges a short reload for it. */
function onHotkey(event: KeyboardEvent) {
  if (phase.value !== 'wave' || paused.value) return
  const index = Number(event.key) - 1
  if (!Number.isInteger(index) || index < 0) return
  const weapon = ownedWeapons.value[index]
  if (weapon) selectWeapon(weapon.id)
}

function selectWeapon(id: FirewallWeaponId) {
  if (!armoury.value.owned.includes(id) || armoury.value.active === id) return
  armoury.value = { ...armoury.value, active: id }
  game?.swapWeapon(firewallWeaponRuntime(id, levels.value, effects.value))
}

function togglePause() {
  if (!game || phase.value !== 'wave') return
  paused.value = !paused.value
  if (paused.value) game.pause()
  else game.resume()
}

// ─── Run flow ───────────────────────────────────────────────────────────────

/** Loads a save — fresh from `start-run` or resumed — onto the field. */
function hydrate(save: FirewallRunSave, rev: number) {
  difficultyId.value = save.difficulty
  armoury.value = save.armoury
  credits.value = save.credits
  coins.value = save.coins
  wave.value = save.wave
  totalKills.value = save.kills
  revision.value = rev
  lastSummary.value = null
  payout.value = null
  notices.value = []
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
    const result = await fwFetch<FirewallApi['/api/firewall/start-run']['post']>('/api/firewall/start-run', {
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
  wave.value += 1
  paused.value = false
  waveMsLeft.value = FIREWALL_WAVE_MS
  game.startWave(wave.value, loadout.value)
  phase.value = 'wave'
}

async function onWaveEnd(summary: FirewallWaveSummary) {
  lastSummary.value = summary
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
    const result = await fwFetch<FirewallApi['/api/firewall/finish-run']['post']>('/api/firewall/finish-run', { method: 'POST', body: { reason } })
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

const tabs: { id: FirewallTab, label: string, icon: string }[] = [
  { id: 'rail', label: 'Rail', icon: 'i-lucide-crosshair' },
  { id: 'turrets', label: 'Turrets', icon: 'i-lucide-cpu' },
  { id: 'bastion', label: 'Bastion', icon: 'i-lucide-shield' },
  { id: 'systems', label: 'Systems', icon: 'i-lucide-radio' }
]
const activeTab = ref<FirewallTab>('rail')

const shopRows = computed(() => FIREWALL_UPGRADES.map((def) => {
  const level = levels.value[def.id]
  const maxed = level >= def.max
  const cost = firewallUpgradeCost(def, level)
  return {
    def,
    level,
    maxed,
    cost,
    affordable: !maxed && credits.value >= cost,
    current: def.value(level),
    next: maxed ? null : def.value(level + 1)
  }
}))

const tabRows = computed(() => shopRows.value.filter(row => row.def.tab === activeTab.value))

function buy(id: FirewallUpgradeId) {
  const def = FIREWALL_UPGRADES.find(u => u.id === id)
  if (!def) return
  const level = levels.value[id]
  if (level >= def.max) return
  const cost = firewallUpgradeCost(def, level)
  if (credits.value < cost) return
  credits.value -= cost

  const next = { ...armoury.value, levels: { ...levels.value, [id]: level + 1 } }
  // A Spire level adds a mount, so the slot array has to grow with it or the new
  // mount exists in the shop and nowhere else.
  if (id === 'spire') {
    const slots = firewallSlots(level + 1, effects.value.startingMounts)
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
const nextIsBoss = computed(() => firewallIsBossWave(nextWave.value))
const isFinalWave = computed(() => nextWave.value >= FIREWALL_MAX_WAVE)

const weaponRows = computed(() => FIREWALL_WEAPONS.map((def) => {
  const owned = armoury.value.owned.includes(def.id)
  const runtime = firewallWeaponRuntime(def.id, levels.value, effects.value)
  const unlockWave = firewallWeaponUnlockWave(def, effects.value.arsenal)
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

function buyWeapon(id: FirewallWeaponId) {
  const row = weaponRows.value.find(r => r.def.id === id)
  if (!row || row.locked) return
  if (row.owned) {
    selectWeapon(id)
    return
  }
  const def = firewallWeapon(id)
  if (credits.value < def.cost) return
  credits.value -= def.cost
  armoury.value = { ...armoury.value, owned: [...armoury.value.owned, id], active: id }
}

// ── Turret mounts ──

const turretRows = computed(() => FIREWALL_TURRETS.map(def => ({
  def,
  locked: nextWave.value < def.unlockWave
})))

const mountRows = computed(() => armoury.value.turrets.map((id, slot) => ({
  slot,
  installed: id ? firewallTurret(id) : null
})))

function installTurret(slot: number, id: FirewallTurretId) {
  const row = turretRows.value.find(r => r.def.id === id)
  if (!row || row.locked) return
  const def = row.def
  const current = armoury.value.turrets[slot] ?? null
  if (current === id) return
  const refund = current ? Math.round(firewallTurret(current).cost * FIREWALL_TURRET_REFUND) : 0
  if (credits.value + refund < def.cost) return
  credits.value += refund - def.cost
  const turrets = [...armoury.value.turrets]
  turrets[slot] = id
  armoury.value = { ...armoury.value, turrets }
}

function clearMount(slot: number) {
  const current = armoury.value.turrets[slot]
  if (!current) return
  credits.value += Math.round(firewallTurret(current).cost * FIREWALL_TURRET_REFUND)
  const turrets = [...armoury.value.turrets]
  turrets[slot] = null
  armoury.value = { ...armoury.value, turrets }
}

const missingHp = computed(() => Math.max(0, wallMaxHp.value - wallHp.value))
const repairCost = computed(() => firewallRepairCost(missingHp.value))
const canRepair = computed(() => missingHp.value > 4 && credits.value >= repairCost.value)

function buyRepair() {
  if (!game || !canRepair.value) return
  credits.value -= repairCost.value
  game.repairWall()
}

// ─── Mainframe ──────────────────────────────────────────────────────────────

async function buyMainframe(id: FirewallMainframeId) {
  if (busy.value) return
  busy.value = true
  try {
    await fwFetch('/api/firewall/upgrade', { method: 'POST', body: { upgradeId: id } })
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
          FIREWALL
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Hold the core for {{ FIREWALL_MAX_WAVE }} waves. The uplink opens between each one — and saves.
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
            @click="soundEnabled = !soundEnabled; if (soundEnabled) firewallSound.unlock()"
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

          <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 text-center">
            <div class="text-[11px] uppercase tracking-widest text-white/50">
              Wave {{ wave }} / {{ FIREWALL_MAX_WAVE }}
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

          <div class="flex items-end gap-2">
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
          :class="notice.kind === 'bad'
            ? 'bg-red-950/70 border-red-500/40 text-red-200'
            : notice.kind === 'good'
              ? 'bg-lime-950/70 border-lime-500/40 text-lime-200'
              : 'bg-black/60 border-white/15 text-white/80'"
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
        class="absolute inset-0 flex flex-col bg-gradient-to-b from-black/92 via-black/88 to-black/95"
      >
        <div class="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div>
            <div class="flex items-center gap-2">
              <div class="text-2xl font-black tracking-[0.2em] text-cyan-300">
                FIREWALL
              </div>
              <UBadge
                v-if="isCoolingDown"
                :label="`Recharging ${cooldownLabel}`"
                icon="i-lucide-battery-charging"
                color="warning"
                variant="subtle"
              />
            </div>
            <p class="text-[11px] text-white/50 mt-0.5">
              LMB fire · R reload · 1-5 swap · Space pulse · Q overclock
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
            class="rounded-lg border border-cyan-400/40 bg-cyan-400/10 p-3 flex items-center justify-between gap-4"
          >
            <div>
              <div class="flex items-center gap-2 text-sm font-semibold text-cyan-200">
                <UIcon name="i-lucide-save" class="size-4" />
                Run in progress — wave {{ account.activeRun.save.wave }} cleared
              </div>
              <div class="mt-0.5 font-mono text-[11px] text-white/50">
                {{ firewallDifficulty(account.activeRun.save.difficulty).name }} ·
                {{ formatNumber(account.activeRun.save.credits, false) }} credits ·
                {{ formatNumber(account.activeRun.save.coins) }} coins banked
              </div>
            </div>
            <UButton color="primary" size="lg" icon="i-lucide-play" @click="resumeRun">
              Resume
            </UButton>
          </div>

          <div v-else-if="isCoolingDown" class="rounded-lg border border-warning/25 bg-warning/10 p-4 text-center">
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
            <div class="text-[11px] uppercase tracking-widest text-white/40 mb-2">
              Difficulty — coins scale with it, and so does everything trying to get in
            </div>
            <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="entry in account?.difficulties ?? []"
                :key="entry.id"
                type="button"
                :disabled="!entry.unlocked"
                class="rounded-lg border p-3 text-left transition-colors"
                :class="difficultyId === entry.id
                  ? 'border-cyan-400 bg-cyan-400/15'
                  : entry.unlocked
                    ? 'border-white/15 bg-white/5 hover:bg-white/10 cursor-pointer'
                    : 'border-white/10 bg-white/5 opacity-45 cursor-not-allowed'"
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
                  · ×{{ entry.enemyHp }} HP
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
              <div class="text-[11px] uppercase tracking-widest text-white/40">
                Mainframe — permanent, bought with coins
              </div>
              <div class="font-mono text-sm font-bold text-amber-300">
                {{ formatNumber(Number(account?.balance ?? 0)) }}
              </div>
            </div>
            <p v-if="account?.activeRun" class="mb-2 text-[11px] text-white/40">
              Offline while a run is in progress. Finish or retire first.
            </p>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                v-for="entry in account?.mainframe ?? []"
                :key="entry.id"
                type="button"
                :disabled="busy || !!account?.activeRun || entry.cost === null
                  || Number(account?.balance ?? 0) < entry.cost"
                class="rounded-lg border p-3 text-left transition-colors"
                :class="entry.cost === null
                  ? 'border-white/10 bg-white/5 opacity-60 cursor-default'
                  : !account?.activeRun && Number(account?.balance ?? 0) >= entry.cost
                    ? 'border-amber-400/40 bg-amber-400/5 hover:bg-amber-400/15 cursor-pointer'
                    : 'border-white/10 bg-white/5 opacity-55 cursor-not-allowed'"
                @click="buyMainframe(entry.id)"
              >
                <div class="flex items-center gap-2">
                  <UIcon :name="entry.icon" class="size-4 shrink-0 text-amber-300" />
                  <span class="text-sm font-semibold text-white truncate">{{ entry.name }}</span>
                  <span class="ml-auto font-mono text-[11px] shrink-0 text-amber-300">
                    {{ entry.cost === null ? 'MAX' : formatNumber(entry.cost) }}
                  </span>
                </div>
                <p class="mt-1 text-[11px] text-white/45 leading-snug">
                  {{ entry.description }}
                </p>
                <div class="mt-1.5 flex items-center gap-2">
                  <span class="font-mono text-[10px] text-white/40">{{ entry.level }}/{{ entry.max }}</span>
                  <div class="h-1 flex-1 rounded-full bg-white/10 overflow-hidden">
                    <div class="h-full bg-amber-400" :style="{ width: `${entry.level / entry.max * 100}%` }" />
                  </div>
                </div>
                <div class="mt-1 font-mono text-[11px] text-white/60 truncate">
                  {{ entry.next ?? entry.current }}
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Uplink ──────────────────────────────────────────────────────── -->
      <div
        v-else-if="phase === 'shop'"
        class="absolute inset-0 flex flex-col bg-black/90 backdrop-blur-sm"
      >
        <div class="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2.5">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold tracking-widest text-cyan-300">UPLINK</span>
            <span v-if="lastSummary" class="text-xs text-white/45 font-mono">
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

        <div class="flex items-center gap-1 border-b border-white/10 px-4">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-widest border-b-2 transition-colors"
            :class="activeTab === tab.id
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-white/40 hover:text-white/70'"
            @click="activeTab = tab.id"
          >
            <UIcon :name="tab.icon" class="size-4" />
            {{ tab.label }}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <!-- Weapons live at the top of the rail tab. -->
          <div v-if="activeTab === 'rail'" class="mb-4">
            <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <button
                v-for="row in weaponRows"
                :key="row.def.id"
                type="button"
                :disabled="!row.owned && !row.affordable"
                class="rounded-lg border p-2.5 text-left transition-colors"
                :class="row.active
                  ? 'border-cyan-400 bg-cyan-400/15'
                  : row.owned
                    ? 'border-white/15 bg-white/5 hover:bg-white/10 cursor-pointer'
                    : row.locked
                      ? 'border-white/10 bg-white/5 opacity-40 cursor-not-allowed'
                      : row.affordable
                        ? 'border-lime-400/40 bg-lime-400/5 hover:bg-lime-400/15 cursor-pointer'
                        : 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'"
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
              class="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2"
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
              Spire opens more mounts and builds the tower another storey taller. Swapping refunds half.
            </p>
          </div>

          <!-- Upgrade rows: name, cost, pips, and the stat. Nothing else. -->
          <div class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="row in tabRows"
              :key="row.def.id"
              type="button"
              :disabled="row.maxed || !row.affordable"
              class="rounded-lg border p-2.5 text-left transition-colors"
              :class="row.maxed
                ? 'border-white/10 bg-white/5 opacity-60 cursor-default'
                : row.affordable
                  ? 'border-cyan-400/40 bg-cyan-400/5 hover:bg-cyan-400/15 cursor-pointer'
                  : 'border-white/10 bg-white/5 opacity-55 cursor-not-allowed'"
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
                        v-for="i in row.def.max"
                        :key="i"
                        class="h-1.5 w-2 rounded-sm"
                        :class="i <= row.level ? 'bg-cyan-300' : 'bg-white/15'"
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
              ? `All ${FIREWALL_MAX_WAVE} waves held on ${difficulty.name}.`
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
    </div>
  </div>
</template>
