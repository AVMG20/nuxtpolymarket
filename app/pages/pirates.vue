<script setup lang="ts">
import {
    PIRATE_STAT_IDS, PIRATE_MAX_STAT_LEVEL,
    pirateMaxHp, pirateShipSpeed, pirateCannonStats, pirateCannonRange, pirateReloadMs,
    type PirateStatId
} from '#shared/utils/gamelogic/pirates'

definePageMeta({
    title: 'Pirate Raid'
})

const canvasHost = ref<HTMLDivElement | null>(null)
const { user, fetchSession } = useAuth()
const toast = useToast()
const balance = computed(() => parseFloat(user.value?.balance ?? '0'))

const { data: state, refresh } = await useFetch('/api/pirates/state')

const STAT_META: Record<PirateStatId, { label: string, icon: string, color: string, effect: (level: number) => string }> = {
    hull: { label: 'Hull', icon: 'i-lucide-heart', color: 'text-red-400 bg-red-400/15', effect: l => `${pirateMaxHp(l)} HP` },
    speed: { label: 'Speed', icon: 'i-lucide-wind', color: 'text-cyan-400 bg-cyan-400/15', effect: l => `${pirateShipSpeed(l)} spd` },
    damage: { label: 'Cannons', icon: 'i-lucide-flame', color: 'text-orange-400 bg-orange-400/15', effect: (l) => { const c = pirateCannonStats(l); return `${c.min}-${c.max} dmg \xd7${c.balls}` } },
    range: { label: 'Range', icon: 'i-lucide-crosshair', color: 'text-violet-400 bg-violet-400/15', effect: l => `${pirateCannonRange(l)} range` },
    reload: { label: 'Reload', icon: 'i-lucide-timer', color: 'text-emerald-400 bg-emerald-400/15', effect: l => `${(pirateReloadMs(l) / 1000).toFixed(1)}s reload` }
}

const upgrading = ref<PirateStatId | null>(null)
const starting = ref(false)

const hp = ref(0)
const maxHp = ref(0)
const coins = ref(0)
const remainingMs = ref(0)
const running = ref(false)
const killFeed = ref<{ id: number, text: string }[]>([])
let killFeedSeq = 0

const gameOverVisible = ref(false)
const gameOverResult = ref<{ survived: boolean, coins: number, awarded: number, capped: boolean } | null>(null)

let game: PirateGame | null = null
let resizeObserver: ResizeObserver | null = null

const hpPercent = computed(() => maxHp.value > 0 ? Math.max(0, Math.min(100, (hp.value / maxHp.value) * 100)) : 0)
const hpBarColor = computed(() => hpPercent.value > 50 ? 'bg-emerald-400' : hpPercent.value > 25 ? 'bg-amber-400' : 'bg-red-500')
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

function pushKillFeed(text: string) {
    const id = killFeedSeq++
    killFeed.value = [...killFeed.value, { id, text }].slice(-4)
    setTimeout(() => { killFeed.value = killFeed.value.filter(k => k.id !== id) }, 3000)
}

async function upgrade(stat: PirateStatId) {
    if (running.value || upgrading.value) return
    upgrading.value = stat
    try {
        await $fetch('/api/pirates/upgrade', { method: 'POST', body: { stat } })
        await Promise.all([refresh(), fetchSession()])
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Upgrade failed', color: 'error' })
    } finally {
        upgrading.value = null
    }
}

async function startVoyage() {
    if (!state.value || running.value || starting.value) return
    starting.value = true
    try {
        const res = await $fetch('/api/pirates/start-run', { method: 'POST' })
        hp.value = res.stats.maxHp
        maxHp.value = res.stats.maxHp
        coins.value = 0
        remainingMs.value = res.runDurationMs
        killFeed.value = []
        running.value = true
        game?.start(res.stats, res.power)
    } catch (e: any) {
        toast.add({ title: e.data?.message ?? 'Failed to set sail', color: 'error' })
    } finally {
        starting.value = false
    }
}

async function handleGameOver(result: { survived: boolean, coins: number, elapsedMs: number }) {
    running.value = false
    try {
        const res = await $fetch('/api/pirates/finish-run', { method: 'POST', body: { coins: result.coins, survived: result.survived } })
        gameOverResult.value = { survived: result.survived, coins: result.coins, awarded: res.awarded, capped: res.capped }
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
        onTimeChange: (_elapsed, remaining) => { remainingMs.value = remaining },
        onGameOver: (result) => { handleGameOver(result) },
        onKill: (tierName, reward) => pushKillFeed(`Sunk a ${tierName} (+${reward})`)
    }, {
        maxHp: state.value.stats.maxHp,
        speed: state.value.stats.speed,
        cannon: state.value.stats.cannon,
        range: state.value.stats.range,
        reloadMs: state.value.stats.reloadMs
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
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-80 rounded-xl" />
      <USkeleton class="h-44 rounded-xl" />
    </div>

    <template v-else>
      <!-- Game viewport -->
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="relative w-full overflow-hidden rounded-lg" style="aspect-ratio: 1400 / 820;">
          <div ref="canvasHost" class="absolute inset-0" />

          <!-- HUD overlay -->
          <div v-if="running" class="pointer-events-none absolute inset-0 p-3 flex flex-col justify-between">
            <div class="flex items-start justify-between gap-3">
              <div class="w-40 sm:w-56 bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2">
                <div class="flex items-center justify-between text-xs text-white/80 mb-1">
                  <span class="flex items-center gap-1"><UIcon name="i-lucide-heart" class="size-3.5" /> Hull</span>
                  <span>{{ Math.ceil(hp) }} / {{ maxHp }}</span>
                </div>
                <div class="h-2 rounded-full bg-white/15 overflow-hidden">
                  <div class="h-full rounded-full transition-[width] duration-200" :class="hpBarColor" :style="{ width: `${hpPercent}%` }" />
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
                Click open water to move, click an enemy ship to open fire. Survive 5 minutes and keep every coin you earn.
              </p>
              <UButton
                size="lg"
                icon="i-lucide-anchor"
                label="Set Sail"
                :loading="starting"
                @click="startVoyage"
              />
            </div>
          </div>
        </div>
      </UCard>

      <!-- Upgrades -->
      <div>
        <p class="text-xs font-semibold text-muted uppercase tracking-wider mb-2 px-0.5">
          Shipwright — Upgrades
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <UCard v-for="statId in PIRATE_STAT_IDS" :key="statId" :ui="{ body: 'p-3.5' }">
            <div class="flex items-center gap-2.5 mb-2.5">
              <div class="size-8 rounded-lg flex items-center justify-center shrink-0" :class="STAT_META[statId].color">
                <UIcon :name="STAT_META[statId].icon" class="size-4" />
              </div>
              <div class="min-w-0">
                <p class="font-semibold text-sm truncate">
                  {{ STAT_META[statId].label }}
                </p>
                <p class="text-xs text-muted">
                  Lv {{ state.levels[statId] }} / {{ PIRATE_MAX_STAT_LEVEL }}
                </p>
              </div>
            </div>

            <p class="text-xs text-muted mb-3">
              {{ STAT_META[statId].effect(state.levels[statId]) }}
            </p>

            <UButton
              block
              size="sm"
              :color="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL ? 'neutral' : 'primary'"
              :variant="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL ? 'subtle' : 'solid'"
              :disabled="running || state.levels[statId] >= PIRATE_MAX_STAT_LEVEL || balance < (state.costs[statId] ?? 0)"
              :loading="upgrading === statId"
              @click="upgrade(statId)"
            >
              <span v-if="state.levels[statId] >= PIRATE_MAX_STAT_LEVEL">Maxed</span>
              <span v-else class="flex items-center gap-1">
                <UIcon name="i-lucide-coins" class="size-3.5 text-yellow-400" />
                {{ formatNumber(state.costs[statId] ?? 0, false) }}
              </span>
            </UButton>
          </UCard>
        </div>
        <p v-if="running" class="text-xs text-muted mt-2 px-0.5">
          Upgrades are locked while you're at sea.
        </p>
      </div>
    </template>

    <UModal v-model:open="gameOverVisible" :title="gameOverResult?.survived ? 'Made it home' : 'Ship sunk'" :ui="{ content: 'max-w-sm' }">
      <template #body>
        <div v-if="gameOverResult" class="text-center space-y-3">
          <UIcon
            :name="gameOverResult.survived ? 'i-lucide-party-popper' : 'i-lucide-skull'"
            class="size-10 mx-auto"
            :class="gameOverResult.survived ? 'text-primary' : 'text-red-400'"
          />
          <p class="text-sm text-muted">
            {{ gameOverResult.survived ? 'You survived the full voyage.' : 'Enemy cannons got the better of you.' }}
          </p>
          <div class="flex items-center justify-center gap-2 text-2xl font-bold">
            <UIcon name="i-lucide-coins" class="size-6 text-yellow-400" />
            {{ formatNumber(gameOverResult.awarded, false) }}
          </div>
          <p v-if="gameOverResult.capped" class="text-xs text-muted">
            Payout capped for this voyage's duration.
          </p>
          <UButton block label="Back to port" @click="gameOverVisible = false" />
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
