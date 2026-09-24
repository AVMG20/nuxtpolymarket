// Gold Miner run flow around the Pixi scene. The server owns the run (stake,
// secret, cash, shop) in `gold_miner_state`; this store deals each level onto the
// scene, lets the player dig, then hands the scene's grab report to
// /api/gold-miner/level and shows whatever the server settled.
import type { InjectionKey } from 'vue'
import {
    GM_CASH_PER_STAKE,
    GM_INTRO_MS,
    GM_LEVEL_MS,
    GM_MAX_STAKE,
    GM_MIN_STAKE,
    GM_NO_PERKS,
    gmGenerateLevel,
    gmGoal,
    gmPayout,
    type GmBagOutcome,
    type GmLevelResult,
    type GmRunView,
    type GmShopItem,
    type GmVein
} from '#shared/utils/gamelogic/gold-miner'
import { gmSfx } from '~/utils/gold-miner/audio'
import type { GoldMinerScene, SceneHooks } from '~/utils/gold-miner/scene'

export type GmPhase = 'loading' | 'lobby' | 'intro' | 'playing' | 'submitting' | 'result' | 'shop' | 'cashout'

interface GmStats {
    runsPlayed: number
    bestLevel: number
    bestPayout: number
    totalStaked: number
    totalPaid: number
}

interface GmSnapshot {
    balance: number
    stats: GmStats
    run: GmRunView | null
}

const PREFS_KEY = 'gold-miner.prefs.v1'

function loadPrefs(): { stake?: number, sfx?: boolean, music?: boolean } {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    } catch {
        return {}
    }
}

function createGoldMiner() {
    const { balanceNum: balance, fetchSession } = useAuth()
    const toast = useToast()
    const prefs = loadPrefs()

    const state = reactive({
        ready: false,
        phase: 'loading' as GmPhase,
        stake: Math.min(GM_MAX_STAKE, Math.max(GM_MIN_STAKE, prefs.stake ?? 1000)),
        stats: null as GmStats | null,
        run: null as GmRunView | null,
        /** Cash dug up on the current level, not yet settled by the server. */
        earned: 0,
        clock: GM_LEVEL_MS / 1000,
        dynamite: 0,
        strength: false,
        /** The vein of the level on the board, known once it's dealt. */
        vein: null as GmVein | null,
        result: null as (GmLevelResult & { error?: string }) | null,
        cashout: null as { payout: number, cash: number, level: number } | null,
        busy: false,
        sfx: prefs.sfx ?? true,
        music: prefs.music ?? true,
        showRules: false,
        goalFlash: false
    })

    let scene: GoldMinerScene | null = null
    let introTimer: ReturnType<typeof setTimeout> | null = null
    let submitting = false

    const cash = computed(() => (state.run?.cash ?? 0) + state.earned)
    const goal = computed(() => state.run?.goal ?? gmGoal(1))
    const goalReached = computed(() => !!state.run && state.earned >= goal.value)
    const payoutNow = computed(() => gmPayout(state.run?.stake ?? 0, state.run?.cash ?? 0))

    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify({ stake: state.stake, sfx: state.sfx, music: state.music }))
        } catch {
            // private mode: preferences just don't stick
        }
    }

    function fail(e: unknown, fallback: string) {
        toast.add({ title: apiErrorMessage(e, fallback), color: 'error' })
    }

    // ─── scene wiring ───────────────────────────────────────────────────────

    const sceneHooks: SceneHooks = {
        onEarned(earned) {
            const before = goalReached.value
            state.earned = earned
            if (!before && goalReached.value && state.phase === 'playing') {
                gmSfx.goalReached()
                scene?.say('goal')
                state.goalFlash = true
                setTimeout(() => (state.goalFlash = false), 1600)
            }
        },
        onDynamite(count) {
            state.dynamite = count
        },
        onStrength(on) {
            state.strength = on
        },
        onClock(secondsLeft) {
            state.clock = secondsLeft
        },
        onTimeUp() {
            void submitLevel()
        },
        onBoardEmpty() {
            void submitLevel()
        },
        revealBag(itemId: number) {
            return apiFetch<GmBagOutcome>('/api/gold-miner/bag', { method: 'POST', body: { itemId } })
        }
    }

    function attachScene(s: GoldMinerScene) {
        scene = s
    }

    // ─── flow ───────────────────────────────────────────────────────────────

    async function load() {
        try {
            const snap = await apiFetch<GmSnapshot>('/api/gold-miner/state')
            state.stats = snap.stats
            state.run = snap.run
            if (!snap.run) return toLobby()
            if (snap.run.phase === 'shop') {
                scene?.setAttract()
                state.phase = 'shop'
                return
            }
            dealLevel(snap.run)
        } catch (e) {
            fail(e, 'Could not reach the mine')
            toLobby()
        }
    }

    function toLobby() {
        clearIntro()
        state.run = null
        state.result = null
        state.cashout = null
        state.earned = 0
        state.phase = 'lobby'
        scene?.setAttract()
    }

    function clearIntro() {
        if (introTimer) clearTimeout(introTimer)
        introTimer = null
    }

    /** Puts the run's current level on the board and starts (or resumes) its clock. */
    function dealLevel(run: GmRunView) {
        clearIntro()
        state.run = run
        state.earned = 0
        state.result = null
        state.dynamite = run.dynamite
        state.strength = run.perks.strength
        state.clock = GM_LEVEL_MS / 1000
        submitting = false
        const elapsed = run.levelElapsedMs ?? -GM_INTRO_MS
        const level = gmGenerateLevel(run.levelSeed ?? 0, run.level)
        state.vein = level.vein
        scene?.loadLevel(level, { perks: run.perks, dynamite: run.dynamite })
        if (elapsed >= GM_LEVEL_MS) {
            // Came back after the whistle: report what's on record (nothing) and let the server decide.
            scene?.startPlay(elapsed)
            state.phase = 'playing'
            void submitLevel()
            return
        }
        scene?.startPlay(elapsed)
        if (elapsed < 0) {
            state.phase = 'intro'
            introTimer = setTimeout(() => {
                state.phase = 'playing'
                gmSfx.bell()
            }, -elapsed)
        } else {
            state.phase = 'playing'
        }
    }

    async function start() {
        if (state.busy) return
        gmSfx.unlock()
        savePrefs()
        state.busy = true
        try {
            const { run } = await apiFetch<{ run: GmRunView }>('/api/gold-miner/start', { method: 'POST', body: { stake: state.stake } })
            void fetchSession()
            gmSfx.button()
            dealLevel(run)
        } catch (e) {
            fail(e, 'Could not start a run')
        } finally {
            state.busy = false
        }
    }

    async function submitLevel() {
        if (submitting || (state.phase !== 'playing' && state.phase !== 'intro')) return
        submitting = true
        clearIntro()
        const grabs = scene?.endPlay() ?? []
        state.phase = 'submitting'
        // Give the last pop-ups a beat to land before the verdict.
        await new Promise(r => setTimeout(r, 900))
        try {
            const result = await apiFetch<GmLevelResult>('/api/gold-miner/level', { method: 'POST', body: { grabs } })
            state.result = result
            state.run = result.run
            state.earned = 0
            if (result.cleared) gmSfx.fanfare()
            else gmSfx.fail()
        } catch (e) {
            // The report didn't settle; whatever the server holds is the truth.
            state.result = {
                cleared: false,
                earned: 0,
                cash: cash.value,
                goal: goal.value,
                level: state.run?.level ?? 1,
                run: null,
                error: apiErrorMessage(e, 'The assay office could not settle this level')
            }
            gmSfx.fail()
        }
        state.phase = 'result'
        void refreshStats()
    }

    async function refreshStats() {
        try {
            const snap = await apiFetch<GmSnapshot>('/api/gold-miner/state')
            state.stats = snap.stats
        } catch {
            // stats are decoration
        }
    }

    function continueFromResult() {
        gmSfx.button()
        if (state.result?.cleared && state.run?.phase === 'shop') {
            state.phase = 'shop'
            gmSfx.bell()
            return
        }
        void fetchSession()
        toLobby()
    }

    async function buy(item: GmShopItem) {
        if (state.busy) return
        state.busy = true
        try {
            const { run } = await apiFetch<{ run: GmRunView }>('/api/gold-miner/buy', { method: 'POST', body: { item } })
            state.run = run
            gmSfx.buy()
        } catch (e) {
            fail(e, 'The shopkeeper shook his head')
        } finally {
            state.busy = false
        }
    }

    async function nextLevel() {
        if (state.busy) return
        state.busy = true
        gmSfx.unlock()
        try {
            const { run } = await apiFetch<{ run: GmRunView }>('/api/gold-miner/next', { method: 'POST' })
            gmSfx.button()
            dealLevel(run)
        } catch (e) {
            fail(e, 'Could not go back down')
        } finally {
            state.busy = false
        }
    }

    async function cashOut() {
        if (state.busy) return
        state.busy = true
        try {
            const result = await apiFetch<{ payout: number, cash: number, level: number }>('/api/gold-miner/cashout', { method: 'POST' })
            state.cashout = result
            state.run = null
            state.phase = 'cashout'
            gmSfx.coinShower()
            void fetchSession()
            void refreshStats()
        } catch (e) {
            fail(e, 'Could not cash out')
        } finally {
            state.busy = false
        }
    }

    function fire() {
        gmSfx.unlock()
        if (state.phase === 'playing') scene?.fire()
    }

    function useDynamite() {
        if (state.phase === 'playing') scene?.useDynamite()
    }

    function finishEarly() {
        if (state.phase === 'playing' && goalReached.value) void submitLevel()
    }

    function setSfx(on: boolean) {
        state.sfx = on
        gmSfx.setSfx(on)
        savePrefs()
    }

    function setMusic(on: boolean) {
        state.music = on
        gmSfx.setMusic(on)
        savePrefs()
    }

    function dispose() {
        clearIntro()
        gmSfx.dispose()
        scene = null
    }

    gmSfx.setSfx(state.sfx)
    gmSfx.setMusic(state.music)

    return {
        state,
        balance,
        cash,
        goal,
        goalReached,
        payoutNow,
        sceneHooks,
        attachScene,
        load,
        start,
        buy,
        nextLevel,
        cashOut,
        continueFromResult,
        fire,
        useDynamite,
        finishEarly,
        setSfx,
        setMusic,
        dispose,
        noPerks: GM_NO_PERKS,
        cashPerStake: GM_CASH_PER_STAKE
    }
}

export type GoldMinerStore = ReturnType<typeof createGoldMiner>

const KEY: InjectionKey<GoldMinerStore> = Symbol('gold-miner')

export function provideGoldMiner() {
    const store = createGoldMiner()
    provide(KEY, store)
    return store
}

export function useGoldMiner() {
    const store = inject(KEY)
    if (!store) throw new Error('useGoldMiner() outside <GoldMinerGame>')
    return store
}
