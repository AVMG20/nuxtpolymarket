export const useColony = () => {
  const toast = useToast()

  const { data: state, refresh, pending } = useAsyncData('colony-state', () => apiFetch<import('nitropack/types').InternalApi['/api/colony/state']['get']>('/api/colony/state'), {
    default: () => null
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

  const { fetchSession } = useAuth()

  async function call(url: string, body: Record<string, unknown>, successMsg: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const res = await apiFetch(url, { method: 'POST', body })
      if (successMsg) toast.add({ title: successMsg, color: 'success' })
      await refresh()
      return res
    } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
      throw e
    }
  }

  async function initColony() {
    await apiFetch('/api/colony/init', { method: 'POST' })
    await refresh()
  }

  async function feedSwarm(method: 'coins' | 'gems' = 'coins') {
    const res = await call('/api/colony/feed', { method }, '')
    if (res?.cost) {
      toast.add({
        title: method === 'gems'
          ? `Colony fed with ${formatNumber(res.cost, false)} gems — buffed!`
          : `Colony fed for ${formatNumber(res.cost, false)} coins`,
        color: 'success'
      })
    }
    await fetchSession()
    return res
  }

  async function buyBug(typeId: string) {
    const res = await call('/api/colony/bugs/buy', { typeId }, '')
    if (res) toast.add({ title: `Bug acquired — Speed +${res.speed}% · Yield ${res.yield} · Eats ${res.eat}`, color: 'success' })
    await fetchSession()
    return res
  }

  async function removeBug(bugId: string) {
    const res = await call('/api/colony/bugs/remove', { bugId }, 'Bug released')
    await fetchSession()
    return res
  }

  async function placeBug(typeId: string, speed: number, yield_: number, eat: number) {
    return call('/api/colony/bugs/place', { typeId, speed, yield: yield_, eat }, '')
  }

  async function unplaceBug(bugId: string) {
    return call('/api/colony/bugs/unplace', { bugId }, 'Bug moved to inventory')
  }

  async function sellItem(itemTypeId: string, quantity?: number) {
    const res = await call('/api/colony/market/sell', { itemTypeId, quantity }, '')
    if (res?.coins) toast.add({ title: `Sold for ${formatNumber(res.coins, false)} coins`, color: 'success' })
    await fetchSession()
    return res
  }

  /** Collect all unclaimed loot. Returns { collected: [{itemTypeId,name,emoji,quantity}] } for floating popups. */
  async function collectLoot() {
    return call('/api/colony/loot/collect', {}, '')
  }

  async function startUpgrade(trackId: string) {
    const res = await call('/api/colony/upgrades/start', { trackId }, 'Builder started')
    await fetchSession()
    return res
  }

  async function collectUpgrade(trackId?: string) {
    const res = await call('/api/colony/upgrades/collect', { trackId }, 'Upgrade complete!')
    return res
  }

  async function upgradeHabitatLevel() {
    const res = await call('/api/colony/habitat/upgrade', {}, 'Habitat construction started')
    await fetchSession()
    return res
  }

  async function sacrificeForResearch(typeId: string) {
    const res = await call('/api/colony/research/sacrifice', { typeId }, '')
    if (res) toast.add({ title: `Research complete — Level ${res.level} unlocked`, color: 'success' })
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
    initColony,
    feedSwarm,
    buyBug,
    removeBug,
    placeBug,
    unplaceBug,
    sellItem,
    collectLoot,
    startUpgrade,
    collectUpgrade,
    upgradeHabitatLevel,
    sacrificeForResearch
  }
}
