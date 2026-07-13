<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid'
})

const canvasHost = ref<HTMLDivElement | null>(null)

const { data: state, refresh } = await useFetch('/api/pirates/state')

const {
    hp, maxHp, coins, ammo, gemAmmo, preferGem, remainingMs,
    running, paused, starting,
    killFeed, combo, comboVisible, bossName, bossVisible,
    gameOverVisible, gameOverResult,
    attachCanvas, detachCanvas, startVoyage, pauseVoyage, resumeVoyage, cancelVoyage,
    toggleAmmoMode, closeGameOver
} = usePirateRun()

const hpPercent = computed(() => maxHp.value > 0 ? Math.max(0, Math.min(100, (hp.value / maxHp.value) * 100)) : 0)
const hpBarColor = computed(() => hpPercent.value > 50 ? 'bg-emerald-400' : hpPercent.value > 25 ? 'bg-amber-400' : 'bg-red-500')
const ammoCapacity = computed(() => state.value?.ammo.capacity ?? 0)
const ammoPercent = computed(() => ammoCapacity.value > 0 ? Math.max(0, Math.min(100, (ammo.value / ammoCapacity.value) * 100)) : 0)
const ammoLow = computed(() => ammoCapacity.value > 0 && ammoPercent.value <= 20 && gemAmmo.value === 0)
const gemAmmoCapacity = computed(() => state.value?.gemAmmo.capacity ?? 0)
const gemAmmoPercent = computed(() => gemAmmoCapacity.value > 0 ? Math.max(0, Math.min(100, (gemAmmo.value / gemAmmoCapacity.value) * 100)) : 0)
const timerLabel = computed(() => {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs.value / 1000))
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})
const bestSurvivalLabel = computed(() => {
    const totalSeconds = Math.floor((state.value?.bestSurvivalMs ?? 0) / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})

const canSetSail = computed(() =>
    (state.value?.cannons.length ?? 0) > 0
    && ((state.value?.ammo.count ?? 0) + (state.value?.gemAmmo.count ?? 0)) > 0
)
const blockReason = computed(() => {
    if (!state.value) return null
    if (state.value.cannons.length === 0) return 'Your gun deck is empty — equip a cannon before setting sail.'
    if (state.value.ammo.count === 0 && state.value.gemAmmo.count === 0) return 'Your ammo hold is empty — stock up before setting sail.'
    return null
})

const gameOverIcon = computed(() => {
    if (!gameOverResult.value) return 'i-lucide-anchor'
    if (gameOverResult.value.survived) return 'i-lucide-party-popper'
    if (gameOverResult.value.reason === 'ammo') return 'i-lucide-box'
    if (gameOverResult.value.reason === 'cancelled') return 'i-lucide-flag'
    return 'i-lucide-skull'
})
const gameOverTitle = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'Made it home'
    if (gameOverResult.value.reason === 'ammo') return 'Ammo hold empty'
    if (gameOverResult.value.reason === 'cancelled') return 'Voyage cancelled'
    return 'Ship sunk'
})
const gameOverMessage = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'You survived the full voyage.'
    if (gameOverResult.value.reason === 'ammo') return 'You fired your last shot with enemies still on the horizon — stock up more before your next voyage.'
    if (gameOverResult.value.reason === 'cancelled') return 'You called it early and banked what you\'d earned so far.'
    return 'Enemy cannons got the better of you.'
})
const gameOverSurvivalLabel = computed(() => {
    const totalSeconds = Math.floor((gameOverResult.value?.elapsedMs ?? 0) / 1000)
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
})

async function handleStartVoyage() {
    const s = state.value
    if (!s || !canSetSail.value) return
    await startVoyage(s)
}

let resizeObserverConnected = false

onMounted(async () => {
    const host = canvasHost.value
    if (!host || !state.value) return
    await attachCanvas(host, state, refresh)
    resizeObserverConnected = true
})

onUnmounted(() => {
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
          Sail out for 5 minutes, sink what you can, keep the loot.
        </p>
      </div>
      <div v-if="state" class="flex items-center gap-2">
        <UBadge color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-anchor" />
        <UBadge color="neutral" variant="subtle" :label="`Best ${bestSurvivalLabel}`" icon="i-lucide-trophy" />
        <UBadge color="neutral" variant="subtle" :label="`${state.runsPlayed} voyages`" icon="i-lucide-map" />
        <UButton to="/pirates/manage" color="neutral" variant="subtle" icon="i-lucide-hammer" label="Manage Ship" />
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

          <!-- HUD overlay -->
          <div v-if="running" class="pointer-events-none absolute inset-0 p-3 flex flex-col justify-between">
            <div class="flex items-start justify-between gap-3">
              <div class="w-44 sm:w-60 space-y-1.5">
                <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
                  <div class="flex items-center justify-between text-xs text-white/80 mb-1">
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-heart" class="size-3.5" /> Hull</span>
                    <span>{{ Math.ceil(hp) }} / {{ maxHp }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                    <div class="h-full rounded-full transition-[width] duration-200" :class="hpBarColor" :style="{ width: `${hpPercent}%` }" />
                  </div>
                </div>
                <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 space-y-1.5">
                  <div>
                    <div class="flex items-center justify-between text-xs mb-1" :class="ammoLow ? 'text-red-300' : 'text-white/80'">
                      <span class="flex items-center gap-1"><UIcon name="i-lucide-box" class="size-3.5" /> Ammo</span>
                      <span>{{ ammo }} / {{ ammoCapacity }}</span>
                    </div>
                    <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                      <div
                        class="h-full rounded-full transition-[width] duration-200"
                        :class="ammoLow ? 'bg-red-500 animate-pulse' : 'bg-amber-400'"
                        :style="{ width: `${ammoPercent}%` }"
                      />
                    </div>
                  </div>
                  <div v-if="gemAmmoCapacity > 0">
                    <div class="flex items-center justify-between text-xs mb-1 text-sky-300">
                      <span class="flex items-center gap-1"><UIcon name="i-lucide-gem" class="size-3.5" /> Gem shots</span>
                      <span>{{ gemAmmo }} / {{ gemAmmoCapacity }}</span>
                    </div>
                    <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                      <div class="h-full rounded-full bg-sky-400 transition-[width] duration-200" :style="{ width: `${gemAmmoPercent}%` }" />
                    </div>
                  </div>
                  <button
                    class="pointer-events-auto w-full rounded-md px-2 py-1 text-xs font-semibold transition-colors"
                    :class="preferGem ? 'bg-sky-400/90 text-sky-950' : 'bg-white/10 text-white/80 hover:bg-white/20'"
                    :disabled="gemAmmo === 0"
                    @click="toggleAmmoMode"
                  >
                    <span class="flex items-center justify-center gap-1">
                      <UIcon name="i-lucide-gem" class="size-3.5" />
                      {{ preferGem ? 'Gem powder loaded' : 'Load gem powder' }}
                    </span>
                  </button>
                </div>
              </div>

              <div class="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2 text-center">
                <p class="text-lg font-bold text-white tabular-nums leading-none">
                  {{ timerLabel }}
                </p>
                <Transition name="combo">
                  <p v-if="comboVisible" class="text-xs font-black text-orange-400 mt-1 leading-none">
                    COMBO x{{ combo }}
                  </p>
                </Transition>
              </div>

              <div class="flex flex-col items-end gap-1.5">
                <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <UIcon name="i-lucide-coins" class="size-4 text-yellow-400" />
                  <span class="font-semibold text-white tabular-nums">{{ formatNumber(coins, false) }}</span>
                </div>
                <div class="pointer-events-auto flex items-center gap-1.5">
                  <button
                    class="rounded-md bg-black/50 backdrop-blur-sm p-1.5 text-white/80 hover:bg-black/70 hover:text-white transition-colors"
                    title="Pause voyage"
                    @click="pauseVoyage"
                  >
                    <UIcon name="i-lucide-pause" class="size-3.5" />
                  </button>
                  <button
                    class="rounded-md bg-black/50 backdrop-blur-sm p-1.5 text-red-300/90 hover:bg-black/70 hover:text-red-300 transition-colors"
                    title="Cancel voyage"
                    @click="cancelVoyage"
                  >
                    <UIcon name="i-lucide-flag" class="size-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Boss warning -->
            <Transition name="boss">
              <div v-if="bossVisible" class="absolute left-1/2 top-16 -translate-x-1/2">
                <div class="bg-red-950/80 border border-red-500/50 backdrop-blur-sm rounded-lg px-4 py-2 text-center animate-pulse">
                  <p class="text-red-300 text-xs font-semibold uppercase tracking-widest">
                    ⚠ Enemy flagship sighted
                  </p>
                  <p class="text-white font-black text-sm">
                    {{ bossName }}
                  </p>
                </div>
              </div>
            </Transition>

            <div class="flex flex-col gap-1 items-start">
              <TransitionGroup name="list" tag="div" class="flex flex-col gap-1">
                <div
                  v-for="k in killFeed"
                  :key="k.id"
                  class="bg-black/50 backdrop-blur-sm rounded-md px-2.5 py-1 text-xs text-white/90"
                >
                  {{ k.text }}
                </div>
              </TransitionGroup>
            </div>
          </div>

          <!-- Paused overlay -->
          <div v-else-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="text-center space-y-3 px-4">
              <UIcon name="i-lucide-pause-circle" class="size-10 text-primary mx-auto" />
              <p class="text-white font-semibold text-lg">
                Voyage paused
              </p>
              <p class="text-white/70 text-sm max-w-xs mx-auto">
                {{ Math.ceil(hp) }} / {{ maxHp }} hull, {{ formatNumber(coins, false) }} coins banked so far, {{ timerLabel }} left on the clock.
              </p>
              <div class="flex items-center justify-center gap-2">
                <UButton size="lg" icon="i-lucide-play" label="Resume Voyage" @click="resumeVoyage" />
                <UButton size="lg" color="error" variant="subtle" icon="i-lucide-flag" label="Cancel Voyage" @click="cancelVoyage" />
              </div>
            </div>
          </div>

          <!-- Pre-voyage overlay -->
          <div v-else class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="text-center space-y-3 px-4">
              <UIcon name="i-lucide-sailboat" class="size-10 text-primary mx-auto" />
              <p class="text-white font-semibold text-lg">
                Ready to set sail?
              </p>
              <p class="text-white/70 text-sm max-w-xs mx-auto">
                Click open water to move — your ship sails around the islands on its own. Click an enemy ship to open fire. Chain kills for combo gold, and survive 5 minutes to keep every coin.
              </p>
              <div class="flex items-center justify-center gap-4 text-xs text-white/70">
                <span class="flex items-center gap-1"><UIcon name="i-lucide-crosshair" class="size-3.5" /> {{ state.cannons.length }}/{{ state.cannonSlots }} cannons</span>
                <span class="flex items-center gap-1"><UIcon name="i-lucide-box" class="size-3.5" /> {{ state.ammo.count }} ammo</span>
                <span v-if="state.gemAmmo.count > 0" class="flex items-center gap-1 text-sky-300"><UIcon name="i-lucide-gem" class="size-3.5" /> {{ state.gemAmmo.count }} gem shots</span>
              </div>

              <template v-if="canSetSail">
                <UButton
                  size="lg"
                  icon="i-lucide-anchor"
                  label="Set Sail"
                  :loading="starting"
                  @click="handleStartVoyage"
                />
              </template>
              <template v-else>
                <p class="text-red-300 text-xs max-w-xs mx-auto">
                  {{ blockReason }}
                </p>
                <UButton size="lg" to="/pirates/manage" icon="i-lucide-hammer" label="Go to Armory" />
              </template>
            </div>
          </div>
        </div>
      </UCard>
    </template>

    <UModal v-model:open="gameOverVisible" :title="gameOverTitle" :ui="{ content: 'max-w-sm' }" @update:open="!$event && closeGameOver()">
      <template #body>
        <div v-if="gameOverResult" class="text-center space-y-3">
          <UIcon
            :name="gameOverIcon"
            class="size-10 mx-auto"
            :class="gameOverResult.survived ? 'text-primary' : gameOverResult.reason === 'ammo' ? 'text-amber-400' : gameOverResult.reason === 'cancelled' ? 'text-muted' : 'text-red-400'"
          />
          <p class="text-sm text-muted">
            {{ gameOverMessage }}
          </p>
          <div class="flex items-center justify-center gap-2 text-2xl font-bold">
            <UIcon name="i-lucide-coins" class="size-6 text-yellow-400" />
            {{ formatNumber(gameOverResult.awarded, false) }}
          </div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-elevated rounded-lg py-2">
              <p class="text-sm font-bold">
                {{ gameOverResult.kills }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Ships sunk
              </p>
            </div>
            <div class="bg-elevated rounded-lg py-2">
              <p class="text-sm font-bold">
                x{{ Math.max(1, gameOverResult.maxCombo) }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Best combo
              </p>
            </div>
            <div class="bg-elevated rounded-lg py-2">
              <p class="text-sm font-bold tabular-nums">
                {{ gameOverSurvivalLabel }}
              </p>
              <p class="text-[10px] text-muted uppercase tracking-wide">
                Survived
              </p>
            </div>
          </div>
          <p v-if="gameOverResult.capped" class="text-xs text-muted">
            Payout capped for this voyage's duration.
          </p>
          <div class="flex gap-2">
            <UButton block color="neutral" variant="subtle" label="Manage Ship" to="/pirates/manage" @click="closeGameOver" />
            <UButton block label="Back to port" @click="closeGameOver" />
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
</style>
