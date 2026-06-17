import { PLANT_TYPES, ARTIFACT_TYPES, getPlant } from '#shared/utils/xeno'

export const useXeno = () => {
  const toast = useToast()

  const { data: state, refresh, pending } = useFetch('/api/xeno/state', {
    key: 'xeno-state',
    default: () => null,
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
        const type = getPlant(row.typeId)
        return type ? { ...row, ...type, speed: row.speed, yield: row.yield } : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
  )

  const freeArtifacts = computed(() => state.value?.freeArtifacts ?? [])
  const unlockedTypeIds = computed<string[]>(() => state.value?.unlockedTypeIds ?? [])

  async function call(url: string, body: Record<string, any>, successMsg: string): Promise<any> {
    try {
      const res = await $fetch(url, { method: 'POST', body })
      if (successMsg) toast.add({ title: successMsg, color: 'success' })
      await refresh()
      return res
    } catch (e: any) {
      toast.add({ title: e?.data?.message ?? 'Something went wrong', color: 'error' })
      throw e
    }
  }

  async function initGame() {
    await $fetch('/api/xeno/init', { method: 'POST' })
    await refresh()
  }

  async function unlockGridSlot() {
    return call('/api/xeno/grid/unlock', {}, 'Grid slot unlocked!')
  }

  /** Plant a specific stack (typeId + speed + yield) in a slot */
  async function plantInSlot(slotId: string, typeId: string, speed: number, yield_: number) {
    return call('/api/xeno/grid/plant', { slotId, typeId, speed, yield: yield_ }, '')
  }

  async function harvestSlot(slotId: string) {
    return call('/api/xeno/grid/harvest', { slotId }, '')
  }

  async function removePlant(slotId: string) {
    return call('/api/xeno/grid/remove-plant', { slotId }, 'Plant removed')
  }

  async function attachGridArtifact(slotId: string, artifactId: string) {
    return call('/api/xeno/grid/attach-artifact', { slotId, artifactId }, 'Artifact attached!')
  }

  async function removeGridArtifact(slotId: string) {
    return call('/api/xeno/grid/remove-artifact', { slotId }, 'Artifact removed')
  }

  async function unlockBreederSlot() {
    return call('/api/xeno/breeder/unlock', {}, 'Breeder slot unlocked!')
  }

  async function startBreed(
    slotId: string,
    plant1TypeId: string, plant1Speed: number, plant1Yield: number,
    plant2TypeId: string, plant2Speed: number, plant2Yield: number,
  ) {
    return call('/api/xeno/breeder/start', {
      slotId, plant1TypeId, plant1Speed, plant1Yield, plant2TypeId, plant2Speed, plant2Yield,
    }, 'Breeding started!')
  }

  async function cancelBreed(slotId: string) {
    return call('/api/xeno/breeder/cancel', { slotId }, 'Breed cancelled — plants returned.')
  }

  async function collectBreed(slotId: string) {
    return call('/api/xeno/breeder/collect', { slotId }, '')
  }

  async function attachBreederArtifact(slotId: string, artifactId: string) {
    return call('/api/xeno/breeder/attach-artifact', { slotId, artifactId }, 'Artifact attached!')
  }

  async function removeBreederArtifact(slotId: string) {
    return call('/api/xeno/breeder/remove-artifact', { slotId }, 'Artifact removed')
  }

  const { fetchSession } = useAuth()

  async function sellPlants(typeId: string, speed: number, yield_: number, quantity: number) {
    const res = await call('/api/xeno/market/sell', { typeId, speed, yield: yield_, quantity }, '')
    if (res) toast.add({ title: `Sold ${res.sold} plants for $${formatNumber(res.total, false)}`, color: 'success' })
    await fetchSession()
    return res
  }

  async function buyArtifact(artifactTypeId: string) {
    return call('/api/xeno/artifacts/buy', { artifactTypeId }, 'Artifact crafted!')
  }

  async function buyPlants(typeId: string, quantity: number) {
    const res = await call('/api/xeno/market/buy', { typeId, quantity }, '')
    if (res) toast.add({ title: `Bought ${res.bought} plant(s) for $${formatNumber(res.total, false)}`, color: 'success' })
    await fetchSession()
    return res
  }

  return {
    state,
    refresh,
    pending,
    plantTypes,
    artifactTypes,
    gridSlots,
    breederSlots,
    inventory,
    freeArtifacts,
    unlockedTypeIds,
    initGame,
    unlockGridSlot,
    plantInSlot,
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
    buyArtifact,
  }
}
