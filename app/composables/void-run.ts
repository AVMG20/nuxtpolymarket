import { VoidGame, type VoidHudCargo, type VoidRunResult } from '~/utils/void-engine'
import { VOID_BOOST_CAPACITY_MS, type VoidResourceBundle } from '#shared/utils/gamelogic/void'

// ─── Shared run state ───────────────────────────────────────────────────────
// The engine instance and every ref it drives live at module scope rather than
// inside a page's setup. Navigating between /void and /void/hangar unmounts the
// page component, and a live run has no business dying because the player
// opened a tab. A page attaches its canvas host and pauses/resumes; it never
// destroys the engine. Only a genuine reload loses this, and the `abandoned`
// path below clears the stale server lock next time /void mounts.

export interface VoidSummary extends VoidRunResult {
    /** What the banked haul is worth at market rates. It is not paid out here. */
    bankedValue: number
    sectorName: string
    bankedHaul: VoidResourceBundle
    sectorUnlocked: number | null
    /** Modules prised out of downed capitals, rolled server-side. */
    moduleDrops: { id: string, name: string, rarityId: string, hex: string, rarityName: string, special: string | null, lines: string[] }[]
}

const hull = ref(0)
const maxHull = ref(0)
const shield = ref(0)
const maxShield = ref(0)
const cargo = ref<VoidHudCargo>({ units: 0, capacity: 0, bundle: {}, value: 0 })
const elapsedMs = ref(0)
const stormPhase = ref(0)
const threat = ref(1)
const miningProgress = ref(0)
const miningLabel = ref<string | null>(null)
const extractProgress = ref(0)
const extractInRange = ref(false)
const boostMs = ref(VOID_BOOST_CAPACITY_MS)
const boostCapacityMs = ref(VOID_BOOST_CAPACITY_MS)

const running = ref(false)
const paused = ref(false)
const launching = ref(false)
const summaryVisible = ref(false)
const summary = ref<VoidSummary | null>(null)

const bossName = ref('')
const bossVisible = ref(false)
let bossTimeout: ReturnType<typeof setTimeout> | null = null

const notices = ref<{ id: number, text: string, kind: 'good' | 'bad' | 'info' }[]>([])
let noticeSeq = 0

let game: VoidGame | null = null
let mountedHost: HTMLDivElement | null = null

// Bound on every useVoidRun() call (component setup, client-only) so engine
// callbacks firing after a page swap still reach live playback.
let voidSound: ReturnType<typeof useVoidSound> | null = null

// Rebound on every usePlayerRun() call so an engine callback firing after a
// page swap always reaches the currently-mounted page's toast and refresh.
let currentToast: ReturnType<typeof useToast> | null = null
let currentRefresh: (() => Promise<unknown>) | null = null
let currentFetchSession: (() => Promise<unknown>) | null = null

function pushNotice(text: string, kind: 'good' | 'bad' | 'info') {
    const id = noticeSeq++
    notices.value = [...notices.value, { id, text, kind }].slice(-3)
    setTimeout(() => { notices.value = notices.value.filter(n => n.id !== id) }, 4200)
}

function showBoss(name: string) {
    bossName.value = name
    bossVisible.value = true
    if (bossTimeout) clearTimeout(bossTimeout)
    bossTimeout = setTimeout(() => { bossVisible.value = false }, 5000)
}

async function handleRunEnd(result: VoidRunResult) {
    running.value = false
    paused.value = false
    try {
        const response = await $fetch('/api/void/finish-run', {
            method: 'POST',
            body: {
                haul: result.haul,
                kills: result.kills,
                bossKills: result.bossesKilled,
                rocksMined: result.rocksMined,
                elapsedMs: result.elapsedMs,
                reason: result.reason
            }
        })
        summary.value = {
            ...result,
            bankedValue: response.haulValue,
            sectorName: response.sectorName,
            bankedHaul: response.haul,
            sectorUnlocked: response.sectorUnlocked,
            moduleDrops: response.moduleDrops
        }
        summaryVisible.value = true
        await Promise.all([currentRefresh?.(), currentFetchSession?.()])
        if (response.sectorUnlocked) {
            currentToast?.add({ title: `Sector ${response.sectorUnlocked} unlocked`, color: 'success', icon: 'i-lucide-unlock' })
        }
        for (const module of response.moduleDrops) {
            currentToast?.add({ title: `${module.rarityName} module recovered — ${module.name}`, color: 'success', icon: 'i-lucide-package-plus' })
        }
    } catch (error: unknown) {
        currentToast?.add({ title: apiErrorMessage(error, 'Failed to settle the run'), color: 'error' })
    }
}

function buildGame() {
    return new VoidGame({
        onHullChange: (h, mh, s, ms) => {
            hull.value = h
            maxHull.value = mh
            shield.value = s
            maxShield.value = ms
        },
        onCargoChange: (value) => { cargo.value = value },
        onTimeChange: (elapsed, phase, currentThreat) => {
            elapsedMs.value = elapsed
            stormPhase.value = phase
            threat.value = currentThreat
        },
        onMiningProgress: (progress, label) => {
            miningProgress.value = progress
            miningLabel.value = label
        },
        onExtractProgress: (progress, inRange) => {
            extractProgress.value = progress
            extractInRange.value = inRange
        },
        onBoostChange: (charge, capacity) => {
            boostMs.value = charge
            boostCapacityMs.value = capacity
        },
        onRunEnd: (result) => { void handleRunEnd(result) },
        onSfx: event => voidSound?.play(event),
        onNotice: pushNotice,
        onBossSpawn: showBoss,
        onStormPhase: (phase) => {
            if (phase === 'engulfed') pushNotice('Sector fully engulfed.', 'bad')
        }
    })
}

export function useVoidRun() {
    currentToast = useToast()
    voidSound = useVoidSound()

    async function attachCanvas(
        host: HTMLDivElement,
        serverThinksRunActive: boolean,
        refresh: () => Promise<unknown>
    ) {
        currentRefresh = refresh
        const { fetchSession } = useAuth()
        currentFetchSession = fetchSession

        // A run marked active server-side with no engine in memory means the
        // tab was closed mid-flight. Clear the lock rather than leaving the
        // player permanently unable to launch.
        if (serverThinksRunActive && !game) {
            try {
                await $fetch('/api/void/finish-run', { method: 'POST', body: { abandoned: true, reason: 'cancelled' } })
                await refresh()
            } catch { /* the lock was already gone */ }
        }

        if (!game) game = buildGame()
        // `mount` is idempotent — on a remount it re-parents the existing
        // canvas rather than building a second renderer and ticker.
        if (mountedHost !== host) {
            await game.mount(host)
            mountedHost = host
        }
        if (running.value) game.resume()
    }

    function detachCanvas() {
        if (game && running.value) game.pause()
    }

    /**
     * The server refuses a launch while it still has a run locked. That lock
     * outlives a tab that was closed mid-flight, so rather than dead-ending the
     * player, clear the stale lock once and try again.
     */
    async function requestLaunch(sector: number) {
        try {
            return await $fetch('/api/void/launch', { method: 'POST', body: { sector } })
        } catch (error: unknown) {
            if (!apiErrorMessage(error, '').includes('already in progress')) throw error
            await $fetch('/api/void/finish-run', { method: 'POST', body: { abandoned: true, reason: 'cancelled' } })
            return await $fetch('/api/void/launch', { method: 'POST', body: { sector } })
        }
    }

    async function launch(sector: number) {
        if (!game || launching.value || running.value) return
        launching.value = true
        // Launching is a user gesture — the one reliable moment to lift the
        // browser autoplay block and warm the sample cache before undock.
        voidSound?.unlock()
        voidSound?.preload()
        try {
            const config = await requestLaunch(sector)

            // Wipe every scrap of the previous run's HUD before the new one can
            // paint, so nothing (an extraction bar sitting at 100%, most of all)
            // can survive into a fresh launch.
            summaryVisible.value = false
            summary.value = null
            notices.value = []
            threat.value = 1
            extractProgress.value = 0
            extractInRange.value = false
            miningProgress.value = 0
            miningLabel.value = null
            elapsedMs.value = 0
            stormPhase.value = 0

            // If the renderer isn't ready the engine will not tick, and flipping
            // `running` anyway would leave a live-looking HUD over a dead game.
            const started = game.start({
                sector: config.sector,
                stats: config.stats,
                shipId: config.shipId,
                turrets: config.turrets,
                power: config.power
            })
            if (!started) {
                await $fetch('/api/void/finish-run', { method: 'POST', body: { abandoned: true, reason: 'cancelled' } })
                currentToast?.add({ title: 'The viewport was not ready — try again', color: 'error' })
                return
            }

            running.value = true
            paused.value = false
            pushNotice(`${config.sectorConfig.name} — undocked.`, 'info')
        } catch (error: unknown) {
            currentToast?.add({ title: apiErrorMessage(error, 'Failed to launch'), color: 'error' })
        } finally {
            launching.value = false
        }
    }

    function pauseRun() {
        if (!game || !running.value) return
        game.pause()
        paused.value = true
    }

    function resumeRun() {
        if (!game || !running.value) return
        game.resume()
        paused.value = false
    }

    function abortRun() {
        if (!game || !running.value) return
        game.resume()
        paused.value = false
        game.cancel()
    }

    function closeSummary() {
        summaryVisible.value = false
    }

    function teardown() {
        if (!game) return
        voidSound?.stop()
        game.destroy()
        game = null
        mountedHost = null
        running.value = false
        paused.value = false
    }

    return {
        hull, maxHull, shield, maxShield, cargo,
        elapsedMs, stormPhase, threat, miningProgress, miningLabel,
        extractProgress, extractInRange, boostMs, boostCapacityMs,
        running, paused, launching, summaryVisible, summary,
        bossName, bossVisible, notices,
        attachCanvas, detachCanvas, launch, pauseRun, resumeRun, abortRun, closeSummary, teardown
    }
}
