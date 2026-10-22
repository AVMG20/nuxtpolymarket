import type {
    HqArenaAttackRequest,
    HqArenaAttemptResponse,
    HqArenaBoardResponse,
    HqArenaCandidatesResponse,
    HqArenaClaimResponse,
    HqArenaDefenseResponse,
    HqArenaLogResponse,
    HqArenaRefreshResponse,
    HqArenaRoundResponse,
    HqArenaShopBuyRequest,
    HqArenaShopBuyResponse,
    HqAwayDismissRequest,
    HqAwayDismissResponse,
    HqBossResponse,
    HqBuySealsRequest,
    HqBuySealsResponse,
    HqCalendarClaimRequest,
    HqCalendarClaimResponse,
    HqChestResponse,
    HqCraftRequest,
    HqCraftResponse,
    HqDevAwayResponse,
    HqDevGrantRequest,
    HqDevSetRequest,
    HqDevSkipRequest,
    HqDevSkipResponse,
    HqDevUnlockRequest,
    HqHolidayClaimRequest,
    HqHolidayClaimResponse,
    HqInitResponse,
    HqLoadoutApplyResponse,
    HqLoadoutPreferenceRequest,
    HqLoadoutPreferenceResponse,
    HqLoadoutRenameRequest,
    HqLoadoutRenameResponse,
    HqLoadoutSaveRequest,
    HqLoadoutSaveResponse,
    HqLoadoutSetRequest,
    HqLoadoutSetResponse,
    HqLoadoutSlotRequest,
    HqMilestonesClaimRequest,
    HqMilestonesClaimResponse,
    HqPickClassRequest,
    HqPickClassResponse,
    HqPrestigeResponse,
    HqPullRequest,
    HqPullResponse,
    HqQuickClearResponse,
    HqRaidLeaveResponse,
    HqRaidRequest,
    HqRaidRoundResponse,
    HqSettingRequest,
    HqSettingResponse,
    HqShopBuyRequest,
    HqShopBuyResponse,
    HqSpeedBuyRequest,
    HqSpeedBuyResponse,
    HqStateResponse,
    HqTraitAutoRollRequest,
    HqTraitAutoRollResponse,
    HqTraitLoadResponse,
    HqTraitLockRequest,
    HqTraitLockResponse,
    HqTraitRollResponse,
    HqTraitSaveResponse,
    HqTraitSaveSlotRequest,
    HqTreeBuyRequest,
    HqTreeBuyResponse,
    HqTreeRespecResponse,
    HqTutorialSeenRequest,
    HqTutorialSeenResponse,
    HqTutorialsResetResponse
} from '#server/utils/hero-quest-api'
import type { HqAwayReport } from '#shared/utils/hero-quest/away-report'
import type { BattleSpeedDuration, BattleSpeedTier } from '#shared/utils/hero-quest/battle-speed'
import type { HolidayId } from '#shared/utils/hero-quest/content/holidays'
import type { RaidId } from '#shared/utils/hero-quest/content/raids'
import type { ShopTrackId } from '#shared/utils/hero-quest/content/shop'
import type { GachaSystem } from '#shared/utils/hero-quest/gacha'
import type { LoadoutTarget } from '#shared/utils/hero-quest/loadout-session'
import type { HqSettingKey, HqSettings } from '#shared/utils/hero-quest/settings'
import type { TutorialRecord } from '#shared/utils/hero-quest/tutorials'
import type { SkipMode } from '#server/utils/hero-quest-dev'
import type { TraitGrade } from '#shared/utils/hero-quest/types'

/**
 * The single source of Hero Quest state on the client. Pages contain no fetch logic.
 *
 * The polling interval here is not cosmetic — it is what the server's presence detection
 * reads. A gap at or under `ONLINE_THRESHOLD_MS` counts as the player being present and
 * accrues at full rate; a longer one is treated as offline and pays the cap and efficiency
 * tax. Stop refreshing and you are, correctly, offline.
 *
 * Every request body and response is typed by the wire contract in `hero-quest-api.ts`.
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
    const { fetchSession, setBalance } = useAuth()

    /**
     * The session (`useHqSession`), decided as each read arrives rather than in a watcher, so the
     * server render decides it too and hands its decision to the client: a watcher does not run
     * on the server once data lands, and the two would disagree about showing the splash.
     */
    const sessionActive = useState<boolean | null>('hq-session-active', () => null)
    const sessionResuming = useState('hq-session-resuming', () => false)
    /** The welcome-back card the server holds (`hq_state.away_report`), until the player puts it away. */
    const welcome = useState<HqAwayReport | null>('hq-welcome', () => null)
    /** The card just put away, so a read that left before the dismiss landed doesn't bring it back. */
    const dismissedWelcomeId = useState<string | null>('hq-welcome-dismissed', () => null)
    /** When this app last read the state: a read is a settle, a write, so a second one moments later reuses it. */
    const fetchedAt = useState('hq-state-fetched-at', () => 0)

    const { data: state, refresh, pending } = useFetch<HqStateResponse>('/api/hero-quest/state', {
        key: 'hero-quest-state',
        // The layout and the tab both hold the state; only the first to mount reads it.
        getCachedData: (key, nuxtApp, context) => reuseRecentRead(key, nuxtApp, context, fetchedAt.value),
        // Every component here calls useFetch on this key, and 'cancel' let the second abort the first
        // read after the server had settled it, dropping the night it banked. Writes refresh with 'cancel'.
        dedupe: 'defer',
        onResponse({ response }) {
            const payload = response._data
            if (!payload) return
            fetchedAt.value = Date.now()
            const away = payload.awayReport ?? null
            welcome.value = away && away.id !== dismissedWelcomeId.value ? away : null
            const report = payload.settled
            if (!payload.initialized) {
                sessionActive.value = false
            } else if (sessionResuming.value) {
                // the read Start makes closes the very gap that ended the session
                sessionResuming.value = false
                sessionActive.value = true
            } else if (report && !report.online) {
                sessionActive.value = false
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
    /** The Passive Skill Tree: the points, the respec, and every node's level and next cost. */
    const passiveTree = computed(() => state.value?.passiveTree ?? null)
    /** The Arena: Medals, this season's Rating, today's attacks, the defence and any season reward waiting. */
    const arena = computed(() => state.value?.arena ?? null)
    /**
     * The Arena's own reads, fetched while its scene is open rather than polled with the state: the
     * opponent list, the battle log and the Rating leaderboard. Shared, so a reload of one view keeps
     * the others.
     */
    const arenaCandidates = useState<HqArenaCandidatesResponse | null>('hq-arena-candidates', () => null)
    const arenaLog = useState<HqArenaLogResponse | null>('hq-arena-log', () => null)
    const arenaBoard = useState<HqArenaBoardResponse | null>('hq-arena-board', () => null)
    /** The Settings scene's choices, defaults filled in by the server. */
    const settings = computed(() => state.value?.settings ?? null)
    const voidShards = computed(() => state.value?.voidShards ?? '0')
    /** Gold banked in the chest as of the last read; the settles fill it and opening it pays it out. */
    const chestGold = computed(() => state.value?.chestGold ?? '0')
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
    async function call<Res, Req extends object = Record<string, never>>(
        url: string,
        body: Req,
        successMsg: string,
        options: { silentErrors?: boolean, refresh?: boolean } = {}
    ): Promise<Res | null> {
        try {
            const res = await $fetch<Res>(url, { method: 'POST', body })
            if (successMsg) toast.add({ title: successMsg, color: 'success' })
            // a fresh read: one already in flight left before this write
            if (options.refresh !== false) await refresh({ dedupe: 'cancel' })
            return res
        } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            if (!options.silentErrors) {
                toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
            }
            throw e
        }
    }

    async function initRun() {
        await $fetch<HqInitResponse>('/api/hero-quest/init', { method: 'POST' })
        await refresh({ dedupe: 'cancel' })
    }

    /**
     * Engage the boss. The response *is* the fight — the server resolved it authoritatively
     * and handed back the event log, so the modal animates a result that already happened.
     * Toast is suppressed: the replay itself is the feedback.
     */
    async function engageBoss(options: { silentErrors?: boolean } = {}) {
        return call<HqBossResponse>('/api/hero-quest/boss/engage', {}, '', options)
    }

    async function prestige() {
        const res = await call<HqPrestigeResponse>('/api/hero-quest/prestige/execute', {}, '')
        // Gold moves during the settle that precedes the reset.
        await fetchSession()
        return res
    }

    async function pickClass(classId: string) {
        return call<HqPickClassResponse, HqPickClassRequest>('/api/hero-quest/prestige/pick-class', { classId }, '')
    }

    /**
     * Buy a shop level. A Gold track (the offline ones) carries the new balance, so it is set straight
     * away; a Gems track (Loadout or Trait save slots) moves a platform balance the response doesn't
     * carry, and Gems have no setter of their own, so the session is read back.
     */
    async function buyUpgrade(upgradeId: ShopTrackId) {
        const res = await call<HqShopBuyResponse, HqShopBuyRequest>('/api/hero-quest/shop/buy', { upgradeId }, '')
        if (res?.currency === 'gold' && res.balance !== null) setBalance(res.balance)
        else if (res?.currency === 'gems') await fetchSession()
        return res
    }

    /** Enter a raid: the response is its round, resolved on the server, for the stage to replay. */
    async function engageRaid(raidId: RaidId) {
        return call<HqRaidRoundResponse, HqRaidRequest>('/api/hero-quest/raid/engage', { raidId }, '')
    }

    /** Spend a Key on the best level's reward, without a round. */
    async function quickClearRaid(raidId: RaidId) {
        return call<HqQuickClearResponse, HqRaidRequest>('/api/hero-quest/raid/quick-clear', { raidId }, '')
    }

    async function loadArenaCandidates() {
        arenaCandidates.value = await $fetch<HqArenaCandidatesResponse>('/api/hero-quest/arena/candidates')
    }

    async function loadArenaLog() {
        arenaLog.value = await $fetch<HqArenaLogResponse>('/api/hero-quest/arena/log')
    }

    async function loadArenaBoard() {
        arenaBoard.value = await $fetch<HqArenaBoardResponse>('/api/hero-quest/arena/leaderboard')
    }

    /** Pay Gems for a fresh opponent list. Gems have no setter of their own, so the session is read back. */
    async function refreshArenaCandidates() {
        const res = await call<HqArenaRefreshResponse>('/api/hero-quest/arena/refresh-candidates', {}, '')
        if (res) arenaCandidates.value = res.candidates
        // a free refresh moves no Gems
        if (res?.gemsSpent) await fetchSession()
        return res
    }

    /**
     * Attack the candidate in `slot`, named so a list redrawn in between can't send the attack at
     * someone else. The response is the fight, for the stage to replay; the list is redrawn by it.
     */
    async function attackArena(slot: number, opponent: string) {
        const res = await call<HqArenaRoundResponse, HqArenaAttackRequest>('/api/hero-quest/arena/attack', { slot, opponent }, '').catch((e) => {
            // a refused attack may have found the list stale (out of band): reading it back redraws it
            loadArenaCandidates().catch(() => {})
            throw e
        })
        // the attack redrew the list; a failed read leaves the old one up, and the next attack says so
        loadArenaCandidates().catch(() => {})
        arenaLog.value = null
        return res
    }

    /** Buy one more attack today, on the doubling Gem ladder. */
    async function buyArenaAttempt() {
        const res = await call<HqArenaAttemptResponse>('/api/hero-quest/arena/buy-attempt', {}, '')
        await fetchSession()
        return res
    }

    /** "Set current loadout as defence": the player's own loadout, as it is equipped now. */
    async function setArenaDefense() {
        return call<HqArenaDefenseResponse>('/api/hero-quest/arena/defense-set', {}, '')
    }

    /** Buy from the Arena Shop with Medals. Gems move a platform balance the response doesn't carry. */
    async function buyArenaItem(itemId: string, quantity = 1) {
        const res = await call<HqArenaShopBuyResponse, HqArenaShopBuyRequest>('/api/hero-quest/arena/shop-buy', { itemId, quantity }, '')
        if (res?.kind === 'gems') await fetchSession()
        return res
    }

    /** Claim every finished season's rank reward waiting. */
    async function claimArenaSeason() {
        return call<HqArenaClaimResponse>('/api/hero-quest/arena/claim-season', {}, '')
    }

    async function setSetting<K extends HqSettingKey>(key: K, value: HqSettings[K]) {
        return call<HqSettingResponse, HqSettingRequest>('/api/hero-quest/settings/set', { key, value } as HqSettingRequest, '')
    }

    /** The guide's tutorial `id` was read or skipped. */
    async function markTutorialSeen(id: TutorialRecord) {
        return call<HqTutorialSeenResponse, HqTutorialSeenRequest>('/api/hero-quest/tutorials/seen', { id }, '')
    }

    /** See every tutorial again. Locks nothing. */
    async function resetTutorials() {
        return call<HqTutorialsResetResponse>('/api/hero-quest/tutorials/reset', {}, '')
    }

    /**
     * Claim today's calendar reward, or with `makeup` the oldest missed day's. A day of Gold or Gems
     * moves a platform balance the response doesn't carry, so the session is read back for those;
     * it happens at most a few times a day.
     */
    async function claimCalendar(makeup: boolean) {
        const res = await call<HqCalendarClaimResponse, HqCalendarClaimRequest>('/api/hero-quest/calendar/claim', { makeup }, '')
        if (res?.kind === 'gold' || res?.kind === 'gems') await fetchSession()
        return res
    }

    /** Open the chest: its Gold goes into the shared balance, and the read after it starts the chest over. Errors are the caller's to show. */
    /** Put the welcome-back card away. A failed dismiss only brings it back on the next page load. */
    function dismissWelcome() {
        const id = welcome.value?.id
        welcome.value = null
        if (!id) return
        dismissedWelcomeId.value = id
        const body: HqAwayDismissRequest = { id }
        $fetch<HqAwayDismissResponse>('/api/hero-quest/away/dismiss', { method: 'POST', body }).catch(() => {})
    }

    async function collectChest() {
        const res = await call<HqChestResponse>('/api/hero-quest/chest/collect', {}, '', { silentErrors: true })
        if (res) setBalance(res.balance)
        return res
    }

    /**
     * Claim an open holiday's gift. Its Gold and Gems move platform balances the response doesn't
     * carry, so the caller reads the session back once the reveal is done, or the header would spoil it.
     */
    async function claimHoliday(holidayId: HolidayId) {
        return call<HqHolidayClaimResponse, HqHolidayClaimRequest>('/api/hero-quest/holiday/claim', { holidayId }, '')
    }

    /**
     * Claim every milestone step waiting on one track. Gems move a platform balance the response
     * doesn't carry, so the session is read back when any were paid.
     */
    async function claimMilestones(track: string) {
        const res = await call<HqMilestonesClaimResponse, HqMilestonesClaimRequest>('/api/hero-quest/milestones/claim', { track }, '')
        if (res?.rewards.some(r => r.kind === 'gems')) await fetchSession()
        return res
    }

    /** Roll every unlocked Trait slot, for the Trait Gems the board's locks price it at. */
    async function rollTraits() {
        return call<HqTraitRollResponse>('/api/hero-quest/trait/roll', {}, '')
    }

    /**
     * One Auto Roll batch. The state is not read back, since a run asks for batch after batch;
     * `refreshTraits` does that once the run is over.
     */
    async function autoRollTraits(minGrade: TraitGrade) {
        return call<HqTraitAutoRollResponse, HqTraitAutoRollRequest>('/api/hero-quest/trait/auto-roll', { minGrade }, '', { refresh: false })
    }

    /** Read the state back after an Auto Roll run. */
    async function refreshTraits() {
        await refresh({ dedupe: 'cancel' })
    }

    /** Lock or unlock a Trait slot: free. */
    async function lockTrait(slotIndex: number, locked: boolean) {
        return call<HqTraitLockResponse, HqTraitLockRequest>('/api/hero-quest/trait/lock', { slotIndex, locked }, '')
    }

    /** Store the live Trait board in a save slot, for Trait Gems. */
    async function saveTraits(saveSlotIndex: number) {
        return call<HqTraitSaveResponse, HqTraitSaveSlotRequest>('/api/hero-quest/trait/save', { saveSlotIndex }, '')
    }

    /** Load a stored Trait board onto the live slots, for Trait Gems. */
    async function loadTraits(saveSlotIndex: number) {
        return call<HqTraitLoadResponse, HqTraitSaveSlotRequest>('/api/hero-quest/trait/load', { saveSlotIndex }, '')
    }

    /** Buy one level of a Passive Skill Tree node, from the Hero's level points. */
    async function buyPassiveNode(nodeId: string) {
        return call<HqTreeBuyResponse, HqTreeBuyRequest>('/api/hero-quest/tree/buy', { nodeId }, '')
    }

    /** Refund the tree. A paid respec moves Gems, which the response doesn't carry, so the session is read back. */
    async function respecPassiveTree() {
        const res = await call<HqTreeRespecResponse>('/api/hero-quest/tree/respec', {}, '')
        if (res && !res.free) await fetchSession()
        return res
    }

    /** Buy the next Trait save slot, a Gems track, so `buyUpgrade` reads the session back. */
    async function buyTraitSaveSlot() {
        return buyUpgrade('traitSaveSlots')
    }

    /** Buy a Battle Speed block. Gems have no setter of their own, so the session is read back. */
    async function buyBattleSpeed(speed: BattleSpeedTier, minutes: BattleSpeedDuration) {
        const res = await call<HqSpeedBuyResponse, HqSpeedBuyRequest>('/api/hero-quest/speed/buy', { speed, minutes }, '')
        await fetchSession()
        return res
    }

    /**
     * The four gachas share one set of actions, taking `system`, exactly as the server routes do.
     *
     * Four copies of each of these is what the shared-gacha design exists to avoid — the rarity
     * ladder, levelling curve, drop table and dupe formula are identical across all four, so the
     * only per-tab difference is which word goes in the body.
     */
    /** Toast is suppressed — the result reel is the feedback, and a 10-pull would stack ten. */
    /**
     * Pull with Seals. `maxGold` lets it buy the Seals it is short off the day's Gold ladder, at no
     * more than that: the price the button showed. Gold then left the shared balance, so the
     * session is read back.
     */
    async function pull(system: GachaSystem, count: 1 | 10 | 100, maxGold?: number) {
        const body: HqPullRequest = maxGold === undefined ? { system, count } : { system, count, autoBuy: { maxGold } }
        const res = await call<HqPullResponse, HqPullRequest>('/api/hero-quest/gacha/pull', body, '')
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
        return call<HqPullResponse, HqPullRequest>('/api/hero-quest/gacha/pull', { system, free: true }, '')
    }

    /** Spend a gacha's Essence on a specific item — the full RNG bypass. */
    async function craft(system: GachaSystem, contentId: string) {
        return call<HqCraftResponse, HqCraftRequest>('/api/hero-quest/gacha/craft', { system, contentId }, '')
    }

    /** Buy Seals with Gold on that gacha's own daily escalating ladder. */
    async function buySeals(system: GachaSystem, count = 1) {
        const res = await call<HqBuySealsResponse, HqBuySealsRequest>('/api/hero-quest/gacha/buy-seals', { system, count }, '')
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
    async function setLoadout(change: HqLoadoutSetRequest, successMsg = 'Loadout updated') {
        return call<HqLoadoutSetResponse, HqLoadoutSetRequest>('/api/hero-quest/loadout/set', change, successMsg)
    }

    /** Snapshot the whole live state into a slot (`loadouts.md` §2). */
    async function saveLoadout(slotIndex: number, name?: string) {
        return call<HqLoadoutSaveResponse, HqLoadoutSaveRequest>('/api/hero-quest/loadout/save', { slotIndex, name }, '')
    }

    /** Apply a saved slot as the new live state — all six components at once. */
    async function applyLoadout(slotIndex: number) {
        return call<HqLoadoutApplyResponse, HqLoadoutSlotRequest>('/api/hero-quest/loadout/apply', { slotIndex }, '')
    }

    /**
     * Point a raid at a saved slot, or with null at none (`loadouts.md` §4). Free; only the
     * pointer moves, so the live loadout changes on the raid's next engage.
     */
    async function setLoadoutPreference(target: LoadoutTarget, slotIndex: number | null) {
        return call<HqLoadoutPreferenceResponse, HqLoadoutPreferenceRequest>('/api/hero-quest/loadout/set-raid-preference', { target, slotIndex }, '')
    }

    /** Leave the raid: the loadout that was live before its first engage goes back, if one was applied. */
    async function leaveRaid() {
        return call<HqRaidLeaveResponse>('/api/hero-quest/raid/leave', {}, '')
    }

    /** Rename a saved slot, leaving what it holds alone. */
    async function renameLoadout(slotIndex: number, name: string) {
        return call<HqLoadoutRenameResponse, HqLoadoutRenameRequest>('/api/hero-quest/loadout/rename', { slotIndex, name }, '')
    }

    /**
     * The playtest harness (`server/utils/hero-quest-dev.ts`) — **development only.**
     *
     * Guarded twice on purpose. `devMode` hides the tab and the page, and the routes themselves
     * 404 outside dev regardless of what the client believes. The client guard is a convenience;
     * the server guard is the security boundary, and neither is trusted to do the other's job.
     */
    const devMode = import.meta.dev

    const dev = {
        /** Settle `hours` as one offline window, or as consecutive presence-length ones. */
        skip: (hours: number, mode: SkipMode) =>
            call<HqDevSkipResponse, HqDevSkipRequest>('/api/hero-quest/dev/skip', { hours, mode }, '').then(async (res) => {
                await fetchSession()
                return res
            }),
        grant: (body: HqDevGrantRequest) =>
            call<unknown, HqDevGrantRequest>('/api/hero-quest/dev/grant', body, 'Granted').then(async (res) => {
                await fetchSession()
                return res
            }),
        unlock: (body: HqDevUnlockRequest) =>
            call<unknown, HqDevUnlockRequest>('/api/hero-quest/dev/unlock', body, 'Collection unlocked'),
        set: (body: HqDevSetRequest) =>
            call<unknown, HqDevSetRequest>('/api/hero-quest/dev/set', body, 'Run moved'),
        reset: () => call<unknown>('/api/hero-quest/dev/reset', {}, 'Hero Quest wiped'),
        /** End the session as an hour away would; the read after it opens on the splash. */
        away: () => call<HqDevAwayResponse>('/api/hero-quest/dev/away', {}, '')
    }

    // The settles bank Gold in the chest, not the shared balance, so the poll leaves the session alone.
    // Not while the splash waits for Start: a tab left on it is away, not present (`useHqSession`).
    // One poll however many components hold the state: the layout and the page both do.
    onMounted(() => {
        if (poll.users++ > 0) return
        poll.timer = setInterval(async () => {
            if (!sessionActive.value) return
            await refresh()
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
        passiveTree,
        arena,
        arenaCandidates,
        arenaLog,
        arenaBoard,
        settings,
        voidShards,
        chestGold,
        collectChest,
        nextPrestigeReward,
        settled,
        welcome,
        dismissWelcome,
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
        autoRollTraits,
        refreshTraits,
        lockTrait,
        saveTraits,
        loadTraits,
        buyTraitSaveSlot,
        buyPassiveNode,
        respecPassiveTree,
        engageRaid,
        quickClearRaid,
        loadArenaCandidates,
        loadArenaLog,
        loadArenaBoard,
        refreshArenaCandidates,
        attackArena,
        buyArenaAttempt,
        setArenaDefense,
        buyArenaItem,
        claimArenaSeason,
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
