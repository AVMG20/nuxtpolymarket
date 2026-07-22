<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid'
})

const canvasHost = ref<HTMLDivElement | null>(null)
const toast = useToast()
const { fetchSession } = useAuth()

const { data: state, refresh } = await useFetch('/api/pirates/state')

const {
    hp, maxHp, coins, ammo, gemAmmo, preferGem, abilityCooldownMs, abilityCooldownTotalMs, remainingMs,
    running, paused, starting,
    combo, comboVisible, bossName, bossVisible,
    activePowerUps, nextPowerUpMs, nextHealthPackMs,
    gameOverVisible, gameOverResult,
    attachCanvas, detachCanvas, startVoyage, pauseVoyage, resumeVoyage, cancelVoyage,
    toggleAmmoMode, closeGameOver,
    soundEnabled, soundVolume, playMenuSound
} = usePirateRun()

const hpPercent = computed(() => maxHp.value > 0 ? Math.max(0, Math.min(100, (hp.value / maxHp.value) * 100)) : 0)
const hpBarColor = computed(() => hpPercent.value > 50 ? 'bg-success' : hpPercent.value > 25 ? 'bg-warning' : 'bg-error')
const ammoCapacity = computed(() => state.value?.ammo.capacity ?? 0)
const ammoPercent = computed(() => ammoCapacity.value > 0 ? Math.max(0, Math.min(100, (ammo.value / ammoCapacity.value) * 100)) : 0)
const gemAmmoCapacity = computed(() => state.value?.gemAmmo.capacity ?? 0)
const gemAmmoPercent = computed(() => gemAmmoCapacity.value > 0 ? Math.max(0, Math.min(100, (gemAmmo.value / gemAmmoCapacity.value) * 100)) : 0)
const timerLabel = computed(() => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs.value / 1000))
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})
const nextPowerUpLabel = computed(() => `${Math.max(0, Math.ceil(nextPowerUpMs.value / 1000))}s`)
const nextHealthPackLabel = computed(() => `${Math.max(0, Math.ceil(nextHealthPackMs.value / 1000))}s`)
const equippedAbility = computed(() => state.value?.abilities.find(ability => ability.equipped) ?? state.value?.abilities[0])
const abilityCooldownLabel = computed(() => abilityCooldownMs.value > 0 ? `${Math.ceil(abilityCooldownMs.value / 1000)}s` : 'Ready')
const abilityCooldownPercent = computed(() => abilityCooldownTotalMs.value > 0 ? Math.max(0, Math.min(100, abilityCooldownMs.value / abilityCooldownTotalMs.value * 100)) : 0)
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

function powerUpStatus(powerUp: typeof activePowerUps.value[number]) {
    const stack = powerUp.stacks > 1 ? `x${powerUp.stacks}` : ''
    let status = ''
    if (powerUp.shield !== undefined) status = `${powerUp.shield} shield`
    else if (powerUp.counter !== undefined) status = `${powerUp.counter} shots`
    else status = `${Math.max(0, Math.ceil((powerUp.remainingMs ?? 0) / 1000))}s`
    return [stack, status].filter(Boolean).join(' · ')
}
const bestSurvivalLabel = computed(() => {
    const totalSeconds = Math.floor((state.value?.bestSurvivalMs ?? 0) / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})

const canSetSail = computed(() =>
    (state.value?.cannons.length ?? 0) > 0
)
const blockReason = computed(() => {
    if (!state.value) return null
    if (state.value.cannons.length === 0) return 'Your gun deck is empty — equip a cannon before setting sail.'
    return null
})

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
const gameOverSurvivalLabel = computed(() => {
    const totalSeconds = Math.floor((gameOverResult.value?.elapsedMs ?? 0) / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})
const gameOverRepairLabel = computed(() => durationLabel(gameOverResult.value?.repairMs ?? 0))

// Dry dock — the server is the source of truth (repair.until), we just tick
// a local clock so the countdown moves smoothly between refreshes instead of
// jumping once a minute.
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

function durationLabel(ms: number) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
    const h = Math.floor(totalSeconds / 3600)
    const m = Math.floor((totalSeconds % 3600) / 60)
    const s = totalSeconds % 60
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
}

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

let resizeObserverConnected = false

onMounted(async () => {
    clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
    const host = canvasHost.value
    if (!host || !state.value) return
    await attachCanvas(host, state, refresh)
    resizeObserverConnected = true
})

onUnmounted(() => {
    if (clockTimer) clearInterval(clockTimer)
    if (resizeObserverConnected) detachCanvas()
})
</script>

<template>
  <UContainer class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Pirate Raid
        </h1>
        <p class="text-sm text-muted mt-0.5">
          Sail out for 6 minutes, stack wild power-ups, and survive the final overrun.
        </p>
      </div>
      <div v-if="state" class="flex items-center gap-2">
        <UBadge color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-anchor" />
        <UBadge color="neutral" variant="subtle" :label="`Best ${bestSurvivalLabel}`" icon="i-lucide-trophy" />
        <UBadge color="neutral" variant="subtle" :label="`${state.runsPlayed} voyages`" icon="i-lucide-map" />
        <UBadge v-if="isRepairing" color="warning" variant="subtle" :label="`Dry dock ${repairRemainingLabel}`" icon="i-lucide-wrench" />
      </div>
      <div class="flex w-full items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-2 sm:w-64">
        <UIcon :name="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4 text-primary" />
        <USwitch v-model="soundEnabled" size="sm" aria-label="Enable pirate game sound" @click="playMenuSound" />
        <USlider v-model="soundVolume" :min="0" :max="100" :disabled="!soundEnabled" size="xs" aria-label="Sound volume" />
        <span class="w-8 text-right text-[10px] font-bold tabular-nums text-muted">{{ soundVolume }}%</span>
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-80 rounded-xl" />
    </div>

    <template v-else>
      <!-- Game viewport -->
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="relative w-full overflow-hidden rounded-lg" style="aspect-ratio: 1400 / 820;">
          <div ref="canvasHost" class="absolute inset-0" />

          <!-- Paused overlay -->
          <div v-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="text-center space-y-3 px-4">
              <UIcon name="i-lucide-pause-circle" class="size-10 text-primary mx-auto" />
              <p class="text-white font-semibold text-lg">
                Voyage paused
              </p>
              <div class="mx-auto flex max-w-xs flex-wrap items-center justify-center gap-x-1 text-sm text-white/70">
                <span>{{ Math.ceil(hp) }} / {{ maxHp }} hull,</span>
                <CoinBalance :value="coins" />
                <span>banked, {{ timerLabel }} left on the clock.</span>
              </div>
              <div class="flex items-center justify-center gap-2">
                <UButton size="lg" icon="i-lucide-play" label="Resume Voyage" @click="resumeVoyage" />
                <UButton size="lg" color="error" variant="subtle" icon="i-lucide-flag" label="Cancel Voyage" @click="cancelVoyage" />
              </div>
            </div>
          </div>

          <!-- Dry dock overlay -->
          <div v-else-if="isRepairing" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="text-center space-y-3 px-4 w-full max-w-xs mx-auto">
              <UIcon name="i-lucide-wrench" class="size-10 text-primary mx-auto" />
              <p class="text-white font-semibold text-lg">
                Ship in dry dock
              </p>
              <p class="text-white/70 text-sm">
                Patching up hull damage from the last voyage — back on the water in {{ repairRemainingLabel }}.
              </p>
              <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                <div class="h-full rounded-full bg-primary transition-[width] duration-1000" :style="{ width: `${repairProgressPercent}%` }" />
              </div>
              <UButton
                size="lg"
                color="neutral"
                variant="subtle"
                icon="i-lucide-gem"
                :loading="rushing"
                :disabled="gems < repairRushGemCost"
                @click="rushRepair"
              >
                <span class="flex items-center gap-1.5">
                  Rush Repair
                  <span class="opacity-80">·</span>
                  {{ repairRushGemCost }} gem{{ repairRushGemCost === 1 ? '' : 's' }}
                </span>
              </UButton>
              <p v-if="gems < repairRushGemCost" class="text-red-300 text-xs">
                Need {{ repairRushGemCost }} gems; you have {{ gems }}.
              </p>
              <p v-else class="text-white/60 text-xs">
                1 gem per started 10 minutes remaining.
              </p>
            </div>
          </div>

          <!-- Pre-voyage overlay -->
          <div v-else-if="!running" class="absolute inset-0 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
            <UCard class="w-full max-w-lg bg-default/95 shadow-2xl" :ui="{ body: 'p-5 sm:p-6' }">
              <div class="mb-4 flex items-center justify-center gap-2">
                <UIcon name="i-lucide-sailboat" class="size-6 text-primary" />
                <p class="text-lg font-bold">
                  Ready to set sail?
                </p>
              </div>

              <div class="grid grid-cols-2 gap-2.5 text-left">
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <UIcon name="i-lucide-crosshair" class="size-3.5 text-primary" /> Cannons
                  </p>
                  <p class="mt-1 text-lg font-black tabular-nums">
                    {{ state.cannons.length }} / {{ state.cannonSlots }}
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <UIcon name="i-lucide-box" class="size-3.5 text-warning" /> Ammo
                  </p>
                  <p class="mt-1 text-sm font-black tabular-nums">
                    {{ state.ammo.count }} premium
                  </p>
                  <p class="text-[10px] text-muted">
                    {{ state.gemAmmo.count }} gem · free ammo unlimited
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <UIcon :name="equippedAbility?.icon ?? 'i-lucide-bomb'" class="size-3.5 text-primary" /> Ability
                  </p>
                  <p class="mt-1 truncate text-sm font-black">
                    {{ equippedAbility?.name ?? 'Powder Keg' }}
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    <UIcon name="i-lucide-gauge" class="size-3.5 text-success" /> Power
                  </p>
                  <p class="mt-1 text-lg font-black tabular-nums">
                    {{ state.power }}
                  </p>
                </div>
              </div>

              <div class="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-left">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="flex items-center gap-1.5 text-xs font-bold">
                      <UIcon name="i-lucide-waves" class="size-4 text-primary" /> Voyage difficulty
                    </p>
                    <p class="mt-0.5 text-[10px] text-muted">
                      Enemy strength and loot scale with the selected tier.
                    </p>
                  </div>
                  <UBadge v-if="selectedDifficulty === state.recommendedDifficulty" color="primary" variant="subtle" label="Recommended" />
                </div>
                <USelect v-model="selectedDifficulty" :items="difficultySelectItems" value-key="value" class="mt-2 w-full" />
                <div class="mt-2 flex items-center justify-between text-xs">
                  <span class="text-muted">Estimated in-run loot</span>
                  <span class="flex items-center gap-2 font-bold">
                    <UBadge color="success" variant="subtle" :label="`${selectedProfitMultiplier.toFixed(1)}x profit`" />
                    <CoinBalance :value="selectedDifficultyInfo?.estimatedLoot ?? 0" />
                  </span>
                </div>
                <div class="mt-1.5 flex items-center justify-between border-t border-primary/20 pt-1.5 text-xs">
                  <span class="flex items-center gap-1 text-muted">
                    <UIcon name="i-lucide-flag-triangle-right" class="size-3.5 text-primary" /> Completion bonus
                  </span>
                  <span class="flex items-center gap-1 font-bold text-primary">
                    +<CoinBalance :value="selectedDifficultyInfo?.completionBonus ?? 0" />
                  </span>
                </div>
                <p class="mt-1 text-[10px] leading-snug text-muted">
                  Survive the full 6-minute voyage to claim the completion bonus on top of your loot.
                </p>
              </div>

              <template v-if="canSetSail">
                <UButton
                  block
                  class="mt-4"
                  size="lg"
                  icon="i-lucide-anchor"
                  label="Set Sail"
                  :loading="starting"
                  @click="handleStartVoyage"
                />
              </template>
              <template v-else>
                <p class="mt-4 text-center text-xs text-error">
                  {{ blockReason }}
                </p>
                <UButton block class="mt-2" size="lg" to="/pirates/manage" icon="i-lucide-hammer" label="Go to Armory" />
              </template>
            </UCard>
          </div>
        </div>

        <!-- Reserved control deck: normal document flow keeps every stat off the sea. -->
        <div v-if="running" class="border-t border-default bg-elevated/80 p-3 sm:p-4">
          <div class="grid gap-3 lg:grid-cols-[minmax(250px,1.2fr)_minmax(180px,0.8fr)_minmax(300px,1.5fr)_auto]">
            <!-- Hull and magazines -->
            <section class="rounded-lg border border-default bg-default p-3 space-y-2.5">
              <div class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-heart" class="size-4 text-error" /> Hull integrity</span>
                <span class="tabular-nums text-muted">{{ Math.ceil(hp) }} / {{ maxHp }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full transition-[width] duration-200" :class="hpBarColor" :style="{ width: `${hpPercent}%` }" />
              </div>

              <div class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-box" class="size-4" /> Premium shots</span>
                <span v-if="ammo > 0" class="tabular-nums">{{ ammo }} / {{ ammoCapacity }}</span>
                <span v-else class="font-medium text-muted">Free ammo active</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full bg-warning transition-[width] duration-200" :style="{ width: `${ammoPercent}%` }" />
              </div>

              <div v-if="gemAmmoCapacity > 0" class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center justify-between text-[11px] text-info">
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-gem" class="size-3.5" /> Gem shots</span>
                    <span class="tabular-nums">{{ gemAmmo }} / {{ gemAmmoCapacity }}</span>
                  </div>
                  <div class="h-1.5 overflow-hidden rounded-full bg-accented">
                    <div class="h-full rounded-full bg-info transition-[width] duration-200" :style="{ width: `${gemAmmoPercent}%` }" />
                  </div>
                </div>
                <UButton
                  size="xs"
                  :color="preferGem ? 'info' : 'neutral'"
                  :variant="preferGem ? 'solid' : 'subtle'"
                  icon="i-lucide-gem"
                  :label="preferGem ? 'Loaded' : 'Load'"
                  :disabled="gemAmmo === 0"
                  @click="toggleAmmoMode"
                />
              </div>
            </section>

            <!-- Voyage clock and score -->
            <section class="rounded-lg border border-default bg-default p-3 text-center flex flex-col justify-center gap-2">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Time remaining
                </p>
                <p class="text-3xl font-black tabular-nums leading-tight">
                  {{ timerLabel }}
                </p>
              </div>
              <div class="flex flex-wrap items-center justify-center gap-2">
                <UBadge color="warning" variant="subtle">
                  <CoinBalance :value="coins" />
                </UBadge>
                <Transition name="combo">
                  <UBadge v-if="comboVisible" color="error" variant="subtle" :label="`Combo x${combo}`" icon="i-lucide-flame" />
                </Transition>
              </div>
              <Transition name="boss">
                <div v-if="bossVisible" class="rounded-md border border-error/40 bg-error/10 px-2 py-1 text-xs text-error animate-pulse">
                  <span class="font-black uppercase">Flagship:</span> {{ bossName }}
                </div>
              </Transition>
            </section>

            <!-- Power-up rack -->
            <section class="rounded-lg border border-default bg-default p-3">
              <div class="mb-2 flex flex-wrap items-center justify-between gap-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                <span class="flex items-center gap-1"><UIcon name="i-lucide-sparkles" class="size-3.5 text-primary" /> Active powers</span>
                <span class="tabular-nums">Drop {{ nextPowerUpLabel }} · Repair {{ nextHealthPackLabel }}</span>
              </div>
              <div v-if="activePowerUps.length" class="grid gap-1.5 sm:grid-cols-2">
                <div
                  v-for="powerUp in activePowerUps"
                  :key="powerUp.id"
                  class="flex min-w-0 items-center gap-2 rounded-md bg-elevated px-2 py-1.5"
                  :title="powerUp.description"
                >
                  <span class="text-base leading-none">{{ powerUp.icon }}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[11px] font-bold leading-tight">
                      {{ powerUp.name }}
                    </p>
                    <p class="truncate text-[9px] leading-tight text-muted">
                      {{ powerUp.description }}
                    </p>
                  </div>
                  <span class="shrink-0 text-[10px] font-black tabular-nums text-primary">{{ powerUpStatus(powerUp) }}</span>
                </div>
              </div>
              <p v-else class="flex min-h-11 items-center justify-center text-xs text-muted">
                Watch the sea for a glowing supply buoy.
              </p>
            </section>

            <!-- Voyage controls -->
            <section class="flex items-center justify-center gap-2 lg:flex-col">
              <div
                class="w-full min-w-30 overflow-hidden rounded-lg border px-2.5 py-2 text-center transition-colors"
                :class="abilityCooldownMs <= 0 ? 'border-primary/50 bg-primary/10 text-primary' : 'border-default bg-default text-muted'"
              >
                <div class="flex items-center justify-center gap-1.5 text-xs font-bold">
                  <UIcon :name="equippedAbility?.icon ?? 'i-lucide-bomb'" class="size-4" />
                  {{ equippedAbility?.name ?? 'Ability' }} {{ abilityCooldownLabel }}
                </div>
                <p class="mt-0.5 text-[9px] uppercase tracking-wide">
                  Right-click sea
                </p>
                <div class="mt-1 h-1 overflow-hidden rounded-full bg-accented">
                  <div class="h-full rounded-full bg-primary transition-[width] duration-100" :style="{ width: `${100 - abilityCooldownPercent}%` }" />
                </div>
              </div>
              <UButton color="neutral" variant="subtle" icon="i-lucide-pause" label="Pause" @click="pauseVoyage" />
              <UButton color="error" variant="subtle" icon="i-lucide-flag" label="Retreat" @click="cancelVoyage" />
            </section>
          </div>
        </div>
      </UCard>
    </template>

    <UModal
      v-model:open="gameOverVisible"
      :title="gameOverTitle"
      :dismissible="false"
      :close="false"
      scrollable
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div v-if="gameOverResult" class="space-y-4">
          <div class="text-center">
            <div class="mx-auto flex size-16 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
              <UIcon
                :name="gameOverIcon"
                class="size-9"
                :class="gameOverResult.survived ? 'text-primary' : gameOverResult.reason === 'cancelled' ? 'text-muted' : 'text-error'"
              />
            </div>
            <p class="mt-2 text-sm text-muted">
              {{ gameOverMessage }}
            </p>
          </div>

          <div class="rounded-xl border border-warning/30 bg-warning/10 p-4 text-center">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              Loot secured
            </p>
            <CoinBalance :value="gameOverResult.awarded" class="mt-1 justify-center text-3xl font-black" />
            <div v-if="gameOverResult.completionBonus > 0" class="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-primary">
              <UIcon name="i-lucide-flag-triangle-right" class="size-3.5" />
              <span>Includes +<CoinBalance :value="gameOverResult.completionBonus" class="inline-flex" /> completion bonus</span>
            </div>
          </div>

          <div class="flex justify-center">
            <UBadge
              :color="gameOverResult.completed ? 'success' : 'neutral'"
              variant="subtle"
              :icon="gameOverResult.completed ? 'i-lucide-badge-check' : 'i-lucide-waves'"
              :label="`Difficulty ${gameOverResult.difficulty}${gameOverResult.completed ? ' completed' : ''}`"
            />
          </div>

          <div class="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-skull" class="mx-auto mb-1 size-4 text-error" />
              <p class="text-lg font-black">
                {{ gameOverResult.kills }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Ships sunk
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-crosshair" class="mx-auto mb-1 size-4 text-info" />
              <p class="text-lg font-black tabular-nums">
                {{ gameOverResult.shotsFired }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Shots fired
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon :name="equippedAbility?.icon ?? 'i-lucide-bomb'" class="mx-auto mb-1 size-4 text-warning" />
              <p class="text-lg font-black tabular-nums">
                {{ gameOverResult.abilitiesUsed }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Abilities used
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-flame" class="mx-auto mb-1 size-4 text-error" />
              <p class="text-lg font-black">
                x{{ Math.max(1, gameOverResult.maxCombo) }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Best combo
              </p>
            </div>
            <div class="col-span-2 rounded-lg bg-elevated px-2 py-3 sm:col-span-1">
              <UIcon name="i-lucide-timer" class="mx-auto mb-1 size-4 text-primary" />
              <p class="text-lg font-black tabular-nums">
                {{ gameOverSurvivalLabel }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Survived
              </p>
            </div>
          </div>

          <div v-if="gameOverResult.sunkByType.length" class="rounded-xl border border-default bg-elevated/50 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-list-collapse" class="size-4" /> Sunk by class
            </p>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="ship in gameOverResult.sunkByType"
                :key="ship.id"
                color="neutral"
                variant="subtle"
                :label="`${ship.name} ×${ship.count}`"
              />
            </div>
          </div>

          <p v-if="gameOverResult.capped" class="text-xs text-muted">
            Payout capped for this voyage's duration.
          </p>
          <p v-if="gameOverResult.repairMs > 0" class="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 flex items-center justify-center gap-1.5">
            <UIcon name="i-lucide-wrench" class="size-3.5" />
            Dry dock for {{ gameOverRepairLabel }} before your next voyage
          </p>
          <div class="flex gap-2 border-t border-default pt-4">
            <UButton block color="neutral" variant="subtle" label="Manage Ship" to="/pirates/manage" @click="closeGameOver" />
            <UButton block icon="i-lucide-anchor" label="Back to port" @click="closeGameOver" />
          </div>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>

<style scoped>
.list-enter-active,
.list-leave-active {
  transition: all 0.25s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
.combo-enter-active {
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.combo-leave-active {
  transition: all 0.2s ease;
}
.combo-enter-from {
  opacity: 0;
  transform: scale(1.8);
}
.combo-leave-to {
  opacity: 0;
}
.boss-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.boss-leave-active {
  transition: all 0.3s ease;
}
.boss-enter-from {
  opacity: 0;
  transform: translate(-50%, -12px) scale(1.3);
}
.boss-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px);
}
.power-up-enter-active {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.power-up-leave-active {
  transition: all 0.25s ease;
}
.power-up-enter-from {
  opacity: 0;
  transform: translate(-50%, -12px) scale(1.25);
}
.power-up-leave-to {
  opacity: 0;
  transform: translate(-50%, -8px) scale(0.9);
}
</style>
