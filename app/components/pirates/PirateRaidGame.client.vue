<script setup lang="ts">
import {
    PIRATE_ABILITIES, PIRATE_RUN_DURATION_MS, pirateCannonTier, piratePowerUp, pirateRarity,
    type PiratePowerUpId
} from '#shared/utils/gamelogic/pirates'

const canvasHost = ref<HTMLDivElement | null>(null)
const toast = useToast()
const { fetchSession } = useAuth()

const { data: state, refresh } = await useFetch('/api/pirates/state')

const {
    hud, running, paused, starting, submitting, preferGem,
    announcements, dismissAnnouncement,
    gameOverVisible, gameOverResult,
    attachCanvas, detachCanvas, startVoyage, pauseVoyage, resumeVoyage, cancelVoyage,
    castAbility, toggleAmmoMode, closeGameOver,
    autopilotEnabled, autopilotStatus, autopilotDecision, toggleAutopilot,
    soundEnabled, soundVolume, playMenuSound
} = usePirateRun()

const inVoyage = computed(() => running.value || paused.value)
const showHarbour = computed(() => !inVoyage.value && !gameOverVisible.value && !submitting.value)

// ─── HUD ────────────────────────────────────────────────────────────────────

const remainingLabel = computed(() => pirateClock(hud.value?.remainingMs ?? PIRATE_RUN_DURATION_MS, true))
const voyageProgress = computed(() => Math.min(1, (hud.value?.elapsedMs ?? 0) / PIRATE_RUN_DURATION_MS))
const finalMinute = computed(() => (hud.value?.remainingMs ?? Infinity) <= 60_000)
// Bumps once per second so the coin counter visibly ticks as the pay lands.
const coinTick = computed(() => Math.floor((hud.value?.elapsedMs ?? 0) / 1000))

const hullFraction = computed(() => hud.value && hud.value.maxHp > 0 ? Math.max(0, Math.min(1, hud.value.hp / hud.value.maxHp)) : 1)
const shieldFraction = computed(() => hud.value && hud.value.maxShield > 0 ? Math.max(0, Math.min(1, hud.value.shield / hud.value.maxShield)) : 0)
const hullColor = computed(() => hullFraction.value > 0.5 ? '#3ddc97' : hullFraction.value > 0.25 ? '#f3c35a' : '#f0524f')
const lowHull = computed(() => hullFraction.value <= 0.25)

const ability = computed(() => hud.value?.ability ?? null)
const equippedAbility = computed(() => state.value?.abilities.find(entry => entry.equipped) ?? state.value?.abilities[0] ?? null)
const abilityId = computed(() => ability.value?.id ?? equippedAbility.value?.id ?? 'bomb')
const abilityName = computed(() => PIRATE_ABILITIES.find(entry => entry.id === abilityId.value)?.name ?? 'Ability')
const abilityAccent = computed(() => pirateAbilityHex(abilityId.value))
const abilityCooldownFraction = computed(() => {
    const a = ability.value
    if (!a) return 0
    if (a.locked) return 1
    return a.totalMs > 0 ? Math.max(0, Math.min(1, a.remainingMs / a.totalMs)) : 0
})
const abilityLabel = computed(() => {
    const a = ability.value
    if (!a) return ''
    if (a.locked) return 'At sea'
    return a.ready ? 'Ready' : `${Math.ceil(a.remainingMs / 1000)}s`
})
const RING = 2 * Math.PI * 46

const upgrades = computed(() => (hud.value?.powerUps ?? []).map(entry => {
    const def = piratePowerUp(entry.id)
    return { ...entry, def, color: piratePowerUpHex(entry.id), rarityName: pirateRarity(def.rarity).name }
}))
const nextCrateLabel = computed(() => `${Math.max(0, Math.ceil((hud.value?.nextCrateMs ?? 0) / 1000))}s`)

const bosses = computed(() => (hud.value?.bosses ?? []).map(boss => ({
    ...boss,
    accent: PIRATE_BOSS_ACCENTS[boss.kind] ?? '#ef4444',
    hpPct: boss.maxHp > 0 ? Math.max(0, Math.min(100, boss.hp / boss.maxHp * 100)) : 0,
    shieldPct: boss.maxHp > 0 ? Math.max(0, Math.min(100, boss.shield / boss.maxHp * 100)) : 0,
    status: boss.hidden ? (boss.kind === 'kraken' ? 'Submerged' : 'Blinking') : ''
})))

const ammoCapacity = computed(() => state.value?.ammo.capacity ?? 0)
const gemAmmoCapacity = computed(() => state.value?.gemAmmo.capacity ?? 0)

function upgradeFrame(id: PiratePowerUpId) {
    return { '--glow': piratePowerUpHex(id) }
}

// ─── Autopilot ──────────────────────────────────────────────────────────────

function moveLabel(move: NonNullable<typeof autopilotStatus.value>['move']) {
    if (!move) return 'Laya'
    if (move.kind === 'sail') return `Sailing ${move.heading}`
    if (move.kind === 'grab') return `Grabbing the ${move.pickup}`
    return 'Attacking'
}
const autopilotLabel = computed(() => {
    const status = autopilotStatus.value
    if (!autopilotEnabled.value || !status) return 'Auto-play'
    if (!status.laya) return status.online ? 'Waiting for Laya' : 'Laya offline'
    return moveLabel(status.move)
})
// Laya's rating of its top moves, highest first, and the ability call.
const autopilotRows = computed(() => {
    const decision = autopilotDecision.value
    if (!decision) return []
    const best = Math.max(...Object.values(decision.moves))
    const rows = Object.entries(decision.moves)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, value]) => ({
            key,
            label: key.startsWith('attack_') ? 'attack ship' : key.replace('_', ' '),
            value,
            text: `${Math.round(value * 100)}%`,
            top: value === best
        }))
    if (decision.keg) rows.push({ key: 'keg', label: 'ability', value: 1, text: 'cast', top: false })
    return rows
})
// Auto-play is limited to a few accounts; drop it if this one lost access.
watch(() => state.value?.autopilot, (allowed) => {
    if (!allowed && autopilotEnabled.value) toggleAutopilot()
})

// ─── Harbour ────────────────────────────────────────────────────────────────

const difficultyOptions = computed(() => state.value?.difficultyOptions ?? [])
const selectedIndex = ref(0)
const selectedDifficulty = computed(() => difficultyOptions.value[selectedIndex.value]?.difficulty ?? 0)
const selectedOption = computed(() => difficultyOptions.value[selectedIndex.value] ?? null)
const baseEstimate = computed(() => difficultyOptions.value[0]?.estimatedLoot ?? 1)
const payMultiplier = computed(() => (selectedOption.value?.estimatedLoot ?? 0) / Math.max(1, baseEstimate.value))
const difficultyPct = computed(() => difficultyOptions.value.length > 1 ? selectedIndex.value / (difficultyOptions.value.length - 1) * 100 : 0)
const difficultyVerdict = computed(() => {
    const s = state.value
    if (!s) return { label: '', color: '#93a8b6' }
    const gap = s.power - selectedDifficulty.value
    if (selectedOption.value?.completed) return { label: 'Cleared before', color: '#3ddc97' }
    if (selectedDifficulty.value === s.recommendedDifficulty) return { label: 'Recommended', color: '#f3c35a' }
    if (gap >= 100) return { label: 'Comfortable', color: '#6cb8ff' }
    if (gap >= 0) return { label: 'Tough', color: '#fb923c' }
    return { label: 'Deadly', color: '#f0524f' }
})

watch(() => state.value?.recommendedDifficulty, (difficulty) => {
    if (difficulty === undefined || inVoyage.value) return
    const index = difficultyOptions.value.findIndex(option => option.difficulty === difficulty)
    if (index >= 0) selectedIndex.value = index
}, { immediate: true })

function stepDifficulty(delta: number) {
    const max = difficultyOptions.value.length - 1
    selectedIndex.value = Math.max(0, Math.min(max, selectedIndex.value + delta))
}

const loadout = computed(() => (state.value?.cannons ?? []).map(cannon => ({
    ...cannon,
    hex: pirateHex(cannon.shotColor),
    tierName: pirateCannonTier(cannon.tierId).name
})))
const loadoutTierIds = computed(() => loadout.value.map(cannon => cannon.tierId))
const bestSurvivalLabel = computed(() => pirateClock(state.value?.bestSurvivalMs ?? 0))
const equippedSkinName = computed(() => state.value?.skins.find(skin => skin.equipped)?.name ?? 'Golden Brigantine')
const canSetSail = computed(() => (state.value?.cannons.length ?? 0) > 0)

// Dry dock — the server is the source of truth (repair.until), we just tick
// a local clock so the countdown moves smoothly between refreshes.
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
const repairRushGemCost = computed(() => state.value?.repair?.rushGemCost ?? 0)
const gems = computed(() => state.value?.gems ?? 0)
const rushing = ref(false)

watch(isRepairing, (repairing, was) => {
    if (was && !repairing) refresh()
})

async function rushRepair() {
    if (rushing.value || !isRepairing.value) return
    rushing.value = true
    try {
        await $fetch('/api/pirates/repair/rush', { method: 'POST' })
        await Promise.all([refresh(), fetchSession()])
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

// ─── Debrief ────────────────────────────────────────────────────────────────

const debrief = computed(() => {
    const r = gameOverResult.value
    if (!r) return null
    const headline = r.survived ? 'Made it home' : r.reason === 'cancelled' ? 'Turned for port' : 'Sent to the deep'
    const icon = r.survived ? 'i-lucide-crown' : r.reason === 'cancelled' ? 'i-lucide-flag' : 'i-lucide-skull'
    const tone = r.survived ? '#f3c35a' : r.reason === 'cancelled' ? '#93a8b6' : '#f0524f'
    const line = r.survived
        ? 'You survived the whole voyage and earned the completion bonus.'
        : r.reason === 'cancelled'
            ? 'You sailed home early and kept the pay earned so far.'
            : 'The fleet sank you. You keep the pay earned before you went down.'
    return { ...r, headline, icon, tone, line }
})

function sailAgain() {
    playMenuSound()
    closeGameOver()
}

// ─── Stage, fullscreen, keys ────────────────────────────────────────────────

const gameContainer = ref<HTMLDivElement | null>(null)
const isFullscreen = ref(false)

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

watch(gameOverVisible, (visible) => {
    if (visible && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {
            isFullscreen.value = false
        })
    }
})

function handleKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (event.key === 'p' || event.key === 'P') {
        if (running.value) pauseVoyage()
        else if (paused.value) resumeVoyage()
    }
}

let attached = false

onMounted(async () => {
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    window.addEventListener('keydown', handleKey)
    clockTimer = setInterval(() => { now.value = Date.now() }, 1000)
    const host = canvasHost.value
    if (!host || !state.value) return
    await attachCanvas(host, state, refresh)
    attached = true
})

onUnmounted(() => {
    document.removeEventListener('fullscreenchange', handleFullscreenChange)
    window.removeEventListener('keydown', handleKey)
    if (clockTimer) clearInterval(clockTimer)
    if (attached) detachCanvas()
})
</script>

<template>
  <div class="raid mx-auto w-full max-w-[1500px] space-y-4 px-3 sm:px-6">
    <!-- Title strip -->
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="pr-display text-4xl leading-none sm:text-5xl">
          Pirate Raid
        </h1>
        <p class="pr-muted mt-1 text-sm">
          Six minutes at sea. Every second afloat pays more than the last.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="state">
          <span class="pr-tag" style="--tag: #f3c35a"><UIcon name="i-lucide-anchor" class="size-3" />Power {{ state.power }}</span>
          <span class="pr-tag" style="--tag: #6cb8ff"><UIcon name="i-lucide-hourglass" class="size-3" />Best {{ bestSurvivalLabel }}</span>
          <span class="pr-tag" style="--tag: #93a8b6"><UIcon name="i-lucide-map" class="size-3" />{{ state.runsPlayed }} voyages</span>
        </template>
        <div class="raid-sound pr-inset flex items-center gap-2 px-2.5 py-1.5">
          <button
            type="button"
            class="raid-icon-btn"
            :aria-label="soundEnabled ? 'Mute sound' : 'Unmute sound'"
            @click="soundEnabled = !soundEnabled; playMenuSound()"
          >
            <UIcon :name="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'" class="size-4" />
          </button>
          <input
            v-model.number="soundVolume"
            type="range"
            min="0"
            max="100"
            class="pr-range w-24 sm:w-28"
            :style="{ '--pct': `${soundVolume}%` }"
            :disabled="!soundEnabled"
            aria-label="Sound volume"
          >
          <span class="w-8 text-right text-[10px] font-bold pr-muted">{{ soundVolume }}%</span>
        </div>
      </div>
    </header>

    <div v-if="!state" class="pr-skeleton raid-aspect w-full" />

    <div
      v-else
      ref="gameContainer"
      class="raid-shell"
      :class="{ 'is-fullscreen': isFullscreen }"
    >
      <div class="raid-stage" :class="{ 'raid-aspect': !isFullscreen, 'is-low': inVoyage && lowHull, 'is-harbour': showHarbour || gameOverVisible }">
        <div ref="canvasHost" class="absolute inset-0 flex items-center justify-center overflow-hidden" />

        <!-- ══ In-voyage HUD ══════════════════════════════════════════════ -->
        <div v-if="inVoyage && hud" class="raid-hud">
          <!-- Clock + pay -->
          <div class="hud-clock" :class="{ 'is-final': finalMinute }">
            <div class="hud-clock-time">
              <UIcon name="i-lucide-hourglass" class="hud-clock-icon" />
              <span>{{ remainingLabel }}</span>
            </div>
            <div class="hud-clock-track">
              <i :style="{ width: `${voyageProgress * 100}%` }" />
              <b v-for="m in 5" :key="m" :style="{ left: `${m / 6 * 100}%` }" />
            </div>
          </div>

          <!-- Bosses -->
          <div v-if="bosses.length" class="hud-bosses">
            <div v-for="boss in bosses" :key="boss.id" class="hud-boss" :class="{ 'is-hidden': boss.hidden }" :style="{ '--accent': boss.accent }">
              <div class="hud-boss-name">
                <UIcon name="i-lucide-skull" />
                <span>{{ boss.name }}</span>
                <em v-if="boss.status">{{ boss.status }}</em>
              </div>
              <div class="hud-boss-bar">
                <i :style="{ width: `${boss.hpPct}%` }" />
                <s v-if="boss.shieldPct > 0" :style="{ width: `${boss.shieldPct}%` }" />
              </div>
            </div>
          </div>

          <!-- Top-left: tally + upgrades -->
          <div class="hud-topleft">
            <div class="hud-tally">
              <span title="Ships sunk"><UIcon name="i-lucide-swords" class="hud-tally-icon" />{{ hud.kills }}</span>
              <span title="Enemy ships afloat"><UIcon name="i-lucide-sailboat" class="hud-tally-icon" />{{ hud.enemiesAfloat }}</span>
              <span class="hud-crate" title="Next salvage crate"><UIcon name="i-lucide-package" class="hud-tally-icon" />{{ nextCrateLabel }}</span>
            </div>
            <div v-if="upgrades.length" class="hud-upgrades">
              <div v-for="upgrade in upgrades" :key="upgrade.id" class="hud-upgrade" :style="upgradeFrame(upgrade.id)">
                <PiratesUpgradeArt :id="upgrade.id" class="size-full" />
                <b v-if="upgrade.def.maxStacks > 1">{{ pirateRoman(upgrade.stacks) }}</b>
                <div class="hud-upgrade-card">
                  <p class="hud-upgrade-rarity" :style="{ color: upgrade.color }">{{ upgrade.rarityName }}</p>
                  <p class="hud-upgrade-name">{{ upgrade.def.name }} <span v-if="upgrade.def.maxStacks > 1">{{ upgrade.stacks }}/{{ upgrade.def.maxStacks }}</span></p>
                  <p class="hud-upgrade-desc">{{ upgrade.def.description }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Top-right controls -->
          <div class="hud-topright">
            <div class="hud-pay">
              <UIcon name="i-lucide-coins" class="hud-pay-icon" />
              <span :key="coinTick" class="hud-pay-value">{{ formatNumber(hud.coins) }}</span>
              <span class="hud-pay-rate">+{{ formatNumber(hud.coinRate) }}/s</span>
            </div>
            <button type="button" class="hud-btn" :aria-label="paused ? 'Resume' : 'Pause'" @click="paused ? resumeVoyage() : pauseVoyage()">
              <UIcon :name="paused ? 'i-lucide-play' : 'i-lucide-pause'" />
            </button>
            <button type="button" class="hud-btn" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
              <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" />
            </button>
          </div>

          <!-- Auto-play decisions -->
          <div v-if="autopilotEnabled && autopilotStatus" class="hud-autopilot">
            <div class="flex items-center justify-between gap-2 font-bold">
              <span class="flex items-center gap-1 truncate"><UIcon name="i-lucide-bot" />{{ autopilotLabel }}</span>
              <span :style="{ color: autopilotStatus.laya ? '#2dd4bf' : '#f0524f' }">{{ autopilotStatus.laya ? 'Laya' : 'Offline' }}</span>
            </div>
            <div v-for="row in autopilotRows" :key="row.key">
              <div class="flex justify-between gap-2">
                <span class="opacity-70">{{ row.label }}</span>
                <span class="font-semibold">{{ row.text }}</span>
              </div>
              <div class="hud-autopilot-bar">
                <i :style="{ width: `${Math.round(row.value * 100)}%`, background: row.top ? '#f3c35a' : '#5f7686' }" />
              </div>
            </div>
          </div>

          <!-- Bottom-left: hull -->
          <div class="hud-hull" :class="{ 'is-low': lowHull }">
            <div class="hud-hull-head">
              <span><UIcon name="i-lucide-shield-half" />Hull</span>
              <span class="hud-hull-num">{{ Math.ceil(hud.hp) }}<small>/{{ hud.maxHp }}</small></span>
            </div>
            <div class="hud-hull-bar">
              <i :style="{ 'width': `${hullFraction * 100}%`, '--fill': hullColor }" />
            </div>
            <div v-if="hud.maxShield > 0" class="hud-shield-bar">
              <i :style="{ width: `${shieldFraction * 100}%` }" />
            </div>
            <div v-if="hud.tethered" class="hud-tether">
              <UIcon name="i-lucide-link" />Harpooned
            </div>
          </div>

          <!-- Bottom-centre: ability -->
          <button
            type="button"
            class="hud-ability"
            :class="{ 'is-ready': ability?.ready, 'is-locked': ability?.locked }"
            :style="{ '--accent': abilityAccent }"
            :aria-label="`${abilityName}: ${abilityLabel}`"
            @click="castAbility"
          >
            <svg viewBox="0 0 100 100" class="hud-ability-ring">
              <circle cx="50" cy="50" r="46" class="hud-ability-track" />
              <circle
                cx="50"
                cy="50"
                r="46"
                class="hud-ability-fill"
                :stroke-dasharray="RING"
                :stroke-dashoffset="RING * abilityCooldownFraction"
              />
            </svg>
            <PiratesAbilityArt :id="abilityId" class="hud-ability-art" :dimmed="!ability?.ready" />
            <span class="hud-ability-label">{{ abilityLabel }}</span>
            <span class="hud-ability-pips">
              <i v-for="pip in 5" :key="pip" :class="{ on: pip <= (ability?.level ?? 1) }" />
            </span>
            <span class="hud-ability-keys"><kbd>RMB</kbd><kbd>Space</kbd></span>
          </button>

          <!-- Bottom-right: ammo -->
          <button
            type="button"
            class="hud-ammo"
            :class="{ 'is-gem': preferGem }"
            :aria-label="preferGem ? 'Firing gem shot, switch to standard' : 'Firing standard shot, switch to gem'"
            @click="toggleAmmoMode"
          >
            <div class="hud-ammo-row" :class="{ active: !preferGem || hud.gemAmmo <= 0 }">
              <span class="hud-ammo-dot" style="background: #f3c35a" />
              <span>Shot</span>
              <b>{{ formatNumber(hud.ammo) }}</b>
            </div>
            <div class="hud-ammo-row" :class="{ active: preferGem && hud.gemAmmo > 0 }">
              <span class="hud-ammo-dot" style="background: #6cb8ff" />
              <span>Gem</span>
              <b>{{ formatNumber(hud.gemAmmo) }}</b>
            </div>
            <kbd>E</kbd>
          </button>

          <!-- Announcements -->
          <TransitionGroup name="announce" tag="div" class="hud-announce">
            <div
              v-for="item in announcements"
              :key="item.id"
              class="announce"
              :class="`announce--${item.kind}`"
              :style="{
                '--glow': item.rarity ? pirateRarityHex(item.rarity) : item.bossKind ? (PIRATE_BOSS_ACCENTS[item.bossKind] ?? '#ef4444') : item.kind === 'warning' ? '#f0524f' : item.kind === 'repair' ? '#3ddc97' : '#f3c35a'
              }"
              @click="dismissAnnouncement(item.id)"
            >
              <template v-if="item.kind === 'boss'">
                <span class="announce-kicker">Boss incoming</span>
                <span class="announce-title pr-display">{{ item.title }}</span>
                <span v-if="item.subtitle" class="announce-sub">{{ item.subtitle }}</span>
              </template>
              <template v-else-if="item.kind === 'upgrade' && item.powerUpId">
                <PiratesUpgradeArt :id="item.powerUpId" class="announce-art" />
                <div class="min-w-0">
                  <span class="announce-kicker">{{ item.rarity ? pirateRarity(item.rarity).name : 'Salvage' }}</span>
                  <span class="announce-title">{{ item.title }}</span>
                  <span v-if="item.subtitle" class="announce-sub">{{ item.subtitle }}</span>
                </div>
              </template>
              <template v-else>
                <UIcon :name="item.kind === 'crate' ? 'i-lucide-package' : item.kind === 'repair' ? 'i-lucide-wrench' : 'i-lucide-triangle-alert'" class="announce-icon" />
                <div class="min-w-0">
                  <span class="announce-title">{{ item.title }}</span>
                  <span v-if="item.subtitle" class="announce-sub">{{ item.subtitle }}</span>
                </div>
              </template>
            </div>
          </TransitionGroup>
        </div>

        <!-- Floating fullscreen toggle outside a voyage -->
        <button v-if="!inVoyage" type="button" class="hud-btn raid-fs" :aria-label="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'" @click="toggleFullscreen">
          <UIcon :name="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'" />
        </button>

        <!-- ══ Pause ════════════════════════════════════════════════════════ -->
        <Transition name="fade">
          <div v-if="paused" class="raid-overlay">
            <div class="pr-panel raid-card w-full max-w-sm p-6 text-center">
              <UIcon name="i-lucide-anchor" class="mx-auto size-10 text-[var(--pr-gold)]" />
              <h2 class="pr-display mt-2 text-4xl">
                Anchors dropped
              </h2>
              <p v-if="hud" class="pr-muted mt-2 text-sm">
                {{ Math.ceil(hud.hp) }}/{{ hud.maxHp }} hull · {{ formatNumber(hud.coins) }} coins earned · {{ remainingLabel }} left
              </p>
              <div class="mt-5 grid gap-2">
                <PiratesButton variant="gold" size="lg" icon="i-lucide-play" label="Weigh anchor" block @click="resumeVoyage" />
                <PiratesButton variant="ghost" icon="i-lucide-flag" label="Sail home now" block @click="cancelVoyage" />
              </div>
              <p class="pr-dim mt-3 text-[11px]">
                Press P to resume. Sailing home keeps the pay earned so far.
              </p>
            </div>
          </div>
        </Transition>

        <!-- ══ Counting the haul ════════════════════════════════════════════ -->
        <Transition name="fade">
          <div v-if="submitting" class="raid-overlay">
            <div class="flex items-center gap-3 text-lg">
              <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-[var(--pr-gold)]" />
              <span class="pr-heading">Counting the haul…</span>
            </div>
          </div>
        </Transition>

        <!-- ══ Debrief ═════════════════════════════════════════════════════ -->
        <Transition name="rise">
          <div v-if="gameOverVisible && debrief" class="raid-overlay raid-overlay--scroll">
            <div class="pr-panel raid-card w-full max-w-3xl p-5 sm:p-7" :style="{ '--tone': debrief.tone }">
              <div class="flex flex-wrap items-center gap-4">
                <div class="debrief-emblem">
                  <UIcon :name="debrief.icon" class="size-8" />
                </div>
                <div class="min-w-0 flex-1">
                  <h2 class="pr-display text-4xl sm:text-5xl" :style="{ color: debrief.tone }">
                    {{ debrief.headline }}
                  </h2>
                  <p class="pr-muted text-sm">
                    {{ debrief.line }}
                  </p>
                </div>
                <div class="debrief-haul">
                  <span class="pr-heading text-[11px]">Coins earned</span>
                  <span class="debrief-haul-value"><UIcon name="i-lucide-coins" />{{ formatNumber(debrief.awarded) }}</span>
                  <span class="pr-muted text-[11px]">
                    {{ formatNumber(debrief.runCoins) }} survival pay<template v-if="debrief.completionBonus > 0"> + {{ formatNumber(debrief.completionBonus) }} completion bonus</template>
                  </span>
                </div>
              </div>

              <div class="pr-divider my-5" />

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div class="debrief-stat">
                  <span>Time afloat</span><b>{{ pirateClock(debrief.elapsedMs) }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Ships sunk</span><b>{{ debrief.kills }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Bosses sunk</span><b>{{ debrief.bossesSunk }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Damage dealt</span><b>{{ formatNumber(debrief.damageDealt) }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Difficulty</span><b>{{ debrief.difficulty }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Shots fired</span><b>{{ formatNumber(debrief.shotsFired) }}</b>
                </div>
                <div class="debrief-stat">
                  <span>Abilities cast</span><b>{{ debrief.abilitiesUsed }}</b>
                </div>
                <div class="debrief-stat" :class="{ 'is-warn': debrief.repairMs > 0 }">
                  <span>Dry dock</span><b>{{ debrief.repairMs > 0 ? pirateDuration(debrief.repairMs) : 'None' }}</b>
                </div>
              </div>

              <div class="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <p class="pr-heading mb-2 text-[11px]">
                    Salvage collected
                  </p>
                  <div v-if="debrief.powerUps.length" class="flex flex-wrap gap-2">
                    <div v-for="upgrade in debrief.powerUps" :key="upgrade.id" class="debrief-upgrade" :style="upgradeFrame(upgrade.id)">
                      <PiratesUpgradeArt :id="upgrade.id" class="size-9 shrink-0" />
                      <div class="min-w-0">
                        <p class="truncate text-xs font-bold">{{ piratePowerUp(upgrade.id).name }}</p>
                        <p class="text-[10px]" :style="{ color: piratePowerUpHex(upgrade.id) }">
                          {{ pirateRarity(piratePowerUp(upgrade.id).rarity).name }}<template v-if="upgrade.stacks > 1"> · {{ pirateRoman(upgrade.stacks) }}</template>
                        </p>
                      </div>
                    </div>
                  </div>
                  <p v-else class="pr-dim text-xs">
                    No crates recovered this voyage.
                  </p>
                </div>
                <div>
                  <p class="pr-heading mb-2 text-[11px]">
                    Sunk by type
                  </p>
                  <div v-if="debrief.sunkByType.length" class="space-y-1">
                    <div v-for="sunk in debrief.sunkByType.slice(0, 6)" :key="sunk.id" class="flex items-center gap-2 text-xs">
                      <PiratesShipPreview :tier-id="sunk.id" class="h-6 w-10 shrink-0" />
                      <span class="flex-1 truncate">{{ sunk.name }}</span>
                      <b class="text-[var(--pr-gold)]">×{{ sunk.count }}</b>
                    </div>
                  </div>
                  <p v-else class="pr-dim text-xs">
                    Nothing sunk.
                  </p>
                </div>
              </div>

              <div class="mt-6 flex flex-wrap justify-end gap-2">
                <PiratesButton variant="wood" icon="i-lucide-hammer" label="Armory" to="/pirates/manage" />
                <PiratesButton variant="gold" icon="i-lucide-sailboat" label="Back to harbour" @click="sailAgain" />
              </div>
            </div>
          </div>
        </Transition>

        <!-- ══ Harbour ═════════════════════════════════════════════════════ -->
        <Transition name="fade">
          <div v-if="showHarbour" class="raid-overlay raid-overlay--harbour raid-overlay--scroll">
            <div class="harbour">
              <!-- Ship -->
              <div class="pr-panel harbour-ship">
                <div class="harbour-ship-art">
                  <PiratesShipPreview :skin-id="state.equippedSkinId" :gun-tier-ids="loadoutTierIds" animate class="size-full" />
                </div>
                <div class="px-4 pb-4">
                  <p class="pr-heading text-[11px]">Your ship</p>
                  <p class="pr-display text-3xl leading-tight">{{ equippedSkinName }}</p>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <UTooltip v-for="cannon in loadout" :key="cannon.slotIndex" :text="cannon.tierName">
                      <span class="harbour-gun" :style="{ '--gun': cannon.hex }" />
                    </UTooltip>
                    <span class="pr-muted ml-1 text-[11px]">{{ loadout.length }}/{{ state.cannonSlots }} guns</span>
                  </div>
                  <div class="mt-3 grid grid-cols-4 gap-1.5 text-center">
                    <div class="harbour-stat"><span>Hull</span><b>{{ state.stats.maxHp }}</b></div>
                    <div class="harbour-stat"><span>Speed</span><b>{{ state.stats.speed }}</b></div>
                    <div class="harbour-stat"><span>Armour</span><b>{{ state.stats.defenseRating }}</b></div>
                    <div class="harbour-stat"><span>Regen</span><b>{{ state.stats.regenRate }}</b></div>
                  </div>
                  <div v-if="equippedAbility" class="harbour-ability mt-3">
                    <PiratesAbilityArt :id="equippedAbility.id" class="size-12 shrink-0" />
                    <div class="min-w-0">
                      <p class="truncate text-sm font-bold">{{ equippedAbility.name }} <span class="pr-muted text-[11px]">Lv {{ equippedAbility.level }}</span></p>
                      <p class="pr-muted text-[11px]">{{ equippedAbility.currentCooldownMs / 1000 }}s cooldown · right-click or Space</p>
                    </div>
                  </div>
                  <div class="mt-2 flex gap-2 text-[11px]">
                    <span class="pr-tag" style="--tag: #f3c35a">{{ formatNumber(state.ammo.count) }}/{{ formatNumber(ammoCapacity) }} shot</span>
                    <span class="pr-tag" style="--tag: #6cb8ff">{{ formatNumber(state.gemAmmo.count) }}/{{ formatNumber(gemAmmoCapacity) }} gem</span>
                  </div>
                </div>
              </div>

              <!-- Voyage -->
              <div class="pr-panel harbour-voyage p-5">
                <p class="pr-heading text-[11px]">Chart a voyage</p>

                <div class="harbour-diff">
                  <button type="button" class="raid-icon-btn raid-icon-btn--lg" aria-label="Easier" :disabled="selectedIndex <= 0" @click="stepDifficulty(-1)">
                    <UIcon name="i-lucide-chevron-left" class="size-6" />
                  </button>
                  <div class="text-center">
                    <p class="harbour-diff-value">{{ selectedDifficulty }}</p>
                    <p class="text-[11px] font-bold uppercase tracking-widest" :style="{ color: difficultyVerdict.color }">
                      <UIcon v-if="selectedOption?.completed" name="i-lucide-check" class="-mt-0.5 inline size-3" />
                      {{ difficultyVerdict.label }}
                    </p>
                  </div>
                  <button type="button" class="raid-icon-btn raid-icon-btn--lg" aria-label="Harder" :disabled="selectedIndex >= difficultyOptions.length - 1" @click="stepDifficulty(1)">
                    <UIcon name="i-lucide-chevron-right" class="size-6" />
                  </button>
                </div>
                <input
                  v-model.number="selectedIndex"
                  type="range"
                  min="0"
                  :max="Math.max(0, difficultyOptions.length - 1)"
                  class="pr-range mt-3 w-full"
                  :style="{ '--pct': `${difficultyPct}%` }"
                  aria-label="Difficulty"
                >
                <div class="mt-1 flex justify-between text-[10px] pr-dim">
                  <span>Calm seas</span>
                  <span>Your power {{ state.power }}</span>
                  <span>Maelstrom</span>
                </div>

                <div class="mt-4 grid grid-cols-2 gap-2">
                  <div class="harbour-pay">
                    <span>Full voyage pay</span>
                    <b><UIcon name="i-lucide-coins" />{{ formatNumber(selectedOption?.estimatedLoot ?? 0) }}</b>
                    <small>×{{ payMultiplier.toFixed(1) }} of calm seas</small>
                  </div>
                  <div class="harbour-pay">
                    <span>Completion bonus</span>
                    <b><UIcon name="i-lucide-crown" />{{ formatNumber(selectedOption?.completionBonus ?? 0) }}</b>
                    <small>for surviving all 6:00</small>
                  </div>
                </div>
                <p class="pr-muted mt-2 text-[11px] leading-snug">
                  Pay ticks up every second you stay afloat and the rate climbs as the voyage goes on. Sink early and you keep what you earned.
                </p>

                <div v-if="isRepairing" class="harbour-dock mt-4">
                  <div class="flex items-center justify-between gap-2">
                    <span class="flex items-center gap-1.5 text-sm font-bold"><UIcon name="i-lucide-wrench" class="text-[var(--pr-gold)]" />In dry dock</span>
                    <span class="text-sm font-bold">{{ pirateDuration(repairRemainingMs) }}</span>
                  </div>
                  <div class="pr-bar mt-2 h-2">
                    <i :style="{ 'width': `${repairProgressPercent}%`, '--fill': '#f3c35a' }" />
                  </div>
                  <PiratesButton
                    class="mt-3"
                    variant="gem"
                    block
                    icon="i-lucide-gem"
                    :loading="rushing"
                    :disabled="gems < repairRushGemCost"
                    @click="rushRepair"
                  >
                    Rush repairs · {{ formatNumber(repairRushGemCost) }} gems
                  </PiratesButton>
                </div>
                <PiratesButton
                  v-else
                  class="mt-4"
                  variant="gold"
                  size="lg"
                  block
                  icon="i-lucide-sailboat"
                  :loading="starting"
                  :disabled="!canSetSail"
                  @click="handleStartVoyage"
                >
                  Set sail
                </PiratesButton>
                <p v-if="!canSetSail" class="mt-2 text-center text-xs text-[var(--pr-blood)]">
                  Your gun deck is empty. Fit a cannon in the Armory first.
                </p>

                <PiratesButton
                  v-if="state.autopilot"
                  class="mt-2"
                  :variant="autopilotEnabled ? 'teal' : 'ghost'"
                  size="sm"
                  block
                  icon="i-lucide-bot"
                  :label="autopilotEnabled ? 'Auto-play on' : 'Auto-play off'"
                  @click="toggleAutopilot"
                />
              </div>

              <!-- Controls -->
              <div class="harbour-controls">
                <span><kbd>Click</kbd> sail there</span>
                <span><kbd>Drag</kbd> steer</span>
                <span><kbd>W A S D</kbd> helm</span>
                <span><kbd>Click ship</kbd> focus fire</span>
                <span><kbd>RMB</kbd>/<kbd>Space</kbd> ability</span>
                <span><kbd>E</kbd> gem shot</span>
                <span><kbd>P</kbd> pause</span>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Stage ──────────────────────────────────────────────────────────────── */
.raid-aspect { aspect-ratio: 1750 / 1025; }

.raid-shell { position: relative; }

.raid-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 1.1rem;
  background: #06121c;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.7),
    0 0 0 4px #3a2614,
    0 0 0 5px rgba(201, 151, 60, 0.7),
    0 30px 70px -30px rgba(0, 0, 0, 0.95);
  container-type: inline-size;
  user-select: none;
}
.raid-stage.is-low::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: inset 0 0 90px rgba(240, 82, 79, 0.45);
  animation: raid-throb 1.1s ease-in-out infinite;
}

.raid-shell.is-fullscreen,
.raid-shell:fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  padding: 0.75rem;
  background: #03090f;
  box-sizing: border-box;
}
.raid-shell.is-fullscreen .raid-stage,
.raid-shell:fullscreen .raid-stage {
  height: 100%;
}

.raid-fs { position: absolute; top: 0.75rem; right: 0.75rem; z-index: 25; }

/* ── HUD (sized in em off the stage width so it scales with the sea) ───── */
.raid-hud {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  font-size: clamp(9px, 0.95cqw, 15px);
  color: #eadfc6;
}
.raid-hud > * { pointer-events: auto; }
.raid-hud :deep(svg) { flex-shrink: 0; }

.hud-glass {
  background: linear-gradient(180deg, rgba(10, 26, 39, 0.82), rgba(5, 14, 23, 0.86));
  border: 1px solid rgba(201, 151, 60, 0.45);
  box-shadow: 0 10px 30px -14px rgba(0, 0, 0, 0.9), inset 0 1px 0 rgba(255, 226, 154, 0.1);
  backdrop-filter: blur(4px);
}

.hud-clock {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 7.5em;
  padding: 0.3em 0.8em 0.4em;
  border-radius: 0 0 0.8em 0.8em;
  text-align: center;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(20, 13, 8, 0.78), rgba(20, 13, 8, 0.62));
  border: 1px solid rgba(201, 151, 60, 0.35);
  border-top: 0;
  box-shadow: 0 8px 20px -12px rgba(0, 0, 0, 0.9);
}
.hud-clock-time {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3em;
  font-family: 'Cinzel', Georgia, serif;
  font-size: 1.15em;
  font-weight: 900;
  line-height: 1;
  color: #ffe29a;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
}
.hud-clock-icon { width: 0.7em; height: 0.7em; opacity: 0.7; }
.hud-clock.is-final .hud-clock-time { color: #ff8a80; animation: raid-throb 1s ease-in-out infinite; }
.hud-clock-track {
  position: relative;
  height: 0.22em;
  margin-top: 0.35em;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
}
.hud-clock-track i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #2dd4bf, #f3c35a 70%, #f0524f);
  transition: width 0.3s linear;
}
.hud-clock-track b {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 226, 154, 0.3);
}
.hud-pay {
  display: flex;
  align-items: center;
  gap: 0.35em;
  height: 2.2em;
  padding: 0 0.7em;
  border-radius: 0.6em;
  pointer-events: none;
  background: rgba(10, 20, 28, 0.62);
  border: 1px solid rgba(201, 151, 60, 0.3);
  font-variant-numeric: tabular-nums;
}
.hud-pay-icon { width: 0.95em; height: 0.95em; color: #f3c35a; }
.hud-pay-value {
  font-weight: 900;
  color: #ffe29a;
  display: inline-block;
  animation: raid-tick 0.45s ease-out;
}
.hud-pay-rate { font-size: 0.8em; font-weight: 700; color: #3ddc97; }

.hud-bosses {
  position: absolute;
  top: 3.4em;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  gap: 0.45em;
  width: min(34em, 70%);
  pointer-events: none;
}
.hud-boss-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4em;
  font-family: 'Pirata One', 'Cinzel', serif;
  font-size: 1.35em;
  color: var(--accent);
  text-shadow: 0 2px 0 #000, 0 0 14px var(--accent);
}
.hud-boss-name em {
  font-family: 'Cinzel', serif;
  font-size: 0.55em;
  font-style: normal;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #eadfc6;
  opacity: 0.8;
}
.hud-boss-bar {
  position: relative;
  height: 0.75em;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.7);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.8), 0 0 0 2px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 18px -4px var(--accent);
}
.hud-boss-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 60%, white), var(--accent) 55%, color-mix(in srgb, var(--accent) 60%, black));
  transition: width 0.2s ease;
}
.hud-boss-bar s {
  position: absolute;
  inset: 0 auto 0 0;
  background: repeating-linear-gradient(-45deg, rgba(103, 232, 249, 0.85) 0 4px, rgba(34, 211, 238, 0.55) 4px 8px);
}
.hud-boss.is-hidden { opacity: 0.55; }

.hud-topleft {
  position: absolute;
  top: 0.9em;
  left: 0.9em;
  display: grid;
  gap: 0.5em;
  max-width: 28%;
}
.hud-tally {
  display: flex;
  gap: 0.35em;
}
.hud-tally > span {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.25em 0.6em;
  border-radius: 999px;
  font-weight: 800;
  font-size: 0.9em;
  background: rgba(5, 14, 23, 0.75);
  border: 1px solid rgba(147, 168, 182, 0.25);
}
.hud-tally-icon { width: 1em; height: 1em; opacity: 0.75; }
.hud-tally .hud-crate { color: #f3c35a; border-color: rgba(243, 195, 90, 0.35); }
.hud-upgrades {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
}
.hud-upgrade {
  position: relative;
  width: 2.9em;
  height: 2.9em;
  border-radius: 0.7em;
  filter: drop-shadow(0 0 0.35em var(--glow));
  cursor: help;
}
.hud-upgrade b {
  position: absolute;
  right: -0.2em;
  bottom: -0.2em;
  min-width: 1.35em;
  padding: 0 0.25em;
  border-radius: 999px;
  font-family: 'Cinzel', serif;
  font-size: 0.7em;
  line-height: 1.35em;
  text-align: center;
  color: #1c1208;
  background: var(--glow);
}
.hud-upgrade-card {
  position: absolute;
  top: calc(100% + 0.5em);
  left: 0;
  z-index: 5;
  width: 16em;
  padding: 0.7em 0.8em;
  border-radius: 0.7em;
  background: rgba(5, 14, 23, 0.95);
  border: 1px solid var(--glow);
  box-shadow: 0 0 24px -8px var(--glow);
  opacity: 0;
  transform: translateY(-0.3em);
  pointer-events: none;
  transition: opacity 0.15s, transform 0.15s;
}
.hud-upgrade:hover .hud-upgrade-card { opacity: 1; transform: none; }
.hud-upgrade-rarity { font-size: 0.72em; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; }
.hud-upgrade-name { font-weight: 800; }
.hud-upgrade-name span { font-size: 0.8em; opacity: 0.6; }
.hud-upgrade-desc { margin-top: 0.2em; font-size: 0.85em; color: #93a8b6; line-height: 1.3; }

.hud-topright {
  position: absolute;
  top: 0.9em;
  right: 0.9em;
  display: flex;
  gap: 0.4em;
}
.hud-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4em;
  height: 2.4em;
  min-width: 28px;
  min-height: 28px;
  border-radius: 0.6em;
  color: #eadfc6;
  background: rgba(5, 14, 23, 0.75);
  border: 1px solid rgba(201, 151, 60, 0.45);
  transition: color 0.15s, background 0.15s;
}
.hud-btn:hover { color: #ffe29a; background: rgba(36, 23, 15, 0.9); }
.hud-btn :deep(span), .hud-btn :deep(svg) { width: 1.2em; height: 1.2em; }

.hud-autopilot {
  position: absolute;
  top: 7.5em;
  left: 0.9em;
  width: 14em;
  padding: 0.6em;
  border-radius: 0.6em;
  font-size: 0.85em;
  line-height: 1.25;
  background: rgba(5, 14, 23, 0.75);
  border: 1px solid rgba(45, 212, 191, 0.3);
  pointer-events: none;
}
.hud-autopilot-bar { height: 0.3em; margin-top: 0.15em; border-radius: 999px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.hud-autopilot-bar i { display: block; height: 100%; border-radius: inherit; transition: width 0.2s; }

.hud-hull {
  position: absolute;
  left: 0.9em;
  bottom: 0.9em;
  width: 19em;
  padding: 0.6em 0.8em 0.7em;
  border-radius: 0.9em;
  background: linear-gradient(180deg, rgba(36, 23, 15, 0.9), rgba(20, 13, 8, 0.9));
  border: 1px solid rgba(201, 151, 60, 0.55);
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}
.hud-hull-head { display: flex; align-items: baseline; justify-content: space-between; }
.hud-hull-head > span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  font-family: 'Cinzel', serif;
  font-size: 0.8em;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #f3c35a;
}
.hud-hull-num { font-size: 1.4em; font-weight: 900; }
.hud-hull-num small { font-size: 0.6em; opacity: 0.55; }
.hud-hull-bar {
  position: relative;
  height: 0.85em;
  margin-top: 0.3em;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.6);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.8);
}
.hud-hull-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: inherit;
  background: linear-gradient(180deg, color-mix(in srgb, var(--fill) 55%, white), var(--fill) 55%, color-mix(in srgb, var(--fill) 70%, black));
  box-shadow: 0 0 12px -2px var(--fill);
  transition: width 0.2s ease, background 0.3s;
}
.hud-shield-bar {
  height: 0.35em;
  margin-top: 0.25em;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.5);
}
.hud-shield-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #22d3ee, #a5f3fc);
  box-shadow: 0 0 10px #22d3ee;
  transition: width 0.2s ease;
}
.hud-hull.is-low { border-color: rgba(240, 82, 79, 0.8); animation: raid-glow-red 1.1s ease-in-out infinite; }
.hud-tether {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  margin-top: 0.35em;
  font-size: 0.8em;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #2dd4bf;
  animation: raid-throb 0.6s ease-in-out infinite;
}

.hud-ability {
  position: absolute;
  left: 50%;
  bottom: 0.7em;
  transform: translateX(-50%);
  width: 6.4em;
  height: 6.4em;
  min-width: 64px;
  min-height: 64px;
  border-radius: 999px;
  cursor: pointer;
  transition: transform 0.12s;
}
.hud-ability:active { transform: translateX(-50%) scale(0.95); }
.hud-ability-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.hud-ability-track { fill: rgba(5, 14, 23, 0.8); stroke: rgba(0, 0, 0, 0.6); stroke-width: 7; }
.hud-ability-fill {
  fill: none;
  stroke: var(--accent);
  stroke-width: 7;
  stroke-linecap: round;
  opacity: 0.35;
  transition: stroke-dashoffset 0.12s linear;
}
.hud-ability-art { position: absolute; inset: 12%; width: 76%; height: 76%; }
.hud-ability-label {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: 'Cinzel', serif;
  font-size: 1.15em;
  font-weight: 900;
  color: #fff;
  text-shadow: 0 2px 4px #000, 0 0 8px #000;
  pointer-events: none;
}
.hud-ability.is-ready .hud-ability-label { opacity: 0; }
.hud-ability.is-ready { filter: drop-shadow(0 0 0.8em var(--accent)); animation: raid-ready 1.6s ease-in-out infinite; }
.hud-ability.is-ready .hud-ability-fill { opacity: 1; }
.hud-ability-pips {
  position: absolute;
  left: 50%;
  bottom: -0.55em;
  transform: translateX(-50%);
  display: flex;
  gap: 0.2em;
  padding: 0.2em 0.4em;
  border-radius: 999px;
  background: rgba(5, 14, 23, 0.9);
  border: 1px solid rgba(201, 151, 60, 0.45);
}
.hud-ability-pips i { width: 0.4em; height: 0.4em; border-radius: 999px; background: rgba(255, 255, 255, 0.15); }
.hud-ability-pips i.on { background: var(--accent); box-shadow: 0 0 5px var(--accent); }
.hud-ability-keys {
  position: absolute;
  left: calc(100% + 0.5em);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.25em;
  pointer-events: none;
}

.raid-hud kbd, .harbour-controls kbd {
  display: inline-block;
  padding: 0.05em 0.4em;
  border-radius: 0.3em;
  font-family: ui-monospace, monospace;
  font-size: 0.72em;
  font-weight: 700;
  color: #eadfc6;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(201, 151, 60, 0.4);
  border-bottom-width: 2px;
}

.hud-ammo {
  position: absolute;
  right: 0.9em;
  bottom: 0.9em;
  display: grid;
  gap: 0.25em;
  min-width: 11em;
  padding: 0.55em 0.75em;
  border-radius: 0.9em;
  text-align: left;
  background: linear-gradient(180deg, rgba(36, 23, 15, 0.9), rgba(20, 13, 8, 0.9));
  border: 1px solid rgba(201, 151, 60, 0.55);
  box-shadow: 0 12px 30px -12px rgba(0, 0, 0, 0.9);
  cursor: pointer;
}
.hud-ammo.is-gem { border-color: rgba(108, 184, 255, 0.7); box-shadow: 0 0 20px -6px #6cb8ff; }
.hud-ammo > kbd { position: absolute; top: -0.7em; right: 0.7em; }
.hud-ammo-row { display: flex; align-items: center; gap: 0.45em; opacity: 0.45; font-size: 0.95em; }
.hud-ammo-row.active { opacity: 1; }
.hud-ammo-row b { margin-left: auto; font-weight: 900; }
.hud-ammo-dot { width: 0.6em; height: 0.6em; border-radius: 999px; box-shadow: 0 0 6px currentColor; }

/* ── Announcements ─────────────────────────────────────────────────────── */
.hud-announce {
  position: absolute;
  top: 36%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6em;
  width: 100%;
  pointer-events: none;
}
.announce {
  display: flex;
  align-items: center;
  gap: 0.8em;
  max-width: 30em;
  padding: 0.7em 1em;
  border-radius: 0.9em;
  background: linear-gradient(180deg, rgba(10, 26, 39, 0.92), rgba(5, 14, 23, 0.94));
  border: 1px solid var(--glow);
  box-shadow: 0 0 30px -8px var(--glow), 0 16px 40px -18px #000;
  pointer-events: auto;
  cursor: pointer;
}
.announce > div { display: grid; }
.announce-kicker { font-size: 0.72em; font-weight: 900; letter-spacing: 0.16em; text-transform: uppercase; color: var(--glow); }
.announce-title { font-weight: 900; font-size: 1.15em; }
.announce-sub { font-size: 0.85em; color: #93a8b6; line-height: 1.3; }
.announce-art { width: 3.6em; height: 3.6em; filter: drop-shadow(0 0 0.6em var(--glow)); }
.announce-icon { width: 1.6em; height: 1.6em; color: var(--glow); }
.announce--crate, .announce--repair { padding: 0.45em 0.8em; font-size: 0.9em; }
.announce--boss {
  display: grid;
  justify-items: center;
  width: 100vw;
  max-width: none;
  padding: 1em 2em;
  border-radius: 0;
  border-left: 0;
  border-right: 0;
  text-align: center;
  background: linear-gradient(90deg, transparent, rgba(20, 5, 5, 0.92) 18%, rgba(20, 5, 5, 0.92) 82%, transparent);
  box-shadow: 0 0 60px -10px var(--glow);
}
.announce--boss .announce-kicker { font-size: 0.9em; animation: raid-throb 0.8s ease-in-out infinite; }
.announce--boss .announce-title { font-size: 3.4em; line-height: 1; color: var(--glow); text-shadow: 0 3px 0 #000, 0 0 30px var(--glow); }
.announce--boss .announce-sub { max-width: 36em; }

.announce-enter-active { transition: opacity 0.3s, transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
.announce-leave-active { transition: opacity 0.3s, transform 0.3s; position: absolute; }
.announce-enter-from { opacity: 0; transform: scale(0.7) translateY(-0.6em); }
.announce-leave-to { opacity: 0; transform: translateY(-1em); }

/* ── Overlays ──────────────────────────────────────────────────────────── */
.raid-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: radial-gradient(ellipse at center, rgba(5, 14, 23, 0.55), rgba(3, 9, 15, 0.85));
  backdrop-filter: blur(2px);
}
.raid-overlay--scroll { overflow-y: auto; align-items: safe center; }
.raid-overlay--harbour {
  background:
    radial-gradient(ellipse at 30% 40%, rgba(45, 212, 191, 0.08), transparent 60%),
    linear-gradient(180deg, rgba(5, 14, 23, 0.5), rgba(3, 9, 15, 0.82));
}
.raid-card { animation: none; }

.debrief-emblem {
  display: grid;
  place-items: center;
  width: 4rem;
  height: 4rem;
  border-radius: 999px;
  color: var(--tone);
  background: radial-gradient(circle, color-mix(in srgb, var(--tone) 25%, transparent), rgba(0, 0, 0, 0.4));
  box-shadow: 0 0 0 2px var(--tone), 0 0 30px -6px var(--tone);
}
.debrief-haul { display: grid; justify-items: end; text-align: right; }
.debrief-haul-value {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 2.2rem;
  font-weight: 900;
  line-height: 1.1;
  color: #ffe29a;
  text-shadow: 0 0 20px rgba(243, 195, 90, 0.5);
}
.debrief-stat {
  display: grid;
  gap: 0.1rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.6rem;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
}
.debrief-stat span { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #93a8b6; }
.debrief-stat b { font-size: 1.15rem; font-weight: 900; }
.debrief-stat.is-warn b { color: #f3c35a; }
.debrief-upgrade {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 10rem;
  padding: 0.35rem 0.6rem 0.35rem 0.35rem;
  border-radius: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--glow) 55%, transparent), 0 0 16px -8px var(--glow);
}

.harbour {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  max-width: 58rem;
}
.harbour-ship { overflow: hidden; }
.harbour-ship-art {
  height: 11rem;
  background:
    radial-gradient(ellipse at 50% 60%, rgba(45, 212, 191, 0.18), transparent 65%),
    linear-gradient(180deg, rgba(15, 43, 61, 0.6), rgba(5, 14, 23, 0.2));
}
.harbour-gun {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 35%, white, var(--gun) 55%, color-mix(in srgb, var(--gun) 60%, black));
  box-shadow: 0 0 8px -1px var(--gun);
}
.harbour-stat {
  display: grid;
  padding: 0.35rem 0.2rem;
  border-radius: 0.5rem;
  background: rgba(0, 0, 0, 0.3);
}
.harbour-stat span { font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #93a8b6; }
.harbour-stat b { font-size: 0.95rem; font-weight: 900; }
.harbour-ability {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.5rem;
  border-radius: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
}
.harbour-voyage { display: flex; flex-direction: column; }
.harbour-diff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.harbour-diff-value {
  font-family: 'Cinzel', serif;
  font-size: 3.4rem;
  font-weight: 900;
  line-height: 1;
  color: #ffe29a;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6), 0 0 24px rgba(243, 195, 90, 0.25);
}
.harbour-pay {
  display: grid;
  padding: 0.6rem 0.75rem;
  border-radius: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
}
.harbour-pay span { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #93a8b6; }
.harbour-pay b { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 1.3rem; font-weight: 900; color: #ffe29a; }
.harbour-pay small { font-size: 10px; color: #5f7686; }
.harbour-dock {
  padding: 0.75rem;
  border-radius: 0.7rem;
  background: rgba(243, 195, 90, 0.07);
  box-shadow: inset 0 0 0 1px rgba(243, 195, 90, 0.3);
}
.harbour-controls {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem 1rem;
  font-size: 12px;
  color: #93a8b6;
}
.harbour-controls kbd { font-size: 10px; margin-right: 0.2rem; }

.raid-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #c8b28c;
  transition: color 0.15s;
}
.raid-icon-btn:hover:not(:disabled) { color: #ffe29a; }
.raid-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.raid-icon-btn--lg {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  box-shadow: 0 0 0 1px rgba(201, 151, 60, 0.45);
}

/* ── Transitions & keyframes ───────────────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.rise-enter-active { transition: opacity 0.35s, transform 0.45s cubic-bezier(0.34, 1.4, 0.64, 1); }
.rise-leave-active { transition: opacity 0.2s; }
.rise-enter-from { opacity: 0; transform: translateY(24px) scale(0.97); }
.rise-leave-to { opacity: 0; }

@keyframes raid-throb { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes raid-tick { 0% { transform: scale(1.18); color: #fff; } 100% { transform: scale(1); } }
@keyframes raid-ready { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.05); } }
@keyframes raid-glow-red { 0%, 100% { box-shadow: 0 0 0 rgba(240, 82, 79, 0); } 50% { box-shadow: 0 0 24px -4px rgba(240, 82, 79, 0.9); } }

/* ── Small screens ─────────────────────────────────────────────────────── */
@container (max-width: 700px) {
  .raid-hud { font-size: 9px; }
  .hud-ability-keys, .hud-autopilot { display: none; }
  .hud-hull { width: 14em; }
  .hud-topleft { max-width: 45%; }
}
@media (max-width: 760px) {
  .harbour { grid-template-columns: 1fr; }
  .harbour-ship-art { height: 8rem; }
  .raid-stage.raid-aspect.is-harbour { aspect-ratio: auto; min-height: 38rem; }
}

@media (prefers-reduced-motion: reduce) {
  .raid-stage.is-low::after,
  .hud-clock.is-final .hud-clock-time,
  .hud-pay-value,
  .hud-ability.is-ready,
  .hud-hull.is-low,
  .hud-tether,
  .announce--boss .announce-kicker { animation: none; }
}
</style>
