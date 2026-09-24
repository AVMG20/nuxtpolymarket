// PolyMasters round flow: bet, balance, autoplay and history around the Pixi
// scene. The server decides every round (shared/utils/gamelogic/polymasters.ts
// via /api/games/play-game) and settles stake and win in one transaction before
// the plane takes off; this store only plays the returned flight back and
// reveals the settled balance once the plane has come down.
import type { InjectionKey } from 'vue'
import {
  PM_MAX_WIN,
  PM_SAFE_LANDING_COST,
  type PmBooster,
  type PmLanding,
  type PolyMastersResult
} from '#shared/utils/gamelogic/polymasters'
import { CASINO_MAX_BET } from '#shared/utils/limits'
import { sfx } from '~/utils/polymasters/audio'
import type { GameScene } from '~/utils/polymasters/scene'

export const PM_MIN_BET = 1
export const PM_MAX_BET = CASINO_MAX_BET
export const PM_SPEEDS = [
  { id: 1, label: 'Slow', mult: 1.09375 },
  { id: 2, label: 'Normal', mult: 1.5625 },
  { id: 3, label: 'Fast', mult: 2.5 },
  { id: 4, label: 'Ultra Turbo', mult: 4.0625 }
]
export const PM_AUTO_OPTIONS = [10, 25, 50, 100]
export const PM_TIERS = ['WIN', 'BIG WIN', 'MEGA WIN', 'EPIC WIN', 'MAX WIN'] as const

const BET_LADDER: number[] = []
for (let e = 0; e <= 11; e++) for (const m of [1, 2, 5]) BET_LADDER.push(m * 10 ** e)

const PREFS_KEY = 'polymasters.prefs.v1'

export type PmCounterKind = 'add' | 'mul' | 'rocket' | 'blocked' | 'booster' | 'start'

export interface PmRoundResult {
  win: number
  cost: number
  mult: number
  landing: PmLanding
  tier: number
}

export interface PmHistoryItem {
  id: number
  mult: number
  win: number
  landing: PmLanding
  safe: boolean
}

interface PmPrefs {
  bet: number
  speed: number
  sfx: boolean
  music: boolean
}

function loadPrefs(): Partial<PmPrefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<PmPrefs>
  } catch {
    return {}
  }
}

function clampBet(v: number) {
  if (!Number.isFinite(v) || v < PM_MIN_BET) return PM_MIN_BET
  return Math.min(PM_MAX_BET, Math.floor(v))
}

function createPolyMastersGame() {
  const { balanceNum: balance, setBalance, fetchSession } = useAuth()
  const prefs = loadPrefs()

  const state = reactive({
    ready: false,
    bet: clampBet(prefs.bet ?? 10),
    speed: PM_SPEEDS.some(s => s.id === prefs.speed) ? prefs.speed! : 2,
    safe: false,
    phase: 'idle' as 'idle' | 'flying' | 'result',
    flightPhase: '',
    /** Bet of the round on screen; the counter is shown in multiples of it. */
    roundBet: 0,
    counter: 0,
    counterUnits: 1,
    pulse: { kind: 'start' as PmCounterKind, value: 0, id: 0 },
    boosters: [] as PmBooster[],
    result: null as PmRoundResult | null,
    history: [] as PmHistoryItem[],
    auto: { active: false, left: 0 },
    sfx: prefs.sfx ?? true,
    music: prefs.music ?? true,
    showRules: false,
    toast: '',
    roundId: 0
  })

  let scene: GameScene | null = null
  let disposed = false
  let toastTimer = 0
  let resultTimer = 0

  const money = (v: number) => formatNumber(v)
  const stake = () => state.bet * (state.safe ? PM_SAFE_LANDING_COST : 1)

  function persist() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ bet: state.bet, speed: state.speed, sfx: state.sfx, music: state.music } satisfies PmPrefs))
    } catch {
      /* storage unavailable */
    }
  }

  function attachScene(s: GameScene) {
    scene = s
    scene.setIdleMoney(money(state.bet))
  }

  const sceneHooks = {
    onCounter(units: number, kind: PmCounterKind, value = 0) {
      state.counterUnits = units
      state.counter = units * state.roundBet
      scene?.setMoney(money(state.counter))
      state.pulse = { kind, value, id: state.pulse.id + 1 }
    },
    onBoosters(active: PmBooster[]) {
      state.boosters = active
    },
    onPhase(p: string) {
      state.flightPhase = p
    }
  }

  function speedMult() {
    return PM_SPEEDS.find(s => s.id === state.speed)?.mult ?? 1
  }

  /** In-game message; also used for errors, since page toasts are hidden in fullscreen. */
  function toast(msg: string) {
    state.toast = msg
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (state.toast = ''), 2600)
  }

  const betLocked = () => state.phase === 'flying' || state.auto.active

  function setBet(v: number) {
    if (betLocked()) return
    state.bet = clampBet(v)
    scene?.setIdleMoney(money(state.bet))
    persist()
  }

  function changeBet(dir: number) {
    if (betLocked()) return
    const next = dir > 0
      ? BET_LADDER.find(v => v > state.bet) ?? PM_MAX_BET
      : [...BET_LADDER].reverse().find(v => v < state.bet) ?? PM_MIN_BET
    setBet(next)
    sfx.click()
  }

  function setSpeed(id: number) {
    state.speed = id
    sfx.click()
    persist()
  }

  function toggleSafe() {
    if (betLocked()) return
    state.safe = !state.safe
    sfx.click()
  }

  function setSfx(on: boolean) {
    state.sfx = on
    sfx.unlock()
    sfx.setSfx(on)
    persist()
  }

  function setMusic(on: boolean) {
    state.music = on
    sfx.unlock()
    sfx.setMusic(on)
    persist()
  }

  function dismissResult() {
    clearTimeout(resultTimer)
    if (state.phase === 'result') {
      state.phase = 'idle'
      state.result = null
    }
  }

  function tierFor(mult: number, costUnits: number): number {
    if (mult >= PM_MAX_WIN) return 4
    const r = mult / costUnits
    return r >= 100 ? 3 : r >= 20 ? 2 : r >= 5 ? 1 : 0
  }

  async function play() {
    if (!scene || !state.ready || state.phase === 'flying' || disposed) return
    sfx.unlock()
    sfx.setSfx(state.sfx)
    sfx.setMusic(state.music)
    dismissResult()

    const bet = state.bet
    const safe = state.safe
    const cost = stake()
    if (cost > balance.value) {
      toast('Not enough coins for this bet')
      stopAuto()
      return
    }

    // Lock the controls before the request so a double click can't send two rounds.
    state.phase = 'flying'
    state.result = null
    const before = balance.value
    setBalance(before - cost)

    let data: { gameData: PolyMastersResult, balance: number }
    try {
      data = await apiFetch<{ gameData: PolyMastersResult, balance: number }>('/api/games/play-game', {
        method: 'POST',
        body: { bet, game: 'polymasters', options: { mode: safe ? 'safe' : 'normal' } }
      })
    } catch (e) {
      if (disposed) return
      setBalance(before)
      state.phase = 'idle'
      toast(apiErrorMessage(e, 'The plane could not take off'))
      stopAuto()
      void fetchSession()
      return
    }
    if (disposed) return

    const result = data.gameData
    const outcome = result.outcome
    state.roundId++
    state.roundBet = bet
    state.counterUnits = 1
    state.counter = bet
    state.pulse = { kind: 'start', value: 0, id: state.pulse.id + 1 }

    await scene.play(outcome, money(bet))
    if (disposed) return

    // The server settled the round before take-off; reveal the balance now the plane is down.
    setBalance(data.balance)
    void fetchSession()
    const tier = result.payout > 0 ? tierFor(outcome.win, outcome.cost) : -1
    state.result = { win: result.payout, cost: result.cost, mult: outcome.win, landing: outcome.landing, tier }
    state.history.unshift({ id: state.roundId, mult: outcome.win, win: result.payout, landing: outcome.landing, safe: outcome.mode === 'safe' })
    if (state.history.length > 30) state.history.length = 30
    state.phase = 'result'
    state.boosters = []
    if (result.payout > 0) {
      sfx.fanfare(tier)
      scene.celebrate(tier)
    }

    const hold = result.payout > 0 ? 2200 + tier * 900 : 1600
    resultTimer = window.setTimeout(() => {
      dismissResult()
      if (!state.auto.active) return
      if (state.auto.left > 0) {
        state.auto.left--
        void play()
      } else {
        stopAuto()
      }
    }, state.auto.active ? hold : hold + 2500)
  }

  function startAuto(rounds: number) {
    state.auto.active = true
    state.auto.left = rounds - 1
    void play()
  }

  function stopAuto() {
    state.auto.active = false
    state.auto.left = 0
  }

  function dispose() {
    disposed = true
    stopAuto()
    clearTimeout(toastTimer)
    clearTimeout(resultTimer)
    scene = null
    sfx.dispose()
  }

  return {
    state,
    balance,
    money,
    stake,
    betLocked,
    attachScene,
    sceneHooks,
    speedMult,
    toast,
    setBet,
    changeBet,
    setSpeed,
    toggleSafe,
    setSfx,
    setMusic,
    dismissResult,
    play,
    startAuto,
    stopAuto,
    dispose
  }
}

export type PolyMastersGame = ReturnType<typeof createPolyMastersGame>

const POLYMASTERS_KEY: InjectionKey<PolyMastersGame> = Symbol('polymasters')

/** Creates the game for the root component and shares it with the HUD. */
export function providePolyMastersGame() {
  const game = createPolyMastersGame()
  provide(POLYMASTERS_KEY, game)
  return game
}

export function usePolyMastersGame() {
  const game = inject(POLYMASTERS_KEY)
  if (!game) throw new Error('usePolyMastersGame() needs providePolyMastersGame() in a parent')
  return game
}
