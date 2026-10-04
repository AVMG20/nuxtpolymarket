// Polytown Mayor streak: the 30-day login track. One shared useAsyncData under
// the 'town-streak' key, so the panel and any HUD badge read the same copy.
// Fetching it is what unlocks today's step, so the first fetch of the day is
// the only one that reports `advancedToday`.

import type { TownBoostBag } from '#shared/utils/gamelogic/town-boosts'
import type { TownStreakExtra, TownStreakPreview, TownStreakReward, TownStreakStatus } from '#shared/utils/gamelogic/town-streak'

export type { TownStreakExtra, TownStreakPreview, TownStreakReward, TownStreakStatus }

export interface TownStreakState {
    initialized: true
    /** Today's UTC day key. */
    day: string
    /** Steps unlocked in this run, 0..30. */
    step: number
    status: TownStreakStatus
    /** Runs reset so far. */
    cycle: number
    claimedSteps: number[]
    claimableSteps: number[]
    canReset: boolean
    /** True only on the response that unlocked today's step. */
    advancedToday: boolean
    /** Lucky charges waiting: the next chest opened is one tier better. */
    lucky: number
    serverNow: number
    /** Epoch ms of the next UTC midnight, when the next step unlocks. */
    nextDayAt: number
    track: TownStreakPreview[]
}

export type TownStreakResponse = TownStreakState | { initialized: false }

export interface TownStreakTotals {
    coins: number
    gems: number
    resources: Record<string, number>
    boosts?: TownBoostBag
    extras?: TownStreakExtra[]
}

export interface TownStreakClaimResult {
    step: number
    reward: TownStreakReward
    balance: string
    gems: number
}

export interface TownStreakResetResult {
    paid: TownStreakReward[]
    total: TownStreakTotals
    balance: string
    gems: number
}

export const useTownStreak = () => {
    const toast = useToast()
    const { user, setBalance } = useAuth()

    const { data, refresh, pending, error } = useAsyncData<TownStreakResponse | null>(
        'town-streak',
        () => apiFetch<TownStreakResponse>('/api/town/streak'),
        // Every fetch can unlock the day, and only that response says so: a
        // second caller (the panel mounting, a second midnight timer) joins
        // the request in flight rather than cancelling it and losing the news.
        { server: false, default: () => null, dedupe: 'defer' }
    )

    const streak = computed<TownStreakState | null>(() => data.value?.initialized ? data.value : null)
    const initialized = computed(() => data.value?.initialized ?? false)

    const serverOffsetMs = ref(0)
    watch(data, (s) => {
        if (s?.initialized) serverOffsetMs.value = s.serverNow - Date.now()
    }, { immediate: true })

    const step = computed(() => streak.value?.step ?? 0)
    const status = computed<TownStreakStatus>(() => streak.value?.status ?? 'active')
    const track = computed(() => streak.value?.track ?? [])
    const claimedSteps = computed(() => new Set(streak.value?.claimedSteps ?? []))
    const claimableSteps = computed(() => new Set(streak.value?.claimableSteps ?? []))
    const claimableCount = computed(() => streak.value?.claimableSteps.length ?? 0)
    const advancedToday = computed(() => streak.value?.advancedToday ?? false)
    const canReset = computed(() => streak.value?.canReset ?? false)
    const nextDayAt = computed(() => streak.value?.nextDayAt ?? null)
    const lucky = computed(() => streak.value?.lucky ?? 0)

    function serverNow() {
        return Date.now() + serverOffsetMs.value
    }

    // Opening the town at midnight should unlock the new day without a reload.
    let dayTimer: ReturnType<typeof setTimeout> | null = null
    watch(nextDayAt, (at) => {
        if (dayTimer) clearTimeout(dayTimer)
        dayTimer = null
        if (!at || import.meta.server) return
        const wait = at - serverNow() + 1_500
        dayTimer = setTimeout(() => { refresh() }, Math.min(Math.max(1_000, wait), 2 ** 31 - 1))
    }, { immediate: true })
    if (getCurrentInstance()) {
        onBeforeUnmount(() => {
            if (dayTimer) clearTimeout(dayTimer)
        })
    }

    /** Push a claim or reset's wallet into the session, once its reveal is done. */
    function applyWallet(res: { balance: string, gems: number }) {
        setBalance(res.balance)
        if (user.value) user.value.gems = res.gems
    }

    const claiming = ref<number | null>(null)
    const resetting = ref(false)

    /**
     * Claim one unlocked step. Pass `deferWallet` to hold the new balance back
     * until an animation has revealed the reward, then call `applyWallet`.
     */
    async function claim(stepNo: number, opts: { deferWallet?: boolean } = {}): Promise<TownStreakClaimResult | null> {
        if (claiming.value !== null || resetting.value) return null
        claiming.value = stepNo
        try {
            const res = await apiFetch<TownStreakClaimResult>('/api/town/streak/claim', {
                method: 'POST',
                body: { step: stepNo }
            })
            if (!opts.deferWallet) applyWallet(res)
            if (data.value?.initialized) {
                data.value = {
                    ...data.value,
                    claimedSteps: [...data.value.claimedSteps, stepNo].sort((a, b) => a - b),
                    claimableSteps: data.value.claimableSteps.filter(s => s !== stepNo),
                    // A chest may spend a lucky charge, and a lucky extra adds one.
                    lucky: Math.max(0, data.value.lucky
                        - (res.reward.upgradedFrom ? 1 : 0)
                        + (res.reward.extras ?? []).filter(e => e.kind === 'lucky').length)
                }
            }
            return res
        } catch (e: unknown) {
            toast.add({ title: apiErrorMessage(e, 'Could not claim that day'), color: 'error' })
            refresh()
            return null
        } finally {
            claiming.value = null
        }
    }

    /** Collect everything unclaimed and start a new run at day 1. Only for a broken or finished track. */
    async function reset(opts: { deferWallet?: boolean } = {}): Promise<TownStreakResetResult | null> {
        if (resetting.value || claiming.value !== null) return null
        resetting.value = true
        try {
            const res = await apiFetch<TownStreakResetResult>('/api/town/streak/reset', { method: 'POST' })
            if (!opts.deferWallet) applyWallet(res)
            await refresh()
            return res
        } catch (e: unknown) {
            toast.add({ title: apiErrorMessage(e, 'Could not reset the streak'), color: 'error' })
            refresh()
            return null
        } finally {
            resetting.value = false
        }
    }

    return {
        data,
        pending,
        error,
        refresh,
        streak,
        initialized,
        step,
        status,
        track,
        claimedSteps,
        claimableSteps,
        claimableCount,
        advancedToday,
        canReset,
        nextDayAt,
        lucky,
        serverNow,
        claiming,
        resetting,
        claim,
        reset,
        applyWallet
    }
}
