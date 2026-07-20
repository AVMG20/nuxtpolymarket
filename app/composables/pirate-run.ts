import { PirateGame, type PirateAbilitySound, type PirateActivePowerUp, type PirateShipStats } from '~/utils/pirates-engine'
import type { PirateAbilityId } from '#shared/utils/gamelogic/pirates'

const pirateSound = usePirateSound()

// ─── Shared pirate-voyage state ────────────────────────────────────────────
// Navigating between /pirates and /pirates/manage unmounts and remounts the
// page component, but a live voyage shouldn't die just because the player
// popped into the armory. So the PirateGame instance and every bit of UI
// state it drives live here, at module scope, outside any single page's
// lifecycle — a page just attaches/detaches its canvas host and pauses or
// resumes the engine, it never destroys it. Only a genuine full reload (or a
// closed tab) actually loses this in-memory state, in which case
// server/api/pirates/finish-run.post.ts's `abandoned` path clears the stale
// server-side lock the next time /pirates mounts fresh.

interface PirateStateSnapshot {
    activeRun: unknown
    equippedSkinId: string
    equippedAbilityId: PirateAbilityId
    stats: { maxHp: number, speed: number, defenseRating: number, regenRate: number }
    ammo: { count: number }
    gemAmmo: { count: number }
    cannons: { slotIndex: number, tierId: string, attackRating: number, maxDamage: number, reloadMs: number, range: number, shotColor: number, shotTrail: boolean }[]
}

export interface PirateGameOverInfo {
    survived: boolean
    reason: 'timeout' | 'defeat' | 'cancelled'
    coins: number
    awarded: number
    completionBonus: number
    capped: boolean
    kills: number
    shotsFired: number
    abilitiesUsed: number
    sunkByType: { id: string, name: string, count: number }[]
    maxCombo: number
    elapsedMs: number
    repairMs: number
    difficulty: number
    completed: boolean
}

const hp = ref(0)
const maxHp = ref(0)
const coins = ref(0)
const ammo = ref(0)
const gemAmmo = ref(0)
const preferGem = ref(false)
const abilityCooldownMs = ref(0)
const abilityCooldownTotalMs = ref(15_000)
const remainingMs = ref(0)
const running = ref(false)
const paused = ref(false)
const starting = ref(false)
const killFeed = ref<{ id: number, text: string }[]>([])
const activePowerUps = ref<PirateActivePowerUp[]>([])
const nextPowerUpMs = ref(30_000)
const nextHealthPackMs = ref(45_000)
const powerUpNotice = ref<{ title: string, collected: boolean } | null>(null)
let powerUpNoticeTimeout: ReturnType<typeof setTimeout> | null = null
let killFeedSeq = 0

const combo = ref(0)
const comboVisible = ref(false)
let comboTimeout: ReturnType<typeof setTimeout> | null = null

const bossName = ref('')
const bossVisible = ref(false)
let bossTimeout: ReturnType<typeof setTimeout> | null = null

const gameOverVisible = ref(false)
const gameOverResult = ref<PirateGameOverInfo | null>(null)

let game: PirateGame | null = null
let resizeObserver: ResizeObserver | null = null

// Rebound on every usePirateRun() call (i.e. every time a page mounts), so an
// engine callback that fires later — after the player has navigated to a
// different page and back — always reaches the currently-mounted page's
// toast/session/refresh rather than a stale closure from an earlier mount.
let currentToast: ReturnType<typeof useToast> | null = null
let currentFetchSession: (() => Promise<unknown>) | null = null
let currentRefresh: (() => Promise<unknown>) | null = null

function pushKillFeed(text: string) {
    const id = killFeedSeq++
    killFeed.value = [...killFeed.value, { id, text }].slice(-4)
    setTimeout(() => { killFeed.value = killFeed.value.filter(k => k.id !== id) }, 3000)
}

function showCombo(count: number) {
    combo.value = count
    comboVisible.value = true
    if (comboTimeout) clearTimeout(comboTimeout)
    comboTimeout = setTimeout(() => { comboVisible.value = false }, 2500)
}

function showBossWarning(name: string) {
    bossName.value = name
    bossVisible.value = true
    if (bossTimeout) clearTimeout(bossTimeout)
    bossTimeout = setTimeout(() => { bossVisible.value = false }, 4000)
}

function showPowerUpNotice(title: string, collected: boolean) {
    powerUpNotice.value = { title, collected }
    if (powerUpNoticeTimeout) clearTimeout(powerUpNoticeTimeout)
    powerUpNoticeTimeout = setTimeout(() => { powerUpNotice.value = null }, collected ? 2600 : 4200)
}

async function handleGameOver(result: {
    survived: boolean
    coins: number
    elapsedMs: number
    ammoUsed: number
    gemAmmoUsed: number
    kills: number
    shotsFired: number
    abilitiesUsed: number
    sunkByType: { id: string, name: string, count: number }[]
    maxCombo: number
    reason: 'timeout' | 'defeat' | 'cancelled'
    hullDamageFraction: number
}) {
    pirateSound.stopAmbience()
    pirateSound.stopKrakenLoop()
    running.value = false
    paused.value = false
    comboVisible.value = false
    activePowerUps.value = []
    powerUpNotice.value = null
    try {
        const res = await $fetch('/api/pirates/finish-run', {
            method: 'POST',
            body: {
                coins: result.coins,
                survived: result.survived,
                ammoUsed: result.ammoUsed,
                gemAmmoUsed: result.gemAmmoUsed,
                elapsedMs: result.elapsedMs,
                kills: result.kills,
                shotsFired: result.shotsFired,
                reason: result.reason,
                hullDamageFraction: result.hullDamageFraction
            }
        })
        gameOverResult.value = {
            survived: result.survived,
            reason: result.reason,
            coins: result.coins,
            awarded: res.awarded,
            completionBonus: res.completionBonus ?? 0,
            capped: res.capped,
            kills: result.kills,
            shotsFired: result.shotsFired,
            abilitiesUsed: result.abilitiesUsed,
            sunkByType: result.sunkByType,
            maxCombo: result.maxCombo,
            elapsedMs: res.elapsedMs,
            repairMs: res.repairTotalMs ?? 0,
            difficulty: res.difficulty,
            completed: res.completed
        }
        gameOverVisible.value = true
        await Promise.all([currentRefresh?.(), currentFetchSession?.()])
    } catch (e: any) {
        currentToast?.add({ title: e.data?.message ?? 'Failed to submit voyage results', color: 'error' })
    }
}

function buildCallbacks() {
    return {
        onHpChange: (h: number, mh: number) => { hp.value = h; maxHp.value = mh },
        onCoinsChange: (c: number) => { coins.value = c },
        onAmmoChange: (a: number, g: number) => { ammo.value = a; gemAmmo.value = g },
        onAbilityCooldownChange: (remaining: number, total: number) => {
            abilityCooldownMs.value = remaining
            abilityCooldownTotalMs.value = total
        },
        onTimeChange: (_elapsed: number, remaining: number) => { remainingMs.value = remaining },
        onGameOver: (result: Parameters<typeof handleGameOver>[0]) => { handleGameOver(result) },
        onCannonFire: () => pirateSound.play('cannon-fire'),
        onCannonImpact: () => pirateSound.play('cannon-impact'),
        onShipHit: () => pirateSound.play('ship-hit'),
        onAbilitySound: (sound: PirateAbilitySound) => {
            if (sound === 'kraken-loop-start') pirateSound.startKrakenLoop()
            else if (sound === 'kraken-loop-stop') pirateSound.stopKrakenLoop()
            else pirateSound.play(sound)
        },
        onKill: (tierName: string, reward: number) => {
            pirateSound.play('enemy-sunk')
            pushKillFeed(reward > 0 ? `Sunk a ${tierName} (+${reward} banked)` : `Sunk a ${tierName}`)
        },
        onCombo: (count: number) => showCombo(count),
        onBossSpawn: (name: string) => showBossWarning(name),
        onPowerUpsChange: (powerUps: PirateActivePowerUp[], nextDropMs: number, nextRepairMs: number) => {
            activePowerUps.value = powerUps
            nextPowerUpMs.value = nextDropMs
            nextHealthPackMs.value = nextRepairMs
        },
        onPowerUpSpawn: (name: string) => showPowerUpNotice(`${name} sighted — sail to collect it!`, false),
        onPowerUpCollected: (name: string) => {
            pirateSound.play(name.startsWith('Reinforced Keel') ? 'speed-boost' : 'power-up')
            showPowerUpNotice(`${name} activated!`, true)
        },
        onHealthPackSpawn: () => showPowerUpNotice('Hull repair pack sighted — sail to collect it!', false),
        onHealthPackCollected: (amount: number) => {
            pirateSound.play('power-up')
            showPowerUpNotice(`Hull repaired by ${amount}!`, true)
        },
        onTreasureCollected: () => pirateSound.play('treasure-pickup')
    }
}

function setupResizeObserver(host: HTMLDivElement) {
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => {
        if (game) game.resize(host.clientWidth)
    })
    resizeObserver.observe(host)
}

export function usePirateRun() {
    currentToast = useToast()
    currentFetchSession = useAuth().fetchSession

    function registerRefresh(refresh: () => Promise<unknown>) {
        currentRefresh = refresh
    }

    /**
     * Called from the page's onMounted. Reattaches a still-live (paused)
     * voyage's canvas if one exists; otherwise mounts a fresh engine, clearing
     * a stale server-side lock first if this turns out to be a genuine reload
     * after a closed tab. `stateRef` is passed as a ref (not a snapshot) so
     * that if we do abandon-and-refresh below, we build the fresh engine off
     * the refetched data rather than a stale copy.
     */
    async function attachCanvas(host: HTMLDivElement, stateRef: Ref<PirateStateSnapshot | null | undefined>, refresh: () => Promise<unknown>) {
        registerRefresh(refresh)

        if (game) {
            if (stateRef.value?.equippedSkinId) game.setPlayerSkin(stateRef.value.equippedSkinId)
            game.attach(host)
            setupResizeObserver(host)
            return
        }

        if (!stateRef.value) return

        if (stateRef.value.activeRun) {
            try {
                await $fetch('/api/pirates/finish-run', { method: 'POST', body: { coins: 0, survived: false, abandoned: true } })
                await refresh()
            } catch {
                // ignore — state.get will still surface the lock if this failed
            }
        }

        const state = stateRef.value
        if (!state) return
        game = new PirateGame(buildCallbacks(), {
            maxHp: state.stats.maxHp,
            speed: state.stats.speed,
            defenseRating: state.stats.defenseRating,
            regenRate: state.stats.regenRate,
            ammo: state.ammo.count,
            gemAmmo: state.gemAmmo.count,
            skinId: state.equippedSkinId,
            abilityId: state.equippedAbilityId,
            cannons: state.cannons.map(c => ({ slotIndex: c.slotIndex, tierId: c.tierId, attackRating: c.attackRating, maxDamage: c.maxDamage, reloadMs: c.reloadMs, range: c.range, shotColor: c.shotColor, shotTrail: c.shotTrail }))
        } satisfies PirateShipStats)

        await game.mount(host)
        game.resize(host.clientWidth)
        setupResizeObserver(host)
    }

    /** Called from the page's onUnmounted. Freezes a running voyage in place instead of tearing it down. */
    function detachCanvas() {
        resizeObserver?.disconnect()
        resizeObserver = null
        if (game && running.value) {
            game.pause()
            pirateSound.stopEffects()
            pirateSound.pauseAmbience()
            pirateSound.pauseKrakenLoop()
            running.value = false
            paused.value = true
        }
    }

    async function startVoyage(state: { cannons: unknown[], ammo: { count: number }, gemAmmo: { count: number } }, difficulty: number) {
        if (!game || running.value || paused.value || starting.value) return
        if (state.cannons.length === 0) return
        starting.value = true
        try {
            const res = await $fetch('/api/pirates/start-run', { method: 'POST', body: { difficulty } })
            hp.value = res.stats.maxHp
            maxHp.value = res.stats.maxHp
            coins.value = 0
            ammo.value = res.ammo
            gemAmmo.value = res.gemAmmo
            preferGem.value = false
            abilityCooldownMs.value = 0
            remainingMs.value = res.runDurationMs
            killFeed.value = []
            activePowerUps.value = []
            nextPowerUpMs.value = 30_000
            nextHealthPackMs.value = 45_000
            powerUpNotice.value = null
            comboVisible.value = false
            gameOverVisible.value = false
            running.value = true
            paused.value = false
            game.start({
                maxHp: res.stats.maxHp,
                speed: res.stats.speed,
                defenseRating: res.stats.defenseRating,
                regenRate: res.stats.regenRate,
                ammo: res.ammo,
                gemAmmo: res.gemAmmo,
                skinId: res.skinId,
                abilityId: res.abilityId,
                cannons: res.cannons
            }, res.power, res.difficulty)
            pirateSound.startAmbience()
        } catch (e: any) {
            currentToast?.add({ title: e.data?.message ?? 'Failed to set sail', color: 'error' })
        } finally {
            starting.value = false
        }
    }

    function pauseVoyage() {
        if (!game || !running.value) return
        game.pause()
        pirateSound.pauseAmbience()
        pirateSound.pauseKrakenLoop()
        running.value = false
        paused.value = true
    }

    function resumeVoyage() {
        if (!game || !paused.value) return
        game.resume()
        pirateSound.startAmbience()
        pirateSound.resumeKrakenLoop()
        paused.value = false
        running.value = true
    }

    /** Ends the voyage early by player choice — banks whatever's been earned so far. */
    function cancelVoyage() {
        game?.cancel()
    }

    function toggleAmmoMode() {
        preferGem.value = !preferGem.value
        game?.setPreferGemAmmo(preferGem.value)
    }

    function closeGameOver() {
        gameOverVisible.value = false
    }

    return {
        hp,
        maxHp,
        coins,
        ammo,
        gemAmmo,
        preferGem,
        abilityCooldownMs,
        abilityCooldownTotalMs,
        remainingMs,
        running,
        paused,
        starting,
        killFeed,
        activePowerUps,
        nextPowerUpMs,
        nextHealthPackMs,
        powerUpNotice,
        combo,
        comboVisible,
        bossName,
        bossVisible,
        gameOverVisible,
        gameOverResult,
        hasActiveVoyage: computed(() => running.value || paused.value),
        registerRefresh,
        attachCanvas,
        detachCanvas,
        startVoyage,
        pauseVoyage,
        resumeVoyage,
        cancelVoyage,
        toggleAmmoMode,
        closeGameOver,
        soundEnabled: pirateSound.soundEnabled,
        soundVolume: pirateSound.soundVolume,
        playMenuSound: () => pirateSound.play('menu')
    }
}
