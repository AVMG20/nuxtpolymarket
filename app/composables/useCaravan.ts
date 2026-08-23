import { generateWorld } from '#shared/utils/caravan/world'
import { nextEventAt } from '#shared/utils/caravan/sim'
import { bonusesFor } from '#shared/utils/caravan/progression'
import { generateMarket, marketRefreshAt } from '#shared/utils/caravan/market'
import type { CaravanState, Item, SimEvent, World } from '#shared/utils/caravan/types'

export interface CraftResult {
    items: Item[]
    /** The best roll of the batch. */
    item: Item
    salvagedCount: number
    salvagedShards: number
}

interface CaravanResponse {
    state: CaravanState
    events: SimEvent[]
    truncated: boolean
    serverTime: number
}

/**
 * Client half of the caravan game.
 *
 * The server owns every number. The client owns the clock and the pixels: it
 * knows when each worker started travelling and when it will arrive, so it can
 * animate the whole map from a single state snapshot without asking for
 * anything. When the snapshot's soonest deadline passes, it asks once for a
 * fresh one. No polling loop, no cron -- the schedule is derived from the state.
 */
export function useCaravan() {
    const state = useState<CaravanState | null>('caravan-state', () => null)
    const events = useState<SimEvent[]>('caravan-events', () => [])
    const loading = useState('caravan-loading', () => false)
    const truncated = useState('caravan-truncated', () => false)
    /** serverTime - Date.now(), so activity timestamps line up with our clock. */
    const clockSkew = useState('caravan-skew', () => 0)

    const world = shallowRef<World>(generateWorld())
    const nodeById = computed(() => new Map(world.value.nodes.map(n => [n.id, n])))
    const edgeById = computed(() => new Map(world.value.edges.map(e => [e.id, e])))

    const { fetchSession } = useAuth()
    const toast = useToast()
    const sound = useCaravanSound()

    let timer: ReturnType<typeof setTimeout> | null = null

    const serverNow = () => Date.now() + clockSkew.value

    function apply(res: CaravanResponse) {
        state.value = res.state
        events.value = res.events
        truncated.value = res.truncated
        clockSkew.value = res.serverTime - Date.now()
        // Each response carries only the events from the stretch of time it just
        // simulated, so replaying them here can never double up.
        for (const event of res.events) {
            if (event.kind === 'camp-cleared') sound.victory()
            else if (event.kind === 'camp-failed') sound.defeat()
            else if (event.kind === 'levelup') sound.levelUp()
        }
        schedule()
    }

    /**
     * Ask again exactly when the next worker finishes something. The floor keeps
     * a big caravan from firing a request every few hundred milliseconds; the
     * ceiling keeps a fully idle caravan honest about depletion regrowth.
     */
    function schedule() {
        if (timer) clearTimeout(timer)
        if (!import.meta.client || !state.value) return
        const next = nextEventAt(state.value)
        const delay = next === null
            ? 60_000
            : Math.min(60_000, Math.max(2_000, next - serverNow() + 250))
        timer = setTimeout(() => { void sync() }, delay)
    }

    async function sync() {
        if (!import.meta.client) return
        try {
            apply(await $fetch<CaravanResponse>('/api/caravan/sync', { method: 'POST' }))
            await fetchSession()
        } catch {
            // A failed sync is not worth a toast -- try again on the next beat.
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => { void sync() }, 10_000)
        }
    }

    async function load() {
        loading.value = true
        try {
            apply(await $fetch<CaravanResponse>('/api/caravan/state'))
            await fetchSession()
        } finally {
            loading.value = false
        }
    }

    /** Fire an action, fold the returned state in, and surface failures. */
    async function act<T extends CaravanResponse>(path: string, body?: Record<string, unknown>): Promise<T | null> {
        try {
            const res = await $fetch<T>(`/api/caravan/${path}`, { method: 'POST', body }) as T
            apply(res)
            await fetchSession()
            return res
        } catch (error) {
            const message = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
            toast.add({ title: message ?? 'That did not work', color: 'error', icon: 'i-lucide-triangle-alert' })
            return null
        }
    }

    onScopeDispose(() => {
        if (timer) clearTimeout(timer)
    })

    const bonuses = computed(() => (state.value ? bonusesFor(state.value) : null))

    /**
     * The recruitment slate. Derived on the client from the same seed and window
     * the server uses, so it renders instantly and always matches what a hire
     * will actually produce.
     */
    const market = computed(() => {
        if (!state.value || !bonuses.value) return []
        return generateMarket(state.value, bonuses.value, serverNow())
    })

    const marketRefreshAtMs = computed(() => marketRefreshAt(serverNow()))
    const ownedNodes = computed(() => new Set(state.value?.ownedNodes ?? []))
    const clearedCamps = computed(() => new Set(state.value?.clearedCamps ?? []))

    return {
        state,
        events,
        loading,
        truncated,
        world,
        nodeById,
        edgeById,
        bonuses,
        market,
        marketRefreshAtMs,
        ownedNodes,
        clearedCamps,
        serverNow,
        load,
        sync,
        act,

        sound,

        purchaseNode: async (nodeId: number) => {
            const res = await act('node/purchase', { nodeId })
            if (res) sound.claim()
            return res
        },
        upgradeRoad: async (edgeId: string) => {
            const res = await act('node/road', { edgeId })
            if (res) sound.claim()
            return res
        },
        assignWorkers: async (workerIds: string[], nodeId: number | null) => {
            const res = await act('worker/assign', { workerIds, nodeId })
            if (res) sound.tick()
            return res
        },
        fillNode: async (nodeId: number) => {
            const res = await act<CaravanResponse & { moved: number }>('node/fill', { nodeId })
            if (res) {
                sound.tick()
                toast.add({
                    title: `Posted ${res.moved} ${res.moved === 1 ? 'worker' : 'workers'} to the seam`,
                    icon: 'i-lucide-user-plus',
                    color: 'success'
                })
            }
            return res
        },
        recallNode: (nodeId: number) => act('node/recall', { nodeId }),
        upgradeCapacity: async (nodeId: number) => {
            const res = await act('node/capacity', { nodeId })
            if (res) sound.claim()
            return res
        },
        hireRecruit: async (slot: number) => {
            const res = await act('market/hire', { slot })
            if (res) sound.claim()
            return res
        },
        refreshMarket: () => act('market/refresh'),
        sellResources: async (sales: Record<string, number>) => {
            const res = await act<CaravanResponse & { earned: number }>('market/sell', { sales })
            if (res) {
                sound.claim()
                toast.add({
                    title: `Sold for ${formatNumber(res.earned)}`,
                    icon: 'i-lucide-coins',
                    color: 'success'
                })
            }
            return res
        },
        renameWorker: (workerId: string, name: string) => act('worker/rename', { workerId, name }),
        autoEquip: async () => {
            const res = await act<CaravanResponse & { changed: number }>('worker/auto-equip')
            if (res) {
                sound.tick()
                toast.add({
                    title: res.changed ? `Refitted ${res.changed} slot${res.changed === 1 ? '' : 's'}` : 'Everyone already has the best gear',
                    icon: 'i-lucide-shield-check',
                    color: res.changed ? 'success' : 'neutral'
                })
            }
            return res
        },
        setPolicy: (policy: Partial<{ autoRefine: boolean, autoSalvageBelow: string | null }>) =>
            act('policy', policy),
        equipItem: (workerId: string, slot: string, itemId: string | null) => act('worker/equip', { workerId, slot, itemId }),
        dismissWorker: (workerId: string) => act('worker/dismiss', { workerId }),
        refine: async (recipeId: string, batches: number) => {
            const res = await act('refine', { recipeId, batches })
            if (res) sound.tick()
            return res
        },
        cancelRefine: async (jobId: string | null, all = false) => {
            const res = await act<CaravanResponse & { refunded: number }>('refine/cancel', { jobId, all })
            if (res) sound.tick()
            return res
        },
        research: async (id: string) => {
            const res = await act('research', { id })
            if (res) sound.claim()
            return res
        },
        cancelResearch: async () => {
            const res = await act<CaravanResponse & { refunded: number }>('research/cancel')
            if (res) sound.tick()
            return res
        },
        advanceTier: async () => {
            const res = await act('tier')
            if (res) sound.ascend()
            return res
        },
        assault: async (nodeId: number, workerIds: string[]) => {
            const res = await act('assault', { nodeId, workerIds })
            if (res) sound.assault()
            return res
        },
        craft: async (tier: number, baseId?: string, guarantee?: string, count = 1) => {
            const res = await act<CaravanResponse & CraftResult>('workshop/craft', { tier, baseId, guarantee, count })
            // The cue plays for the best roll of the batch, so a legendary in a
            // stack of ten still announces itself.
            if (res?.item) sound.craft(res.item.rarity)
            if (res?.salvagedCount) {
                toast.add({
                    title: `${res.salvagedCount} auto-salvaged for ${res.salvagedShards} shards`,
                    icon: 'i-lucide-recycle',
                    color: 'neutral'
                })
            }
            return res
        },
        salvage: (itemIds: string[]) => act('workshop/salvage', { itemIds }),
        reroll: (itemId: string, keepBest = false) => act('workshop/reroll', { itemId, keepBest }),
        buyShards: async (gems: number) => {
            const res = await act<CaravanResponse & { shards: number }>('workshop/shards', { gems })
            if (res) {
                sound.tick()
                toast.add({ title: `+${formatNumber(res.shards)} shards`, icon: 'i-lucide-gem', color: 'success' })
            }
            return res
        },
        reforgeItem: async (itemId: string) => {
            const res = await act<CaravanResponse & { item: Item, outcome: string }>('workshop/reforge', { itemId })
            if (!res) return res
            const message: Record<string, string> = {
                nothing: 'The reforge changed nothing',
                reroll: 'Every value rerolled',
                gain: 'It gained an affix',
                lose: 'It lost an affix'
            }
            toast.add({
                title: message[res.outcome] ?? 'Reforged',
                icon: res.outcome === 'lose' ? 'i-lucide-heart-crack' : 'i-lucide-flame',
                color: res.outcome === 'gain' ? 'success' : res.outcome === 'lose' ? 'error' : 'neutral'
            })
            if (res.outcome === 'gain') sound.victory()
            else if (res.outcome === 'lose') sound.defeat()
            else sound.tick()
            return res
        },
        buyCharter: () => act('gems/charter'),
        buyDeed: () => act('gems/deed')
    }
}
