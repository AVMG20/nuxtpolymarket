// Shared scaffolding for dice/limbo/wheel: bet + play-guard + POST to
// /api/games/play-game + capped history. Balance/history are applied by the
// page, not here, because each page delays them until its animation finishes.

interface PlayResponse<TResult> {
  gameData: TResult
  balance: number
}

export function useCasinoGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(
  game: string,
  opts?: { historyLimit?: number }
) {
  const { setBalance, balanceNum: balance } = useAuth()
  const historyLimit = opts?.historyLimit ?? 8

  const bet = ref(10)
  const isPlaying = ref(false)
  const isFetching = ref(false)
  const lastBet = ref(0)
  const errorMsg = ref('')
  // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
  const history = ref([]) as Ref<THistory[]>

  function pushHistory(entry: THistory) {
    history.value.unshift(entry)
    if (history.value.length > historyLimit) history.value.pop()
  }

  // onStart fires only once the guard has passed, so page-local state (e.g. lastResult)
  // is reset in the same tick as bet/isPlaying — not before a blocked click does nothing.
  async function play(options: Record<string, unknown>, onStart?: () => void): Promise<PlayResponse<TResult> | null> {
    if (isPlaying.value || balance.value < bet.value) return null
    isPlaying.value = true
    isFetching.value = true
    errorMsg.value = ''
    lastBet.value = bet.value
    onStart?.()

    try {
      const data = await $fetch('/api/games/play-game', {
        method: 'POST',
        body: { bet: bet.value, game, options }
      }) as PlayResponse<TResult>
      isFetching.value = false
      return data
    } catch (e: unknown) {
      isFetching.value = false
      isPlaying.value = false
      errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
      return null
    }
  }

  return { bet, isPlaying, isFetching, lastBet, errorMsg, balance, setBalance, history, pushHistory, play }
}
