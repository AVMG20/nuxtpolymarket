<script setup lang="ts">
import { ShapezzEngine, type ShapezzSnapshot } from '~/utils/shapezz-engine'
import {
    SHAPEZZ_CHECKPOINT_MS,
    shapezzCheckpointPressure,
    shapezzPayoutForRun,
    shapezzRunUpgrade,
    type ShapezzDifficultyId,
    type ShapezzRunUpgradeId
} from '#shared/utils/gamelogic/shapezz'

definePageMeta({ title: 'SHAPEZZ' })

const canvas = ref<HTMLCanvasElement | null>(null)
const toast = useToast()
const { user, fetchSession } = useAuth()
const sound = useShapezzSound()
const { soundEnabled, soundVolume } = sound

function togglePause() {
    engine?.togglePause()
}

// Audible feedback when toggling sound on (play() is a no-op when off).
function onSoundToggle() {
    sound.unlock()
    sound.play('pickup-coin')
}
const { data: state, refresh } = await useFetch('/api/shapezz/state')

const selectedDifficultyId = ref<ShapezzDifficultyId>('surge')
const activeDifficultyId = ref<ShapezzDifficultyId>('surge')
const starting = ref(false)
const settling = ref(false)
const running = ref(false)
const paused = ref(false)
const checkpointOffers = ref<ShapezzRunUpgradeId[]>([])
const snapshot = ref<ShapezzSnapshot>({ hp: 0, maxHp: 1, coins: 0, kills: 0, elapsedMs: 0, checkpoint: 0, combo: 0, upgrades: {} })
const result = ref<null | {
    reason: 'cashout' | 'defeat'
    awarded: number
    elapsedMs: number
    kills: number
    checkpoint: number
    capped?: boolean
}>(null)
const bossWarning = ref('')
let bossWarningTimer: ReturnType<typeof setTimeout> | null = null
let engine: ShapezzEngine | null = null

const hpPercent = computed(() => clampPercent(snapshot.value.hp / Math.max(1, snapshot.value.maxHp) * 100))
const selectedDifficulty = computed(() => state.value?.difficulties.find(difficulty => difficulty.id === selectedDifficultyId.value))
const difficultyItems = computed(() => (state.value?.difficulties ?? []).map(difficulty => ({
    label: `${difficulty.name} · ${difficulty.reward.toFixed(2)}x loot`,
    value: difficulty.id
})))
const nextMutationMs = computed(() => Math.max(0, (snapshot.value.checkpoint + 1) * SHAPEZZ_CHECKPOINT_MS - snapshot.value.elapsedMs))
const activeUpgrades = computed(() => Object.entries(snapshot.value.upgrades)
    .filter((entry): entry is [ShapezzRunUpgradeId, number] => Number(entry[1]) > 0)
    .map(([id, stacks]) => ({ ...shapezzRunUpgrade(id), stacks })))
const currentPressure = computed(() => shapezzCheckpointPressure(snapshot.value.checkpoint))
// This is the same calculation used by server settlement. Never show an
// unbankable raw loot total as the cash-out offer.
const cashOffer = computed(() => shapezzPayoutForRun(
    snapshot.value.coins,
    snapshot.value.elapsedMs,
    activeDifficultyId.value
))

// Arena cooldown after a settled run — ticks once a second while visible.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null
const cooldownRemainingMs = computed(() => {
    const until = state.value?.runCooldown?.until
    return until ? Math.max(0, new Date(until).getTime() - now.value) : 0
})
const isCoolingDown = computed(() => cooldownRemainingMs.value > 0)
const cooldownRushCost = computed(() => state.value?.runCooldown?.rushCost ?? 0)
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

function clampPercent(value: number) {
    return Math.max(0, Math.min(100, value))
}

function formatTime(ms: number) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function rarityLabel(id: ShapezzRunUpgradeId) {
    return shapezzRunUpgrade(id).rarity.toUpperCase()
}

function rarityClass(id: ShapezzRunUpgradeId) {
    const rarity = shapezzRunUpgrade(id).rarity
    if (rarity === 'cataclysmic') return 'text-secondary'
    if (rarity === 'unstable') return 'text-warning'
    return 'text-info'
}

async function clearStaleRun() {
    if (!state.value?.activeRun) return
    try {
        await $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: { reason: 'abandoned', elapsedMs: 0, coins: 0, kills: 0 }
        })
        await refresh()
    } catch {
        // A concurrent request may already have cleared it; refreshing is enough.
        await refresh()
    }
}

async function startRun() {
    if (starting.value || !canvas.value || !state.value || isCoolingDown.value) return
    starting.value = true
    // Starting a run is a user gesture — the one reliable moment to lift the
    // browser autoplay block and warm the sample cache before the first shot.
    sound.unlock()
    sound.preload()
    result.value = null
    checkpointOffers.value = []
    try {
        const run = await $fetch('/api/shapezz/start-run', {
            method: 'POST',
            body: { difficultyId: selectedDifficultyId.value }
        })
        activeDifficultyId.value = run.difficulty.id
        if (!canvas.value) {
            // Unmounted while the request was in flight — release the run the
            // server just opened instead of leaving it blocking the workshop.
            void $fetch('/api/shapezz/finish-run', {
                method: 'POST',
                body: { reason: 'abandoned', elapsedMs: 0, coins: 0, kills: 0 }
            }).catch(() => {})
            return
        }
        engine?.destroy()
        engine = new ShapezzEngine(canvas.value, run.stats, run.weapon, selectedDifficultyId.value, {
            onHud: value => { snapshot.value = value },
            onCheckpoint: (offers, value) => {
                snapshot.value = value
                checkpointOffers.value = offers
                sound.play('checkpoint')
            },
            onBoss: (name) => {
                bossWarning.value = name
                if (bossWarningTimer) clearTimeout(bossWarningTimer)
                bossWarningTimer = setTimeout(() => { bossWarning.value = '' }, 4200)
            },
            onGameOver: (value) => { settleDefeat(value) },
            onSfx: event => sound.play(event),
            onPause: (value) => { paused.value = value }
        })
        running.value = true
        paused.value = false
        engine.start()
        sound.play('run-start')
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Could not start SHAPEZZ'), color: 'error' })
    } finally {
        starting.value = false
    }
}

function chooseUpgrade(upgradeId: ShapezzRunUpgradeId) {
    if (!engine || settling.value) return
    engine.chooseUpgrade(upgradeId)
    checkpointOffers.value = []
    sound.play('upgrade')
    toast.add({
        title: `${shapezzRunUpgrade(upgradeId).name} ONLINE`,
        description: shapezzRunUpgrade(upgradeId).stackText,
        color: 'success',
        duration: 1800
    })
}

async function cashOut() {
    if (!engine || settling.value || checkpointOffers.value.length === 0) return
    settling.value = true
    const finalSnapshot = engine.getSnapshot()
    try {
        const response = await $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: {
                reason: 'cashout',
                elapsedMs: finalSnapshot.elapsedMs,
                coins: cashOffer.value,
                kills: finalSnapshot.kills
            }
        })
        engine.destroy()
        engine = null
        running.value = false
        paused.value = false
        checkpointOffers.value = []
        sound.play('cash-out')
        result.value = {
            reason: 'cashout',
            awarded: response.awarded,
            elapsedMs: response.elapsedMs,
            kills: finalSnapshot.kills,
            checkpoint: response.checkpoint,
            capped: response.capped
        }
        await Promise.all([refresh(), fetchSession()])
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Cash-out failed'), color: 'error' })
    } finally {
        settling.value = false
    }
}

async function rushCooldown() {
    if (rushingCooldown.value || !isCoolingDown.value) return
    rushingCooldown.value = true
    try {
        const response = await $fetch('/api/shapezz/rush-cooldown', { method: 'POST' })
        toast.add({ title: `Arena recharge cleared for ${response.cost} gem${response.cost === 1 ? '' : 's'}`, color: 'success' })
        await Promise.all([refresh(), fetchSession()])
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Could not rush the arena recharge'), color: 'error' })
    } finally {
        rushingCooldown.value = false
    }
}

async function settleDefeat(finalSnapshot: ShapezzSnapshot) {
    if (settling.value) return
    settling.value = true
    try {
        const response = await $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: {
                reason: 'defeat',
                elapsedMs: finalSnapshot.elapsedMs,
                coins: finalSnapshot.coins,
                kills: finalSnapshot.kills
            }
        })
        result.value = {
            reason: 'defeat',
            awarded: 0,
            elapsedMs: response.elapsedMs,
            kills: finalSnapshot.kills,
            checkpoint: response.checkpoint
        }
        await refresh()
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Run settlement failed'), color: 'error' })
    } finally {
        engine?.destroy()
        engine = null
        running.value = false
        paused.value = false
        checkpointOffers.value = []
        settling.value = false
    }
}

function closeResult() {
    result.value = null
    snapshot.value = { hp: 0, maxHp: 1, coins: 0, kills: 0, elapsedMs: 0, checkpoint: 0, combo: 0, upgrades: {} }
}

onMounted(() => {
    clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
    void clearStaleRun()
})
onUnmounted(() => {
    engine?.destroy()
    engine = null
    sound.stop()
    if (clockTimer) clearInterval(clockTimer)
    if (bossWarningTimer) clearTimeout(bossWarningTimer)
    // Leaving mid-run forfeits it — settle server-side so the workshop and
    // the next visit aren't blocked by a run that no longer exists.
    if (running.value) {
        running.value = false
        void $fetch('/api/shapezz/finish-run', {
            method: 'POST',
            body: { reason: 'abandoned', elapsedMs: 0, coins: 0, kills: 0 }
        }).catch(() => {})
    }
})
</script>

<template>
  <UContainer class="max-w-[1600px] space-y-6 pb-12">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <h1 class="shapezz-title text-3xl font-black tracking-[-0.08em] text-highlighted sm:text-4xl">
            SHAPEZZ
          </h1>
          <UBadge label="ENDLESS" color="secondary" variant="subtle" />
        </div>
        <p class="mt-1 max-w-2xl text-sm text-muted">
          Turn a cube with a gun into a screen-clearing catastrophe. Every 45 seconds: mutate or take the money and run.
        </p>
      </div>
      <div v-if="state" class="flex flex-wrap gap-2">
        <UBadge :label="`Power ${state.power}`" icon="i-lucide-zap" color="primary" variant="subtle" />
        <UBadge :label="`Best ${formatTime(state.bestSurvivalMs)}`" icon="i-lucide-trophy" color="neutral" variant="subtle" />
        <UBadge :label="`${state.runsPlayed} runs`" icon="i-lucide-repeat-2" color="neutral" variant="subtle" />
        <UBadge v-if="isCoolingDown" :label="`Recharging ${cooldownLabel}`" icon="i-lucide-battery-charging" color="warning" variant="subtle" />
      </div>
      <div class="flex w-full items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 sm:w-64">
        <UIcon :name="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4 text-primary" />
        <USwitch v-model="soundEnabled" size="sm" aria-label="Enable SHAPEZZ sound" @click="onSoundToggle" />
        <USlider v-model="soundVolume" :min="0" :max="100" :disabled="!soundEnabled" size="xs" aria-label="Sound volume" />
        <span class="w-8 text-right text-[10px] font-bold tabular-nums text-muted">{{ soundVolume }}%</span>
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="aspect-video w-full rounded-xl" />
      <USkeleton class="h-40 w-full rounded-xl" />
    </div>

    <template v-else>
      <UCard class="overflow-hidden" :ui="{ body: 'p-0 sm:p-0' }">
        <div class="shapezz-arena relative aspect-video min-h-[360px] w-full overflow-hidden bg-background">
          <canvas ref="canvas" class="absolute inset-0 size-full touch-none" :class="{ 'cursor-none': running }" />

          <div v-if="running" class="pointer-events-none absolute inset-x-0 top-0 p-3 sm:p-4">
            <div class="flex items-start justify-between gap-3">
              <div class="w-52 max-w-[42vw] rounded-lg border border-white/10 bg-black/55 p-2.5 backdrop-blur-sm">
                <div class="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/70">
                  <span>Hull integrity</span>
                  <span>{{ Math.ceil(snapshot.hp) }} / {{ snapshot.maxHp }}</span>
                </div>
                <div class="h-2.5 overflow-hidden rounded-full bg-white/10">
                  <div class="h-full bg-success shadow-[0_0_14px_var(--ui-success)] transition-[width] duration-100" :style="{ width: `${hpPercent}%` }" />
                </div>
              </div>

              <div class="flex gap-2">
                <div class="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-center backdrop-blur-sm">
                  <p class="text-[9px] font-black uppercase tracking-widest text-white/50">Cash offer</p>
                  <p class="text-lg font-black tabular-nums text-warning">{{ formatNumber(cashOffer) }}</p>
                </div>
                <div class="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-center backdrop-blur-sm">
                  <p class="text-[9px] font-black uppercase tracking-widest text-white/50">Next mutation</p>
                  <p class="text-lg font-black tabular-nums text-info">{{ Math.ceil(nextMutationMs / 1000) }}s</p>
                </div>
                <UButton
                  :icon="paused ? 'i-lucide-play' : 'i-lucide-pause'"
                  color="neutral"
                  variant="outline"
                  class="pointer-events-auto self-center border-white/10 bg-black/55 backdrop-blur-sm"
                  :aria-label="paused ? 'Resume' : 'Pause'"
                  @click="togglePause"
                />
              </div>
            </div>

            <div class="mt-3 flex items-start justify-between gap-3">
              <div class="flex max-w-[70%] flex-wrap gap-1.5">
                <div
                  v-for="upgrade in activeUpgrades"
                  :key="upgrade.id"
                  class="flex items-center gap-1 rounded-md border border-white/10 bg-black/50 px-2 py-1 text-[10px] font-bold text-white/75 backdrop-blur-sm"
                >
                  <UIcon :name="upgrade.icon" class="size-3" :style="{ color: upgrade.accent }" />
                  <span>{{ upgrade.name }}</span>
                  <span class="text-white">×{{ upgrade.stacks }}</span>
                </div>
              </div>
              <div v-if="snapshot.combo > 1" class="shapezz-combo text-right text-2xl font-black italic text-warning sm:text-4xl">
                ×{{ snapshot.combo }} COMBO
              </div>
            </div>
          </div>

          <div v-if="paused" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm">
            <p class="text-xs font-black uppercase tracking-[0.5em] text-white/60">Simulation frozen</p>
            <h2 class="text-3xl font-black text-white sm:text-4xl">PAUSED</h2>
            <UButton icon="i-lucide-play" size="lg" color="primary" label="Resume" @click="togglePause" />
            <p class="text-xs text-white/40">P or Escape also toggles pause</p>
          </div>

          <Transition name="boss">
            <div v-if="bossWarning" class="pointer-events-none absolute inset-x-0 top-[38%] text-center">
              <p class="text-xs font-black uppercase tracking-[0.5em] text-secondary">Boss geometry detected</p>
              <p class="shapezz-boss mt-1 text-3xl font-black tracking-tight text-white sm:text-5xl">{{ bossWarning }}</p>
            </div>
          </Transition>

          <div v-if="checkpointOffers.length" class="absolute inset-0 z-20 overflow-y-auto bg-black/80 p-4 backdrop-blur-md sm:p-6">
            <div class="mx-auto flex min-h-full max-w-5xl flex-col justify-center">
              <div class="mb-5 text-center">
                <p class="text-xs font-black uppercase tracking-[0.35em] text-secondary">Checkpoint {{ snapshot.checkpoint }}</p>
                <h2 class="mt-1 text-2xl font-black text-white sm:text-4xl">GET STRONGER OR GET PAID</h2>
                <p class="mt-2 text-sm text-white/60">The arena is frozen. Taking a mutation starts the next 45 seconds with enemies at {{ currentPressure.health.toFixed(1) }}× health and {{ currentPressure.damage.toFixed(1) }}× mutation damage.</p>
              </div>

              <div class="grid gap-3 md:grid-cols-3">
                <button
                  v-for="upgradeId in checkpointOffers"
                  :key="upgradeId"
                  type="button"
                  class="shapezz-upgrade group relative overflow-hidden rounded-xl border border-white/15 bg-white/6 p-4 text-left transition duration-200 hover:-translate-y-1 hover:border-white/40 hover:bg-white/10 sm:p-5"
                  :disabled="settling"
                  :style="{ '--upgrade-accent': shapezzRunUpgrade(upgradeId).accent }"
                  @click="chooseUpgrade(upgradeId)"
                >
                  <div class="absolute inset-x-0 top-0 h-1 bg-[var(--upgrade-accent)] shadow-[0_0_24px_var(--upgrade-accent)]" />
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex size-11 items-center justify-center rounded-lg border border-white/10 bg-black/35">
                      <UIcon :name="shapezzRunUpgrade(upgradeId).icon" class="size-6" :style="{ color: shapezzRunUpgrade(upgradeId).accent }" />
                    </div>
                    <div class="text-right">
                      <p class="text-[9px] font-black tracking-[0.2em]" :class="rarityClass(upgradeId)">{{ rarityLabel(upgradeId) }}</p>
                      <p v-if="snapshot.upgrades[upgradeId]" class="mt-1 text-xs font-bold text-white/50">STACK {{ (snapshot.upgrades[upgradeId] ?? 0) + 1 }}</p>
                    </div>
                  </div>
                  <h3 class="mt-4 text-lg font-black text-white">{{ shapezzRunUpgrade(upgradeId).name }}</h3>
                  <p class="mt-1.5 min-h-10 text-sm leading-relaxed text-white/65">{{ shapezzRunUpgrade(upgradeId).description }}</p>
                  <p class="mt-4 flex items-center gap-1.5 text-xs font-black text-white">
                    <UIcon name="i-lucide-layers-3" class="size-3.5" /> {{ shapezzRunUpgrade(upgradeId).stackText }}
                  </p>
                </button>
              </div>

              <div class="mt-4 flex flex-col items-center justify-between gap-3 rounded-xl border border-warning/25 bg-warning/8 p-4 sm:flex-row">
                <div>
                  <p class="flex items-center gap-2 font-black text-white"><UIcon name="i-lucide-hand-coins" class="size-5 text-warning" /> WALK AWAY ALIVE</p>
                  <p class="mt-0.5 text-sm text-white/55">End this run and permanently add the offer to your balance.</p>
                </div>
                <UButton color="warning" size="xl" icon="i-lucide-banknote-arrow-down" :loading="settling" @click="cashOut">
                  Cash out {{ formatNumber(cashOffer) }}
                </UButton>
              </div>
            </div>
          </div>

          <div v-else-if="!running" class="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm">
            <UCard v-if="result" class="w-full max-w-lg bg-default/95 shadow-2xl" :ui="{ body: 'p-5 sm:p-7' }">
              <div class="text-center">
                <div class="mx-auto flex size-14 items-center justify-center rounded-2xl" :class="result.reason === 'cashout' ? 'bg-success/15 text-success' : 'bg-error/15 text-error'">
                  <UIcon :name="result.reason === 'cashout' ? 'i-lucide-party-popper' : 'i-lucide-skull'" class="size-8" />
                </div>
                <h2 class="mt-4 text-2xl font-black">{{ result.reason === 'cashout' ? 'PROFIT SECURED' : 'GEOMETRY WINS' }}</h2>
                <p class="mt-1 text-sm text-muted">{{ result.reason === 'cashout' ? 'You left before the shapes could take it back.' : 'Defeat burns the uncashed offer. Greed has a shape.' }}</p>
              </div>
              <div class="mt-5 grid grid-cols-3 gap-2">
                <div class="rounded-lg bg-elevated p-3 text-center"><p class="text-[10px] font-bold uppercase text-muted">Paid</p><p class="mt-1 font-black text-warning">{{ formatNumber(result.awarded) }}</p></div>
                <div class="rounded-lg bg-elevated p-3 text-center"><p class="text-[10px] font-bold uppercase text-muted">Time</p><p class="mt-1 font-black">{{ formatTime(result.elapsedMs) }}</p></div>
                <div class="rounded-lg bg-elevated p-3 text-center"><p class="text-[10px] font-bold uppercase text-muted">Kills</p><p class="mt-1 font-black">{{ formatNumber(result.kills) }}</p></div>
              </div>
              <UButton class="mt-5 w-full justify-center" size="lg" icon="i-lucide-rotate-ccw" label="Build another monster" @click="closeResult" />
            </UCard>

            <UCard v-else class="w-full max-w-xl bg-default/95 shadow-2xl" :ui="{ body: 'p-5 sm:p-7' }">
              <div class="text-center">
                <div class="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                  <UIcon name="i-lucide-crosshair" class="size-8" />
                </div>
                <h2 class="mt-3 text-2xl font-black">ENTER THE SHAPE STORM</h2>
                <p class="mt-1 text-sm text-muted">Difficulty controls the enemies and payout. Workshop power never secretly changes it.</p>
              </div>

              <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <UFormField label="Starting difficulty" :description="selectedDifficulty?.tagline">
                  <USelect v-model="selectedDifficultyId" :items="difficultyItems" class="w-full" size="lg" />
                </UFormField>
                <div class="rounded-lg border border-default bg-elevated px-4 py-3 text-center sm:min-w-28">
                  <p class="text-[10px] font-bold uppercase tracking-wide text-muted">Loot rate</p>
                  <p class="mt-1 text-xl font-black text-warning">{{ selectedDifficulty?.reward.toFixed(2) }}×</p>
                </div>
              </div>

              <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div class="rounded-lg bg-elevated p-2.5"><p class="text-muted">Weapon</p><p class="mt-0.5 truncate font-black" :style="{ color: state.currentWeapon.primaryColor }">{{ state.currentWeapon.name }}</p></div>
                <div class="rounded-lg bg-elevated p-2.5"><p class="text-muted">Output</p><p class="mt-0.5 font-black">{{ Math.round(state.stats.damage * state.currentWeapon.damageMultiplier) }}</p></div>
                <div class="rounded-lg bg-elevated p-2.5"><p class="text-muted">Starting HP</p><p class="mt-0.5 font-black">{{ state.stats.maxHp }}</p></div>
              </div>

              <div v-if="isCoolingDown" class="mt-5 rounded-lg border border-warning/25 bg-warning/10 p-4 text-center">
                <p class="flex items-center justify-center gap-2 font-black text-warning"><UIcon name="i-lucide-battery-charging" class="size-5" /> ARENA RECHARGING</p>
                <p class="mt-1 text-sm text-muted">The shapes are regrouping after your last run. Next run in <span class="font-black tabular-nums text-highlighted">{{ cooldownLabel }}</span>.</p>
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
                <p v-if="gems < cooldownRushCost" class="mt-2 text-xs text-muted">Need {{ cooldownRushCost }} gems; you have {{ gems }}.</p>
                <p v-else class="mt-2 text-xs text-muted">1 gem per started 10 minutes remaining.</p>
              </div>
              <UButton v-else class="mt-5 w-full justify-center" size="xl" icon="i-lucide-play" label="START THE VIOLENCE" :loading="starting" @click="startRun" />
              <p class="mt-3 text-center text-xs text-muted">Move: WASD / arrows · Jump: W / Space · Drop: S / Down · Aim: mouse · Fire: hold left click</p>
            </UCard>
          </div>
        </div>
      </UCard>

      <UAlert
        icon="i-lucide-info"
        color="neutral"
        variant="subtle"
        title="The greed contract"
        description="You can only bank at a 45-second checkpoint. Choosing a mutation rejects that offer and starts the next round. Death pays zero. There is no final wave. Every settled run puts the arena on a 2-hour recharge."
      />
    </template>
  </UContainer>
</template>

<style scoped>
.shapezz-title {
    text-shadow: 0 0 24px color-mix(in srgb, var(--ui-primary) 55%, transparent);
}

.shapezz-arena {
    box-shadow: inset 0 0 90px rgb(0 0 0 / 70%);
}

.shapezz-combo {
    text-shadow: 0 0 18px rgb(250 204 21 / 70%);
    animation: combo-pulse 0.45s ease-in-out infinite alternate;
}

.shapezz-boss {
    text-shadow: 0 0 30px rgb(232 121 249 / 85%);
}

.shapezz-upgrade::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    content: '';
    opacity: 0;
    background: radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--upgrade-accent) 24%, transparent), transparent 65%);
    transition: opacity 180ms ease;
}

.shapezz-upgrade:hover::after {
    opacity: 1;
}

.boss-enter-active,
.boss-leave-active {
    transition: all 300ms ease;
}

.boss-enter-from,
.boss-leave-to {
    opacity: 0;
    transform: scale(1.35);
}

@keyframes combo-pulse {
    from { transform: scale(0.96) rotate(-1deg); }
    to { transform: scale(1.04) rotate(1deg); }
}
</style>
