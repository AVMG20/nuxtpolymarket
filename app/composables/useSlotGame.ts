// Shared scaffolding for the slot games: bet + spin-guard + POST to
// /api/games/play-game. Unlike useCasinoGame, the guard cost isn't always
// `bet` (buy-bonus spins cost a multiple of it), so callers pass it in.
// Like useCasinoGame, balance/history are normally written by the caller —
// slots debit optimistically before the fetch and settle with the response's
// balance after the reveal animation. Never fetchSession() per spin: the
// response already carries the balance, and hammering get-session logs the
// player out. The one exception is unmounting mid-spin: the reveal never
// finishes, so the pending balance is applied here instead.

interface SpinResponse<TResult> {
  gameData: TResult
  balance: number
}

// All six slots cap their spin history at 10 rows; no caller needs this
// configurable, so it isn't.
const HISTORY_LIMIT = 10

export function useSlotGame<TResult, THistory extends Record<string, unknown> = Record<string, unknown>>(game: string) {
  const { balanceNum: balance, setBalance: writeBalance } = useAuth()

  const bet = ref(10)
  const isSpinning = ref(false)
  const errorMsg = ref('')
  // ref() would unwrap THistory into UnwrapRefSimple and reject the entries pushed below.
  const history = ref([]) as Ref<THistory[]>

  // Server balance from a spin whose reveal hasn't settled yet. Any caller
  // write (the settle after the animation) clears it.
  let pendingBalance: number | null = null
  let disposed = false

  function setBalance(value: number | string) {
    pendingBalance = null
    return writeBalance(value)
  }

  onScopeDispose(() => {
    disposed = true
    if (pendingBalance !== null) void writeBalance(pendingBalance)
    pendingBalance = null
  })

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
      const data = await $fetch('/api/games/play-game', {
        method: 'POST',
        body: { bet: bet.value, game, options }
      }) as SpinResponse<TResult>
      if (disposed) void writeBalance(data.balance)
      else pendingBalance = data.balance
      return data
    } catch (e: unknown) {
      isSpinning.value = false
      errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
      return null
    }
  }

  return { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin }
}
