import { avgTickYield, bugStackKey, getBug, getItem, HABITAT_BUILDER_JOB_ID, type ColonyBugStack } from '#shared/utils/colony'

/* eslint-disable @typescript-eslint/no-explicit-any */

// Shared by every useColony() instance: they all read the same 'colony-state'
// payload, so they have to agree on what is still in flight.
let inFlight = 0
let generation = 0
let pendingSeq = 0
// Colony requests go out one at a time, in click order: an unplace and the
// place right after it must reach a full terrarium in that order, and balance
// and gems from the responses must not land older-over-newer.
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(request: () => Promise<T>): Promise<T> {
  const run = queue.then(request, request)
  queue = run.catch(() => {})
  return run
}

/** Placed bugs not yet confirmed by the server carry this id prefix. */
export const PENDING_BUG_PREFIX = 'pending:'

/**
 * Nutrition eaten since `since` (the server clock the state was settled at):
 * food is spent only when a bug's displayed cycle completes.
 */
export function colonyFoodSpent(bugs: any[], since: number, now: number): number {
  const elapsedMs = Math.max(0, now - since)
  return bugs.reduce((sum: number, bug: any) => {
    if (!bug.tickMs || bug.tickMs <= 0) return sum
    const completedCycles = Math.floor((bug.tickProgressMs + elapsedMs) / bug.tickMs)
    const foodPerCycle = Math.round(bug.feedPerHour * bug.tickMs / 3_600_000)
    return sum + completedCycles * foodPerCycle
  }, 0)
}

export interface ColonyOptions {
  /** Leave errors to the caller instead of showing a toast (spreadsheet mode shows them in cells) */
  silent?: boolean
  /** Fetch the state right away (default) or wait for the first refresh() */
  immediate?: boolean
}

export const useColony = (opts: ColonyOptions = {}) => {
  const toast = useToast()

  const { data: state, pending } = useFetch('/api/colony/state', {
    key: 'colony-state',
    default: () => null,
    immediate: opts.immediate ?? true
  })

  const bugs = computed(() => state.value?.bugs ?? [])
  const speciesCatalog = computed(() => state.value?.speciesCatalog ?? [])
  const inventory = computed(() => state.value?.inventory ?? [])
  const bugInventory = computed(() => state.value?.bugInventory ?? [])
  const placedCount = computed(() => state.value?.placedCount ?? 0)
  const pendingLoot = computed(() => state.value?.pendingLoot ?? [])
  const upgrades = computed(() => state.value?.upgrades ?? [])
  const research = computed(() => state.value?.research ?? [])
  const builders = computed(() => state.value?.builders ?? [])
  const builderCount = computed(() => state.value?.builderCount ?? 1)
  const buildersFree = computed(() => Math.max(0, builderCount.value - builders.value.length))
  /** trackIds a builder is already on — those tracks can't be started again. */
  const busyTrackIds = computed(() => new Set(builders.value.map(b => b.trackId)))
  const capacity = computed(() => state.value?.capacity ?? 0)
  const habitatLevel = computed(() => state.value?.habitatLevel ?? 1)
  const maxTier = computed(() => state.value?.maxTier ?? 6)
  const habitatLevelUpCost = computed(() => state.value?.habitatLevelUpCost ?? 0)
  const habitatLevelUpDurationMs = computed(() => state.value?.habitatLevelUpDurationMs ?? 0)
  const habitatLevelUpGemCost = computed(() => state.value?.habitatLevelUpGemCost ?? 0)
  const nutrition = computed(() => state.value?.nutrition ?? 0)
  const nutritionMax = computed(() => state.value?.nutritionMax ?? 100)
  const nutritionDrainPerHour = computed(() => state.value?.nutritionDrainPerHour ?? 0)
  const feedCost = computed(() => state.value?.feedCost ?? 0)
  const gemNutrition = computed(() => state.value?.gemNutrition ?? 0)
  const gemBuffActive = computed(() => state.value?.gemBuffActive ?? false)
  const gemFeedCost = computed(() => state.value?.gemFeedCost ?? 0)
  const gemFeedNutritionPerGem = computed(() => state.value?.gemFeedNutritionPerGem ?? 200)
  const initialized = computed(() => state.value?.initialized ?? false)
  const serverNow = computed(() => state.value?.serverNow ?? Date.now())

  const { user, balanceNum, fetchSession, applyWallet } = useAuth()
  const gems = computed(() => user.value?.gems ?? 0)

  function ownedQty(itemTypeId: string) {
    return inventory.value.find((i: any) => i.id === itemTypeId)?.quantity ?? 0
  }

  // ─── Habitat and track gating, shared by the habitat page and spreadsheet mode ───

  const tracksMeetingRequirement = computed(() => upgrades.value.filter((t: any) => t.meetsHabitatRequirement).length)
  const habitatUpgradeReady = computed(() => tracksMeetingRequirement.value === upgrades.value.length && upgrades.value.length > 0)

  /** Why the habitat can't be dug a level deeper right now, or null when it can. */
  const habitatBlockedReason = computed<string | null>(() => {
    const short = upgrades.value.length - tracksMeetingRequirement.value
    if (!upgrades.value.length) return 'Found your colony first'
    if (busyTrackIds.value.has(HABITAT_BUILDER_JOB_ID)) return 'The dig is under way'
    if (!habitatUpgradeReady.value) return `${short} ${short === 1 ? 'track' : 'tracks'} short`
    if (buildersFree.value === 0) return builderCount.value === 1 ? 'Builder busy' : 'All builders busy'
    const coinsOk = balanceNum.value >= habitatLevelUpCost.value
    const gemsOk = gems.value >= habitatLevelUpGemCost.value
    if (!coinsOk || !gemsOk) return `Not enough ${coinsOk ? 'gems' : 'coins'}`
    return null
  })

  /** Why an upgrade track can't be started right now, or null when it can. */
  function trackBlockedReason(track: { id: string, nextCost: { coins: number, items: { itemTypeId: string, quantity: number }[] } | null }): string | null {
    if (busyTrackIds.value.has(track.id)) return 'Under construction'
    if (buildersFree.value === 0) return builderCount.value === 1 ? 'Builder busy' : 'All builders busy'
    const cost = track.nextCost
    if (!cost) return 'Not enough resources'
    const missing = cost.items.filter(need => ownedQty(need.itemTypeId) < need.quantity).map(need => getItem(need.itemTypeId)?.emoji ?? '?')
    if (balanceNum.value < cost.coins) missing.unshift('coins')
    return missing.length ? `Short on ${missing.join(' ')}` : null
  }

  interface WalletOptions {
    /** Leave the header to the caller: a batch of sells settles it once at the end. */
    settleWallet?: boolean
  }

  type ColonyState = NonNullable<typeof state.value>

  /**
   * Re-read the state from the server, but only once nothing is in flight: an
   * optimistic edit that the server hasn't confirmed yet would otherwise
   * flicker away. A read that started before another edit landed is dropped;
   * that edit's own reconcile brings the fresh state.
   */
  async function refresh() {
    if (inFlight > 0) return
    const gen = generation
    try {
      const fresh = await $fetch('/api/colony/state')
      if (gen === generation && inFlight === 0) state.value = fresh
    } catch { /* the next refresh catches up */ }
  }

  function fail(e: any): never {
    if (!opts.silent) toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
    throw e
  }

  /**
   * Apply `edit` to a copy of the state right away, then send the request. On
   * failure the edit is undone (when nothing else changed the state since) and
   * the server state is reloaded either way.
   */
  async function optimistic<T>(edit: (s: ColonyState) => void, request: () => Promise<T>): Promise<T> {
    const before = state.value
    if (before) {
      const next = structuredClone(toRaw(before)) as ColonyState
      edit(next)
      state.value = next
    }
    const gen = ++generation
    inFlight++
    try {
      return await enqueue(request)
    } catch (e) {
      if (gen === generation) state.value = before
      fail(e)
    } finally {
      inFlight--
      void refresh()
    }
  }

  /** For actions whose outcome only the server knows: send, then reload the state. */
  async function call(url: string, body: Record<string, unknown>): Promise<any> {
    generation++
    inFlight++
    let res: any
    try {
      res = await enqueue(() => $fetch(url, { method: 'POST', body }))
    } catch (e) {
      fail(e)
    } finally {
      inFlight--
    }
    await refresh()
    return res
  }

  async function initColony() {
    await $fetch('/api/colony/init', { method: 'POST' })
    await refresh()
  }

  async function feedSwarm(method: 'coins' | 'gems' = 'coins') {
    const res: any = await optimistic((s) => {
      // Top the tank up to full as of now: the stored figures date from the
      // last settle, and the bugs have kept eating since.
      const spent = colonyFoodSpent(s.bugs, s.serverNow, Date.now())
      const liveGem = Math.max(0, s.gemNutrition - spent)
      const liveCoin = Math.max(0, Math.min(s.nutritionMax, s.nutrition - Math.max(0, spent - s.gemNutrition)))
      const missing = Math.max(0, s.nutritionMax - liveGem - liveCoin)
      if (method === 'gems') {
        s.gemNutrition += missing
        s.gemBuffActive = true
      } else {
        s.nutrition += missing
      }
      s.feedCost = 0
      s.gemFeedCost = 0
    }, () => $fetch('/api/colony/feed', { method: 'POST', body: { method } }))
    applyWallet(res)
    return res
  }

  async function buyBug(typeId: string) {
    const res = await call('/api/colony/bugs/buy', { typeId })
    applyWallet(res)
    return res
  }

  async function removeBug(bugId: string) {
    if (bugId.startsWith(PENDING_BUG_PREFIX)) return
    const res: any = await optimistic((s) => {
      const before = s.bugs.length
      s.bugs = s.bugs.filter((b: any) => b.id !== bugId)
      s.placedCount -= before - s.bugs.length
    }, () => $fetch('/api/colony/bugs/remove', { method: 'POST', body: { bugId } }))
    applyWallet(res)
    return res
  }

  /** Release spare bugs from the inventory: they leave at once and the refund lands with the response. */
  async function releaseBugs(stacks: ColonyBugStack[]) {
    const res: any = await optimistic((s) => {
      for (const pick of stacks) {
        const stack: any = s.bugInventory.find((b: any) => bugStackKey(b) === bugStackKey(pick))
        if (stack) stack.quantity -= Math.min(stack.quantity, pick.quantity)
      }
      s.bugInventory = s.bugInventory.filter((b: any) => b.quantity > 0)
    }, () => $fetch('/api/colony/bugs/release', { method: 'POST', body: { stacks } }))
    applyWallet(res)
    return res
  }

  async function placeBug(typeId: string, speed: number, yield_: number, eat: number) {
    const tempId = `${PENDING_BUG_PREFIX}${++pendingSeq}`
    const res: any = await optimistic((s) => {
      const stack: any = s.bugInventory.find((b: any) =>
        b.typeId === typeId && b.speed === speed && b.yield === yield_ && b.eat === eat)
      if (!stack) return
      stack.quantity--
      if (stack.quantity <= 0) s.bugInventory = s.bugInventory.filter((b: any) => b !== stack)
      s.placedCount++
      // A stand-in until the server's state arrives: the stack's own numbers,
      // without the colony-wide track and social bonuses.
      const rm = stack.resourceMultiplier ?? 1
      const tickMs = stack.baseTickMs * (1 - speed / 100)
      s.bugs = [...s.bugs, {
        id: tempId,
        typeId,
        speed,
        yield: yield_,
        eat,
        name: stack.name,
        emoji: stack.emoji,
        color: stack.color,
        tier: stack.tier,
        social: stack.social,
        sameSpeciesCount: 1,
        socialMultiplier: 1,
        itemTypeId: getBug(typeId)?.itemId ?? '',
        itemEmoji: stack.itemEmoji,
        itemName: stack.itemName,
        itemSellValue: stack.itemSellValue,
        tickMs,
        tickProgressMs: 0,
        itemsPerTickMin: Math.floor(rm),
        itemsPerTickMax: Math.floor((yield_ + 1) * rm),
        itemsPerHour: tickMs > 0 ? (avgTickYield(yield_) * rm / tickMs) * 3_600_000 : 0,
        resourceMultiplier: rm,
        feedPerHour: stack.feedPerHour
      }] as any
    }, () => $fetch('/api/colony/bugs/place', { method: 'POST', body: { typeId, speed, yield: yield_, eat } }))
    applyWallet(res)
    // Give the stand-in its real id straight away, so the terrarium keeps the
    // same bug instead of swapping it for a new one on the next state read.
    if (res?.bugId && state.value) {
      const next = structuredClone(toRaw(state.value)) as ColonyState
      const bug: any = next.bugs.find((b: any) => b.id === tempId)
      if (bug) {
        bug.id = res.bugId
        state.value = next
      }
    }
    return res
  }

  async function unplaceBug(bugId: string) {
    if (bugId.startsWith(PENDING_BUG_PREFIX)) return
    const res: any = await optimistic((s) => {
      const bug: any = s.bugs.find((b: any) => b.id === bugId)
      if (!bug) return
      s.bugs = s.bugs.filter((b: any) => b !== bug)
      s.placedCount--
      const stack: any = s.bugInventory.find((b: any) =>
        b.typeId === bug.typeId && b.speed === bug.speed && b.yield === bug.yield && b.eat === bug.eat)
      if (stack) {
        stack.quantity++
        return
      }
      const type = getBug(bug.typeId)
      s.bugInventory = [...s.bugInventory, {
        typeId: bug.typeId,
        speed: bug.speed,
        yield: bug.yield,
        eat: bug.eat,
        quantity: 1,
        name: bug.name,
        emoji: bug.emoji,
        color: bug.color,
        tier: bug.tier,
        social: bug.social,
        producesGems: type?.producesGems ?? false,
        resourceMultiplier: bug.resourceMultiplier,
        baseTickMs: type?.baseTickMs ?? 0,
        yieldMin: type?.yieldMin ?? 0,
        yieldMax: type?.yieldMax ?? 0,
        eatMin: type?.eatMin ?? 0,
        eatMax: type?.eatMax ?? 0,
        feedPerHour: bug.feedPerHour,
        itemEmoji: bug.itemEmoji,
        itemName: bug.itemName,
        itemSellValue: bug.itemSellValue
      }] as any
    }, () => $fetch('/api/colony/bugs/unplace', { method: 'POST', body: { bugId } }))
    applyWallet(res)
    return res
  }

  async function sellItem(itemTypeId: string, quantity?: number, opts: WalletOptions = {}) {
    const res: any = await optimistic((s) => {
      const item: any = s.inventory.find((i: any) => i.id === itemTypeId)
      if (item) item.quantity = quantity && quantity > 0 ? Math.max(0, item.quantity - quantity) : 0
    }, () => $fetch('/api/colony/market/sell', { method: 'POST', body: { itemTypeId, quantity } }))
    if (opts.settleWallet !== false) applyWallet(res)
    return res
  }

  /** Collect all unclaimed loot. Returns { collected: [{itemTypeId,name,emoji,quantity}] } for floating popups. */
  async function collectLoot() {
    const res: any = await optimistic((s) => {
      for (const loot of s.pendingLoot) {
        const item: any = s.inventory.find((i: any) => i.id === loot.itemTypeId)
        if (item) item.quantity += loot.quantity
      }
      s.pendingLoot = []
    }, () => $fetch('/api/colony/loot/collect', { method: 'POST' }))
    applyWallet(res)
    return res
  }

  async function startUpgrade(trackId: string) {
    const res = await call('/api/colony/upgrades/start', { trackId })
    await fetchSession()
    return res
  }

  async function collectUpgrade(trackId?: string) {
    const res = await call('/api/colony/upgrades/collect', { trackId })
    return res
  }

  async function upgradeHabitatLevel() {
    const res = await call('/api/colony/habitat/upgrade', {})
    await fetchSession()
    return res
  }

  async function sacrificeForResearch(typeId: string) {
    const res = await call('/api/colony/research/sacrifice', { typeId })
    await fetchSession()
    return res
  }

  return {
    state,
    pending,
    refresh,
    initialized,
    serverNow,
    bugs,
    speciesCatalog,
    inventory,
    bugInventory,
    placedCount,
    pendingLoot,
    upgrades,
    research,
    builders,
    builderCount,
    buildersFree,
    busyTrackIds,
    capacity,
    habitatLevel,
    maxTier,
    habitatLevelUpCost,
    habitatLevelUpDurationMs,
    habitatLevelUpGemCost,
    nutrition,
    nutritionMax,
    nutritionDrainPerHour,
    feedCost,
    gemNutrition,
    gemBuffActive,
    gemFeedCost,
    gemFeedNutritionPerGem,
    ownedQty,
    tracksMeetingRequirement,
    habitatUpgradeReady,
    habitatBlockedReason,
    trackBlockedReason,
    initColony,
    feedSwarm,
    buyBug,
    removeBug,
    releaseBugs,
    placeBug,
    unplaceBug,
    sellItem,
    collectLoot,
    startUpgrade,
    collectUpgrade,
    upgradeHabitatLevel,
    sacrificeForResearch,
    fetchSession
  }
}
