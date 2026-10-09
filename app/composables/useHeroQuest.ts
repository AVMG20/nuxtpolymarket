import type { FightEvent, FightOutcome } from '#shared/utils/hero-quest/fight'
import type { HqSettingKey } from '#shared/utils/hero-quest/settings'
import { HQ_SESSION_TIMEOUT_MS } from '#shared/utils/hero-quest/constants'

/**
 * The single source of Hero Quest state on the client. Pages contain no fetch logic.
 *
 * The polling interval here is not cosmetic — it is what the server's presence detection
 * reads. A gap at or under `ONLINE_THRESHOLD_MS` counts as the player being present and
 * accrues at full rate; a longer one is treated as offline and pays the cap and efficiency
 * tax. Stop refreshing and you are, correctly, offline.
 */
/** How recent a read the next component to mount reuses rather than settling again. */
const STATE_REUSE_MS = 5_000

/**
 * The state read already in hand, for a component mounting moments after another read it: the
 * hydrated one, or one under `STATE_REUSE_MS` old. A refresh always reads.
 *
 * Typed `never` so it takes no part in inferring the payload's type, which an inline callback
 * reading `payload.data` sends past the compiler's depth limit.
 */
function reuseRecentRead(key: string, nuxtApp: { isHydrating?: boolean, payload: { data: Record<string, unknown> } }, context: { cause: string }, fetchedAt: number): never | undefined {
    if (context.cause !== 'initial') return undefined
    const cached = nuxtApp.payload.data[key] ?? undefined
    return (nuxtApp.isHydrating || Date.now() - fetchedAt < STATE_REUSE_MS ? cached : undefined) as never | undefined
}

/** The one presence poll, shared by every component holding Hero Quest state. Browser only. */
const poll: { users: number, timer: ReturnType<typeof setInterval> | null } = { users: 0, timer: null }

export const useHeroQuest = () => {
    const toast = useToast()
    const { fetchSession } = useAuth()

    /**
     * The session (`useHqSession`), decided as each read arrives rather than in a watcher, so the
     * server render decides it too and hands its decision to the client: a watcher does not run
     * on the server once data lands, and the two would disagree about showing the splash.
     */
    const sessionActive = useState<boolean | null>('hq-session-active', () => null)
    const sessionResuming = useState('hq-session-resuming', () => false)
    /** The report of the read that ended the session, for the splash: a later read replaces `settled`. */
    const sessionAway = useState<unknown>('hq-session-away', () => null)
    /** When this app last read the state: a read is a settle, a write, so a second one moments later reuses it. */
    const fetchedAt = useState('hq-state-fetched-at', () => 0)

    const { data: state, refresh, pending } = useFetch('/api/hero-quest/state', {
        key: 'hero-quest-state',
        default: () => null,
        // The layout and the tab both hold the state; only the first to mount reads it.
        getCachedData: (key, nuxtApp, context) => reuseRecentRead(key, nuxtApp, context, fetchedAt.value),
        onResponse({ response }) {
            const payload = response._data as { initialized?: boolean, awaySeconds?: number, settled?: unknown } | undefined
            if (!payload) return
            fetchedAt.value = Date.now()
            if (!payload.initialized) {
                sessionActive.value = false
            } else if (sessionResuming.value) {
                // the read Start makes closes the very gap that ended the session
                sessionResuming.value = false
                sessionActive.value = true
            } else if ((payload.awaySeconds ?? 0) * 1000 > HQ_SESSION_TIMEOUT_MS) {
                sessionActive.value = false
                sessionAway.value = payload.settled ?? null
            } else if (sessionActive.value === null) {
                sessionActive.value = true
            }
        }
    })

    const initialized = computed(() => state.value?.initialized ?? false)
    const run = computed(() => state.value?.run ?? null)
    const hero = computed(() => state.value?.hero ?? null)
    const shop = computed(() => state.value?.shop ?? [])
    const classTree = computed(() => state.value?.classTree ?? [])
    /** The capstone class: its unlock so far, the live picks and every skill it can pick. */
    const ascendant = computed(() => state.value?.ascendant ?? null)
    /** A prestige's class token, waiting to take a class not reached before. */
    const classToken = computed(() => state.value?.classToken ?? false)
    /** The running Battle Speed block, if any, and the price of every block. */
    const battleSpeed = computed(() => state.value?.battleSpeed ?? null)
    /** Every raid: open or not, its Keys, when more come, its best and what that pays. */
    const raids = computed(() => state.value?.raids ?? [])
    /** The login calendar: every day's reward as of now, which are claimed, and the make-ups. */
    const calendar = computed(() => state.value?.calendar ?? null)
    /** The holiday gifts open now (claimed or not, and what each pays) and the next to open. */
    const holidays = computed(() => state.value?.holidays ?? null)
    /** Every milestone track: its feat now, the steps claimed, the next step, and what's waiting. */
    const milestones = computed(() => state.value?.milestones ?? [])
    /** The features open, in the order they opened, and the guide's tutorials seen; null before the first read. */
    const tutorials = computed(() => state.value?.tutorials ?? null)
    /** The Traits: the live board, the Roll's price, every Set's tier, and the save slots. */
    const traits = computed(() => state.value?.traits ?? null)
    /** The Settings scene's choices, defaults filled in by the server. */
    const settings = computed(() => state.value?.settings ?? null)
    const voidShards = computed(() => state.value?.voidShards ?? '0')
    const nextPrestigeReward = computed(() => state.value?.nextPrestigeReward ?? '0')
    const settled = computed(() => state.value?.settled ?? null)
    const serverNow = computed(() => state.value?.serverNow ?? Date.now())
    const refreshIntervalMs = computed(() => state.value?.refreshIntervalMs ?? 60_000)

    const guild = computed(() => state.value?.guild ?? null)
    const forge = computed(() => state.value?.forge ?? null)
    const training = computed(() => state.value?.training ?? null)
    const digSite = computed(() => state.value?.digSite ?? null)
    const loadouts = computed(() => state.value?.loadouts ?? null)
    /** Raid (or `arena`) → the saved slot it applies on a fresh engage (`loadouts.md` §4). */
    const loadoutPreferences = computed<Partial<Record<string, number>>>(() => state.value?.loadoutPreferences ?? {})
    /** The open preferred-Loadout session: which raid's Loadout is live now, and its slot; null when none. */
    const loadoutSession = computed(() => state.value?.loadoutSession ?? null)
    const atBossGate = computed(() => run.value?.atBossGate ?? false)
    const walled = computed(() => run.value?.walled ?? false)
    const canPrestige = computed(() => state.value?.run?.runCleared ?? false)

    /**
     * `silentErrors` suppresses the failure toast but still rethrows, for the one caller that
     * expects to be rejected as a matter of course: automatic boss engagement races the server's
     * lazy settle and a 400 there means "not yet", not "something went wrong". The caller decides
     * what a given failure means; it never decides whether the request happened.
     */
    async function call<T>(
        url: string,
        body: Record<string, unknown>,
        successMsg: string,
        options: { silentErrors?: boolean } = {}
    ): Promise<T | null> {
        try {
            const res = await $fetch(url, { method: 'POST', body })
            if (successMsg) toast.add({ title: successMsg, color: 'success' })
            await refresh()
            return res as T
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!options.silentErrors) {
                toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
            }
            throw e
        }
    }

    async function initRun() {
        await $fetch('/api/hero-quest/init', { method: 'POST' })
        await refresh()
    }

    interface BossResult {
        outcome: FightOutcome
        seed: number
        secondsElapsed: number
        damageDealtPct: number
        enemyMaxHp: string
        /** Per body, escort first — a boss stands with minions, so the pack is mixed. */
        enemyMaxHps: string[]
        enemyHpRemaining: string
        events: FightEvent[]
        /** The party in the fight's `unitIndex` order: the Hero's class, then each fielded Champion. */
        partyIds: string[]
        partyMaxHps: string[]
        landing: { world: number; stage: number }
        runComplete: boolean
        /** Battle Speed at engage: how much faster the replay plays. */
        playbackSpeed: number
    }

    /**
     * Engage the boss. The response *is* the fight — the server resolved it authoritatively
     * and handed back the event log, so the modal animates a result that already happened.
     * Toast is suppressed: the replay itself is the feedback.
     */
    async function engageBoss(options: { silentErrors?: boolean } = {}) {
        return call<BossResult>('/api/hero-quest/boss/engage', {}, '', options)
    }

    async function prestige() {
        const res = await call<{ voidShardsEarned: string; prestige: number }>(
            '/api/hero-quest/prestige/execute', {}, ''
        )
        // Gold moves during the settle that precedes the reset.
        await fetchSession()
        return res
    }

    async function pickClass(classId: string) {
        return call<{ className: string }>('/api/hero-quest/prestige/pick-class', { classId }, '')
    }

    async function buyUpgrade(upgradeId: string) {
        return call('/api/hero-quest/prestige/shop-buy', { upgradeId }, '')
    }

    interface RaidRound {
        raidId: string
        seed: number
        outcome: FightOutcome
        level: number
        /** The dummy's damage; null for a boss. */
        damage: string | null
        reward: number
        best: number
        newBest: boolean
        keys: number
        secondsElapsed: number
        events: FightEvent[]
        enemyMaxHps: string[]
        partyIds: string[]
        partyMaxHps: string[]
    }

    /** Enter a raid: the response is its round, resolved on the server, for the stage to replay. */
    async function engageRaid(raidId: string) {
        return call<RaidRound>('/api/hero-quest/raid/engage', { raidId }, '')
    }

    /** Spend a Key on the best level's reward, without a round. */
    async function quickClearRaid(raidId: string) {
        return call<{ raidId: string, level: number, reward: number, keys: number }>('/api/hero-quest/raid/quick-clear', { raidId }, '')
    }

    async function setSetting(key: HqSettingKey, value: boolean) {
        return call('/api/hero-quest/settings/set', { key, value }, '')
    }

    /** The guide's tutorial `id` was read or skipped. */
    async function markTutorialSeen(id: string) {
        return call('/api/hero-quest/tutorials/seen', { id }, '')
    }

    /** See every tutorial again. Locks nothing. */
    async function resetTutorials() {
        return call('/api/hero-quest/tutorials/reset', {}, '')
    }

    /**
     * Claim today's calendar reward, or with `makeup` the oldest missed day's. A day of Gold or Gems
     * moves a platform balance the response doesn't carry, so the session is read back for those;
     * it happens at most a few times a day.
     */
    async function claimCalendar(makeup: boolean) {
        const res = await call<{ day: number, kind: string, amount: string }>('/api/hero-quest/calendar/claim', { makeup }, '')
        if (res?.kind === 'gold' || res?.kind === 'gems') await fetchSession()
        return res
    }

    /**
     * Claim an open holiday's gift. Its Gold and Gems move platform balances the response doesn't
     * carry, so the session is read back; it happens a few times a year.
     */
    async function claimHoliday(holidayId: string) {
        const res = await call<{ holidayId: string, year: number, gold: string, gems: number }>('/api/hero-quest/holiday/claim', { holidayId }, '')
        await fetchSession()
        return res
    }

    /**
     * Claim every milestone step waiting: on one track, or on all of them without one. Gems move a
     * platform balance the response doesn't carry, so the session is read back when any were paid.
     */
    async function claimMilestones(track?: string) {
        const res = await call<{ rewards: { kind: string, amount: number }[] }>('/api/hero-quest/milestones/claim', track ? { track } : {}, '')
        if (res?.rewards.some(r => r.kind === 'gems')) await fetchSession()
        return res
    }

    /** Roll every unlocked Trait slot, for the Trait Gems the board's locks price it at. */
    async function rollTraits() {
        return call<{ spent: number, traitGems: number }>('/api/hero-quest/trait/roll', {}, '')
    }

    /** Lock or unlock a Trait slot: free. */
    async function lockTrait(slotIndex: number, locked: boolean) {
        return call('/api/hero-quest/trait/lock', { slotIndex, locked }, '')
    }

    /** Store the live Trait board in a save slot, for Trait Gems. */
    async function saveTraits(saveSlotIndex: number) {
        return call('/api/hero-quest/trait/save', { saveSlotIndex }, '')
    }

    /** Load a stored Trait board onto the live slots, for Trait Gems. */
    async function loadTraits(saveSlotIndex: number) {
        return call('/api/hero-quest/trait/load', { saveSlotIndex }, '')
    }

    /** Buy the next Trait save slot. Gems have no setter of their own, so the session is read back. */
    async function buyTraitSaveSlot() {
        const res = await call('/api/hero-quest/prestige/shop-buy', { upgradeId: 'traitSaveSlots' }, '')
        await fetchSession()
        return res
    }

    /** Buy a Battle Speed block. Gems have no setter of their own, so the session is read back. */
    async function buyBattleSpeed(speed: number, minutes: number) {
        const res = await call('/api/hero-quest/speed/buy', { speed, minutes }, '')
        await fetchSession()
        return res
    }

    interface PullRecord {
        contentId: string
        name: string
        rarity: string
        isNew: boolean
        star: number
        level: number
        essence: number
    }

    /**
     * The four gachas share one set of actions, taking `system`, exactly as the server routes do.
     *
     * Four copies of each of these is what the shared-gacha design exists to avoid — the rarity
     * ladder, levelling curve, drop table and dupe formula are identical across all four, so the
     * only per-tab difference is which word goes in the body.
     */
    type GachaSystem = 'gear' | 'champion' | 'skill' | 'artifact'

    /** Toast is suppressed — the result reel is the feedback, and a 10-pull would stack ten. */
    /**
     * Pull with Seals. `maxGold` lets it buy the Seals it is short off the day's Gold ladder, at no
     * more than that: the price the button showed. Gold then left the shared balance, so the
     * session is read back.
     */
    async function pull(system: GachaSystem, count: 1 | 10, maxGold?: number) {
        const body = maxGold === undefined ? { system, count } : { system, count, autoBuy: { maxGold } }
        const res = await call<{ pulls: PullRecord[]; essenceGained: number; gachaLevel: number }>(
            '/api/hero-quest/gacha/pull', body, ''
        )
        if (maxGold !== undefined) await fetchSession()
        return res
    }

    /**
     * Spend one of the day's free 10-pull entitlements.
     *
     * Same route as `pull`, because a free pull *is* a pull — only the payment differs, and the
     * server decides whether one is owed. Count is not sent: the entitlement is always ten, and
     * letting the client name a size would be letting it name a price.
     */
    async function freePull(system: GachaSystem) {
        return call<{ pulls: PullRecord[]; essenceGained: number; gachaLevel: number; free: boolean }>(
            '/api/hero-quest/gacha/pull', { system, free: true }, ''
        )
    }

    /** Spend a gacha's Essence on a specific item — the full RNG bypass. */
    async function craft(system: GachaSystem, contentId: string) {
        return call<{ name: string; isNew: boolean }>(
            '/api/hero-quest/gacha/craft', { system, contentId }, ''
        )
    }

    /** Buy Seals with Gold on that gacha's own daily escalating ladder. */
    async function buySeals(system: GachaSystem, count = 1) {
        const res = await call<{ sealsBought: number; goldSpent: number }>(
            '/api/hero-quest/gacha/buy-seals', { system, count }, ''
        )
        // Gold left the shared balance — the header has to follow it.
        await fetchSession()
        return res
    }

    /**
     * Set any part of the live loadout. Every field is optional — the Gear page sends only
     * `gear`, the Champions page only `championIds` and `formation`.
     *
     * Party and formation still travel together when either changes, because a formation is only
     * valid against a specific party and the server validates row capacity across both.
     */
    interface LiveLoadout {
        championIds?: string[]
        formation?: Record<string, 'front' | 'back'>
        skillIds?: string[]
        artifactIds?: string[]
        gear?: Record<string, string>
        ascendantSkillIds?: string[]
    }

    async function setLoadout(change: LiveLoadout, successMsg = 'Loadout updated') {
        return call('/api/hero-quest/loadout/set', change as Record<string, unknown>, successMsg)
    }

    /** Snapshot the whole live state into a slot (`loadouts.md` §2). */
    async function saveLoadout(slotIndex: number, name?: string) {
        return call('/api/hero-quest/loadout/save', { slotIndex, name }, '')
    }

    /** Apply a saved slot as the new live state — all six components at once. */
    async function applyLoadout(slotIndex: number) {
        return call('/api/hero-quest/loadout/apply', { slotIndex }, '')
    }

    /**
     * Point a raid at a saved slot, or with null at none (`loadouts.md` §4). Free; only the
     * pointer moves, so the live loadout changes on the raid's next engage.
     */
    async function setLoadoutPreference(target: string, slotIndex: number | null) {
        return call('/api/hero-quest/loadout/set-raid-preference', { target, slotIndex }, '')
    }

    /** Leave the raid: the loadout that was live before its first engage goes back, if one was applied. */
    async function leaveRaid() {
        return call<{ restored: boolean }>('/api/hero-quest/raid/leave', {}, '')
    }

    /** Rename a saved slot, leaving what it holds alone. */
    async function renameLoadout(slotIndex: number, name: string) {
        return call('/api/hero-quest/loadout/rename', { slotIndex, name }, '')
    }

    /**
     * The playtest harness (`server/utils/hero-quest-dev.ts`) — **development only.**
     *
     * Guarded twice on purpose. `devMode` hides the tab and the page, and the routes themselves
     * 404 outside dev regardless of what the client believes. The client guard is a convenience;
     * the server guard is the security boundary, and neither is trusted to do the other's job.
     */
    const devMode = import.meta.dev

    interface SkipResult {
        chunksRun: number
        kills: number
        goldEarned: number
        levelsGained: number
        blockedAtBoss: boolean
        world: number
        stage: number
        heroLevel: number
    }

    const dev = {
        /** Settle `hours` as one offline window, or as consecutive presence-length ones. */
        skip: (hours: number, mode: 'offline' | 'online') =>
            call<SkipResult>('/api/hero-quest/dev/skip', { hours, mode }, '').then(async (res) => {
                await fetchSession()
                return res
            }),
        grant: (body: Record<string, number>) =>
            call('/api/hero-quest/dev/grant', body, 'Granted').then(async (res) => {
                await fetchSession()
                return res
            }),
        unlock: (body: Record<string, unknown>) =>
            call('/api/hero-quest/dev/unlock', body, 'Collection unlocked'),
        set: (body: Record<string, unknown>) =>
            call('/api/hero-quest/dev/set', body, 'Run moved'),
        reset: () => call('/api/hero-quest/dev/reset', {}, 'Hero Quest wiped'),
        /** End the session as an hour away would; the read after it opens on the splash. */
        away: () => call<{ awaySeconds: number }>('/api/hero-quest/dev/away', {}, '')
    }

    // Gold accrues into the shared balance on every settle, so the header has to follow it.
    // Not while the splash waits for Start: a tab left on it is away, not present (`useHqSession`).
    // One poll however many components hold the state: the layout and the page both do.
    onMounted(() => {
        if (poll.users++ > 0) return
        poll.timer = setInterval(async () => {
            if (!sessionActive.value) return
            await refresh()
            await fetchSession()
        }, refreshIntervalMs.value)
    })
    onUnmounted(() => {
        if (--poll.users > 0 || !poll.timer) return
        clearInterval(poll.timer)
        poll.timer = null
    })

    return {
        state,
        pending,
        refresh,
        initialized,
        run,
        hero,
        shop,
        guild,
        forge,
        training,
        digSite,
        loadouts,
        loadoutPreferences,
        loadoutSession,
        classTree,
        ascendant,
        classToken,
        battleSpeed,
        raids,
        calendar,
        holidays,
        milestones,
        tutorials,
        traits,
        settings,
        voidShards,
        nextPrestigeReward,
        settled,
        serverNow,
        atBossGate,
        walled,
        canPrestige,
        initRun,
        engageBoss,
        prestige,
        pickClass,
        buyUpgrade,
        buyBattleSpeed,
        setSetting,
        claimCalendar,
        claimHoliday,
        claimMilestones,
        markTutorialSeen,
        resetTutorials,
        rollTraits,
        lockTrait,
        saveTraits,
        loadTraits,
        buyTraitSaveSlot,
        engageRaid,
        quickClearRaid,
        pull,
        freePull,
        craft,
        buySeals,
        setLoadout,
        saveLoadout,
        applyLoadout,
        renameLoadout,
        setLoadoutPreference,
        leaveRaid,
        devMode,
        dev
    }
}
