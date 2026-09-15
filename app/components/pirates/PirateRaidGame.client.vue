<script setup lang="ts">
const canvasHost = ref<HTMLDivElement | null>(null)
const toast = useToast()
const { fetchSession } = useAuth()

const { data: state, refresh } = await useFetch('/api/pirates/state')

const {
    hp, maxHp, coins, ammo, gemAmmo, preferGem, abilityCooldownMs, abilityCooldownTotalMs, abilityLocked, remainingMs,
    running, paused, starting,
    combo, comboVisible, bossName, bossVisible,
    activePowerUps, nextPowerUpMs, nextHealthPackMs,
    gameOverVisible, gameOverResult,
    attachCanvas, detachCanvas, startVoyage, pauseVoyage, resumeVoyage, cancelVoyage,
    toggleAmmoMode, closeGameOver,
    soundEnabled, soundVolume, playMenuSound
} = usePirateRun()

function clockLabel(ms: number) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
}

function durationLabel(ms: number) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
}

const hpPercent = computed(() => maxHp.value > 0 ? Math.max(0, Math.min(100, (hp.value / maxHp.value) * 100)) : 0)
const hpBarColor = computed(() => hpPercent.value > 50 ? 'bg-success' : hpPercent.value > 25 ? 'bg-warning' : 'bg-error')
const gemAmmoCapacity = computed(() => state.value?.gemAmmo.capacity ?? 0)
const timerLabel = computed(() => clockLabel(remainingMs.value))
const nextPowerUpLabel = computed(() => `${Math.max(0, Math.ceil(nextPowerUpMs.value / 1000))}s`)
const nextHealthPackLabel = computed(() => `${Math.max(0, Math.ceil(nextHealthPackMs.value / 1000))}s`)
const equippedAbility = computed(() => state.value?.abilities.find(ability => ability.equipped) ?? state.value?.abilities[0])
// The consort is unavailable while its escort is alive, but nothing is
// counting down — showing a stale number there would just read as a stuck timer.
const abilityCooldownLabel = computed(() => {
    if (abilityLocked.value) return 'At sea'
    return abilityCooldownMs.value > 0 ? `${Math.ceil(abilityCooldownMs.value / 1000)}s` : 'Ready'
})
const abilityReady = computed(() => abilityCooldownMs.value <= 0 && !abilityLocked.value)
const abilityChargePercent = computed(() => {
    if (abilityLocked.value) return 0
    return abilityCooldownTotalMs.value > 0 ? 100 - Math.max(0, Math.min(100, abilityCooldownMs.value / abilityCooldownTotalMs.value * 100)) : 100
})

const selectedDifficulty = ref(0)
const difficultySelectItems = computed(() => (state.value?.difficultyOptions ?? []).map(option => ({
    label: `Difficulty ${option.difficulty}${option.completed ? ' · cleared' : option.difficulty === state.value?.recommendedDifficulty ? ' · recommended' : ''}`,
    value: option.difficulty
})))
const selectedDifficultyInfo = computed(() => state.value?.difficultyOptions.find(option => option.difficulty === selectedDifficulty.value))
const baseDifficultyProfit = computed(() => state.value?.difficultyOptions[0]?.estimatedLoot ?? 1)
const selectedProfitMultiplier = computed(() => (selectedDifficultyInfo.value?.estimatedLoot ?? 0) / Math.max(1, baseDifficultyProfit.value))

watch(() => state.value?.recommendedDifficulty, (difficulty) => {
    if (difficulty !== undefined && !running.value && !paused.value) selectedDifficulty.value = difficulty
}, { immediate: true })

watch(gameOverVisible, (visible) => {
    if (visible && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
            isFullscreen.value = false
        })
    }
})

function powerUpStatus(powerUp: typeof activePowerUps.value[number]) {
    if (powerUp.shield !== undefined) return `${powerUp.shield}`
    if (powerUp.counter !== undefined) return `${powerUp.counter}`
    return `${Math.max(0, Math.ceil((powerUp.remainingMs ?? 0) / 1000))}s`
}
function powerUpTooltip(powerUp: typeof activePowerUps.value[number]) {
    const stack = powerUp.stacks > 1 ? ` x${powerUp.stacks}` : ''
    let status = ''
    if (powerUp.shield !== undefined) status = `${powerUp.shield} shield`
    else if (powerUp.counter !== undefined) status = `${powerUp.counter} shots`
    else status = `${Math.max(0, Math.ceil((powerUp.remainingMs ?? 0) / 1000))}s left`
    return `${powerUp.name}${stack} · ${status} — ${powerUp.description}`
}

const bestSurvivalLabel = computed(() => clockLabel(state.value?.bestSurvivalMs ?? 0))

const canSetSail = computed(() => (state.value?.cannons.length ?? 0) > 0)

const gameOverIcon = computed(() => {
    if (!gameOverResult.value) return 'i-lucide-anchor'
    if (gameOverResult.value.survived) return 'i-lucide-party-popper'
    if (gameOverResult.value.reason === 'cancelled') return 'i-lucide-flag'
    return 'i-lucide-skull'
})
const gameOverTitle = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'Made it home'
    if (gameOverResult.value.reason === 'cancelled') return 'Voyage cancelled'
    return 'Ship sunk'
})
const gameOverMessage = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'You survived the full voyage.'
    if (gameOverResult.value.reason === 'cancelled') return 'You called it early and banked what you\'d earned so far.'
    return 'Enemy cannons got the better of you.'
})
const gameOverStats = computed(() => {
    const r = gameOverResult.value
    if (!r) return []
    return [
        { label: 'Sunk', value: `${r.kills}`, icon: 'i-lucide-skull', color: 'text-error' },
        { label: 'Shots', value: `${r.shotsFired}`, icon: 'i-lucide-crosshair', color: 'text-info' },
        { label: 'Abilities', value: `${r.abilitiesUsed}`, icon: equippedAbility.value?.icon ?? 'i-lucide-bomb', color: 'text-warning' },
        { label: 'Best combo', value: `x${Math.max(1, r.maxCombo)}`, icon: 'i-lucide-flame', color: 'text-error' },
        { label: 'Survived', value: clockLabel(r.elapsedMs), icon: 'i-lucide-timer', color: 'text-primary' }
    ]
})
const gameOverRepairLabel = computed(() => durationLabel(gameOverResult.value?.repairMs ?? 0))

// Dry dock — the server is the source of truth (repair.until), we just tick
// a local clock so the countdown moves smoothly between refreshes instead of
// jumping once a minute.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

const repairUntilMs = computed(() => {
    const until = state.value?.repair?.until
    return until ? new Date(until).getTime() : 0
})
const repairRemainingMs = computed(() => Math.max(0, repairUntilMs.value - now.value))
const isRepairing = computed(() => repairRemainingMs.value > 0)
const repairProgressPercent = computed(() => {
    const total = state.value?.repair?.totalMs ?? 0
    if (total <= 0) return 100
    return Math.min(100, Math.max(0, ((total - repairRemainingMs.value) / total) * 100))
})
const repairRemainingLabel = computed(() => durationLabel(repairRemainingMs.value))
const repairRushGemCost = computed(() => state.value?.repair?.rushGemCost ?? 0)
const gems = computed(() => state.value?.gems ?? 0)
const rushing = ref(false)

async function rushRepair() {
    if (rushing.value || !isRepairing.value) return
    rushing.value = true
    try {
        const res = await $fetch('/api/pirates/repair/rush', { method: 'POST' })
        await Promise.all([refresh(), fetchSession()])
        toast.add({ title: `Repairs rushed for ${res.gemCost} gem${res.gemCost === 1 ? '' : 's'}`, color: 'success' })
    } catch (error: unknown) {
        toast.add({ title: apiErrorMessage(error, 'Failed to rush repair'), color: 'error' })
    } finally {
        rushing.value = false
    }
}

async function handleStartVoyage() {
    const s = state.value
    if (!s || !canSetSail.value || isRepairing.value) return
    playMenuSound()
    await startVoyage(s, selectedDifficulty.value)
}

const gameContainer = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)
const portalTarget = computed(() => isFullscreen.value && gameContainer.value ? gameContainer.value : true)

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        gameContainer.value?.requestFullscreen().catch(() => {
            isFullscreen.value = !isFullscreen.value
        })
    } else {
        document.exitFullscreen().catch(() => {
            isFullscreen.value = false
        })
    }
}

function handleFullscreenChange() {
    isFullscreen.value = !!document.fullscreenElement
}

let resizeObserverConnected = false

onMounted(async () => {
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
    const host = canvasHost.value
    if (!host || !state.value) return
    await attachCanvas(host, state, refresh)
    resizeObserverConnected = true
})

onUnmounted(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    if (clockTimer) clearInterval(clockTimer)
    if (resizeObserverConnected) detachCanvas()
})
</script>

<template>
  <div class="px-3 sm:px-4">
    <USkeleton v-if="!state" class="h-[60svh] rounded-xl" />

    <div
      v-else
      ref="gameContainer"
      class="pirate-game flex flex-col gap-2"
      :class="{ 'is-fullscreen': isFullscreen }"
    >
      <!-- Top bar: voyage stats while idle, the live HUD while sailing.
           Kept out of the sea so nothing covers the action. -->
      <div class="flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-default bg-elevated/80 px-3 py-1.5">
        <div v-if="running" class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <!-- Hull -->
          <div class="flex w-56 items-center gap-2">
            <UIcon name="i-lucide-heart" class="size-4 shrink-0 text-error" />
            <div class="min-w-0 flex-1">
              <div class="h-2 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full transition-[width] duration-200" :class="hpBarColor" :style="{ width: `${hpPercent}%` }" />
              </div>
            </div>
            <span class="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">{{ Math.ceil(hp) }}<span class="text-muted">/{{ maxHp }}</span></span>
          </div>

          <!-- Ammo -->
          <div class="flex items-center gap-1.5 text-xs">
            <UTooltip :text="ammo > 0 ? 'Premium shots left' : 'Free ammo, unlimited'">
              <span class="flex w-12 items-center gap-1 tabular-nums" :class="ammo > 0 ? 'text-warning' : 'text-muted'">
                <UIcon name="i-lucide-box" class="size-4" />
                {{ ammo > 0 ? ammo : '∞' }}
              </span>
            </UTooltip>
            <UButton
              v-if="gemAmmoCapacity > 0"
              size="xs"
              :color="preferGem ? 'info' : 'neutral'"
              :variant="preferGem ? 'solid' : 'subtle'"
              icon="i-lucide-gem"
              :label="`${gemAmmo}`"
              :disabled="gemAmmo === 0"
              :title="preferGem ? 'Gem shots loaded — click to unload' : 'Load gem shots'"
              @click="toggleAmmoMode"
            />
          </div>

          <!-- Clock and loot -->
          <div class="flex items-center gap-3">
            <span class="w-14 text-2xl font-black leading-none tabular-nums" :class="remainingMs < 30_000 ? 'text-error' : ''">{{ timerLabel }}</span>
            <CoinBalance :value="coins" class="w-20 text-sm font-bold tabular-nums" />
            <Transition name="combo">
              <UBadge v-if="comboVisible" color="error" variant="subtle" size="sm" icon="i-lucide-flame" :label="`x${combo}`" />
            </Transition>
            <Transition name="combo">
              <UBadge v-if="bossVisible" color="error" variant="solid" size="sm" icon="i-lucide-skull" :label="bossName" class="animate-pulse" />
            </Transition>
          </div>

          <!-- Power-ups -->
          <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            <UTooltip v-for="powerUp in activePowerUps" :key="powerUp.id" :text="powerUpTooltip(powerUp)">
              <span class="flex min-w-14 shrink-0 items-center justify-center gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-xs font-bold tabular-nums text-primary">
                <span class="leading-none">{{ powerUp.icon }}</span>
                <span v-if="powerUp.stacks > 1" class="text-[10px] opacity-70">x{{ powerUp.stacks }}</span>
                {{ powerUpStatus(powerUp) }}
              </span>
            </UTooltip>
            <span class="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted">
              <UIcon name="i-lucide-sparkles" class="size-3" /><span class="w-6">{{ nextPowerUpLabel }}</span>
              <UIcon name="i-lucide-heart-pulse" class="size-3" /><span class="w-6">{{ nextHealthPackLabel }}</span>
            </span>
          </div>

          <!-- Ability and controls -->
          <div class="flex items-center gap-1.5">
            <UTooltip :text="`${equippedAbility?.name ?? 'Ability'} — right-click the sea`">
              <div
                class="relative flex h-8 min-w-24 items-center justify-center gap-1.5 overflow-hidden rounded-md border px-2.5 text-xs font-bold transition-colors"
                :class="abilityReady ? 'border-primary/50 bg-primary/15 text-primary' : 'border-default bg-default text-muted'"
              >
                <div v-if="!abilityReady" class="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-100" :style="{ width: `${abilityChargePercent}%` }" />
                <UIcon :name="equippedAbility?.icon ?? 'i-lucide-bomb'" class="relative size-4" />
                <span class="relative tabular-nums">{{ abilityCooldownLabel }}</span>
              </div>
            </UTooltip>
            <UButton size="sm" color="neutral" variant="subtle" icon="i-lucide-pause" aria-label="Pause" @click="pauseVoyage" />
            <UButton size="sm" color="error" variant="subtle" icon="i-lucide-flag" aria-label="Retreat" @click="cancelVoyage" />
          </div>
        </div>
        <div v-else class="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted">
          <template v-if="paused">
            <UIcon name="i-lucide-pause" class="size-3.5 text-primary" />
            <span>Paused · Difficulty {{ selectedDifficulty }}</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-anchor" class="size-3.5 text-primary" />
            <span class="font-semibold text-default">Power {{ state.power }}</span>
            <span class="hidden sm:inline">· Best {{ bestSurvivalLabel }} · {{ state.runsPlayed }} voyages</span>
            <UBadge v-if="isRepairing" color="warning" variant="subtle" size="sm" icon="i-lucide-wrench" :label="`Dry dock ${repairRemainingLabel}`" class="ml-1" />
          </template>
        </div>
        <div class="flex shrink-0 items-center gap-0.5">
          <UPopover :portal="portalTarget">
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
              aria-label="Sound settings"
            />
            <template #content>
              <div class="w-56 space-y-3 p-3.5">
                <div class="flex items-center justify-between text-sm">
                  <span class="font-semibold">Sound</span>
                  <USwitch v-model="soundEnabled" size="sm" @click="playMenuSound" />
                </div>
                <div class="flex items-center gap-3" :class="!soundEnabled && 'opacity-40'">
                  <USlider v-model="soundVolume" :min="0" :max="100" :disabled="!soundEnabled" size="sm" aria-label="Sound volume" />
                  <span class="w-8 text-right text-xs tabular-nums text-muted">{{ soundVolume }}%</span>
                </div>
              </div>
            </template>
          </UPopover>
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            :icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
            :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
            @click="toggleFullscreen"
          />
        </div>
      </div>

      <!-- Sea -->
      <div class="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-[#0b1a2b] ring-1 ring-default">
        <div ref="canvasHost" class="absolute inset-0 flex items-center justify-center overflow-hidden" />

        <!-- Paused -->
        <div v-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div class="w-full max-w-xs space-y-4 text-center">
            <UIcon name="i-lucide-pause" class="mx-auto size-8 text-white" />
            <div>
              <p class="text-lg font-bold text-white">
                Paused
              </p>
              <p class="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/70">
                {{ timerLabel }} left · {{ Math.ceil(hp) }}/{{ maxHp }} hull · <CoinBalance :value="coins" />
              </p>
            </div>
            <div class="flex flex-col gap-2">
              <UButton block size="lg" icon="i-lucide-play" label="Resume" @click="resumeVoyage" />
              <UButton block color="error" variant="subtle" icon="i-lucide-flag" label="Retreat and bank loot" @click="cancelVoyage" />
            </div>
          </div>
        </div>

        <!-- Dry dock -->
        <div v-else-if="isRepairing" class="absolute inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div class="w-full max-w-xs space-y-4 text-center">
            <UIcon name="i-lucide-wrench" class="mx-auto size-8 text-warning" />
            <div>
              <p class="text-lg font-bold text-white">
                In dry dock
              </p>
              <p class="mt-1 text-sm text-white/70">
                Back on the water in {{ repairRemainingLabel }}
              </p>
            </div>
            <UProgress :model-value="repairProgressPercent" color="warning" size="sm" />
            <div>
              <UButton
                block
                size="lg"
                color="neutral"
                variant="subtle"
                icon="i-lucide-gem"
                :label="`Rush for ${repairRushGemCost} gem${repairRushGemCost === 1 ? '' : 's'}`"
                :loading="rushing"
                :disabled="gems < repairRushGemCost"
                @click="rushRepair"
              />
              <p v-if="gems < repairRushGemCost" class="mt-2 text-xs text-white/50">
                You have {{ gems }} gems.
              </p>
            </div>
          </div>
        </div>

        <!-- Set sail -->
        <div v-else-if="!running" class="absolute inset-0 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]">
          <UCard class="w-full max-w-sm bg-default/95 shadow-2xl" :ui="{ body: 'p-5 space-y-4' }">
            <div class="flex items-center gap-3">
              <UIcon name="i-lucide-sailboat" class="size-7 shrink-0 text-primary" />
              <div class="min-w-0">
                <p class="text-lg font-bold leading-tight">
                  Set sail
                </p>
                <p class="text-xs text-muted">
                  Survive 6 minutes for the bonus.
                </p>
              </div>
            </div>

            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span class="flex items-center gap-1.5" :class="state.cannons.length === 0 ? 'text-error' : 'text-muted'">
                <UIcon name="i-lucide-crosshair" class="size-3.5" />
                <span class="font-semibold text-default">{{ state.cannons.length }}/{{ state.cannonSlots }}</span> cannons
              </span>
              <span class="flex items-center gap-1.5 text-muted">
                <UIcon :name="equippedAbility?.icon ?? 'i-lucide-bomb'" class="size-3.5" />
                <span class="font-semibold text-default">{{ equippedAbility?.name ?? 'Powder Keg' }}</span>
                <span v-if="equippedAbility">Lv {{ equippedAbility.level }}</span>
              </span>
              <span class="flex items-center gap-1.5 text-muted">
                <UIcon name="i-lucide-box" class="size-3.5" />
                <span class="font-semibold text-default">{{ state.ammo.count }}</span> premium
                <span v-if="gemAmmoCapacity > 0">· <span class="font-semibold text-default">{{ state.gemAmmo.count }}</span> gem</span>
              </span>
            </div>

            <div class="space-y-2">
              <USelect v-model="selectedDifficulty" :items="difficultySelectItems" value-key="value" :portal="portalTarget" icon="i-lucide-waves" class="w-full" />
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-lg bg-elevated px-3 py-2">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Est. loot · {{ selectedProfitMultiplier.toFixed(1) }}x
                  </p>
                  <CoinBalance :value="selectedDifficultyInfo?.estimatedLoot ?? 0" class="mt-0.5 text-sm font-bold" />
                </div>
                <div class="rounded-lg bg-elevated px-3 py-2">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Completion bonus
                  </p>
                  <CoinBalance :value="selectedDifficultyInfo?.completionBonus ?? 0" class="mt-0.5 text-sm font-bold text-primary" />
                </div>
              </div>
            </div>

            <UButton
              v-if="canSetSail"
              block
              size="lg"
              icon="i-lucide-anchor"
              label="Set Sail"
              :loading="starting"
              @click="handleStartVoyage"
            />
            <div v-else class="space-y-2">
              <p class="text-center text-xs text-error">
                Equip a cannon before setting sail.
              </p>
              <UButton block size="lg" to="/pirates/manage" icon="i-lucide-hammer" label="Go to Armory" />
            </div>
          </UCard>
        </div>
      </div>

    </div>

    <UModal
      v-model:open="gameOverVisible"
      :title="gameOverTitle"
      :dismissible="false"
      :close="false"
      :portal="portalTarget"
      scrollable
      :ui="{ content: 'max-w-lg' }"
    >
      <template #body>
        <div v-if="gameOverResult" class="space-y-4">
          <div class="flex items-center gap-3">
            <UIcon
              :name="gameOverIcon"
              class="size-8 shrink-0"
              :class="gameOverResult.survived ? 'text-primary' : gameOverResult.reason === 'cancelled' ? 'text-muted' : 'text-error'"
            />
            <div>
              <p class="text-sm text-muted">
                {{ gameOverMessage }}
              </p>
              <p class="text-xs text-muted">
                Difficulty {{ gameOverResult.difficulty }}<span v-if="gameOverResult.completed" class="text-success"> · cleared</span>
              </p>
            </div>
          </div>

          <div class="rounded-xl bg-warning/10 p-4 text-center">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              Loot secured
            </p>
            <CoinBalance :value="gameOverResult.awarded" class="mt-1 justify-center text-3xl font-black" />
            <p v-if="gameOverResult.completionBonus > 0" class="mt-1 flex items-center justify-center gap-1 text-xs font-semibold text-primary">
              includes <CoinBalance :value="gameOverResult.completionBonus" :show-icon="false" /> completion bonus
            </p>
            <p v-if="gameOverResult.capped" class="mt-1 text-xs text-muted">
              Payout capped for this voyage's duration.
            </p>
          </div>

          <div class="grid grid-cols-5 gap-1 text-center">
            <div v-for="stat in gameOverStats" :key="stat.label" class="rounded-lg bg-elevated px-1 py-2">
              <UIcon :name="stat.icon" class="mx-auto mb-1 size-4" :class="stat.color" />
              <p class="text-base font-black tabular-nums">
                {{ stat.value }}
              </p>
              <p class="text-[10px] text-muted">
                {{ stat.label }}
              </p>
            </div>
          </div>

          <div v-if="gameOverResult.sunkByType.length" class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="ship in gameOverResult.sunkByType"
              :key="ship.id"
              color="neutral"
              variant="subtle"
              size="sm"
              :label="`${ship.name} ×${ship.count}`"
            />
          </div>

          <UAlert
            v-if="gameOverResult.repairMs > 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-wrench"
            :title="`Dry dock for ${gameOverRepairLabel} before your next voyage`"
          />

          <div class="flex gap-2">
            <UButton block color="neutral" variant="subtle" label="Manage ship" to="/pirates/manage" @click="closeGameOver" />
            <UButton block icon="i-lucide-anchor" label="Back to port" @click="closeGameOver" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.combo-enter-active {
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.combo-leave-active {
  transition: all 0.2s ease;
}
.combo-enter-from {
  opacity: 0;
  transform: scale(1.6);
}
.combo-leave-to {
  opacity: 0;
}

/* Sea plus HUD fit the viewport, so the whole voyage is visible without scrolling. */
.pirate-game {
  height: calc(100svh - 8rem);
  min-height: 460px;
}

.pirate-game:fullscreen,
.pirate-game.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  width: 100vw;
  height: 100vh;
  min-height: 0;
  background-color: var(--ui-bg, #090d16);
  padding: 0.5rem;
  box-sizing: border-box;
  overflow: hidden;
}
</style>
