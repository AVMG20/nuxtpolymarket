// Shared scaffolding for the slot games: bet + spin-guard + POST to
// /api/games/play-game. Unlike useCasinoGame, the guard cost isn't always
// `bet` (buy-bonus spins cost a multiple of it), so callers pass it in.
// Like useCasinoGame, balance/history are never written here — slots debit
// optimistically before the fetch and settle after the reveal animation,
// both at call sites this composable does not control.

interface SpinResponse<TResult> {
  gameData: TResult
  balance: number
}

// All six slots cap their spin history at 10 rows; no caller needs this
// configurable, so it isn't.
const HISTORY_LIMIT = 10

export function useSlotGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(game: string) {
  const { balanceNum: balance, setBalance } = useAuth()

  const bet = ref(10)
  const isSpinning = ref(false)
  const errorMsg = ref('')
  // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
  const history = ref([]) as Ref<THistory[]>

  function pushHistory(entry: THistory) {
    history.value.unshift(entry)
    if (history.value.length > HISTORY_LIMIT) history.value.pop()
  }

  // onStart fires only once the guard has passed, so the caller can take its
  // optimistic balance debit and reset per-round visual state in the same
  // tick as isSpinning flipping true, not before a blocked click does nothing.
  async function spin(cost: number, options: Record<string, unknown> | undefined, onStart?: () => void): Promise<SpinResponse<TResult> | null> {
    if (isSpinning.value || balance.value < cost) return null
    isSpinning.value = true
    errorMsg.value = ''
    onStart?.()

    try {
      return await $fetch('/api/games/play-game', {
        method: 'POST',
        body: { bet: bet.value, game, options }
      }) as SpinResponse<TResult>
    } catch (e: unknown) {
      isSpinning.value = false
      errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
      return null
    }
  }

  return { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin }
}
