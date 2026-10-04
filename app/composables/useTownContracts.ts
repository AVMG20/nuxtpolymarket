// Polytown daily town hall contracts. One shared useAsyncData under the
// 'town-contracts' key, so the panel and any badge in the HUD read the same
// copy. The server rolls the day's contracts on first view and never rerolls.

export interface TownContractView {
    id: string
    slot: number
    resource: string
    name: string
    quantity: number
    /** Coins paid on delivery: twice the floor value. */
    reward: number
    /** What the same goods fetch at the town hall floor. */
    floorValue: number
    delivered: boolean
    /** Settled stock when the contracts were fetched. */
    have: number
}

export interface TownContractsState {
    day: string
    serverNow: number
    /** Epoch ms of the next UTC midnight, when a new set is rolled. */
    resetAt: number
    contracts: TownContractView[]
    /** The day's gem bonus: claimable once every contract is in, claimed by hand. */
    bonus: { gems: number, claimed: boolean, claimable: boolean }
    allDelivered: boolean
}

export interface TownContractDelivery {
    id: string
    resource: string
    quantity: number
    reward: number
    /** This delivery completed the set and the gem bonus is now waiting to be claimed. */
    bonusReady: boolean
    allDelivered: boolean
    balance: string
    gems: number
}

export interface TownContractBonusClaim {
    /** Gems the bonus paid. */
    gems: number
    balance: string
    /** The player's gem total after the bonus. */
    userGems: number
}

/**
 * `inventory`, when given (the town state's live inventory), takes over from
 * the stock the contracts were fetched with, so readiness follows production.
 */
export const useTownContracts = (inventory?: MaybeRefOrGetter<Record<string, number> | undefined>) => {
    const toast = useToast()
    const { user, setBalance } = useAuth()

    const { data, refresh, pending, error } = useAsyncData<TownContractsState | null>(
        'town-contracts',
        () => apiFetch<TownContractsState>('/api/town/contracts'),
        { server: false, default: () => null }
    )

    const serverOffsetMs = ref(0)
    watch(data, (s) => {
        if (s?.serverNow) serverOffsetMs.value = s.serverNow - Date.now()
    }, { immediate: true })

    const contracts = computed(() => data.value?.contracts ?? [])
    const bonus = computed(() => data.value?.bonus ?? { gems: 0, claimed: false, claimable: false })
    const allDelivered = computed(() => data.value?.allDelivered ?? false)
    const resetAt = computed(() => data.value?.resetAt ?? null)
    const deliveredCount = computed(() => contracts.value.filter(c => c.delivered).length)

    function have(c: TownContractView): number {
        const live = toValue(inventory)
        return live ? live[c.resource] ?? 0 : c.have
    }

    /** Undelivered contracts the town has the goods for right now. */
    const readyCount = computed(() => contracts.value.filter(c => !c.delivered && have(c) >= c.quantity).length)

    // Pick up the new day's set the moment the old one expires.
    let resetTimer: ReturnType<typeof setTimeout> | null = null
    watch(resetAt, (at) => {
        if (resetTimer) clearTimeout(resetTimer)
        resetTimer = null
        if (!at || import.meta.server) return
        const wait = at - (Date.now() + serverOffsetMs.value) + 1_500
        // setTimeout overflows past ~24.8 days; a day is the most we ever wait.
        resetTimer = setTimeout(() => { refresh() }, Math.min(Math.max(1_000, wait), 2 ** 31 - 1))
    }, { immediate: true })
    if (getCurrentInstance()) {
        onBeforeUnmount(() => {
            if (resetTimer) clearTimeout(resetTimer)
        })
    }

    const delivering = ref<string | null>(null)

    async function deliver(id: string): Promise<TownContractDelivery | null> {
        if (delivering.value) return null
        delivering.value = id
        try {
            const res = await apiFetch<TownContractDelivery>('/api/town/contracts/deliver', {
                method: 'POST',
                body: { contractId: id }
            })
            setBalance(res.balance)
            if (user.value) user.value.gems = res.gems
            // Stamp it straight away; the refetch below confirms it and the bonus.
            if (data.value) {
                const contracts = data.value.contracts.map(c => c.id === id ? { ...c, delivered: true, have: Math.max(0, c.have - c.quantity) } : c)
                data.value = {
                    ...data.value,
                    contracts,
                    allDelivered: contracts.every(c => c.delivered),
                    bonus: res.bonusReady ? { ...data.value.bonus, claimable: true } : data.value.bonus
                }
            }
            refresh()
            return res
        } catch (e: unknown) {
            toast.add({ title: apiErrorMessage(e, 'Could not deliver that contract'), color: 'error' })
            refresh()
            return null
        } finally {
            delivering.value = null
        }
    }

    const claimingBonus = ref(false)

    async function claimBonus(): Promise<TownContractBonusClaim | null> {
        if (claimingBonus.value) return null
        claimingBonus.value = true
        try {
            const res = await apiFetch<TownContractBonusClaim>('/api/town/contracts/bonus', { method: 'POST', body: {} })
            setBalance(res.balance)
            if (user.value) user.value.gems = res.userGems
            if (data.value) {
                data.value = { ...data.value, bonus: { gems: res.gems, claimed: true, claimable: false } }
            }
            return res
        } catch (e: unknown) {
            toast.add({ title: apiErrorMessage(e, 'Could not claim the bonus'), color: 'error' })
            refresh()
            return null
        } finally {
            claimingBonus.value = false
        }
    }

    function serverNow() {
        return Date.now() + serverOffsetMs.value
    }

    return {
        data,
        pending,
        error,
        refresh,
        contracts,
        bonus,
        allDelivered,
        resetAt,
        deliveredCount,
        readyCount,
        have,
        delivering,
        deliver,
        claimingBonus,
        claimBonus,
        serverNow
    }
}
