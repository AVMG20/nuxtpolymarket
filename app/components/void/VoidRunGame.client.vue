<script setup lang="ts">
import { VOID_STORM_START_MS, VOID_RUN_DURATION_MS, VOID_MIDBOSS_SPAWN_MS, voidResource } from '#shared/utils/gamelogic/void'
import VoidResourceChip from '~/components/void/VoidResourceChip.vue'

const canvasHost = ref<HTMLDivElement | null>(null)

const { data: state, refresh } = await useFetch('/api/void/state')

const {
    hull, maxHull, shield, maxShield, cargo, survey,
    elapsedMs, stormPhase, threat, miningProgress, miningLabel,
    extractProgress, extractInRange, boostMs, boostCapacityMs,
    running, paused, launching, summaryVisible, summary,
    bossName, bossVisible, notices,
    attachCanvas, detachCanvas, launch, pauseRun, resumeRun, abortRun, closeSummary
} = useVoidRun()

const sound = useVoidSound()
const { soundEnabled, soundVolume } = sound

// Audible confirmation when flipping sound on (play() is a no-op while off).
function onSoundToggle() {
    sound.unlock()
    sound.preload()
    sound.play('pickup')
}

const selectedSector = ref(1)

watch(() => state.value?.recommendedSector, (tier) => {
    if (tier !== undefined && !running.value) selectedSector.value = tier
}, { immediate: true })

// Annotated so `value` widens to `number`: the sector tiers are literal types
// on the shared config, which would otherwise force the v-model ref into a
// `1 | 2 | 3 | 4` union.
const sectorOptions = computed<{ label: string, value: number, disabled: boolean }[]>(() =>
    (state.value?.sectors ?? []).map(sector => ({
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
// The gauges are lit from a fixed palette rather than theme tokens: they sit
// against the canvas and have to read as the same instrument as the ship's own
// hull bar, which is drawn in exactly these colours.
const hullColor = computed(() => hullPercent.value > 50 ? '#4ade80' : hullPercent.value > 25 ? '#fbbf24' : '#f87171')
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

/** World units are metres; anything past a kilometre reads better as one. */
function rangeLabel(metres: number) {
    return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`
}

const runClock = computed(() => clockLabel(elapsedMs.value))
const stormCountdown = computed(() => {
    if (elapsedMs.value < VOID_STORM_START_MS) return `Storm in ${clockLabel(VOID_STORM_START_MS - elapsedMs.value)}`
    if (stormPhase.value >= 1) return 'Sector engulfed'
    return `Closing · ${Math.round(stormPhase.value * 100)}%`
})
const stormTone = computed(() => {
    if (elapsedMs.value < VOID_STORM_START_MS) return 'calm'
    return stormPhase.value >= 1 ? 'bad' : 'warn'
})
const timeLeftLabel = computed(() => clockLabel(Math.max(0, VOID_RUN_DURATION_MS - elapsedMs.value)))
const threatTone = computed(() => threat.value >= 1.6 ? 'bad' : threat.value >= 1.25 ? 'warn' : 'calm')
const midBossLabel = computed(() => elapsedMs.value < VOID_MIDBOSS_SPAWN_MS
    ? clockLabel(VOID_MIDBOSS_SPAWN_MS - elapsedMs.value)
    : null)

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
    if (summary.value.extracted) return 'Everything in the hold is now in your stores, ready to sell.'
    if (summary.value.reason === 'cancelled') return 'You pulled the plug before docking, so the hold is gone.'
    return 'The hold went down with the ship. Nothing out there converts to money until it is docked.'
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
  <UContainer class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Void Runner
          <UBadge
            color="warning"
            variant="subtle"
            size="sm"
            icon="i-lucide-flask-conical"
            label="OPEN BETA · all progress can be deleted"
          />
        </h1>
        <p class="mt-0.5 text-sm text-muted">
          Undock, cut rocks, kill patrols — and be back at the mothership before the ion storm closes.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="state">
          <UBadge color="primary" variant="subtle" :label="`Power ${state.power}`" icon="i-lucide-gauge" />
          <UBadge color="neutral" variant="subtle" :label="`${state.extractions} extractions`" icon="i-lucide-badge-check" />
          <UBadge color="neutral" variant="subtle" :label="`${state.rocksMined} rocks cut`" icon="i-lucide-pickaxe" />
        </template>
        <div class="flex items-center gap-2 rounded-lg border border-default bg-elevated px-3 py-1.5">
          <UIcon :name="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4 text-primary" />
          <USwitch v-model="soundEnabled" size="sm" aria-label="Enable Void Runner sound" @click="onSoundToggle" />
          <USlider v-model="soundVolume" :min="0" :max="100" :disabled="!soundEnabled" size="xs" class="w-24" aria-label="Sound volume" />
          <span class="w-8 text-right text-[10px] font-bold tabular-nums text-muted">{{ soundVolume }}%</span>
        </div>
      </div>
    </div>

    <div v-if="!state" class="space-y-4">
      <USkeleton class="h-96 rounded-xl" />
    </div>

    <template v-else>
      <!--
        Canvas and deck share one shell. The deck is not a card sitting under a
        game — it is the bottom of the same instrument, so it carries the same
        backdrop, the same hairlines and the same cyan the dock ring is drawn in.
      -->
      <div class="console">
        <div class="console__scan" />

        <div class="relative w-full overflow-hidden" style="aspect-ratio: 1400 / 820;">
          <div ref="canvasHost" class="absolute inset-0" />

          <!-- In-flight overlays live on top of the canvas so the control deck below never jumps -->
          <div v-if="running" class="pointer-events-none absolute inset-0">
            <div class="absolute left-1/2 top-3 -translate-x-1/2 space-y-1.5 text-center">
              <TransitionGroup name="notice">
                <div
                  v-for="notice in notices"
                  :key="notice.id"
                  class="notice"
                  :class="`notice--${notice.kind}`"
                >
                  {{ notice.text }}
                </div>
              </TransitionGroup>
            </div>

            <div v-if="bossVisible" class="absolute left-1/2 top-16 -translate-x-1/2 animate-pulse">
              <div class="hud-plate hud-plate--danger px-4 py-1.5 text-sm font-black uppercase tracking-[0.2em]">
                Capital contact — {{ bossName }}
              </div>
            </div>

            <div v-if="miningLabel" class="absolute bottom-4 left-1/2 w-72 -translate-x-1/2">
              <div class="hud-plate px-3 py-2">
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="lbl">Cutting {{ miningLabel }}</span>
                  <span class="num text-[11px] text-white/80">{{ Math.round(miningProgress * 100) }}%</span>
                </div>
                <div class="gauge">
                  <div class="gauge__fill" :style="{ 'width': `${miningProgress * 100}%`, '--c': '#67e8f9' }" />
                </div>
              </div>
            </div>

            <div v-if="extractInRange" class="absolute bottom-4 right-4 w-60">
              <div class="hud-plate hud-plate--dock px-3 py-2">
                <div class="mb-1.5 flex items-center justify-between">
                  <span class="lbl" style="color: #67e8f9">Docking</span>
                  <span class="num text-[11px] text-white/80">{{ Math.round(extractProgress * 100) }}%</span>
                </div>
                <div class="gauge">
                  <div class="gauge__fill gauge__fill--fast" :style="{ 'width': `${extractProgress * 100}%`, '--c': '#22d3ee' }" />
                </div>
              </div>
            </div>
          </div>

          <!-- Paused -->
          <div v-if="paused" class="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
            <div class="space-y-3 px-4 text-center">
              <UIcon name="i-lucide-pause-circle" class="mx-auto size-10 text-primary" />
              <p class="text-lg font-semibold text-white">
                Run paused
              </p>
              <p class="num text-sm text-white/70">
                {{ Math.ceil(hull) }} / {{ maxHull }} hull · {{ cargo.units }} / {{ cargo.capacity }} cargo · {{ runClock }} elapsed
              </p>
              <div class="flex items-center justify-center gap-2">
                <UButton size="lg" icon="i-lucide-play" label="Resume" @click="resumeRun" />
                <UButton size="lg" color="error" variant="subtle" icon="i-lucide-flag" label="Abort Run" @click="abortRun" />
              </div>
            </div>
          </div>

          <!-- Pre-launch -->
          <div v-else-if="!running" class="absolute inset-0 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]">
            <div class="launch w-full max-w-xl">
              <div class="mb-4 flex items-center justify-center gap-2">
                <UIcon name="i-lucide-rocket" class="size-5 text-primary" />
                <p class="text-sm font-black uppercase tracking-[0.28em] text-cyan-200">
                  Launch sequence
                </p>
              </div>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div class="stat">
                  <p class="lbl">
                    Hull
                  </p>
                  <p class="num mt-1 text-lg font-black text-white">
                    {{ state.stats.maxHull }}
                  </p>
                </div>
                <div class="stat">
                  <p class="lbl">
                    Cargo
                  </p>
                  <p class="num mt-1 text-lg font-black text-white">
                    {{ state.stats.cargoCapacity }}
                  </p>
                </div>
                <div class="stat">
                  <p class="lbl">
                    Modules
                  </p>
                  <p class="num mt-1 text-lg font-black text-white">
                    {{ state.weapons.filter(w => w.slotIndex !== null).length }} / {{ state.turretSlots }}
                  </p>
                </div>
                <div class="stat">
                  <p class="lbl">
                    Power
                  </p>
                  <p class="num mt-1 text-lg font-black text-white">
                    {{ state.power }}
                  </p>
                </div>
              </div>

              <div class="mt-3 rounded-sm border border-cyan-400/25 bg-cyan-400/5 p-3 text-left">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <p class="flex items-center gap-1.5 text-xs font-bold text-white">
                      <UIcon name="i-lucide-radar" class="size-4 text-primary" /> Destination sector
                    </p>
                    <p class="mt-0.5 text-[10px] text-white/50">
                      Deeper sectors have richer deposits, tougher garrisons, and slower cuts.
                    </p>
                  </div>
                  <UBadge v-if="selectedSector === state.recommendedSector" color="primary" variant="subtle" label="Recommended" />
                </div>
                <USelect v-model="selectedSector" :items="sectorOptions" value-key="value" class="mt-2 w-full" />
                <p v-if="selectedSectorInfo" class="mt-2 text-xs text-white/60">
                  {{ selectedSectorInfo.description }}
                </p>
                <div v-if="selectedSectorInfo" class="mt-2 flex flex-wrap items-center gap-1.5">
                  <UBadge color="neutral" variant="subtle" :label="`${selectedSectorInfo.threat.toFixed(1)}x threat`" />
                  <UBadge color="success" variant="subtle" :label="`${selectedSectorInfo.reward.toFixed(1)}x reward`" />
                  <UBadge color="primary" variant="subtle" :label="`${selectedSectorInfo.depositSites} rich deposits`" />
                  <UBadge color="neutral" variant="subtle" :label="`${selectedSectorInfo.depositGuards} guards each`" />
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
              <p class="mt-2 text-center text-[11px] text-white/45">
                WASD to thrust · Space to boost · mouse to aim · hold left click to fire or mine
              </p>
              <p class="mt-1 text-center text-[11px] text-white/45">
                The scan marks every rich deposit at undock. They are a long way out and something is sitting on each of them.
              </p>
            </div>
          </div>
        </div>

        <!-- Control deck -->
        <div v-if="running" class="deck">
          <div class="grid gap-2.5 xl:grid-cols-[minmax(210px,0.95fr)_minmax(210px,1fr)_minmax(200px,1fr)_minmax(150px,0.7fr)_auto]">
            <section class="panel space-y-2">
              <div class="flex items-baseline justify-between">
                <span class="lbl">Hull</span>
                <span class="num text-[11px] text-white/70">{{ Math.ceil(hull) }} / {{ maxHull }}</span>
              </div>
              <div class="gauge gauge--tall">
                <div class="gauge__fill" :style="{ 'width': `${hullPercent}%`, '--c': hullColor }" />
              </div>

              <template v-if="maxShield > 0">
                <div class="flex items-baseline justify-between">
                  <span class="lbl">Shield</span>
                  <span class="num text-[11px] text-white/70">{{ Math.ceil(shield) }} / {{ maxShield }}</span>
                </div>
                <div class="gauge">
                  <div class="gauge__fill" :style="{ 'width': `${shieldPercent}%`, '--c': '#38bdf8' }" />
                </div>
              </template>

              <div class="flex items-baseline justify-between">
                <span class="lbl">Burn</span>
                <span class="num text-[11px] text-white/70">{{ Math.round(boostPercent) }}%</span>
              </div>
              <div class="gauge">
                <div class="gauge__fill gauge__fill--fast" :style="{ 'width': `${boostPercent}%`, '--c': '#fbbf24' }" />
              </div>
            </section>

            <section class="panel space-y-2">
              <div class="flex items-baseline justify-between">
                <span class="lbl">Cargo hold</span>
                <span class="num text-[11px]" :class="cargoFull ? 'text-red-300' : 'text-white/70'">
                  {{ cargo.units }} / {{ cargo.capacity }}
                </span>
              </div>
              <div class="gauge gauge--tall">
                <div class="gauge__fill" :style="{ 'width': `${cargoPercent}%`, '--c': cargoFull ? '#f87171' : '#22d3ee' }" />
              </div>
              <div class="flex items-center gap-1.5">
                <span class="lbl">Worth</span>
                <CoinBalance :value="cargo.value" class="num text-xs font-bold text-amber-300" />
              </div>
              <div v-if="cargoLines.length" class="flex flex-wrap gap-1">
                <VoidResourceChip
                  v-for="line in cargoLines"
                  :key="line.id"
                  :resource="line.id"
                  :amount="line.amount"
                  :compact="false"
                  size="sm"
                />
              </div>
              <p v-else class="text-[11px] text-white/40">
                Empty. Hold left click on a rock to cut it.
              </p>
            </section>

            <!--
              The survey is the deck's most important panel. The sector is ten
              viewports across and everything expensive is parked at the far
              edges of it, so "which deposit, and can I still get home from it"
              is the decision the whole run turns on.
            -->
            <section class="panel space-y-1.5">
              <div class="flex items-baseline justify-between">
                <span class="lbl">Deposit survey</span>
                <span class="num text-[10px] text-white/40">{{ survey.length }} sites</span>
              </div>
              <div v-if="survey.length" class="space-y-1">
                <div
                  v-for="site in survey"
                  :key="site.id"
                  class="survey-row"
                  :class="{ 'survey-row--inside': site.inside, 'survey-row--spent': site.remaining === 0 }"
                >
                  <span class="survey-row__dot" :style="{ '--c': site.hex }" />
                  <span class="truncate text-[11px] font-semibold" :style="{ color: site.hex }">{{ site.name }}</span>
                  <span class="num ml-auto shrink-0 text-[10px] text-white/45">×{{ site.remaining }}</span>
                  <span class="num shrink-0 text-[11px] font-bold text-white/75">
                    {{ site.inside ? 'ON SITE' : rangeLabel(site.distance) }}
                  </span>
                </div>
              </div>
              <p v-else class="text-[11px] text-white/40">
                Scanning…
              </p>
            </section>

            <section class="panel flex flex-col justify-center gap-1.5 text-center">
              <p class="lbl">
                Elapsed
              </p>
              <p class="num text-3xl font-black leading-none text-white">
                {{ runClock }}
              </p>
              <p class="chip" :class="`chip--${stormTone}`">
                {{ stormCountdown }}
              </p>
              <div class="flex flex-wrap justify-center gap-1">
                <span class="chip" :class="`chip--${threatTone}`">Threat {{ threat.toFixed(2) }}x</span>
                <span v-if="midBossLabel" class="chip chip--calm">Cruiser {{ midBossLabel }}</span>
                <span class="chip chip--calm">{{ timeLeftLabel }} left</span>
              </div>
            </section>

            <section class="flex items-center justify-center gap-2 xl:flex-col">
              <UButton color="neutral" variant="subtle" icon="i-lucide-pause" label="Pause" @click="pauseRun" />
              <UButton color="error" variant="subtle" icon="i-lucide-flag" label="Abort" @click="abortRun" />
            </section>
          </div>
        </div>
      </div>
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
              Haul value
            </p>
            <CoinBalance :value="summary.bankedValue" class="mt-1 justify-center text-3xl font-black" />
            <p class="mt-2 text-xs text-muted">
              {{ summary.bankedValue > 0 ? 'Sell it at the dock market whenever you like.' : 'Nothing came home.' }}
            </p>
          </div>

          <div v-if="summaryHaulLines.length" class="rounded-xl border border-success/30 bg-success/5 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-package-check" class="size-4 text-success" /> Added to stores
            </p>
            <div class="flex flex-wrap gap-1.5">
              <VoidResourceChip
                v-for="line in summaryHaulLines"
                :key="line.id"
                :resource="line.id"
                :amount="line.amount"
                :compact="false"
                size="sm"
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

          <div v-if="summary.moduleDrops.length" class="rounded-xl border border-primary/40 bg-primary/5 p-3">
            <p class="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
              <UIcon name="i-lucide-package-plus" class="size-4 text-primary" /> Recovered from the wreckage
            </p>
            <div class="space-y-1.5">
              <div
                v-for="module in summary.moduleDrops"
                :key="module.id"
                class="rounded-lg border p-2.5"
                :style="{ borderColor: `${module.hex}66`, background: `${module.hex}0f` }"
              >
                <p class="text-sm font-bold" :style="{ color: module.hex }">
                  {{ module.name }}
                  <span class="ml-1 text-[10px] font-medium uppercase tracking-wide opacity-70">{{ module.rarityName }}</span>
                </p>
                <ul class="mt-1 space-y-0.5 text-[11px] text-muted">
                  <li v-for="line in module.lines" :key="line">
                    {{ line }}
                  </li>
                </ul>
                <p v-if="module.special" class="mt-1 text-[11px] font-bold text-error">
                  {{ module.special }}
                </p>
              </div>
            </div>
            <p class="mt-2 text-[11px] text-muted">
              Waiting for you in the module inventory.
            </p>
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

          <div class="flex gap-2 border-t border-default pt-4">
            <UButton block color="neutral" variant="subtle" label="Sell haul" to="/void/market" @click="handleCloseSummary" />
            <UButton block icon="i-lucide-rocket" label="Back to the pad" @click="handleCloseSummary" />
          </div>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>

<style scoped>
/*
  The console is deliberately not themed. Everything in here sits directly
  against a canvas that is drawn in fixed colours — deep-space navy, dock cyan,
  the same green/amber/red the ship's own hull bar uses — and a panel that
  followed the site's light theme would read as a web page bolted under a game
  rather than the bottom half of the same instrument.
*/
.console {
  --edge: rgb(34 211 238 / 0.22);
  --edge-soft: rgb(34 211 238 / 0.1);
  position: relative;
  overflow: hidden;
  border: 1px solid var(--edge);
  border-radius: 0.5rem;
  background:
    radial-gradient(130% 90% at 50% 0%, #0b1524 0%, #05070f 62%, #04050c 100%);
  box-shadow:
    0 0 70px -30px rgb(34 211 238 / 0.55),
    inset 0 0 140px -70px rgb(34 211 238 / 0.4);
}

/* A single scanline wash across the whole shell, canvas included, so the two
   halves are visibly under the same piece of glass. */
.console__scan {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 20;
  opacity: 0.35;
  background: repeating-linear-gradient(
    180deg,
    rgb(255 255 255 / 0.022) 0 1px,
    transparent 1px 3px
  );
}

.deck {
  position: relative;
  padding: 0.75rem;
  background:
    linear-gradient(180deg, rgb(34 211 238 / 0.07) 0%, transparent 32%),
    linear-gradient(180deg, #060a14 0%, #04060e 100%);
}

/* The hairline where the image stops. It glows, so the canvas reads as bleeding
   into the deck instead of being cropped off above it. */
.deck::before {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(34 211 238 / 0.7) 20%, rgb(34 211 238 / 0.7) 80%, transparent);
  box-shadow: 0 0 12px rgb(34 211 238 / 0.55);
}

.panel {
  position: relative;
  padding: 0.7rem 0.75rem;
  border: 1px solid rgb(34 211 238 / 0.16);
  background: linear-gradient(180deg, rgb(9 16 30 / 0.9), rgb(4 8 18 / 0.9));
  /* Cut corners rather than rounded ones — the canvas instruments use the same
     bevel, and it is what stops the panels reading as web cards. */
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
}

.panel::after {
  content: '';
  position: absolute;
  top: 4px;
  right: 4px;
  width: 12px;
  height: 12px;
  border-top: 1px solid rgb(103 232 249 / 0.5);
  border-right: 1px solid rgb(103 232 249 / 0.5);
}

.lbl {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(125 211 252 / 0.65);
}

.num {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'SFMono-Regular', 'Cascadia Mono', Menlo, monospace;
}

/* ── Gauges ─────────────────────────────────────────────────────────────── */

.gauge {
  position: relative;
  height: 6px;
  overflow: hidden;
  background: rgb(148 163 184 / 0.14);
  clip-path: polygon(3px 0, 100% 0, calc(100% - 3px) 100%, 0 100%);
}

.gauge--tall {
  height: 9px;
}

.gauge__fill {
  height: 100%;
  background: var(--c);
  box-shadow: 0 0 10px -1px var(--c);
  transition: width 0.2s ease;
}

/* Burn and docking move fast enough that a 200 ms ease reads as lag. */
.gauge__fill--fast {
  transition: width 0.08s linear;
}

/* Notches over the top of the fill, so a bar reads as a segmented readout. */
.gauge::after {
  content: '';
  pointer-events: none;
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(90deg, transparent 0 5px, rgb(4 6 14 / 0.9) 5px 7px);
}

/* ── Chips ──────────────────────────────────────────────────────────────── */

.chip {
  display: inline-block;
  padding: 2px 7px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  border: 1px solid currentcolor;
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%);
}

.chip--calm { color: rgb(148 163 184 / 0.9); }
.chip--warn { color: #fbbf24; }
.chip--bad { color: #f87171; }

/* ── Survey rows ────────────────────────────────────────────────────────── */

.survey-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 2px 4px;
  border-left: 2px solid transparent;
}

.survey-row--inside {
  border-left-color: currentcolor;
  background: rgb(34 211 238 / 0.08);
}

.survey-row--spent {
  opacity: 0.4;
}

.survey-row__dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  rotate: 45deg;
  background: var(--c);
  box-shadow: 0 0 7px var(--c);
}

/* ── In-canvas plates ───────────────────────────────────────────────────── */

.hud-plate {
  border: 1px solid rgb(34 211 238 / 0.28);
  background: rgb(3 7 18 / 0.72);
  backdrop-filter: blur(4px);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  color: rgb(255 255 255 / 0.9);
}

.hud-plate--danger {
  border-color: rgb(248 113 113 / 0.55);
  background: rgb(69 10 10 / 0.55);
  color: #fecaca;
}

.hud-plate--dock {
  border-color: rgb(34 211 238 / 0.5);
}

.notice {
  padding: 4px 12px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid transparent;
  backdrop-filter: blur(4px);
  clip-path: polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%);
}

.notice--bad { border-color: rgb(248 113 113 / 0.5); background: rgb(127 29 29 / 0.45); color: #fecaca; }
.notice--good { border-color: rgb(74 222 128 / 0.5); background: rgb(6 78 59 / 0.45); color: #bbf7d0; }
.notice--info { border-color: rgb(34 211 238 / 0.4); background: rgb(3 7 18 / 0.6); color: rgb(255 255 255 / 0.9); }

/* ── Launch panel ───────────────────────────────────────────────────────── */

.launch {
  padding: 1.25rem;
  border: 1px solid rgb(34 211 238 / 0.3);
  background: linear-gradient(180deg, rgb(8 15 30 / 0.97), rgb(4 7 16 / 0.97));
  box-shadow: 0 0 60px -20px rgb(34 211 238 / 0.6);
  clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px);
}

.stat {
  padding: 0.5rem 0.6rem;
  border: 1px solid rgb(34 211 238 / 0.14);
  background: rgb(255 255 255 / 0.03);
  clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
}

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
