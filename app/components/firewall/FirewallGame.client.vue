<script setup lang="ts">
import { FirewallGame } from '~/utils/firewall-engine'
import type { FirewallWaveSummary } from '~/utils/firewall-engine'
import {
  FIREWALL_UPGRADES, FIREWALL_WAVE_MS,
  firewallEmptyLevels, firewallIsBossWave, firewallLoadout, firewallRepairCost, firewallUpgradeCost,
  type FirewallUpgradeGroup, type FirewallUpgradeId, type FirewallUpgradeLevels
} from '#shared/utils/gamelogic/firewall'

type Phase = 'briefing' | 'wave' | 'shop' | 'over'

const host = ref<HTMLDivElement | null>(null)
const shell = ref<HTMLDivElement | null>(null)

const phase = ref<Phase>('briefing')
const paused = ref(false)

// ─── Meta state ─────────────────────────────────────────────────────────────
// Credits and upgrade levels live here rather than in the engine: the engine
// runs a wave, the shop runs the economy, and the only thing that crosses
// between them is a derived loadout.

const levels = ref<FirewallUpgradeLevels>(firewallEmptyLevels())
const credits = ref(0)
const earned = ref(0)
const spent = ref(0)
const wave = ref(0)
const totalKills = ref(0)
const lastSummary = ref<FirewallWaveSummary | null>(null)

const loadout = computed(() => firewallLoadout(levels.value))

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
const pulsePercent = computed(() => pulseCooldown.value > 0 ? Math.min(100, pulseCharge.value / pulseCooldown.value * 100) : 0)

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
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  document.removeEventListener('fullscreenchange', syncFullscreen)
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

function togglePause() {
  if (!game || phase.value !== 'wave') return
  paused.value = !paused.value
  if (paused.value) game.pause()
  else game.resume()
}

// ─── Run flow ───────────────────────────────────────────────────────────────

function startRun() {
  if (!game) return
  levels.value = firewallEmptyLevels()
  credits.value = 120
  earned.value = 0
  spent.value = 0
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

// ─── Shop ───────────────────────────────────────────────────────────────────

const groups: { id: FirewallUpgradeGroup, label: string, icon: string }[] = [
  { id: 'weapon', label: 'Rail', icon: 'i-lucide-crosshair' },
  { id: 'defense', label: 'Bastion', icon: 'i-lucide-shield' },
  { id: 'support', label: 'Systems', icon: 'i-lucide-cpu' }
]

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

function rowsFor(group: FirewallUpgradeGroup) {
  return shopRows.value.filter(row => row.def.group === group)
}

function buy(id: FirewallUpgradeId) {
  const def = FIREWALL_UPGRADES.find(u => u.id === id)
  if (!def) return
  const level = levels.value[id]
  if (level >= def.max) return
  const cost = firewallUpgradeCost(def, level)
  if (credits.value < cost) return
  credits.value -= cost
  spent.value += cost
  levels.value = { ...levels.value, [id]: level + 1 }
}

const missingHp = computed(() => Math.max(0, wallMaxHp.value - wallHp.value))
const repairCost = computed(() => firewallRepairCost(missingHp.value))
const canRepair = computed(() => missingHp.value > 4 && credits.value >= repairCost.value)

function buyRepair() {
  if (!game || !canRepair.value) return
  credits.value -= repairCost.value
  spent.value += repairCost.value
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
          Hold the core against the intrusion. Twenty-five seconds a wave, then the shop opens.
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
      <!-- Canvas -->
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
          <!-- Wall / shield -->
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

          <!-- Wave clock -->
          <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 text-center">
            <div class="text-[11px] uppercase tracking-widest text-white/50">
              Wave {{ wave }}
            </div>
            <div class="font-mono text-2xl font-bold" :class="secondsLeft <= 5 ? 'text-amber-300' : 'text-white'">
              {{ phase === 'wave' ? secondsLeft : 0 }}s
            </div>
            <div class="mt-1 h-1 w-28 rounded-full bg-white/10 overflow-hidden">
              <div class="h-full bg-cyan-400" :style="{ width: `${timePercent}%` }" />
            </div>
            <div class="mt-1 text-[11px] text-white/45">
              {{ alive }} hostile{{ alive === 1 ? '' : 's' }}
            </div>
          </div>

          <!-- Credits -->
          <div class="w-40 sm:w-52 rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 p-2.5 text-right">
            <div class="text-[11px] uppercase tracking-widest text-white/50">
              Credits
            </div>
            <div class="font-mono text-xl font-bold text-lime-300">
              {{ formatNumber(credits, false) }}
            </div>
          </div>
        </div>

        <!-- Bottom row: ammo, pulse, controls -->
        <div class="flex items-end justify-between gap-3">
          <div class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2">
            <div class="text-[11px] uppercase tracking-widest text-white/50">
              Buffer
            </div>
            <div v-if="reloading" class="mt-1 w-32">
              <div class="text-xs text-amber-300 font-mono">
                FLUSHING
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

          <div class="text-center text-[11px] text-white/40 font-mono hidden sm:block">
            HOLD LMB — FIRE · R — FLUSH BUFFER<span v-if="loadout.pulseUnlocked"> · SPACE — ICE PULSE</span>
          </div>

          <div
            v-if="loadout.pulseUnlocked"
            class="rounded-lg bg-black/55 backdrop-blur-sm border border-white/10 px-3 py-2 w-32"
          >
            <div class="flex items-center justify-between text-[11px] uppercase tracking-widest">
              <span class="text-white/50">Pulse</span>
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

      <!-- Notices -->
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
            Intrusion daemons are walking on the core. You have one rail gun, a wall, and
            twenty-five seconds a wave. Between waves the shop opens — spend everything,
            because credits do not survive a breach.
          </p>
          <div class="mt-5 grid grid-cols-3 gap-3 text-left text-xs text-white/60">
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="font-mono text-cyan-300 mb-1">
                LMB
              </div>
              Aim and hold to fire the rail.
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="font-mono text-cyan-300 mb-1">
                R
              </div>
              Flush the buffer before it runs dry.
            </div>
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="font-mono text-cyan-300 mb-1">
                SPACE
              </div>
              ICE pulse, once you have bought one.
            </div>
          </div>
          <UButton class="mt-6" size="xl" icon="i-lucide-power" color="primary" @click="startRun">
            Boot firewall
          </UButton>
        </div>
      </div>

      <!-- ── Shop ────────────────────────────────────────────────────────── -->
      <div
        v-if="phase === 'shop'"
        class="absolute inset-0 flex flex-col bg-black/90 backdrop-blur-sm"
      >
        <div class="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div class="flex items-baseline gap-3">
            <span class="text-lg font-bold tracking-widest text-cyan-300">UPLINK</span>
            <span v-if="lastSummary" class="text-xs text-white/50 font-mono">
              wave {{ lastSummary.wave }} held · {{ lastSummary.kills }} purged · +{{ lastSummary.credits }} cr
            </span>
          </div>
          <div class="flex items-center gap-4">
            <div class="text-right">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Credits
              </div>
              <div class="font-mono text-xl font-bold text-lime-300 leading-none">
                {{ formatNumber(credits, false) }}
              </div>
            </div>
            <UButton
              :color="canRepair ? 'warning' : 'neutral'"
              variant="subtle"
              icon="i-lucide-wrench"
              :disabled="!canRepair"
              @click="buyRepair"
            >
              Repair {{ Math.round(missingHp) }} HP · {{ repairCost }}
            </UButton>
            <UButton
              size="lg"
              :color="nextIsBoss ? 'error' : 'primary'"
              trailing-icon="i-lucide-chevron-right"
              @click="deployNextWave"
            >
              Deploy wave {{ nextWave }}{{ nextIsBoss ? ' — ROOTKIT' : '' }}
            </UButton>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <div class="grid gap-4 lg:grid-cols-3">
            <div v-for="group in groups" :key="group.id" class="space-y-2">
              <div class="flex items-center gap-2 text-xs uppercase tracking-widest text-white/45">
                <UIcon :name="group.icon" class="size-4" />
                {{ group.label }}
              </div>
              <button
                v-for="row in rowsFor(group.id)"
                :key="row.def.id"
                type="button"
                :disabled="row.maxed || !row.affordable"
                class="w-full rounded-lg border p-2.5 text-left transition-colors"
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
                        {{ row.maxed ? 'MAX' : `${row.cost} cr` }}
                      </span>
                    </div>
                    <div class="text-[11px] text-white/45 truncate">
                      {{ row.def.blurb }}
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
                      <span class="font-mono text-[11px] text-white/60">
                        {{ row.current }}
                        <template v-if="row.next"> → <span class="text-cyan-300">{{ row.next }}</span></template>
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            </div>
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
            The core is gone. The daemons were through the wall on wave {{ wave }}.
          </p>
          <div class="mt-5 grid grid-cols-3 gap-3">
            <div class="rounded-lg border border-white/10 bg-white/5 p-3">
              <div class="text-[10px] uppercase tracking-widest text-white/40">
                Waves held
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
                Credits earned
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
