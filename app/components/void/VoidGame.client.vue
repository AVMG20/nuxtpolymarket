<template>
    <div ref="root" class="vr-root" :class="{ 'vr-flying': inFlight, 'vr-calm': reduceFlashes }">
        <div ref="viewport" class="absolute inset-0" @click="onViewportClick" />

        <!-- ═══ Hangar ═══ -->
        <VoidHangar
            v-if="!inFlight && state"
            :state="state"
            :busy="busy"
            :preview-ship-id="previewShipId"
            :history="history"
            :leaderboard="leaderboard"
            @preview="previewShip"
            @launch="launch"
            @equip="equipShip"
            @buy-ship="buyShip"
            @refit-ship="refitShip"
            @refit-preview="previewRefit"
            @set-fit="setFit"
            @craft="craftItem"
            @upgrade-item="upgradeItem"
            @salvage="salvageItem"
            @socket="socketMod"
            @buy-supply="buySupply"
            @claim-contract="claimContract"
            @buy-perk="buyPerk"
            @upgrade="buyUpgrade"
            @sell="sell"
            @unlock-skill="unlockSkill"
            @equip-skill="equipSkill"
            @skill-nodes="setSkillNodes"
            @buy-trade="buyTrade"
            @tab="onTab"
            :muted="muted"
            :fullscreen="fullscreen"
            :spin="hangarSpin"
            :can-fullscreen="canFullscreen"
            :highlight-item-id="lastCraftId"
            @sound="(s: VoidSfx) => audio.play(s)"
            @toggle-mute="muted = !muted"
            @toggle-fullscreen="toggleFullscreen"
            @toggle-spin="hangarSpin = !hangarSpin"
        />
        <div v-else-if="!inFlight && !state" class="vr-loading">
            <div class="vr-logo">VOID<span>RUNNER</span></div>
            <div class="vr-loading-bar"><div /></div>
        </div>

        <!-- ═══ Flight HUD ═══ -->
        <template v-if="inFlight && hud">
            <VoidHud :hud="hud" :run="run" :toasts="toasts" :banner="banner" :price-mult="state?.trade.mult ?? 1" />

            <!-- Engage overlay -->
            <div v-if="!hud.locked && !hud.paused && hud.phase === 'flying' && !summary" class="vx-screen vx-engage" @click="engage">
                <div class="vx-engage-body">
                    <div class="vx-engage-ring"><UIcon name="i-lucide-mouse-pointer-click" /></div>
                    <div class="vx-engage-title">Take the helm</div>
                    <div class="vx-keys">
                        <div v-for="c in coreControls" :key="c[0]"><kbd>{{ c[0] }}</kbd><span>{{ c[1] }}</span></div>
                    </div>
                    <div class="vx-engage-more">Esc · all controls</div>
                </div>
            </div>

            <!-- Pause -->
            <div v-if="hud.paused && !summary && !gateChoice && !tradeOpen" class="vx-screen">
                <div class="vx-panel vx-pause">
                    <div class="vx-pause-side">
                        <div class="vx-kicker">{{ run?.sectorName }}</div>
                        <div class="vx-title">Paused</div>
                        <div class="vx-pause-run"><b>{{ run?.shipName }}</b>{{ clock(hud.elapsed) }} · {{ hud.kills }} kills · {{ hud.cargoUnits }} in hold</div>
                        <button class="vr-btn vr-btn-primary" @click="engage"><UIcon name="i-lucide-play" />Resume</button>
                        <button class="vr-btn vr-btn-danger" @click="confirmAbandon"><UIcon name="i-lucide-log-out" />{{ abandonArmed ? 'Confirm · lose the hold' : 'Abandon run' }}</button>
                    </div>
                    <div class="vx-pause-main">
                        <div>
                            <div class="vx-section-title">Settings</div>
                            <div class="vx-settings">
                                <label>Volume <input v-model.number="volume" type="range" min="0" max="1" step="0.05"></label>
                                <label>Mouse sensitivity <input v-model.number="sensitivity" type="range" min="0.3" max="2.5" step="0.05"></label>
                                <label>Invert mouse Y <input v-model="invertY" type="checkbox"></label>
                                <label title="Overall picture brightness">Brightness <input v-model.number="brightness" type="range" min="0.6" max="1.4" step="0.05"></label>
                                <label title="How far bright lights and explosions glow. Big monitors often look best lower">Glow <input v-model.number="glow" type="range" min="0" max="1.5" step="0.05"></label>
                                <label title="Auto renders standard-density monitors at Retina-like sharpness, so small lights keep their colour and thin beams stay solid">Anti-aliasing <select v-model="antialias"><option value="auto">Auto</option><option value="high">High</option><option value="off">Off</option></select></label>
                                <label title="Softer glow, dimmer explosions and faint screen flashes">Reduce flashes <input v-model="reduceFlashes" type="checkbox"></label>
                                <label v-if="canFullscreen">Fullscreen <input :checked="fullscreen" type="checkbox" @change="onFullscreenCheckbox"></label>
                            </div>
                        </div>
                        <div>
                            <div class="vx-section-title">Controls</div>
                            <div class="vx-controls">
                                <div v-for="c in controls" :key="c[0]"><kbd>{{ c[0] }}</kbd><span>{{ c[1] }}</span></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </template>

        <Transition name="vr-fade">
            <div v-if="launching" class="vr-launch-fade" />
        </Transition>

        <!-- ═══ Jump gate ═══ -->
        <div v-if="gateChoice && inFlight" class="vx-screen">
            <div class="vx-panel" style="--vx-tone: #c07bff">
                <div class="vx-kicker">Jump gate<span class="vx-fuel"><i v-for="n in hud?.systems?.fuel ?? 0" :key="n" /></span></div>
                <div class="vx-title">Jump {{ gateJump.depth }}</div>
                <div class="vx-zc vx-gate-odds">
                    <div class="vx-zc-chips">
                        <i class="vx-zc-up"><UIcon name="i-lucide-chevron-up" />+{{ gateJump.loot }}% loot</i>
                        <i class="vx-zc-down"><UIcon name="i-lucide-chevron-down" />+{{ gateJump.threat }}% threat</i>
                    </div>
                </div>
                <div class="vx-choices">
                    <button v-for="z in gateChoice" :key="z.id" class="vx-choice" :style="{ '--zc': voidHex(z.color) }" @click="chooseJump(z.id)">
                        <UIcon :name="z.icon" />
                        <b>{{ z.name }}</b>
                        <VoidZoneChips :zone="z.id" :depth="gateJump.depth" />
                    </button>
                </div>
                <div class="vx-row"><button class="vr-btn" @click="stayHere">Stay in this zone</button></div>
            </div>
        </div>

        <!-- ═══ Free Trader ═══ -->
        <div v-if="tradeOpen && inFlight" class="vx-screen">
            <div class="vx-panel" style="--vx-tone: #9fffd9">
                <div class="vx-kicker">Free Trader</div>
                <div class="vx-title">Trade</div>
                <p class="vx-sub">{{ tradeableUnits }} units to trade, largest stacks first. Warp cores never trade.</p>
                <div class="vx-choices">
                    <button v-for="o in tradeOffers" :key="o.id" class="vx-choice" style="--zc: #9fffd9" :disabled="tradeableUnits < o.cost" @click="trade(o.id)">
                        <UIcon :name="o.icon" />
                        <b>{{ o.name }}</b>
                        <em>{{ o.cost }} units</em>
                    </button>
                </div>
                <div class="vx-row"><button class="vr-btn vr-btn-primary" @click="closeTrade">Done</button></div>
            </div>
        </div>

        <!-- ═══ Craft reveal ═══ -->
        <Transition name="vr-reveal">
            <div v-if="reveal" class="vr-modal-wrap" @click="closeReveal()">
                <div class="vr-reveal" :style="{ '--rc': reveal.rarityColor }" @click.stop>
                    <div class="vr-reveal-rays" />
                    <div class="vr-reveal-kicker">{{ reveal.title }}</div>
                    <VoidItemArt v-if="reveal.type" :type="reveal.type" :tier="reveal.tier" :rarity-color="reveal.rarityColor" size="lg" class="vr-reveal-art" />
                    <div class="vr-reveal-rarity">{{ reveal.rarityName }}</div>
                    <div class="vr-reveal-name">T{{ reveal.tier }} {{ reveal.name }}</div>
                    <div class="vr-reveal-stats">
                        <span v-for="st in reveal.stats" :key="st.label">{{ st.label }} <b>{{ st.value }}</b></span>
                    </div>
                    <div v-if="reveal.affixList.length" class="vr-reveal-affixes">
                        <span v-for="a in reveal.affixList" :key="a.id">{{ a.text }} {{ a.name }}</span>
                    </div>
                    <button class="vr-btn vr-btn-primary" @click="closeReveal()">Nice</button>
                </div>
            </div>
        </Transition>

        <!-- ═══ Debrief ═══ -->
        <VoidDebrief v-if="summary" :summary="summary" :xp-before="state?.pilot.xp ?? 0" @close="closeSummary" @retry="retryReport" />
    </div>
</template>

<script setup lang="ts">
import type { InternalApi } from 'nitropack/types'
import {
    VOID_RESOURCE_IDS, voidBundleUnits, voidBundleValue, voidHex, voidResource, voidSector, voidShip,
    type VoidResourceBundle, type VoidTurretId, type VoidUpgradeId
} from '#shared/utils/gamelogic/void'
import { VOID_RARITIES, voidItemType, voidMod } from '#shared/utils/gamelogic/void-items'
import { VOID_LORE, voidDepthLoot, voidDepthThreat, voidZone, type VoidZoneDefinition, type VoidZoneModifier } from '#shared/utils/gamelogic/void-pilot'
import { VoidAudio, type VoidSfx } from '~/utils/void/audio'
import { VoidEngine, type VoidAntialias } from '~/utils/void/engine'
import type { HudState, RunResult } from '~/utils/void/types'
import VoidDebrief, { type VoidRunSummary } from './VoidDebrief.vue'
import VoidHangar from './VoidHangar.vue'
import VoidHud from './VoidHud.vue'
import VoidItemArt from './VoidItemArt.vue'

export type VoidStatePayload = InternalApi['/api/void/state']['get']

const root = ref<HTMLDivElement | null>(null)
const viewport = ref<HTMLDivElement | null>(null)
const toast = useToast()
const { fetchSession } = useAuth()

const state = shallowRef<VoidStatePayload | null>(null)
const history = shallowRef<InternalApi['/api/void/history']['get']>([])
const leaderboard = shallowRef<InternalApi['/api/void/leaderboard']['get']>([])
const busy = ref(false)
const launching = ref(false)
const previewShipId = ref<string | null>(null)
const hud = shallowRef<HudState | null>(null)
const inFlight = ref(false)
const run = ref<{ sectorName: string, shipName: string, tier: number, startedAt: string } | null>(null)
const toasts = ref<{ id: number, text: string, tone: string }[]>([])
const banner = ref<{ id: number, title: string, subtitle: string, tone: string, zone?: { id: VoidZoneModifier, depth: number } } | null>(null)
let bannerTimer: ReturnType<typeof setTimeout> | undefined
const summary = ref<VoidRunSummary | null>(null)

const audio = new VoidAudio()
let engine: VoidEngine | null = null
let toastId = 1

const volume = ref(0.7)
const sensitivity = ref(1)
const invertY = ref(false)
const muted = ref(false)
const reduceFlashes = ref(false)
const brightness = ref(1)
const glow = ref(1)
const antialias = ref<VoidAntialias>('auto')
const hangarSpin = ref(true)

const reveal = ref<null | { title: string, name: string, type?: string, tier: number, rarityName: string, rarityColor: string, stats: { label: string, value: string }[], affixList: { id: string, name: string, text: string }[] }>(null)

const gateChoice = ref<VoidZoneDefinition[] | null>(null)
/** The jump on offer: its number, and what it adds over the home zone. */
const gateJump = computed(() => {
    const depth = (hud.value?.systems?.depth ?? 1) + 1
    return { depth, loot: Math.round((voidDepthLoot(depth) - 1) * 100), threat: Math.round((voidDepthThreat(depth) - 1) * 100) }
})
const tradeOpen = ref(false)
const tradeableUnits = computed(() => (hud.value?.cargoUnits ?? 0) - (hud.value?.cargo.core ?? 0))
const tradeOffers = [
    { id: 'nanites' as const, name: 'Repair Nanites', cost: 150, icon: 'i-lucide-wrench' },
    { id: 'cell' as const, name: 'Shield Cell', cost: 120, icon: 'i-lucide-battery-charging' },
    { id: 'fuel' as const, name: 'Fuel Cell', cost: 250, icon: 'i-lucide-fuel' }
]

function chooseJump(id: VoidZoneModifier) {
    gateChoice.value = null
    if (!engine?.gateOptions) return
    engine.startJump(id)
    engage()
}

function stayHere() {
    gateChoice.value = null
    engine?.cancelGate()
    engage()
}

function trade(offer: 'nanites' | 'cell' | 'fuel') {
    engine?.trade(offer)
    if (engine) hud.value = { ...hud.value!, cargoUnits: voidBundleUnits(engine.cargo), cargo: { ...engine.cargo } }
}

function closeTrade() {
    tradeOpen.value = false
    if (engine) engine.modalOpen = false
    engage()
}

/** The five that get a pilot moving; Esc has the rest. */
const coreControls: [string, string][] = [
    ['Mouse', 'Steer'],
    ['W', 'Thrust'],
    ['LMB', 'Fire'],
    ['Q', 'Pilot skill'],
    ['F (hold)', 'Dock and bank your hold']
]

const controls: [string, string][] = [
    ['Mouse', 'Steer'],
    ['W / S', 'Thrust / brake'],
    ['A / D', 'Strafe'],
    ['Space / C', 'Rise / sink'],
    ['Z / X', 'Roll'],
    ['Shift', 'Boost'],
    ['LMB', 'Primary gun'],
    ['Q / RMB', 'Pilot skill'],
    ['R', 'Ship ability'],
    ['E (hold)', 'Lock on, release to fire missiles'],
    ['G', 'Device: your gadget, e.g. shield boost'],
    ['T', 'Scan for hidden caches and logs'],
    ['V', 'Cockpit view'],
    ['Wheel / MMB', 'Zoom out / reset camera'],
    ['1 / 2 / 3', 'Supplies'],
    ['F (hold)', 'Dock · F near a trader to trade'],
    ['Tab / M', 'Sector map'],
    ['F11', 'Fullscreen'],
    ['Esc', 'Pause']
]

const fullscreen = ref(false)
const canFullscreen = ref(false)

/** Fullscreens the game itself, not the whole page, so the HUD and menus come along. */
async function toggleFullscreen() {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen()
        } else if (root.value) {
            // Entering fullscreen drops pointer lock in some browsers, which
            // pauses the run; resume and take the helm back if we were flying.
            const relock = !!document.pointerLockElement
            await root.value.requestFullscreen({ navigationUI: 'hide' })
            if (relock && !document.pointerLockElement) engage()
        }
    } catch {
        toast.add({ title: 'Fullscreen is not available here', color: 'warning' })
    } finally {
        fullscreen.value = document.fullscreenElement === root.value
    }
}

function onFullscreenCheckbox(e: Event) {
    // Keep the box in step with the real state, even when the request fails.
    ;(e.target as HTMLInputElement).checked = fullscreen.value
    void toggleFullscreen()
}

function onFullscreenChange() {
    fullscreen.value = document.fullscreenElement === root.value
}

function onFullscreenKey(e: KeyboardEvent) {
    if (e.code !== 'F11' || e.repeat || !canFullscreen.value) return
    e.preventDefault()
    void toggleFullscreen()
}

function loadPrefs() {
    try {
        const raw = localStorage.getItem('void-runner-prefs')
        if (!raw) return
        const prefs = JSON.parse(raw) as { volume?: number, sensitivity?: number, invertY?: boolean, reduceFlashes?: boolean, brightness?: number, glow?: number, antialias?: string, hangarSpin?: boolean, muted?: boolean }
        if (typeof prefs.volume === 'number') volume.value = prefs.volume
        if (typeof prefs.sensitivity === 'number') sensitivity.value = prefs.sensitivity
        if (typeof prefs.invertY === 'boolean') invertY.value = prefs.invertY
        if (typeof prefs.reduceFlashes === 'boolean') reduceFlashes.value = prefs.reduceFlashes
        if (typeof prefs.brightness === 'number') brightness.value = prefs.brightness
        if (typeof prefs.glow === 'number') glow.value = prefs.glow
        if (prefs.antialias === 'auto' || prefs.antialias === 'high' || prefs.antialias === 'off') antialias.value = prefs.antialias
        if (typeof prefs.hangarSpin === 'boolean') hangarSpin.value = prefs.hangarSpin
        if (typeof prefs.muted === 'boolean') muted.value = prefs.muted
    } catch {
        // storage unavailable
    }
}

const GUIDE_KEY = 'void-runner-guide'

/** Pilot guide lessons are a local nicety, not progress: they live in the browser. */
function loadGuide(): string[] {
    try {
        const raw = JSON.parse(localStorage.getItem(GUIDE_KEY) ?? '[]') as unknown
        return Array.isArray(raw) ? raw.map(String) : []
    } catch {
        return []
    }
}

function saveGuide(lesson: string) {
    try {
        const learned = new Set(loadGuide())
        learned.add(lesson)
        localStorage.setItem(GUIDE_KEY, JSON.stringify([...learned]))
    } catch {
        // storage unavailable
    }
}

const REPORT_KEY = 'void-runner-report'
const FLYING_KEY = 'void-runner-flying'
let flyingTimer = 0

/** A heartbeat other tabs can see, so opening the game twice never closes the run being flown. */
function markFlying(on: boolean) {
    clearInterval(flyingTimer)
    const beat = () => {
        try {
            localStorage.setItem(FLYING_KEY, String(Date.now()))
        } catch {
            // storage unavailable
        }
    }
    try {
        if (on) {
            beat()
            flyingTimer = window.setInterval(beat, 4000)
        } else {
            localStorage.removeItem(FLYING_KEY)
        }
    } catch {
        // storage unavailable
    }
}

function anotherTabFlying() {
    if (inFlight.value) return false
    try {
        return Date.now() - Number(localStorage.getItem(FLYING_KEY) ?? 0) < 15_000
    } catch {
        return false
    }
}

type FinishReason = 'extracted' | 'destroyed' | 'abandoned'
type FinishBody = Record<string, unknown> & { reason: FinishReason }
type FinishResponse = InternalApi['/api/void/finish']['post']

/**
 * A run report the server has not confirmed yet. It is kept until the server
 * takes it, so a dropped request or a deploy mid-run never costs the hold.
 */
function loadPendingReport(): { startedAt: string, body: FinishBody } | null {
    try {
        const raw = JSON.parse(localStorage.getItem(REPORT_KEY) ?? 'null') as { startedAt?: unknown, body?: FinishBody } | null
        return raw && typeof raw.startedAt === 'string' && raw.body ? { startedAt: raw.startedAt, body: raw.body } : null
    } catch {
        return null
    }
}

function savePendingReport(startedAt: string, body: FinishBody) {
    try {
        localStorage.setItem(REPORT_KEY, JSON.stringify({ startedAt, body }))
    } catch {
        // storage unavailable
    }
}

function clearPendingReport() {
    try {
        localStorage.removeItem(REPORT_KEY)
    } catch {
        // storage unavailable
    }
}

function statusOf(e: unknown) {
    const err = e as { statusCode?: number, status?: number } | null
    return err?.statusCode ?? err?.status ?? 0
}

/** A 4xx is the server's answer about this run; anything else is worth another try. */
function isFinal(e: unknown) {
    const status = statusOf(e)
    return status >= 400 && status < 500
}

/**
 * Files a run report, retrying network and server errors. The server banks a
 * run exactly once, so a retry can never pay twice. Returns null when an
 * earlier attempt landed but its response was lost.
 */
async function fileReport(body: FinishBody): Promise<FinishResponse | null> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await apiFetch<FinishResponse>('/api/void/finish', { method: 'POST', body })
        } catch (e) {
            if (attempt > 0 && statusOf(e) === 400) return null
            if (isFinal(e) || attempt >= 3) throw e
            await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
        }
    }
}

/**
 * Files the report of a run the server still has open. Throws when it cannot,
 * so the caller never clears that run (and its hold) by accident.
 */
async function flushPendingReport() {
    const pending = loadPendingReport()
    if (!pending) return
    // A report for some other run must never settle the one that is open now.
    const active = state.value?.activeRun
    if (active && String(active.startedAt) !== pending.startedAt) {
        clearPendingReport()
        return
    }
    try {
        await fileReport(pending.body)
    } catch (e) {
        if (!isFinal(e)) throw e
    }
    clearPendingReport()
    await refresh()
}

watch([volume, sensitivity, invertY, reduceFlashes, brightness, glow, antialias, hangarSpin, muted], () => {
    audio.volume = volume.value
    audio.setMuted(muted.value)
    if (engine) {
        engine.sensitivity = sensitivity.value
        engine.invertY = invertY.value
        engine.setReduceFlashes(reduceFlashes.value)
        engine.setBrightness(brightness.value)
        engine.setGlow(glow.value)
        engine.setAntialias(antialias.value)
        engine.hangarSpin = hangarSpin.value
    }
    try {
        localStorage.setItem('void-runner-prefs', JSON.stringify({ volume: volume.value, sensitivity: sensitivity.value, invertY: invertY.value, reduceFlashes: reduceFlashes.value, brightness: brightness.value, glow: glow.value, antialias: antialias.value, hangarSpin: hangarSpin.value, muted: muted.value }))
    } catch {
        // storage unavailable
    }
})


function bundleItems(bundle: VoidResourceBundle) {
    return VOID_RESOURCE_IDS
        .filter(id => (bundle[id] ?? 0) > 0)
        .map(id => ({ id, name: voidResource(id).name, hex: voidHex(voidResource(id).color), amount: bundle[id]! }))
}

function clock(seconds: number) {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function pushToast(text: string, tone: string) {
    const id = toastId++
    toasts.value = [...toasts.value.slice(-3), { id, text, tone }]
    setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id)
    }, 3600)
}

function fail(e: unknown, fallback: string) {
    audio.play('uiError')
    toast.add({ title: apiErrorMessage(e, fallback), color: 'error' })
}

async function refresh() {
    try {
        state.value = await apiFetch<VoidStatePayload>('/api/void/state')
    } catch (e) {
        fail(e, 'Could not reach the hangar')
    }
}

async function loadRecords() {
    try {
        const [h, l] = await Promise.all([
            apiFetch<InternalApi['/api/void/history']['get']>('/api/void/history'),
            apiFetch<InternalApi['/api/void/leaderboard']['get']>('/api/void/leaderboard')
        ])
        history.value = h
        leaderboard.value = l
    } catch {
        // records are optional
    }
}

function currentShowroom() {
    const s = state.value
    if (!s || !engine) return
    const shipId = previewShipId.value ?? s.equippedShipId
    const ship = s.ships.find(x => x.id === shipId) ?? s.ships[0]!
    const tier = Math.min(5, s.highestSectorCleared + 1)
    const shipTier = refitPreview.value && ship.owned && ship.refit ? ship.refit.tier : ship.tier
    engine.showHangar(ship.id, ship.turretTypes as (VoidTurretId | null)[], ship.stats.drones, tier, lastPaletteTier === tier ? undefined : voidSector(tier).palette, shipTier)
    lastPaletteTier = tier
}
let lastPaletteTier = -1
const refitPreview = ref(false)
function previewRefit(on: boolean) {
    if (refitPreview.value === on) return
    refitPreview.value = on
    currentShowroom()
}

function previewShip(shipId: string | null) {
    previewShipId.value = shipId
    currentShowroom()
}

function onTab(tab: string) {
    if (tab === 'records') void loadRecords()
}

async function act(fn: () => Promise<unknown>, fallback: string, sfx: VoidSfx = 'uiConfirm') {
    if (busy.value) return
    busy.value = true
    // The press answers immediately; the result cue follows when the server does.
    audio.play('ui')
    try {
        await fn()
        audio.play(sfx)
        await refresh()
        currentShowroom()
    } catch (e) {
        fail(e, fallback)
    } finally {
        busy.value = false
    }
}

const equipShip = (shipId: string) => act(() => apiFetch('/api/void/ships/equip', { method: 'POST', body: { shipId } }), 'Could not switch ships').then(() => previewShip(null))
const buyShip = (shipId: string) => act(() => apiFetch('/api/void/ships/buy', { method: 'POST', body: { shipId } }), 'Could not build that ship', 'levelUp').then(async () => {
    await fetchSession()
    previewShip(null)
})
const refitShip = (shipId: string) => act(() => apiFetch('/api/void/ships/refit', { method: 'POST', body: { shipId } }), 'Could not refit that hull', 'levelUp').then(() => fetchSession())
const setFit = (shipId: string, fit: unknown) => act(() => apiFetch('/api/void/ships/loadout', { method: 'POST', body: { shipId, fit } }), 'Could not refit', 'ui')
const lastCraftId = ref<string | null>(null)
let craftHighlightTimer: ReturnType<typeof setTimeout> | undefined

/** The fresh item stays highlighted in the workshop for a moment, then goes back to normal. */
function closeReveal() {
    reveal.value = null
    clearTimeout(craftHighlightTimer)
    craftHighlightTimer = setTimeout(() => {
        lastCraftId.value = null
    }, 4000)
}
const craftItem = (kind: string, type: string, tier: number) => {
    lastCraftId.value = null
    return act(async () => {
    const res = await apiFetch<InternalApi['/api/void/items/craft']['post']>('/api/void/items/craft', { method: 'POST', body: { kind, type, tier } })
    lastCraftId.value = res.item.id
    await fetchSession()
}, 'Could not craft that', 'ui').then(() => {
    // The refreshed state holds the new item with its display info.
    const item = state.value?.items.find(i => i.id === lastCraftId.value)
    if (!item) return
    reveal.value = { title: 'Crafted', name: item.name, type: item.type, tier: item.tier, rarityName: item.rarityName, rarityColor: item.rarityColor, stats: item.stats, affixList: item.affixList }
    audio.play(item.rarity >= 4 ? 'rareDrop' : item.rarity >= 3 ? 'bounty' : item.rarity >= 1 ? 'levelUp' : 'uiConfirm', { pitch: 1 + item.rarity * 0.06 })
    })
}
const upgradeItem = (itemId: string) => act(() => apiFetch('/api/void/items/upgrade', { method: 'POST', body: { itemId } }).then(() => fetchSession()), 'Could not upgrade that', 'levelUp')
const salvageItem = (itemId: string) => act(() => apiFetch('/api/void/items/salvage', { method: 'POST', body: { itemId } }), 'Could not salvage that', 'pickup')
const socketMod = (itemId: string, modId: string) => act(() => apiFetch('/api/void/items/socket', { method: 'POST', body: { itemId, modId } }), 'Could not socket that mod', 'levelUp')
const buySupply = (supplyId: string, count: number) => act(() => apiFetch('/api/void/supplies/buy', { method: 'POST', body: { supplyId, count } }).then(() => fetchSession()), 'Could not buy supplies', 'pickup')
const buyPerk = (perkId: string) => act(() => apiFetch('/api/void/perks/buy', { method: 'POST', body: { perkId } }), 'Could not buy that perk', 'levelUp')
const claimContract = (index: number) => act(() => apiFetch('/api/void/contracts/claim', { method: 'POST', body: { index } }).then(() => fetchSession()), 'Could not deliver that contract', 'levelUp')
const buyUpgrade = (upgrade: VoidUpgradeId) => act(() => apiFetch('/api/void/upgrade', { method: 'POST', body: { upgrade } }), 'Could not upgrade', 'levelUp')
const unlockSkill = (skillId: string) => act(() => apiFetch('/api/void/skills/unlock', { method: 'POST', body: { skillId } }), 'Could not unlock that skill', 'levelUp').then(() => fetchSession())
const equipSkill = (skillId: string) => act(() => apiFetch('/api/void/skills/equip', { method: 'POST', body: { skillId } }), 'Could not equip that skill', 'ui')
const setSkillNodes = (skillId: string, nodes: string[]) => act(() => apiFetch('/api/void/skills/nodes', { method: 'POST', body: { skillId, nodes } }), 'Could not update the skill tree', 'ui')
const buyTrade = () => act(() => apiFetch('/api/void/trade', { method: 'POST' }), 'Could not sign the contract', 'levelUp').then(() => fetchSession())
const sell = (resource: string, amount: number | 'all') => act(async () => {
    await apiFetch('/api/void/market/sell', { method: 'POST', body: { resource, amount } })
    await fetchSession()
}, 'Could not sell', 'pickup')

async function launch(tier: number) {
    const s = state.value
    if (!s || busy.value || !engine) return
    audio.unlock()
    // Take the pointer inside the click so the run starts at the helm, not behind an overlay.
    engine.requestLock()
    launching.value = true
    busy.value = true
    try {
        // An unfiled report from the last run goes in first; forcing a launch would throw its hold away.
        await flushPendingReport()
        let res: InternalApi['/api/void/launch']['post']
        try {
            res = await apiFetch<InternalApi['/api/void/launch']['post']>('/api/void/launch', { method: 'POST', body: { sector: tier } })
        } catch (e) {
            // A run left open by a closed tab: clear it (it banks nothing) and go.
            if (statusOf(e) === 409) {
                if (anotherTabFlying()) throw { data: { statusMessage: 'A run is already flying in another tab' } }
                res = await apiFetch<InternalApi['/api/void/launch']['post']>('/api/void/launch', { method: 'POST', body: { sector: tier, force: true } })
            } else {
                throw e
            }
        }
        previewShipId.value = null
        gateChoice.value = null
        tradeOpen.value = false
        run.value = { sectorName: res.sector.name, shipName: voidShip(res.loadout.shipId).name, tier, startedAt: String(res.startedAt) }
        inFlight.value = true
        markFlying(true)
        engine.startRun({
            tutorial: s.extractions === 0 && tier === 1,
            sector: voidSector(tier),
            shipId: res.loadout.shipId,
            shipTier: res.loadout.shipTier,
            stats: res.stats,
            turrets: res.loadout.turrets,
            levels: res.loadout.levels,
            gun: res.loadout.gun,
            skill: res.loadout.skill,
            supplies: res.supplies,
            secondary: res.loadout.secondary,
            device: res.loadout.device,
            perks: res.loadout.perks,
            beacons: res.beacons,
            loreKnown: s.lore.filter(l => l.found).map(l => l.id),
            // The pilot guide runs until sector 1 is cleared.
            guideLearned: s.highestSectorCleared < 1 ? loadGuide() : null
        })
    } catch (e) {
        if (document.pointerLockElement) document.exitPointerLock()
        fail(e, 'Launch failed')
    } finally {
        busy.value = false
        setTimeout(() => {
            launching.value = false
        }, 250)
    }
}

function engage() {
    audio.unlock()
    engine?.setPaused(false)
    engine?.requestLock()
}

function onViewportClick() {
    if (inFlight.value && hud.value && !hud.value.locked && !hud.value.paused) engage()
}

async function finishRun(result: RunResult, reason: FinishReason) {
    gateChoice.value = null
    tradeOpen.value = false
    const items = bundleItems(result.haul)
    summary.value = {
        extracted: reason === 'extracted',
        pending: true,
        failed: false,
        kills: result.kills,
        elapsedMs: result.elapsedMs,
        units: items.reduce((s, i) => s + i.amount, 0),
        value: Math.round(voidBundleValue(result.haul) * (state.value?.trade.mult ?? 1)),
        sectorCleared: null,
        sectorOpened: null,
        wardenRejected: false,
        beacons: null,
        xp: 0,
        levelBefore: 0,
        levelAfter: 0,
        relics: [],
        marks: 0,
        blueprint: null,
        lore: [],
        depth: result.depth,
        gear: [],
        gearEmpty: 0,
        gearLost: reason === 'extracted' ? 0 : (engine?.gearCaches ?? 0),
        lostValue: reason === 'extracted' ? 0 : Math.round(voidBundleValue(result.lost ?? {}) * (state.value?.trade.mult ?? 1)),
        items: reason === 'extracted' ? items : bundleItems({})
    }
    if (document.pointerLockElement) document.exitPointerLock()
    const body: FinishBody = { reason, haul: result.haul, kills: result.kills, wardenKilled: result.wardenKilled, elapsedMs: result.elapsedMs, skillUses: result.skillUses, suppliesUsed: result.suppliesUsed, relics: result.relics, gearCaches: result.gearCaches, bonusXp: result.bonusXp, depth: result.depth, carrierKilled: result.carrierKilled, tyrantKilled: result.tyrantKilled, harbingerKilled: result.harbingerKilled, telemetry: result.telemetry, lore: result.lore, beaconsCaptured: result.beaconsCaptured, beaconsDefended: result.beaconsDefended }
    if (run.value) savePendingReport(run.value.startedAt, body)
    await submitReport(body)
}

async function retryReport() {
    const pending = loadPendingReport()
    if (!pending || !summary.value) return
    summary.value = { ...summary.value, pending: true, failed: false }
    await submitReport(pending.body)
}

async function submitReport(body: FinishBody) {
    if (!summary.value) return
    try {
        const res = await fileReport(body)
        clearPendingReport()
        if (!res) {
            summary.value = { ...summary.value, pending: false }
            return
        }
        summary.value = {
            ...summary.value,
            pending: false,
            units: res.units,
            value: res.coinValue,
            kills: res.kills,
            xp: res.xp,
            levelBefore: res.levelBefore,
            levelAfter: res.levelAfter,
            relics: res.relics.map(id => ({ name: voidMod(id)?.name ?? id, hex: voidHex(voidMod(id)?.color ?? 0xffffff) })),
            marks: res.marks,
            blueprint: res.blueprint ? (voidItemType(res.blueprint)?.name ?? res.blueprint) : null,
            lore: res.lore.map(id => VOID_LORE.find(l => l.id === id)?.title ?? id),
            depth: res.depth,
            gear: res.gear.map(g => ({ name: g.name, tier: g.tier, color: VOID_RARITIES[g.rarity]?.color ?? '#fff', rarity: VOID_RARITIES[g.rarity]?.name ?? 'Common' })),
            gearEmpty: res.gearEmpty,
            sectorCleared: res.sectorCleared,
            sectorOpened: res.sectorOpened,
            wardenRejected: res.wardenRejected,
            beacons: [res.beaconsCaptured ? `${res.beaconsCaptured} beacon${res.beaconsCaptured > 1 ? 's' : ''} captured` : '', res.beaconsDefended ? 'Beacon defended' : ''].filter(Boolean).join(' · ') || null,
            items: bundleItems(res.haul)
        }
        if (res.sectorCleared || res.levelAfter > res.levelBefore) audio.play('levelUp')
    } catch (e) {
        if (isFinal(e)) clearPendingReport()
        summary.value = { ...summary.value!, pending: false, failed: !isFinal(e) }
        fail(e, 'Could not file the run report')
    }
}

const abandonArmed = ref(false)
let abandonTimer: ReturnType<typeof setTimeout> | undefined

/** Abandoning throws the hold away, so the button has to be pressed twice. */
function confirmAbandon() {
    clearTimeout(abandonTimer)
    if (abandonArmed.value) {
        abandonArmed.value = false
        abandon()
        return
    }
    abandonArmed.value = true
    abandonTimer = setTimeout(() => {
        abandonArmed.value = false
    }, 3000)
}

function abandon() {
    if (!engine) return
    const result: RunResult = { reason: 'destroyed', haul: {}, lost: { ...engine.cargo }, kills: engine.kills, wardenKilled: false, elapsedMs: Math.round(engine.elapsed * 1000), skillUses: engine.skills?.uses ?? 0, suppliesUsed: { ...engine.suppliesUsed }, relics: 0, gearCaches: 0, bonusXp: engine.pilotBonusXp, depth: engine.depth, carrierKilled: false, tyrantKilled: false, harbingerKilled: false, telemetry: engine.telemetry.report(), lore: [], beaconsCaptured: [...(engine.beacons?.captured ?? [])], beaconsDefended: [...(engine.beacons?.defended ?? [])] }
    engine.paused = true
    void finishRun(result, 'abandoned')
}

async function closeSummary() {
    summary.value = null
    markFlying(false)
    inFlight.value = false
    hud.value = null
    run.value = null
    engine?.returnToHangar()
    await refresh()
    lastPaletteTier = -1
    currentShowroom()
}

onMounted(async () => {
    // Registered before any await, so leaving the page early still unbinds it.
    window.addEventListener('beforeunload', warnBeforeLeaving)
    window.addEventListener('pagehide', stopFlying)
    // Inside the page's suspense boundary the template ref can bind a tick
    // after mounted fires, so wait a few frames for it before giving up.
    for (let i = 0; i < 10 && !viewport.value; i++) {
        await nextTick()
        await new Promise(resolve => requestAnimationFrame(resolve))
    }
    if (!viewport.value || engine) return
    canFullscreen.value = !!document.fullscreenEnabled
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('keydown', onFullscreenKey)
    loadPrefs()
    audio.volume = volume.value
    audio.setMuted(muted.value)
    engine = new VoidEngine(viewport.value, audio, {
        hud: (h) => {
            hud.value = h
        },
        toast: (text, tone) => pushToast(text, tone),
        banner: (title, subtitle, tone, zone) => {
            banner.value = { id: toastId++, title, subtitle, tone, zone }
            clearTimeout(bannerTimer)
            // An arrival card carries the zone's chips, so it stays up a little longer.
            bannerTimer = setTimeout(() => {
                banner.value = null
            }, zone ? 5200 : 3400)
        },
        end: (result) => {
            void finishRun(result, result.reason)
        },
        pause: () => {
            if (engine?.player) hud.value = { ...hud.value!, paused: engine.paused }
        },
        gate: (options) => {
            gateChoice.value = options.map(id => voidZone(id))
        },
        guide: (lesson) => {
            saveGuide(lesson)
        },
        trade: () => {
            tradeOpen.value = true
            if (engine) engine.modalOpen = true
            engine?.setPaused(true)
            if (document.pointerLockElement) document.exitPointerLock()
        }
    })
    engine.sensitivity = sensitivity.value
    engine.invertY = invertY.value
    if (reduceFlashes.value) engine.setReduceFlashes(true)
    engine.setBrightness(brightness.value)
    engine.setGlow(glow.value)
    engine.setAntialias(antialias.value)
    engine.hangarSpin = hangarSpin.value
    await refresh()
    // A report that never reached the server is filed now; a run that never
    // reported at all (closed tab or reload) banks nothing, so clear it and say so.
    if (state.value?.activeRun && loadPendingReport()) {
        try {
            await flushPendingReport()
        } catch {
            toast.add({ title: 'Your last run report is still waiting', description: 'The station could not be reached. It is filed again before your next launch.', color: 'warning' })
        }
    }
    if (state.value?.activeRun && !loadPendingReport() && !anotherTabFlying()) {
        try {
            await apiFetch('/api/void/finish', { method: 'POST', body: { reason: 'abandoned' } })
            await refresh()
            toast.add({ title: 'Your last run was interrupted', description: 'The page closed or reloaded mid-flight, so that hold was lost.', color: 'warning' })
        } catch {
            // the next launch clears it
        }
    }
    currentShowroom()
    window.addEventListener('pointerdown', unlockAudio, { once: true })
})

/** Closing or reloading mid-flight loses the hold, so ask the browser to confirm first. */
function warnBeforeLeaving(e: BeforeUnloadEvent) {
    if (!inFlight.value || summary.value) return
    e.preventDefault()
    e.returnValue = ''
}

/** A reload ends the run for good, so the next load may clear it straight away. */
function stopFlying() {
    if (inFlight.value) markFlying(false)
}

function unlockAudio() {
    audio.unlock()
}

onBeforeUnmount(() => {
    if (inFlight.value) markFlying(false)
    window.removeEventListener('pagehide', stopFlying)
    engine?.dispose()
    engine = null
    audio.dispose()
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('beforeunload', warnBeforeLeaving)
    document.removeEventListener('fullscreenchange', onFullscreenChange)
    window.removeEventListener('keydown', onFullscreenKey)
    if (document.fullscreenElement === root.value) void document.exitFullscreen().catch(() => {})
})
</script>

<style>
@import '~/assets/css/void.css';
@import '~/assets/css/void-hud.css';
</style>
