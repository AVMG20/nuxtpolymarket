<script setup lang="ts">
import { VOID_STORM_START_MS, VOID_RUN_DURATION_MS, voidResource } from '#shared/utils/gamelogic/void'

const canvasHost = ref<HTMLDivElement | null>(null)

const { data: state, refresh } = await useFetch('/api/void/state')

const {
    hull, maxHull, shield, maxShield, credits, cargo,
    elapsedMs, stormPhase, miningProgress, miningLabel,
    extractProgress, extractInRange, boostMs, boostCapacityMs,
    running, paused, launching, summaryVisible, summary,
    bossName, bossVisible, notices,
    attachCanvas, detachCanvas, launch, pauseRun, resumeRun, abortRun, closeSummary
} = useVoidRun()

const selectedSector = ref(1)

watch(() => state.value?.recommendedSector, (tier) => {
    if (tier !== undefined && !running.value) selectedSector.value = tier
}, { immediate: true })

const sectorOptions = computed(() => (state.value?.sectors ?? []).map(sector => ({
    label: `${sector.tier}. ${sector.name}${sector.cleared ? ' · cleared' : ''}`,
    value: sector.tier,
    disabled: !sector.unlocked
})))
const selectedSectorInfo = computed(() => state.value?.sectors.find(s => s.tier === selectedSector.value))
const sectorTooHot = computed(() => {
    const info = selectedSectorInfo.value
    return Boolean(info && (state.value?.power ?? 0) < info.recommendedPower)
})

const hullPercent = computed(() => maxHull.value > 0 ? Math.max(0, Math.min(100, hull.value / maxHull.value * 100)) : 0)
const hullBarColor = computed(() => hullPercent.value > 50 ? 'bg-success' : hullPercent.value > 25 ? 'bg-warning' : 'bg-error')
const shieldPercent = computed(() => maxShield.value > 0 ? Math.max(0, Math.min(100, shield.value / maxShield.value * 100)) : 0)
const cargoPercent = computed(() => cargo.value.capacity > 0 ? Math.min(100, cargo.value.units / cargo.value.capacity * 100) : 0)
const cargoFull = computed(() => cargo.value.capacity > 0 && cargo.value.units >= cargo.value.capacity)
const boostPercent = computed(() => boostCapacityMs.value > 0 ? Math.min(100, boostMs.value / boostCapacityMs.value * 100) : 0)

function bundleLines(bundle: Record<string, number | undefined>) {
    return Object.entries(bundle)
        .map(([id, amount]) => ({ id, amount: amount ?? 0, def: voidResource(id) }))
        .filter(line => line.amount > 0)
}

const cargoLines = computed(() => bundleLines(cargo.value.bundle))

function clockLabel(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000))
    return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

const runClock = computed(() => clockLabel(elapsedMs.value))
const stormCountdown = computed(() => {
    if (elapsedMs.value < VOID_STORM_START_MS) return `Storm in ${clockLabel(VOID_STORM_START_MS - elapsedMs.value)}`
    if (stormPhase.value >= 1) return 'Sector engulfed'
    return `Closing · ${Math.round(stormPhase.value * 100)}%`
})
const stormColor = computed(() => {
    if (elapsedMs.value < VOID_STORM_START_MS) return 'neutral' as const
    return stormPhase.value >= 1 ? 'error' as const : 'warning' as const
})
const timeLeftLabel = computed(() => clockLabel(Math.max(0, VOID_RUN_DURATION_MS - elapsedMs.value)))

const summaryIcon = computed(() => {
    if (!summary.value) return 'i-lucide-rocket'
    if (summary.value.extracted) return 'i-lucide-badge-check'
    if (summary.value.reason === 'cancelled') return 'i-lucide-flag'
    return 'i-lucide-skull'
})
const summaryTitle = computed(() => {
    if (!summary.value) return ''
    if (summary.value.extracted) return 'Docked — haul secured'
    if (summary.value.reason === 'cancelled') return 'Run aborted'
    if (summary.value.reason === 'timeout') return 'Lost to the storm'
    return 'Ship destroyed'
})
const summaryMessage = computed(() => {
    if (!summary.value) return ''
    if (summary.value.extracted) return 'Everything in the hold is now in your stores.'
    if (summary.value.reason === 'cancelled') return 'You pulled the plug. Credits earned in flight are still yours; the hold is not.'
    return 'The hold went down with the ship. Credits picked up in flight survived the wreck.'
})
const summaryHaulLines = computed(() => bundleLines(summary.value?.bankedHaul ?? {}))

async function handleLaunch() {
    if (!state.value) return
    await launch(selectedSector.value)
}

async function handleCloseSummary() {
    closeSummary()
    await refresh()
}

onMounted(async () => {
    const host = canvasHost.value
    if (!host || !state.value) return
    await attachCanvas(host, Boolean(state.value.activeRun), refresh)
})

onUnmounted(() => detachCanvas())
</script>

<template>
  <UContainer class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">
          Void Runner
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Undock, cut rocks, kill patrols — and be back at the mothership before the ion storm closes.
        </p>
      </div>
      <div v-if="state" class="flex flex-wrap items-center gap-2">
        <UBadge color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-gauge" />
        <UBadge color="neutral" variant="subtle" :label="`${state.extractions} extractions`" icon="i-lucide-badge-check" />
        <UBadge color="neutral" variant="subtle" :label="`${state.rocksMined} rocks cut`" icon="i-lucide-pickaxe" />
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-96 rounded-xl" />
    </div>

    <template v-else>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <div class="relative w-full overflow-hidden rounded-lg" style="aspect-ratio: 1400 / 820;">
          <div ref="canvasHost" class="absolute inset-0" />

          <!-- In-flight overlays live on top of the canvas so the control deck below never jumps -->
          <div v-if="running" class="pointer-events-none absolute inset-0">
            <div class="absolute left-1/2 top-3 -translate-x-1/2 space-y-1.5 text-center">
              <TransitionGroup name="notice">
                <div
                  v-for="notice in notices"
                  :key="notice.id"
                  class="rounded-full px-3 py-1 text-xs font-semibold backdrop-blur"
                  :class="notice.kind === 'bad' ? 'bg-error/25 text-red-100' : notice.kind === 'good' ? 'bg-success/25 text-emerald-100' : 'bg-black/40 text-white/90'"
                >
                  {{ notice.text }}
                </div>
              </TransitionGroup>
            </div>

            <div v-if="bossVisible" class="absolute left-1/2 top-16 -translate-x-1/2 animate-pulse rounded-lg border border-error/50 bg-error/20 px-4 py-1.5 text-sm font-black uppercase tracking-wide text-red-100 backdrop-blur">
              Capital contact — {{ bossName }}
            </div>

            <div v-if="miningLabel" class="absolute bottom-4 left-1/2 w-64 -translate-x-1/2 rounded-lg bg-black/55 px-3 py-2 backdrop-blur">
              <div class="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-white/80">
                <span>Cutting {{ miningLabel }}</span>
                <span class="tabular-nums">{{ Math.round(miningProgress * 100) }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div class="h-full rounded-full bg-primary" :style="{ width: `${miningProgress * 100}%` }" />
              </div>
            </div>

            <div v-if="extractInRange" class="absolute bottom-4 right-4 w-56 rounded-lg border border-info/40 bg-black/60 px-3 py-2 backdrop-blur">
              <div class="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-info">
                <span>Docking</span>
                <span class="tabular-nums">{{ Math.round(extractProgress * 100) }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-white/15">
                <div class="h-full rounded-full bg-info transition-[width] duration-100" :style="{ width: `${extractProgress * 100}%` }" />
              </div>
            </div>
          </div>

          <!-- Paused -->
          <div v-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
            <div class="space-y-3 px-4 text-center">
              <UIcon name="i-lucide-pause-circle" class="mx-auto size-10 text-primary" />
              <p class="text-lg font-semibold text-white">
                Run paused
              </p>
              <p class="text-sm text-white/70">
                {{ Math.ceil(hull) }} / {{ maxHull }} hull · {{ cargo.units }} / {{ cargo.capacity }} cargo · {{ runClock }} elapsed
              </p>
              <div class="flex items-center justify-center gap-2">
                <UButton size="lg" icon="i-lucide-play" label="Resume" @click="resumeRun" />
                <UButton size="lg" color="error" variant="subtle" icon="i-lucide-flag" label="Abort Run" @click="abortRun" />
              </div>
            </div>
          </div>

          <!-- Pre-launch -->
          <div v-else-if="!running" class="absolute inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]">
            <UCard class="w-full max-w-xl bg-default/95 shadow-2xl" :ui="{ body: 'p-5 sm:p-6' }">
              <div class="mb-4 flex items-center justify-center gap-2">
                <UIcon name="i-lucide-rocket" class="size-6 text-primary" />
                <p class="text-lg font-bold">
                  Launch sequence
                </p>
              </div>

              <div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Hull
                  </p>
                  <p class="mt-1 text-lg font-black tabular-nums">
                    {{ state.stats.maxHull }}
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Cargo
                  </p>
                  <p class="mt-1 text-lg font-black tabular-nums">
                    {{ state.stats.cargoCapacity }}
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Turrets
                  </p>
                  <p class="mt-1 text-lg font-black tabular-nums">
                    {{ state.weapons.filter(w => w.slotIndex !== null).length }} / {{ state.turretSlots }}
                  </p>
                </div>
                <div class="rounded-lg border border-default bg-elevated p-3">
                  <p class="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Power
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
                      <UIcon name="i-lucide-radar" class="size-4 text-primary" /> Destination sector
                    </p>
                    <p class="mt-0.5 text-[10px] text-muted">
                      Deeper sectors have rarer ore, tougher patrols, and slower cuts.
                    </p>
                  </div>
                  <UBadge v-if="selectedSector === state.recommendedSector" color="primary" variant="subtle" label="Recommended" />
                </div>
                <USelect v-model="selectedSector" :items="sectorOptions" value-key="value" class="mt-2 w-full" />
                <p v-if="selectedSectorInfo" class="mt-2 text-xs text-muted">
                  {{ selectedSectorInfo.description }}
                </p>
                <div v-if="selectedSectorInfo" class="mt-2 flex flex-wrap items-center gap-1.5">
                  <UBadge color="neutral" variant="subtle" :label="`${selectedSectorInfo.threat.toFixed(1)}x threat`" />
                  <UBadge color="success" variant="subtle" :label="`${selectedSectorInfo.reward.toFixed(1)}x reward`" />
                  <UBadge color="neutral" variant="subtle" :label="`${selectedSectorInfo.mineTimeMult.toFixed(2)}x cut time`" />
                </div>
                <p v-if="sectorTooHot" class="mt-2 flex items-center gap-1.5 text-xs text-warning">
                  <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
                  Power {{ selectedSectorInfo?.recommendedPower }} recommended — you're at {{ state.power }}.
                </p>
              </div>

              <UButton
                block
                class="mt-4"
                size="lg"
                icon="i-lucide-rocket"
                label="Undock"
                :loading="launching"
                :disabled="!selectedSectorInfo?.unlocked"
                @click="handleLaunch"
              />
              <p class="mt-2 text-center text-[11px] text-muted">
                WASD to thrust · Space to boost · mouse to aim · hold left click to fire or mine
              </p>
            </UCard>
          </div>
        </div>

        <!-- Control deck -->
        <div v-if="running" class="border-t border-default bg-elevated/80 p-3 sm:p-4">
          <div class="grid gap-3 lg:grid-cols-[minmax(240px,1.1fr)_minmax(220px,1fr)_minmax(200px,0.8fr)_auto]">
            <section class="space-y-2.5 rounded-lg border border-default bg-default p-3">
              <div class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-heart" class="size-4 text-error" /> Hull</span>
                <span class="tabular-nums text-muted">{{ Math.ceil(hull) }} / {{ maxHull }}</span>
              </div>
              <div class="h-2 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full transition-[width] duration-200" :class="hullBarColor" :style="{ width: `${hullPercent}%` }" />
              </div>

              <template v-if="maxShield > 0">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-shield" class="size-4 text-info" /> Shield</span>
                  <span class="tabular-nums text-muted">{{ Math.ceil(shield) }} / {{ maxShield }}</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-accented">
                  <div class="h-full rounded-full bg-info transition-[width] duration-200" :style="{ width: `${shieldPercent}%` }" />
                </div>
              </template>

              <div class="flex items-center justify-between text-xs">
                <span class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-zap" class="size-4 text-warning" /> Boost</span>
                <span class="tabular-nums text-muted">{{ Math.round(boostPercent) }}%</span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full bg-warning" :style="{ width: `${boostPercent}%` }" />
              </div>
            </section>

            <section class="rounded-lg border border-default bg-default p-3">
              <div class="mb-2 flex items-center justify-between text-xs">
                <span class="flex items-center gap-1.5 font-semibold">
                  <UIcon name="i-lucide-package" class="size-4" :class="cargoFull ? 'text-error' : 'text-primary'" /> Cargo hold
                </span>
                <span class="tabular-nums" :class="cargoFull ? 'font-bold text-error' : 'text-muted'">
                  {{ cargo.units }} / {{ cargo.capacity }}
                </span>
              </div>
              <div class="mb-2 h-2 overflow-hidden rounded-full bg-accented">
                <div class="h-full rounded-full transition-[width] duration-200" :class="cargoFull ? 'bg-error' : 'bg-primary'" :style="{ width: `${cargoPercent}%` }" />
              </div>
              <div v-if="cargoLines.length" class="flex flex-wrap gap-1.5">
                <UBadge
                  v-for="line in cargoLines"
                  :key="line.id"
                  color="neutral"
                  variant="subtle"
                  :icon="line.def.icon"
                  :label="`${line.def.name} ${line.amount}`"
                />
              </div>
              <p v-else class="text-xs text-muted">
                Hold empty — hold left click on a rock to start cutting.
              </p>
            </section>

            <section class="flex flex-col justify-center gap-2 rounded-lg border border-default bg-default p-3 text-center">
              <div>
                <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                  Elapsed
                </p>
                <p class="text-3xl font-black leading-tight tabular-nums">
                  {{ runClock }}
                </p>
              </div>
              <UBadge :color="stormColor" variant="subtle" :label="stormCountdown" icon="i-lucide-wind" />
              <div class="flex items-center justify-center gap-1.5">
                <UBadge color="warning" variant="subtle">
                  <CoinBalance :value="credits" />
                </UBadge>
                <UBadge color="neutral" variant="subtle" :label="`${timeLeftLabel} left`" />
              </div>
            </section>

            <section class="flex items-center justify-center gap-2 lg:flex-col">
              <UButton color="neutral" variant="subtle" icon="i-lucide-pause" label="Pause" @click="pauseRun" />
              <UButton color="error" variant="subtle" icon="i-lucide-flag" label="Abort" @click="abortRun" />
            </section>
          </div>
        </div>
      </UCard>
    </template>

    <UModal
      v-model:open="summaryVisible"
      :title="summaryTitle"
      :dismissible="false"
      :close="false"
      scrollable
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div v-if="summary" class="space-y-4">
          <div class="text-center">
            <div class="mx-auto flex size-16 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
              <UIcon
                :name="summaryIcon"
                class="size-9"
                :class="summary.extracted ? 'text-success' : summary.reason === 'cancelled' ? 'text-muted' : 'text-error'"
              />
            </div>
            <p class="mt-2 text-sm text-muted">
              {{ summaryMessage }}
            </p>
          </div>

          <div class="rounded-xl border border-warning/30 bg-warning/10 p-4 text-center">
            <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
              Credits banked
            </p>
            <CoinBalance :value="summary.awarded" class="mt-1 justify-center text-3xl font-black" />
            <p v-if="summary.extractionBonus > 0" class="mt-2 text-xs font-bold text-primary">
              Includes +{{ formatNumber(summary.extractionBonus) }} docking bonus
            </p>
          </div>

          <div v-if="summaryHaulLines.length" class="rounded-xl border border-success/30 bg-success/5 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-package-check" class="size-4 text-success" /> Added to stores
            </p>
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="line in summaryHaulLines"
                :key="line.id"
                color="success"
                variant="subtle"
                :icon="line.def.icon"
                :label="`${line.def.name} +${line.amount}`"
              />
            </div>
          </div>
          <div v-else-if="!summary.extracted && summary.units === 0" class="rounded-xl border border-error/30 bg-error/5 p-3 text-center text-xs text-error">
            The hold was lost with the ship.
          </div>

          <div class="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-skull" class="mx-auto mb-1 size-4 text-error" />
              <p class="text-lg font-black tabular-nums">
                {{ summary.kills }}
              </p>
              <p class="text-[10px] uppercase tracking-wide text-muted">
                Kills
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-pickaxe" class="mx-auto mb-1 size-4 text-primary" />
              <p class="text-lg font-black tabular-nums">
                {{ summary.rocksMined }}
              </p>
              <p class="text-[10px] uppercase tracking-wide text-muted">
                Rocks cut
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-crown" class="mx-auto mb-1 size-4 text-warning" />
              <p class="text-lg font-black tabular-nums">
                {{ summary.bossesKilled }}
              </p>
              <p class="text-[10px] uppercase tracking-wide text-muted">
                Capitals
              </p>
            </div>
            <div class="rounded-lg bg-elevated px-2 py-3">
              <UIcon name="i-lucide-timer" class="mx-auto mb-1 size-4 text-info" />
              <p class="text-lg font-black tabular-nums">
                {{ clockLabel(summary.elapsedMs) }}
              </p>
              <p class="text-[10px] uppercase tracking-wide text-muted">
                Time out
              </p>
            </div>
          </div>

          <div v-if="summary.killsByType.length" class="rounded-xl border border-default bg-elevated/50 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-list-collapse" class="size-4" /> Downed by class
            </p>
            <div class="flex flex-wrap gap-1.5">
              <UBadge v-for="entry in summary.killsByType" :key="entry.id" color="neutral" variant="subtle" :label="`${entry.name} ×${entry.count}`" />
            </div>
          </div>

          <div v-if="summary.sectorUnlocked" class="rounded-xl border border-primary/40 bg-primary/10 p-3 text-center text-sm font-bold text-primary">
            Sector {{ summary.sectorUnlocked }} is now open.
          </div>

          <p v-if="summary.capped" class="text-xs text-muted">
            Credit payout was capped for this run's duration.
          </p>

          <div class="flex gap-2 border-t border-default pt-4">
            <UButton block color="neutral" variant="subtle" label="Hangar" to="/void/hangar" @click="handleCloseSummary" />
            <UButton block icon="i-lucide-rocket" label="Back to the pad" @click="handleCloseSummary" />
          </div>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>

<style scoped>
.notice-enter-active,
.notice-leave-active {
  transition: all 0.25s ease;
}
.notice-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.notice-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
