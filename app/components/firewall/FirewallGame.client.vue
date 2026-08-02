<script setup lang="ts">
import { FirewallGame } from '~/utils/firewall-engine'
import type { FirewallWaveSummary } from '~/utils/firewall-engine'
import {
  FIREWALL_TURRETS, FIREWALL_TURRET_REFUND, FIREWALL_UPGRADES, FIREWALL_WAVE_MS, FIREWALL_WEAPONS,
  firewallEmptyArmoury, firewallIsBossWave, firewallLoadout, firewallRepairCost, firewallSlots,
  firewallTurret, firewallUpgradeCost, firewallWeapon, firewallWeaponRuntime,
  type FirewallArmoury, type FirewallTab, type FirewallTurretId,
  type FirewallUpgradeId, type FirewallWeaponId
} from '#shared/utils/gamelogic/firewall'

type Phase = 'briefing' | 'wave' | 'shop' | 'over'

const host = ref<HTMLDivElement | null>(null)
const shell = ref<HTMLDivElement | null>(null)

const phase = ref<Phase>('briefing')
const paused = ref(false)

// ─── Meta state ─────────────────────────────────────────────────────────────
// Credits and the armoury live here rather than in the engine: the engine runs
// a wave, the uplink runs the economy, and the only thing that crosses between
// them is a derived loadout.

const armoury = ref<FirewallArmoury>(firewallEmptyArmoury())
const credits = ref(0)
const earned = ref(0)
const wave = ref(0)
const totalKills = ref(0)
const lastSummary = ref<FirewallWaveSummary | null>(null)

const loadout = computed(() => firewallLoadout(armoury.value))
const levels = computed(() => armoury.value.levels)

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

let game: FirewallGame | null = null

onMounted(async () => {
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
    onCredits: (delta) => {
      credits.value += delta
      earned.value += delta
    },
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
    onWaveEnd: (summary) => {
      lastSummary.value = summary
      totalKills.value += summary.kills
      phase.value = 'shop'
    },
    onGameOver: (stats) => {
      totalKills.value = stats.kills
      phase.value = 'over'
    },
    onBoss: name => pushNotice(`${name} detected`, 'bad'),
    onNotice: pushNotice
  })
  if (host.value) await game.mount(host.value)

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('fullscreenchange', syncFullscreen)
  window.addEventListener('keydown', onHotkey)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('fullscreenchange', syncFullscreen)
  window.removeEventListener('keydown', onHotkey)
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
  game?.swapWeapon(firewallWeaponRuntime(id, levels.value))
}

function togglePause() {
  if (!game || phase.value !== 'wave') return
  paused.value = !paused.value
  if (paused.value) game.pause()
  else game.resume()
}

// ─── Run flow ───────────────────────────────────────────────────────────────

function startRun() {
  if (!game) return
  armoury.value = firewallEmptyArmoury()
  credits.value = 150
  earned.value = 0
  totalKills.value = 0
  lastSummary.value = null
  notices.value = []
  wave.value = 1
  paused.value = false
  game.startRun(loadout.value)
  game.startWave(1, loadout.value)
  phase.value = 'wave'
}

function deployNextWave() {
  if (!game || phase.value !== 'shop') return
  wave.value += 1
  paused.value = false
  waveMsLeft.value = FIREWALL_WAVE_MS
  game.startWave(wave.value, loadout.value)
  phase.value = 'wave'
}

function restart() {
  startRun()
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
  // Ramparts adds a mount, so the slot array has to grow with it or the new
  // mount exists in the shop and nowhere else.
  if (id === 'ramparts') {
    const slots = firewallSlots(level + 1)
    next.turrets = Array.from({ length: slots }, (_, i) => next.turrets[i] ?? null)
  }
  armoury.value = next
}

// ── Weapons ──

const weaponRows = computed(() => FIREWALL_WEAPONS.map((def) => {
  const owned = armoury.value.owned.includes(def.id)
  const runtime = firewallWeaponRuntime(def.id, levels.value)
  return {
    def,
    owned,
    active: armoury.value.active === def.id,
    affordable: !owned && credits.value >= def.cost,
    dps: runtime.damage * runtime.pellets / (runtime.fireIntervalMs / 1000),
    runtime
  }
}))

function buyWeapon(id: FirewallWeaponId) {
  const def = firewallWeapon(id)
  if (armoury.value.owned.includes(id)) {
    selectWeapon(id)
    return
  }
  if (credits.value < def.cost) return
  credits.value -= def.cost
  armoury.value = { ...armoury.value, owned: [...armoury.value.owned, id], active: id }
}

// ── Turret mounts ──

const mountRows = computed(() => armoury.value.turrets.map((id, slot) => ({
  slot,
  installed: id ? firewallTurret(id) : null
})))

function installTurret(slot: number, id: FirewallTurretId) {
  const def = firewallTurret(id)
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

const nextWave = computed(() => wave.value + 1)
const nextIsBoss = computed(() => firewallIsBossWave(nextWave.value))

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
          Hold the core. Fifty seconds a wave, then the uplink opens.
        </p>
      </div>
      <div class="flex items-center gap-2">
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
        v-if="phase !== 'briefing'"
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
              Wave {{ wave }}
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
          </div>
        </div>

        <div class="flex items-end justify-between gap-3">
          <div class="flex items-end gap-2">
            <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2">
              <div class="text-[11px] uppercase tracking-widest text-white/50">
                {{ loadout.weapon.name }}
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

      <!-- ── Briefing ────────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'briefing'"
        class="absolute inset-0 grid place-items-center bg-gradient-to-b from-black/85 via-black/75 to-black/90 p-6"
      >
        <div class="max-w-xl text-center">
          <div class="text-4xl sm:text-5xl font-black tracking-[0.2em] text-cyan-300">
            FIREWALL
          </div>
          <p class="mt-3 text-sm text-white/70">
            Fifty seconds a wave. Plated units shrug off anything that is not
            armour-piercing, so buy the right gun before the tanks arrive.
          </p>
          <div class="mt-5 grid grid-cols-4 gap-2 text-left text-[11px] text-white/60">
            <div class="rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div class="font-mono text-cyan-300 mb-0.5">
                LMB
              </div>
              Fire
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div class="font-mono text-cyan-300 mb-0.5">
                R
              </div>
              Reload
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div class="font-mono text-cyan-300 mb-0.5">
                1-5
              </div>
              Swap weapon
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div class="font-mono text-cyan-300 mb-0.5">
                SPACE / Q
              </div>
              Pulse · overclock
            </div>
          </div>
          <UButton class="mt-6" size="xl" icon="i-lucide-power" color="primary" @click="startRun">
            Boot firewall
          </UButton>
        </div>
      </div>

      <!-- ── Uplink ──────────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'shop'"
        class="absolute inset-0 flex flex-col bg-black/90 backdrop-blur-sm"
      >
        <div class="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2.5">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold tracking-widest text-cyan-300">UPLINK</span>
            <span v-if="lastSummary" class="text-xs text-white/45 font-mono">
              w{{ lastSummary.wave }} · {{ lastSummary.kills }} kills · +{{ lastSummary.credits }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <div class="font-mono text-xl font-bold text-lime-300 leading-none">
              {{ formatNumber(credits, false) }}
            </div>
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
              :color="nextIsBoss ? 'error' : 'primary'"
              trailing-icon="i-lucide-chevron-right"
              @click="deployNextWave"
            >
              Wave {{ nextWave }}{{ nextIsBoss ? ' · BOSS' : '' }}
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
                    :class="row.active ? 'text-cyan-300' : row.owned ? 'text-white/40' : 'text-lime-300'"
                  >
                    {{ row.active ? 'ACTIVE' : row.owned ? 'OWNED' : `${row.def.cost}` }}
                  </span>
                </div>
                <div class="mt-1 font-mono text-[11px] text-white/60">
                  {{ Math.round(row.runtime.damage) }} dmg
                  <span v-if="row.runtime.pellets > 1">×{{ row.runtime.pellets }}</span>
                  · {{ Math.round(row.dps) }} dps
                </div>
                <div class="mt-0.5 text-[10px] uppercase tracking-wider" :class="row.def.armorPiercing ? 'text-orange-300' : 'text-white/35'">
                  {{ row.def.armorPiercing ? 'AP · ' : '' }}{{ row.def.tag }}
                </div>
              </button>
            </div>
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
                  v-for="turret in FIREWALL_TURRETS"
                  :key="turret.id"
                  type="button"
                  class="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors"
                  :class="mount.installed?.id === turret.id
                    ? 'border-cyan-400 bg-cyan-400/15 text-cyan-200'
                    : credits >= turret.cost
                      ? 'border-white/15 bg-black/40 text-white/70 hover:bg-white/10 cursor-pointer'
                      : 'border-white/10 bg-black/30 text-white/30 cursor-not-allowed'"
                  @click="installTurret(mount.slot, turret.id)"
                >
                  <UIcon :name="turret.icon" class="size-3.5" />
                  <span class="font-semibold">{{ turret.name }}</span>
                  <span class="font-mono opacity-70">{{ turret.cost }}</span>
                  <span v-if="turret.armorPiercing" class="text-orange-300 font-mono">AP</span>
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
              Ramparts opens more mounts. Swapping refunds half.
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

      <!-- ── Game over ───────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'over'"
        class="absolute inset-0 grid place-items-center bg-black/85 backdrop-blur-sm p-6"
      >
        <div class="max-w-md w-full text-center">
          <div class="text-4xl font-black tracking-[0.2em] text-red-400">
            BREACHED
          </div>
          <p class="mt-2 text-sm text-white/60">
            They were through the wall on wave {{ wave }}.
          </p>
          <div class="mt-5 grid grid-cols-3 gap-3">
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Waves
              </div>
              <div class="font-mono text-xl font-bold text-white">
                {{ Math.max(0, wave - 1) }}
              </div>
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Purged
              </div>
              <div class="font-mono text-xl font-bold text-white">
                {{ totalKills }}
              </div>
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Credits
              </div>
              <div class="font-mono text-xl font-bold text-lime-300">
                {{ formatNumber(earned, false) }}
              </div>
            </div>
          </div>
          <UButton class="mt-6" size="xl" icon="i-lucide-rotate-ccw" color="primary" @click="restart">
            Reboot
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
