<script setup lang="ts">
definePageMeta({
    title: 'Pirate Raid'
})

const canvasHost = ref<HTMLDivElement | null>(null)
const { fetchSession } = useAuth()
const toast = useToast()

const { data: state, refresh } = await useFetch('/api/pirates/state')

const starting = ref(false)

const hp = ref(0)
const maxHp = ref(0)
const coins = ref(0)
const ammo = ref(0)
const remainingMs = ref(0)
const running = ref(false)
const killFeed = ref<{ id: number, text: string }[]>([])
let killFeedSeq = 0

const gameOverVisible = ref(false)
const gameOverResult = ref<{
    survived: boolean
    reason: 'timeout' | 'defeat' | 'ammo'
    coins: number
    awarded: number
    capped: boolean
} | null>(null)

let game: PirateGame | null = null
let resizeObserver: ResizeObserver | null = null

const hpPercent = computed(() => maxHp.value > 0 ? Math.max(0, Math.min(100, (hp.value / maxHp.value) * 100)) : 0)
const hpBarColor = computed(() => hpPercent.value > 50 ? 'bg-emerald-400' : hpPercent.value > 25 ? 'bg-amber-400' : 'bg-red-500')
const ammoCapacity = computed(() => state.value?.ammo.capacity ?? 0)
const ammoPercent = computed(() => ammoCapacity.value > 0 ? Math.max(0, Math.min(100, (ammo.value / ammoCapacity.value) * 100)) : 0)
const ammoLow = computed(() => ammoCapacity.value > 0 && ammoPercent.value <= 20)
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

const canSetSail = computed(() => (state.value?.cannons.length ?? 0) > 0 && (state.value?.ammo.count ?? 0) > 0)
const blockReason = computed(() => {
    if (!state.value) return null
    if (state.value.cannons.length === 0) return 'Your gun deck is empty — equip a cannon before setting sail.'
    if (state.value.ammo.count === 0) return 'Your ammo hold is empty — stock up before setting sail.'
    return null
})

const gameOverIcon = computed(() => {
    if (!gameOverResult.value) return 'i-lucide-anchor'
    if (gameOverResult.value.survived) return 'i-lucide-party-popper'
    if (gameOverResult.value.reason === 'ammo') return 'i-lucide-box'
    return 'i-lucide-skull'
})
const gameOverTitle = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'Made it home'
    if (gameOverResult.value.reason === 'ammo') return 'Ammo hold empty'
    return 'Ship sunk'
})
const gameOverMessage = computed(() => {
    if (!gameOverResult.value) return ''
    if (gameOverResult.value.survived) return 'You survived the full voyage.'
    if (gameOverResult.value.reason === 'ammo') return 'You fired your last shot with enemies still on the horizon — stock up more before your next voyage.'
    return 'Enemy cannons got the better of you.'
})

function pushKillFeed(text: string) {
    const id = killFeedSeq++
    killFeed.value = [...killFeed.value, { id, text }].slice(-4)
    setTimeout(() => { killFeed.value = killFeed.value.filter(k => k.id !== id) }, 3000)
}

async function startVoyage() {
    if (!state.value || running.value || starting.value || !canSetSail.value) return
    starting.value = true
    try {
        const res = await $fetch('/api/pirates/start-run', { method: 'POST' })
        hp.value = res.stats.maxHp
        maxHp.value = res.stats.maxHp
        coins.value = 0
        ammo.value = res.ammo
        remainingMs.value = res.runDurationMs
        killFeed.value = []
        running.value = true
        game?.start({
            maxHp: res.stats.maxHp,
            speed: res.stats.speed,
            defenseRating: res.stats.defenseRating,
            ammo: res.ammo,
            cannons: res.cannons
        }, res.power)
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to set sail', color: 'error' })
    } finally {
        starting.value = false
    }
}

async function handleGameOver(result: { survived: boolean, coins: number, elapsedMs: number, ammoUsed: number, reason: 'timeout' | 'defeat' | 'ammo' }) {
    running.value = false
    try {
        const res = await $fetch('/api/pirates/finish-run', {
            method: 'POST',
            body: { coins: result.coins, survived: result.survived, ammoUsed: result.ammoUsed }
        })
        gameOverResult.value = { survived: result.survived, reason: result.reason, coins: result.coins, awarded: res.awarded, capped: res.capped }
        gameOverVisible.value = true
        await Promise.all([refresh(), fetchSession()])
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to submit voyage results', color: 'error' })
    }
}

onMounted(async () => {
    if (!canvasHost.value || !state.value) return

    // A closed tab mid-voyage leaves runStartedAt set server-side, which blocks
    // upgrades and future voyages. Clear it with a zero-coin finish before the
    // player can interact with anything.
    if (state.value.activeRun) {
        try {
            await $fetch('/api/pirates/finish-run', { method: 'POST', body: { coins: 0, survived: false, abandoned: true } })
            await refresh()
        } catch {
            // ignore — state.get will still surface the lock if this failed
        }
    }

    game = new PirateGame({
        onHpChange: (h, mh) => { hp.value = h; maxHp.value = mh },
        onCoinsChange: (c) => { coins.value = c },
        onAmmoChange: (a) => { ammo.value = a },
        onTimeChange: (_elapsed, remaining) => { remainingMs.value = remaining },
        onGameOver: (result) => { handleGameOver(result) },
        onKill: (tierName, reward) => pushKillFeed(`Sunk a ${tierName} (+${reward})`)
    }, {
        maxHp: state.value.stats.maxHp,
        speed: state.value.stats.speed,
        defenseRating: state.value.stats.defenseRating,
        ammo: state.value.ammo.count,
        cannons: state.value.cannons.map(c => ({ slotIndex: c.slotIndex, attackRating: c.attackRating, maxDamage: c.maxDamage, reloadMs: c.reloadMs, range: c.range }))
    })

    await game.mount(canvasHost.value)
    game.resize(canvasHost.value.clientWidth)

    resizeObserver = new ResizeObserver(() => {
        if (canvasHost.value) game?.resize(canvasHost.value.clientWidth)
    })
    resizeObserver.observe(canvasHost.value)
})

onUnmounted(() => {
    resizeObserver?.disconnect()
    game?.destroy()
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
              <div class="w-40 sm:w-56 space-y-1.5">
                <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
                  <div class="flex items-center justify-between text-xs text-white/80 mb-1">
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-heart" class="size-3.5" /> Hull</span>
                    <span>{{ Math.ceil(hp) }} / {{ maxHp }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                    <div class="h-full rounded-full transition-[width] duration-200" :class="hpBarColor" :style="{ width: `${hpPercent}%` }" />
                  </div>
                </div>
                <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
                  <div class="flex items-center justify-between text-xs mb-1" :class="ammoLow ? 'text-red-300' : 'text-white/80'">
                    <span class="flex items-center gap-1"><UIcon name="i-lucide-box" class="size-3.5" /> Ammo</span>
                    <span>{{ ammo }} / {{ ammoCapacity }}</span>
                  </div>
                  <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                    <div
                      class="h-full rounded-full transition-[width] duration-200"
                      :class="ammoLow ? 'bg-red-500 animate-pulse' : 'bg-sky-400'"
                      :style="{ width: `${ammoPercent}%` }"
                    />
                  </div>
                </div>
              </div>

              <div class="bg-black/50 backdrop-blur-sm rounded-lg px-4 py-2 text-center">
                <p class="text-lg font-bold text-white tabular-nums leading-none">
                  {{ timerLabel }}
                </p>
              </div>

              <div class="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-1.5">
                <UIcon name="i-lucide-coins" class="size-4 text-yellow-400" />
                <span class="font-semibold text-white tabular-nums">{{ formatNumber(coins, false) }}</span>
              </div>
            </div>

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

          <!-- Pre-voyage overlay -->
          <div v-else class="absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
            <div class="text-center space-y-3 px-4">
              <UIcon name="i-lucide-sailboat" class="size-10 text-primary mx-auto" />
              <p class="text-white font-semibold text-lg">
                Ready to set sail?
              </p>
              <p class="text-white/70 text-sm max-w-xs mx-auto">
                Click open water to move, click an enemy ship to open fire — your cannons reload and engage independently. Survive 5 minutes and keep every coin you earn.
              </p>
              <div class="flex items-center justify-center gap-4 text-xs text-white/70">
                <span class="flex items-center gap-1"><UIcon name="i-lucide-crosshair" class="size-3.5" /> {{ state.cannons.length }}/{{ state.cannonSlots }} cannons</span>
                <span class="flex items-center gap-1"><UIcon name="i-lucide-box" class="size-3.5" /> {{ state.ammo.count }} ammo</span>
              </div>

              <template v-if="canSetSail">
                <UButton
                  size="lg"
                  icon="i-lucide-anchor"
                  label="Set Sail"
                  :loading="starting"
                  @click="startVoyage"
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

    <UModal v-model:open="gameOverVisible" :title="gameOverTitle" :ui="{ content: 'max-w-sm' }">
      <template #body>
        <div v-if="gameOverResult" class="text-center space-y-3">
          <UIcon
            :name="gameOverIcon"
            class="size-10 mx-auto"
            :class="gameOverResult.survived ? 'text-primary' : gameOverResult.reason === 'ammo' ? 'text-amber-400' : 'text-red-400'"
          />
          <p class="text-sm text-muted">
            {{ gameOverMessage }}
          </p>
          <div class="flex items-center justify-center gap-2 text-2xl font-bold">
            <UIcon name="i-lucide-coins" class="size-6 text-yellow-400" />
            {{ formatNumber(gameOverResult.awarded, false) }}
          </div>
          <p v-if="gameOverResult.capped" class="text-xs text-muted">
            Payout capped for this voyage's duration.
          </p>
          <div class="flex gap-2">
            <UButton block color="neutral" variant="subtle" label="Manage Ship" to="/pirates/manage" @click="gameOverVisible = false" />
            <UButton block label="Back to port" @click="gameOverVisible = false" />
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
</style>
