import { PLANT_TYPES, ARTIFACT_TYPES, getArtifact, getPlant, getPlantDisplay, gridGrowSecs, breedSecs } from '#shared/utils/xeno'

// Optimistic actions are shared by every useXeno() caller on the page. Each one
// bumps the generation when it edits local state; the server state is refetched
// once nothing is in flight, and a refetch is dropped if an edit landed after it
// started, so a stale response never flickers a fresh plant back out.
let inFlight = 0
let generation = 0
// Parallel sells can come back in any order, so only a lone sell trusts the
// balance in its response; a burst refetches the session once it is over.
let sellsInFlight = 0
let sellBurst = false

export interface XenoOptions {
  /** Leave errors to the caller instead of showing a toast (spreadsheet mode shows them in cells) */
  silent?: boolean
  /** Fetch the state right away (default) or wait for the first refresh() */
  immediate?: boolean
}

export const useXeno = (opts: XenoOptions = {}) => {
  const toast = useToast()

  const { data: state, refresh, pending } = useFetch('/api/xeno/state', {
    key: 'xeno-state',
    default: () => null,
    immediate: opts.immediate ?? true,
  })

  const plantTypes = PLANT_TYPES
  const artifactTypes = ARTIFACT_TYPES

  const gridSlots = computed(() => state.value?.grid?.slots ?? [])
  const breederSlots = computed(() => state.value?.breeder?.slots ?? [])

  /**
   * Grouped inventory from state: { typeId, speed, yield, quantity }.
   * Enriched with config data (name, emoji, tier, value, baseTime, description).
   */
  const inventory = computed(() =>
    (state.value?.inventory ?? [])
      .map((row: { typeId: string; speed: number; yield: number; quantity: number }) => {
        const type = getPlantDisplay(row.typeId)
        return type ? { ...row, ...type, speed: row.speed, yield: row.yield } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  )

  const freeArtifacts = computed(() => state.value?.freeArtifacts ?? [])
  const unlockedTypeIds = computed<string[]>(() => state.value?.unlockedTypeIds ?? [])
  const highestTier = computed<number>(() => state.value?.highestTier ?? 0)
  const upgrades = computed(() => state.value?.upgrades ?? { mutation: 0, yield: 0, speed: 0 })
  const hybrids = computed(() => state.value?.hybrids ?? { unlocked: false, unlockTier: 4, tier: 0, costGems: 0, nextTier: 4, nextTierProgress: null })

  const { fetchSession, setBalance } = useAuth()

  type XenoState = NonNullable<typeof state.value>
  type GridSlot = XenoState['grid']['slots'][number]
  type BreederSlot = XenoState['breeder']['slots'][number]

  /**
   * A server-decided action (purchases, unlocks, rolls). It counts as in flight
   * so a reconcile can't land mid-way, and it bumps the generation so a failing
   * optimistic action can't restore a snapshot from before it.
   */
  async function call(url: string, body: Record<string, any> = {}): Promise<any> {
    inFlight++
    try {
      const res = await $fetch(url, { method: 'POST', body })
      generation++
      return res
    } catch (e: any) {
      if (!opts.silent) toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
      throw e
    } finally {
      inFlight--
      await reconcile()
    }
  }

  /** Refetch the authoritative state, unless an optimistic action is still running or started meanwhile. */
  async function reconcile() {
    if (inFlight > 0) return
    const gen = generation
    try {
      const fresh = await $fetch('/api/xeno/state')
      if (gen === generation && inFlight === 0) state.value = fresh
    } catch { /* the next action reconciles */ }
  }

  /**
   * Apply `edit` to a copy of the local state right away, then run `request`.
   * A failure puts the previous state back (when nothing else edited it since)
   * and shows the error; either way the server state is refetched once idle.
   */
  async function optimistic<T>(edit: (s: XenoState) => void, request: () => Promise<T>): Promise<T> {
    const prev = state.value
    let gen = generation
    if (prev) {
      const next = structuredClone(toRaw(prev)) as XenoState
      edit(next)
      state.value = next
      gen = ++generation
    }
    inFlight++
    try {
      return await request()
    } catch (e: any) {
      if (prev && gen === generation) state.value = prev
      if (!opts.silent) toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
      throw e
    } finally {
      inFlight--
      void reconcile()
    }
  }

  function post(url: string, body: Record<string, any>): Promise<any> {
    return $fetch(url, { method: 'POST', body })
  }

  function adjustStack(s: XenoState, typeId: string, speed: number, yield_: number, delta: number) {
    const i = s.inventory.findIndex(r => r.typeId === typeId && r.speed === speed && r.yield === yield_)
    const row = s.inventory[i]
    if (row) {
      row.quantity += delta
      if (row.quantity <= 0) s.inventory.splice(i, 1)
    } else if (delta > 0) {
      s.inventory.push({ typeId, speed, yield: yield_, quantity: delta })
    }
  }

  function stackCount(s: XenoState, typeId: string, speed: number, yield_: number): number {
    return s.inventory.find(r => r.typeId === typeId && r.speed === speed && r.yield === yield_)?.quantity ?? 0
  }

  /** A freshly planted plant as state.get would describe it; the timer is corrected on reconcile. */
  function growingPlant(s: XenoState, slot: GridSlot, typeId: string, speed: number, yield_: number): GridSlot['plant'] {
    const display = getPlantDisplay(typeId)
    if (!display) return null
    const secs = gridGrowSecs({ typeId, speed }, slot.artifact?.typeId, slot.artifact?.gemCrafted, s.upgrades.speed) ?? 0
    const now = Date.now()
    return {
      id: `pending:${slot.id}`,
      typeId,
      speed,
      yield: yield_,
      name: display.name,
      emoji: display.emoji,
      tier: display.tier,
      color: display.color,
      value: display.value,
      isHybrid: display.isHybrid,
      resources: display.resources,
      startedAt: new Date(now).toISOString(),
      completesAt: new Date(now + secs * 1000).toISOString(),
    }
  }

  /** Mirrors the server's void-plant rule so plant-all skips the same slots. */
  function canHost(slot: GridSlot, typeId: string): boolean {
    if (!getPlant(typeId)?.voidPlant) return true
    return (getArtifact(slot.artifact?.typeId ?? '')?.level ?? 0) >= 2
  }

  function findGridSlot(s: XenoState, slotId: string) {
    return s.grid.slots.find(sl => sl.id === slotId)
  }

  function findBreederSlot(s: XenoState, slotId: string) {
    return s.breeder.slots.find(sl => sl.id === slotId)
  }

  function takeFreeArtifact(s: XenoState, artifactId: string) {
    const i = s.freeArtifacts.findIndex(a => a.id === artifactId)
    return i >= 0 ? s.freeArtifacts.splice(i, 1)[0]! : null
  }

  async function initGame() {
    await $fetch('/api/xeno/init', { method: 'POST' })
    await reconcile()
  }

  async function unlockGridSlot() {
    const res = await call('/api/xeno/grid/unlock', {})
    await fetchSession()
    return res
  }

  /** Plant a specific stack (typeId + speed + yield) in a slot */
  async function plantInSlot(slotId: string, typeId: string, speed: number, yield_: number) {
    return optimistic((s) => {
      const slot = findGridSlot(s, slotId)
      if (!slot || slot.plant || stackCount(s, typeId, speed, yield_) < 1) return
      slot.plant = growingPlant(s, slot, typeId, speed, yield_)
      adjustStack(s, typeId, speed, yield_, -1)
    }, () => post('/api/xeno/grid/plant', { slotId, typeId, speed, yield: yield_ }))
  }

  /** Plant a specific stack (typeId + speed + yield) into every empty slot in one request */
  async function plantAllSlots(typeId: string, speed: number, yield_: number) {
    return optimistic((s) => {
      for (const slot of [...s.grid.slots].sort((a, b) => a.slotIndex - b.slotIndex)) {
        if (stackCount(s, typeId, speed, yield_) < 1) break
        if (slot.plant || !canHost(slot, typeId)) continue
        slot.plant = growingPlant(s, slot, typeId, speed, yield_)
        adjustStack(s, typeId, speed, yield_, -1)
      }
    }, () => post('/api/xeno/grid/plant-all', { typeId, speed, yield: yield_ }))
  }

  /**
   * Harvest a slot. The plot clears (or, with `replant`, starts regrowing the
   * same stack) at once; the drops are rolled server-side and arrive with the
   * response. The harvest always returns at least one of the same stack (a
   * hybrid regrows itself), so the replant can go out right after it.
   */
  async function harvestSlot(slotId: string, opts: { replant?: boolean } = {}) {
    let plant: GridSlot['plant'] = null
    return optimistic((s) => {
      const slot = findGridSlot(s, slotId)
      if (!slot?.plant) return
      plant = slot.plant
      slot.plant = opts.replant ? growingPlant(s, slot, plant.typeId, plant.speed, plant.yield) : null
    }, async () => {
      const res = await post('/api/xeno/grid/harvest', { slotId })
      let replanted = false
      if (opts.replant && plant) {
        try {
          await post('/api/xeno/grid/plant', { slotId, typeId: plant.typeId, speed: plant.speed, yield: plant.yield })
          replanted = true
        } catch { /* stack was consumed elsewhere — the reconcile empties the plot */ }
      }
      return { ...res, replanted }
    })
  }

  async function removePlant(slotId: string) {
    return optimistic((s) => {
      const slot = findGridSlot(s, slotId)
      if (!slot?.plant) return
      adjustStack(s, slot.plant.typeId, slot.plant.speed, slot.plant.yield, 1)
      slot.plant = null
    }, () => post('/api/xeno/grid/remove-plant', { slotId }))
  }

  async function attachGridArtifact(slotId: string, artifactId: string) {
    return optimistic((s) => {
      const slot = findGridSlot(s, slotId)
      if (!slot) return
      const art = takeFreeArtifact(s, artifactId)
      if (!art) return
      if (slot.artifact) s.freeArtifacts.push(slot.artifact)
      slot.artifact = art
    }, () => post('/api/xeno/grid/attach-artifact', { slotId, artifactId }))
  }

  async function removeGridArtifact(slotId: string) {
    return optimistic((s) => {
      const slot = findGridSlot(s, slotId)
      if (!slot?.artifact) return
      s.freeArtifacts.push(slot.artifact)
      slot.artifact = null
    }, () => post('/api/xeno/grid/remove-artifact', { slotId }))
  }

  async function unlockBreederSlot() {
    const res = await call('/api/xeno/breeder/unlock', {})
    await fetchSession()
    return res
  }

  function clearBreeder(slot: BreederSlot, collected: boolean) {
    Object.assign(slot, {
      parent1: null, parent2: null, startedAt: null, completesAt: null,
      resultTypeId: null, resultSpeed: null, resultYield: null, resultQuantity: null, wasMutation: null,
      collected,
    })
  }

  async function startBreed(
    slotId: string,
    plant1TypeId: string, plant1Speed: number, plant1Yield: number,
    plant2TypeId: string, plant2Speed: number, plant2Yield: number,
  ) {
    return optimistic((s) => {
      const slot = findBreederSlot(s, slotId)
      if (!slot || (slot.startedAt && !slot.collected)) return
      const sameStack = plant1TypeId === plant2TypeId && plant1Speed === plant2Speed && plant1Yield === plant2Yield
      if (sameStack ? stackCount(s, plant1TypeId, plant1Speed, plant1Yield) < 2
        : stackCount(s, plant1TypeId, plant1Speed, plant1Yield) < 1 || stackCount(s, plant2TypeId, plant2Speed, plant2Yield) < 1) return
      const secs = breedSecs({ typeId: plant1TypeId }, { typeId: plant2TypeId }, slot.artifact?.typeId, slot.artifact?.gemCrafted, s.upgrades.speed) ?? 0
      const now = Date.now()
      clearBreeder(slot, false)
      Object.assign(slot, {
        parent1: { typeId: plant1TypeId, speed: plant1Speed, yield: plant1Yield },
        parent2: { typeId: plant2TypeId, speed: plant2Speed, yield: plant2Yield },
        startedAt: new Date(now).toISOString(),
        completesAt: new Date(now + secs * 1000).toISOString(),
      })
      adjustStack(s, plant1TypeId, plant1Speed, plant1Yield, -1)
      adjustStack(s, plant2TypeId, plant2Speed, plant2Yield, -1)
    }, () => post('/api/xeno/breeder/start', {
      slotId, plant1TypeId, plant1Speed, plant1Yield, plant2TypeId, plant2Speed, plant2Yield,
    }))
  }

  async function cancelBreed(slotId: string) {
    return optimistic((s) => {
      const slot = findBreederSlot(s, slotId)
      if (!slot?.startedAt || slot.collected) return
      for (const p of [slot.parent1, slot.parent2]) {
        if (p) adjustStack(s, p.typeId, p.speed ?? 0, p.yield ?? 0, 1)
      }
      clearBreeder(slot, false)
    }, () => post('/api/xeno/breeder/cancel', { slotId }))
  }

  async function collectBreed(slotId: string) {
    return optimistic((s) => {
      const slot = findBreederSlot(s, slotId)
      // The result only reaches the client once the breed is done.
      if (!slot?.resultTypeId || slot.resultSpeed == null || slot.resultYield == null) return
      adjustStack(s, slot.resultTypeId, slot.resultSpeed, slot.resultYield, slot.resultQuantity ?? 1)
      clearBreeder(slot, true)
    }, () => post('/api/xeno/breeder/collect', { slotId }))
  }

  async function attachBreederArtifact(slotId: string, artifactId: string) {
    return optimistic((s) => {
      const slot = findBreederSlot(s, slotId)
      if (!slot || slot.artifact || (slot.startedAt && !slot.collected)) return
      slot.artifact = takeFreeArtifact(s, artifactId)
    }, () => post('/api/xeno/breeder/attach-artifact', { slotId, artifactId }))
  }

  async function removeBreederArtifact(slotId: string) {
    return optimistic((s) => {
      const slot = findBreederSlot(s, slotId)
      if (!slot?.artifact || (slot.startedAt && !slot.collected)) return
      s.freeArtifacts.push(slot.artifact)
      slot.artifact = null
    }, () => post('/api/xeno/breeder/remove-artifact', { slotId }))
  }

  /**
   * Sell part of a stack. The stack shrinks at once; the coins land with the
   * response. Parallel sells settle their responses in any order, so a batch
   * passes `settleBalance: false` and fetches the session once at the end.
   */
  async function sellPlants(typeId: string, speed: number, yield_: number, quantity: number, opts: { settleBalance?: boolean } = {}) {
    const settle = opts.settleBalance !== false
    if (settle && ++sellsInFlight > 1) sellBurst = true
    let res: any = null
    try {
      res = await optimistic(
        s => adjustStack(s, typeId, speed, yield_, -Math.min(quantity, stackCount(s, typeId, speed, yield_))),
        () => post('/api/xeno/market/sell', { typeId, speed, yield: yield_, quantity }),
      )
      return res
    } finally {
      if (settle && --sellsInFlight === 0) {
        if (sellBurst) void fetchSession()
        else if (res) void setBalance(res.balance)
        sellBurst = false
      }
    }
  }

  async function deleteArtifacts(artifactIds: string[]) {
    const ids = new Set(artifactIds)
    return optimistic(
      (s) => { s.freeArtifacts = s.freeArtifacts.filter(a => !ids.has(a.id)) },
      () => post('/api/xeno/artifacts/delete', { artifactIds }),
    )
  }

  async function buyArtifact(artifactTypeId: string, gemCrafted = false, quantity = 1) {
    const res = await call('/api/xeno/artifacts/buy', { artifactTypeId, gemCrafted, quantity })
    await fetchSession()
    return res
  }

  async function buyPlants(typeId: string, quantity: number) {
    const res = await call('/api/xeno/market/buy', { typeId, quantity })
    await fetchSession()
    return res
  }

  async function rollHybrid() {
    const res = await call('/api/xeno/market/roll-hybrid')
    await fetchSession()
    return res
  }

  async function buyUpgrade(upgradeId: 'mutation' | 'yield' | 'speed') {
    const res = await call('/api/xeno/upgrades/buy', { upgradeId })
    await fetchSession()
    return res
  }

  return {
    state,
    refresh,
    reconcile,
    pending,
    plantTypes,
    artifactTypes,
    gridSlots,
    breederSlots,
    inventory,
    freeArtifacts,
    unlockedTypeIds,
    highestTier,
    upgrades,
    hybrids,
    canHost,
    initGame,
    unlockGridSlot,
    plantInSlot,
    plantAllSlots,
    harvestSlot,
    removePlant,
    attachGridArtifact,
    removeGridArtifact,
    unlockBreederSlot,
    startBreed,
    cancelBreed,
    collectBreed,
    attachBreederArtifact,
    removeBreederArtifact,
    sellPlants,
    buyPlants,
    rollHybrid,
    buyArtifact,
    deleteArtifacts,
    buyUpgrade,
    fetchSession,
  }
}
