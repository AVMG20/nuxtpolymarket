/**
 * Player-side TCG state: daily allowance + bundle window (`/api/tcg/state`)
 * and the live set list (`/api/tcg/sets`). `call()` POSTs an action and then
 * refreshes both plus the session — every purchase moves gems, so the
 * sidebar balance must follow (CLAUDE.md).
 */
export const useTcg = () => {
  const toast = useToast()
  const { fetchSession } = useAuth()

  const { data: state, refresh: refreshState } = useFetch('/api/tcg/state', {
    key: 'tcg-state'
  })
  const { data: setsData, refresh: refreshSets } = useFetch('/api/tcg/sets', {
    key: 'tcg-sets'
  })

  const sets = computed(() => setsData.value?.sets ?? [])
  const prices = computed(() => state.value?.prices ?? setsData.value?.prices ?? null)
  const allowance = computed(() => state.value?.allowance ?? null)
  const bundle = computed(() => state.value?.bundle ?? null)

  function setById(id: string | null | undefined) {
    return id ? sets.value.find(s => s.id === id) ?? null : null
  }

  async function call<T = unknown>(url: string, body?: Record<string, unknown>, successMsg?: string): Promise<T> {
    try {
      const res = await $fetch(url, { method: 'POST', body })
      if (successMsg) toast.add({ title: successMsg, color: 'success' })
      await Promise.all([refreshState(), refreshSets(), fetchSession()])
      return res as T
    } catch (e) {
      toast.add({ title: apiErrorMessage(e, 'Something went wrong'), color: 'error' })
      throw e
    }
  }

  return { state, sets, prices, allowance, bundle, setById, refreshState, refreshSets, call }
}
