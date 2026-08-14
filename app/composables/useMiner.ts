/**
 * Shared miner state.
 *
 * Every /miner page and the tab shell read the same `useFetch` key, so one
 * request feeds them all and a `refresh()` from any page updates the HUD too.
 * Pending cash/gems are interpolated locally between fetches — the server only
 * ever stores a timestamp, so the client can derive the same curve.
 */
export async function useMiner() {
  const { data: state, refresh } = await useFetch('/api/miner/state', { key: 'miner-state' })

  const fetchedAt = ref(Date.now())
  const now = ref(Date.now())

  watch(state, () => { fetchedAt.value = Date.now() })

  onMounted(() => {
    const interval = setInterval(() => { now.value = Date.now() }, 1000)
    onUnmounted(() => clearInterval(interval))
  })

  const elapsedDays = computed(() => (now.value - fetchedAt.value) / 86_400_000)

  const displayCash = computed(() => {
    if (!state.value) return 0
    return Math.min(state.value.pendingCash + state.value.income * elapsedDays.value, state.value.cap)
  })

  const displayGems = computed(() => {
    if (!state.value) return 0
    return Math.min(state.value.pendingGems + state.value.rate * elapsedDays.value, state.value.gemCap)
  })

  const collectableGems = computed(() => Math.floor(displayGems.value))

  const cashFill = computed(() => {
    if (!state.value?.cap) return 0
    return Math.min(displayCash.value / state.value.cap, 1)
  })

  const gemFill = computed(() => {
    if (!state.value?.gemCap) return 0
    return Math.min(displayGems.value / state.value.gemCap, 1)
  })

  return { state, refresh, displayCash, displayGems, collectableGems, cashFill, gemFill }
}
