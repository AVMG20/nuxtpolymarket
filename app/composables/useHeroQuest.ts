import type { FightEvent, FightOutcome } from '#shared/utils/hero-quest/fight'

/**
 * The single source of Hero Quest state on the client. Pages contain no fetch logic.
 *
 * The polling interval here is not cosmetic — it is what the server's presence detection
 * reads. A gap at or under `ONLINE_THRESHOLD_MS` counts as the player being present and
 * accrues at full rate; a longer one is treated as offline and pays the cap and efficiency
 * tax. Stop refreshing and you are, correctly, offline.
 */
export const useHeroQuest = () => {
    const toast = useToast()
    const { fetchSession } = useAuth()

    const { data: state, refresh, pending } = useFetch('/api/hero-quest/state', {
        key: 'hero-quest-state',
        default: () => null
    })

    const initialized = computed(() => state.value?.initialized ?? false)
    const run = computed(() => state.value?.run ?? null)
    const hero = computed(() => state.value?.hero ?? null)
    const shop = computed(() => state.value?.shop ?? [])
    const classTree = computed(() => state.value?.classTree ?? [])
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
        if (res) {
            toast.add({
                title: `Prestige ${res.prestige} — ${formatNumber(Number(res.voidShardsEarned))} Void Shards`,
                description: 'Your hero keeps every level.',
                color: 'success'
            })
        }
        // Gold moves during the settle that precedes the reset.
        await fetchSession()
        return res
    }

    async function pickClass(classId: string) {
        return call<{ className: string }>('/api/hero-quest/prestige/pick-class', { classId }, '')
            .then((res) => {
                if (res) toast.add({ title: `Now training as ${res.className}`, color: 'success' })
                return res
            })
    }

    async function buyUpgrade(upgradeId: string) {
        return call('/api/hero-quest/prestige/shop-buy', { upgradeId }, 'Upgrade purchased')
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
    async function pull(system: GachaSystem, count: 1 | 10) {
        return call<{ pulls: PullRecord[]; essenceGained: number; gachaLevel: number }>(
            '/api/hero-quest/gacha/pull', { system, count }, ''
        )
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
        ).then((res) => {
            if (res) {
                toast.add({
                    title: res.isNew ? `Crafted ${res.name}` : `${res.name} levelled`,
                    color: 'success'
                })
            }
            return res
        })
    }

    /** Buy Seals with Gold on that gacha's own daily escalating ladder. */
    async function buySeals(system: GachaSystem, count = 1) {
        const res = await call<{ sealsBought: number; goldSpent: number }>(
            '/api/hero-quest/gacha/buy-seals', { system, count }, ''
        )
        if (res) {
            toast.add({
                title: `+${res.sealsBought} Seals`,
                description: `${formatNumber(res.goldSpent)} Gold`,
                color: 'success'
            })
        }
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
    }

    async function setLoadout(change: LiveLoadout, successMsg = 'Loadout updated') {
        return call('/api/hero-quest/loadout/set', change as Record<string, unknown>, successMsg)
    }

    /** Snapshot the whole live state into a slot (`loadouts.md` §2). */
    async function saveLoadout(slotIndex: number, name?: string) {
        return call('/api/hero-quest/loadout/save', { slotIndex, name }, 'Loadout saved')
    }

    /** Apply a saved slot as the new live state — all five components at once. */
    async function applyLoadout(slotIndex: number) {
        return call('/api/hero-quest/loadout/apply', { slotIndex }, 'Loadout applied')
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
        reset: () => call('/api/hero-quest/dev/reset', {}, 'Hero Quest wiped')
    }

    // Gold accrues into the shared balance on every settle, so the header has to follow it.
    let timer: ReturnType<typeof setInterval> | null = null
    onMounted(() => {
        timer = setInterval(async () => {
            await refresh()
            await fetchSession()
        }, refreshIntervalMs.value)
    })
    onUnmounted(() => {
        if (timer) clearInterval(timer)
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
        classTree,
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
        pull,
        freePull,
        craft,
        buySeals,
        setLoadout,
        saveLoadout,
        applyLoadout,
        devMode,
        dev
    }
}
