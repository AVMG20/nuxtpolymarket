<script lang="ts" setup>
import type { Cell, LineWin, SpinataResult, SpinPaySymbol, SpinSymbol } from '#shared/utils/gamelogic/spinata'
import {
  BONUS_PAY,
  PAYLINES,
  SCATTER_PAY,
  SPN_BONUS_TRIGGER,
  SPN_BUY_BONUS_COST,
  SPN_COLS,
  SPN_FREE_SPINS,
  SPN_LINES,
  SPN_ROWS,
  SPN_SCATTER_TRIGGER,
  SPN_TRACK_CAP,
  SPN_TRACK_START
} from '#shared/utils/gamelogic/spinata'
import { SPN_APP_H, SPN_APP_W, SPN_LINE_COLORS, SPN_PAD, SpinataScene, spinataCellCenter } from '~/utils/slots/spinata-scene'
import type { SpinataSampleName } from '~/utils/spinata-sounds'
import type { SpinataSoundHandle } from '~/composables/spinata-sound'
import SpinataAutoSpin from '~/components/games/spinata/SpinataAutoSpin.vue'
import type { SpinataAutoSpinSettings } from '~/components/games/spinata/SpinataAutoSpin.vue'
import SpinataBigWin from '~/components/games/spinata/SpinataBigWin.vue'
import SpinataConfetti from '~/components/games/spinata/SpinataConfetti.vue'
import SpinataInfo from '~/components/games/spinata/SpinataInfo.vue'

// Display figures. The max win is the realistic ceiling from a 10M-spin
// Monte Carlo run (scripts/spinata-rtp.ts); the hard cap is SPN_MAX_WIN_MULT.
const SPN_RTP = 98
const SPN_DISPLAY_MAX_WIN = 1000
const SPN_VOLATILITY = 2
/** Wins from this many times the bet get the big win celebration. */
const BIG_WIN_MULT = 15

const { bet, isSpinning, errorMsg, balance, setBalance, history, pushHistory, spin: requestSpin } = useSlotGame<SpinataResult, { payout: number, bet: number, bonus: boolean }>('spinata')
const sound = useSpinataSound()
const { muted, sfxVolume, musicVolume } = sound

// --- bet ladder --------------------------------------------------------------
const MIN_BET = 1
const MAX_BET = 100_000_000_000
const BET_STEPS = (() => {
  const steps: number[] = []
  for (let e = 0; e <= 11; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e
      if (v <= MAX_BET) steps.push(v)
    }
  }
  return steps
})()

const betLocked = computed(() => isSpinning.value || auto.on)
const editingBet = ref(false)
const betDraft = ref(bet.value)
const betText = useAmountInput(betDraft, { integer: true, shorthand: true })
const betInputEl = ref<HTMLInputElement>()

function clampBet(v: number) {
  if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(v))
}

function setBet(v: number, cue: SpinataSampleName = 'betChange') {
  if (betLocked.value) return
  const next = clampBet(v)
  if (next === bet.value) return
  bet.value = next
  sound.play(cue)
}

function betUp() {
  setBet(BET_STEPS.find(s => s > bet.value) ?? MAX_BET)
}

function betDown() {
  setBet([...BET_STEPS].reverse().find(s => s < bet.value) ?? MIN_BET)
}

function betMax() {
  const affordable = [...BET_STEPS].reverse().find(s => s <= balance.value) ?? MIN_BET
  setBet(affordable, 'betMax')
}

function editBet() {
  if (betLocked.value) return
  betDraft.value = bet.value
  editingBet.value = true
  sound.play('click')
  nextTick(() => {
    betInputEl.value?.focus()
    betInputEl.value?.select()
  })
}

function commitBet() {
  if (!editingBet.value) return
  editingBet.value = false
  if (betDraft.value > 0) setBet(betDraft.value)
}

const buyCost = computed(() => bet.value * SPN_BUY_BONUS_COST)
const lineBet = computed(() => bet.value / SPN_LINES)

// --- settings ----------------------------------------------------------------
const turbo = ref(false)
const showInfo = ref(false)
const showAuto = ref(false)
const showBuy = ref(false)
const showSound = ref(false)
const ready = ref(false)

function toggleTurbo() {
  turbo.value = !turbo.value
  sound.play('click')
  try {
    localStorage.setItem('spinata-turbo', String(turbo.value))
  } catch {
    // Storage blocked.
  }
}

// --- round state -------------------------------------------------------------
const winShown = ref(0)
const winPulse = ref(0)
const balancePulse = ref(0)
const noFunds = ref(0)
const message = ref('')
const messageKind = ref<'idle' | 'spin' | 'win' | 'line' | 'feature' | 'error'>('idle')

const inFree = ref(false)
const fsRound = ref(0)
const multiplier = ref(SPN_TRACK_START)
const multPulse = ref(0)
const pot = ref(0)
const potPulse = ref(0)
const fsWin = ref(0)
const pinatasThisSpin = ref(0)
const scattersThisSpin = ref(0)

const fsIntro = ref(false)
const fsIntroCountdown = ref(0)
let fsIntroResolve: (() => void) | null = null

const prize = ref<{ amount: number, count: number } | null>(null)

// --- auto spin ---------------------------------------------------------------
const auto = reactive({ on: false, left: 0, stopOnFeature: true, winLimit: 0, lossLimit: 0, startBalance: 0 })

function startAuto(s: SpinataAutoSpinSettings) {
  Object.assign(auto, { on: true, left: s.count, stopOnFeature: s.stopOnFeature, winLimit: s.winLimit, lossLimit: s.lossLimit, startBalance: balance.value })
  if (!isSpinning.value) void spin()
}

function stopAuto() {
  auto.on = false
  auto.left = 0
}

// --- idle tips ---------------------------------------------------------------
const TIPS = [
  `${SPN_SCATTER_TRIGGER} Scatters start ${SPN_FREE_SPINS} free spins`,
  `${SPN_BONUS_TRIGGER} Piñatas break open for up to ${BONUS_PAY[5]}× bet`,
  `In free spins every Wild adds +1 to the multiplier, up to ×${SPN_TRACK_CAP}`,
  'Press Space to spin'
]
let tipIndex = 0
let tipTimer: ReturnType<typeof setInterval> | null = null

function setMessage(text: string, kind: typeof messageKind.value) {
  message.value = text
  messageKind.value = kind
}

function showTip() {
  setMessage(TIPS[tipIndex % TIPS.length]!, 'idle')
  tipIndex++
}

// --- helpers -----------------------------------------------------------------
const scene = new SpinataScene()
const reelHost = ref<HTMLDivElement>()
const multEl = ref<HTMLElement>()
const potEl = ref<HTMLElement>()
const cabinetConfetti = ref<InstanceType<typeof SpinataConfetti>>()
const bigWin = ref<InstanceType<typeof SpinataBigWin>>()
let destroyed = false
let resizeObs: ResizeObserver | null = null

// Waits that the player can hurry along (Space / spin button during a reveal).
let skipWaiters: (() => void)[] = []
let hurry = false
function wait(ms: number) {
  if (hurry) ms = Math.min(ms, 60)
  return new Promise<void>((resolve) => {
    const t = setTimeout(done, ms)
    function done() {
      clearTimeout(t)
      skipWaiters = skipWaiters.filter(f => f !== done)
      resolve()
    }
    skipWaiters.push(done)
  })
}
function hurryUp() {
  hurry = true
  for (const f of skipWaiters.slice()) f()
}

// Win meter count-up.
let meterRaf = 0
let meterTick: SpinataSoundHandle | null = null
function countWin(to: number, ms = 700) {
  if (meterRaf) cancelAnimationFrame(meterRaf)
  const from = winShown.value
  if (to <= from) {
    winShown.value = to
    return
  }
  winPulse.value++
  const start = performance.now()
  const dur = hurry || turbo.value ? Math.min(ms, 250) : ms
  meterTick?.stop(0.05)
  meterTick = dur > 350 ? sound.play('counter', { loop: true, gain: 0.8 }) : null
  const step = (now: number) => {
    const p = Math.min(1, (now - start) / dur)
    winShown.value = from + (to - from) * (1 - (1 - p) ** 3)
    if (p < 1) {
      meterRaf = requestAnimationFrame(step)
    } else {
      meterRaf = 0
      meterTick?.stop(0.05)
      meterTick = null
    }
  }
  meterRaf = requestAnimationFrame(step)
}

function cellClient(c: Cell) {
  const canvas = scene.canvas
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  const k = rect.width / SPN_APP_W
  const p = spinataCellCenter(c.col, c.row)
  return { x: rect.left + (SPN_PAD + p.x) * k, y: rect.top + (SPN_PAD + p.y) * k, size: 150 * k }
}

/** Fly a symbol image from a cell to a DOM target. Cosmetic. */
function fly(c: Cell, img: string, target: HTMLElement | undefined, delay: number): Promise<void> {
  const from = cellClient(c)
  if (!from || !target) return Promise.resolve()
  const to = target.getBoundingClientRect()
  const el = document.createElement('img')
  el.src = img
  el.alt = ''
  Object.assign(el.style, {
    position: 'fixed', left: `${from.x}px`, top: `${from.y}px`, width: `${from.size * 0.7}px`, height: `${from.size * 0.7}px`,
    translate: '-50% -50%', pointerEvents: 'none', zIndex: '60', filter: 'drop-shadow(0 0 14px rgba(255,200,60,0.9))'
  })
  document.body.appendChild(el)
  const dx = to.left + to.width / 2 - from.x
  const dy = to.top + to.height / 2 - from.y
  const dur = turbo.value || hurry ? 380 : 650
  const spin = (Math.random() > 0.5 ? 1 : -1) * (200 + Math.random() * 160)
  const anim = el.animate([
    { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 90}px) scale(0.85) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(${spin}deg)`, opacity: 0.4 }
  ], { duration: dur, delay, easing: 'cubic-bezier(0.5, 0, 0.6, 1)', fill: 'both' })
  setTimeout(() => sound.synth('whoosh', 1), delay)
  return new Promise((resolve) => {
    const done = () => {
      el.remove()
      resolve()
    }
    anim.onfinish = done
    anim.oncancel = done
  })
}

function cellsOf(grid: SpinSymbol[][], sym: SpinSymbol): Cell[] {
  const out: Cell[] = []
  for (let col = 0; col < SPN_COLS; col++) {
    for (let row = 0; row < SPN_ROWS; row++) if (grid[col]![row] === sym) out.push({ col, row })
  }
  return out
}

/** Reels that should slow down: the trigger is one symbol away once they stop. */
function anticipationReels(grid: SpinSymbol[][], sym: SpinSymbol, need: number) {
  const out: number[] = []
  let seen = 0
  for (let col = 0; col < SPN_COLS; col++) {
    if (seen >= need - 1) out.push(col)
    seen += grid[col]!.filter(s => s === sym).length
  }
  return out
}

const SYMBOL_NAMES: Record<SpinPaySymbol | 'wild', string> = {
  ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
  maracas: 'Maracas', cactus: 'Cactus', sombrero: 'Sombrero', flower: 'Flower', wild: 'Wild'
}

const FLAVOUR: Partial<Record<SpinPaySymbol | 'wild', SpinataSampleName>> = {
  maracas: 'maracas', cactus: 'ukulele', sombrero: 'accordion', flower: 'cocktail', wild: 'cheer'
}

function winSound(lines: LineWin[]) {
  const best = lines.reduce((a, b) => (b.pay > a.pay ? b : a))
  const flavour = FLAVOUR[best.symbol]
  if (flavour) {
    sound.play('winMid')
    sound.play(flavour, { delay: 0.15 })
  } else {
    sound.play('winLow')
  }
}

// --- reel events: landing sounds and anticipation -------------------------------
let landScatter = 0
let anticipationLoop: SpinataSoundHandle | null = null
let spinLoop: SpinataSoundHandle | null = null
let anticipating = new Set<number>()

function stopSpinSounds() {
  spinLoop?.stop(0.15)
  spinLoop = null
  anticipationLoop?.stop(0.3)
  anticipationLoop = null
}

scene.events = {
  onReelStopping(i) {
    if (anticipating.has(i) && !anticipationLoop) anticipationLoop = sound.play('anticipation', { loop: true })
  },
  onReelLanded(i, symbols) {
    const scat = symbols.filter(s => s === 'scatter').length
    const bonus = symbols.filter(s => s === 'bonus').length
    const wild = symbols.includes('wild')
    if (scat > 0) {
      landScatter = Math.min(5, landScatter + scat)
      sound.play(`scatterStop${landScatter}` as SpinataSampleName)
      symbols.forEach((s, row) => {
        if (s === 'scatter') scene.sparkle(i, row, 18)
      })
    } else if (bonus > 0) {
      sound.play('bonusLand')
    } else if (wild && inFree.value) {
      sound.play('wildLand')
    }
    sound.play('reelStop', { gain: scat || bonus ? 0.5 : 1 })
    if (i === SPN_COLS - 1) {
      anticipationLoop?.stop(0.25)
      anticipationLoop = null
    }
  }
}

async function landReels(grid: SpinSymbol[][], anticipate: number[]) {
  landScatter = 0
  anticipating = new Set(anticipate)
  await scene.land(grid, anticipate)
  stopSpinSounds()
}

function startReels() {
  scene.turbo = turbo.value
  scene.startSpin()
  sound.play('spinStart')
  spinLoop?.stop(0.05)
  spinLoop = sound.play('reelSpin', { loop: true })
}

// --- win presentation ---------------------------------------------------------
let presentToken = 0
let lastGrid: SpinSymbol[][] = []

function lineColor(i: number) {
  return SPN_LINE_COLORS[i % SPN_LINE_COLORS.length]!
}

function lineAmount(w: LineWin, betAmt: number, mult: number) {
  return w.pay * (betAmt / SPN_LINES) * mult
}

function lineLabel(w: LineWin, amount: number, mult: number) {
  const m = mult > 1 ? ` ×${mult}` : ''
  return `Line ${w.line + 1} · ${w.count} ${SYMBOL_NAMES[w.symbol]}${m} · ${formatNumber(amount)}`
}

/** All winning lines at once, then (when there's time) each line on its own. */
async function presentLines(lines: LineWin[], betAmt: number, mult: number, opts: { cycle: boolean, meterFrom: number }) {
  const total = lines.reduce((s, w) => s + lineAmount(w, betAmt, mult), 0)
  const cells = lines.flatMap(w => w.cells)
  scene.drawLines(lines.map((w, i) => ({ rows: PAYLINES[w.line]!, color: lineColor(i) })), false, 4)
  scene.highlight(cells, 0xffc93c, lines.some(w => w.pay >= 100))
  if (lines.length === 1) scene.floatAmount(lines[0]!.cells, formatNumber(total))
  winSound(lines)
  sound.synth('sparkle')
  setMessage(`Win ${formatNumber(total)}`, 'win')
  countWin(opts.meterFrom + total, Math.min(1600, 500 + lines.length * 120))
  const high = lines.filter(w => w.pay >= 142)
  if (high.length) scene.burst(high.flatMap(w => w.cells.slice(0, 1)), 22, 0.9)
  await wait(turbo.value ? 550 : 1150)

  if (!opts.cycle || lines.length < 2) return
  const shown = lines.slice().sort((a, b) => b.pay - a.pay).slice(0, 6)
  for (let i = 0; i < shown.length; i++) {
    const w = shown[i]!
    const amount = lineAmount(w, betAmt, mult)
    scene.drawLines([{ rows: PAYLINES[w.line]!, color: lineColor(i) }], true, 6)
    scene.highlight(w.cells, lineColor(i))
    scene.floatAmount(w.cells, formatNumber(amount))
    sound.synth('line', i)
    setMessage(lineLabel(w, amount, mult), 'line')
    await wait(820)
  }
}

/** After a round, keep cycling the winning lines until the next spin. */
async function idleCycle(lines: LineWin[], betAmt: number, mult: number) {
  const token = ++presentToken
  if (lines.length === 0) return
  const order = lines.slice().sort((a, b) => b.pay - a.pay)
  let i = 0
  await new Promise(r => setTimeout(r, 900))
  while (token === presentToken && !destroyed) {
    const w = order[i % order.length]!
    const amount = lineAmount(w, betAmt, mult)
    scene.drawLines([{ rows: PAYLINES[w.line]!, color: lineColor(i) }], true, 5)
    scene.highlight(w.cells, lineColor(i))
    scene.floatAmount(w.cells, formatNumber(amount))
    setMessage(lineLabel(w, amount, mult), 'line')
    i++
    await new Promise(r => setTimeout(r, 1500))
  }
}

function cancelPresentation() {
  presentToken++
  scene.clearWins()
}

// --- piñata prize (base game) ---------------------------------------------------
async function breakPinatas(cells: Cell[], amount: number, meterFrom: number) {
  scene.clearWins()
  scene.highlight(cells, 0xff3d7f, true)
  setMessage(`${cells.length} Piñatas!`, 'feature')
  for (let hit = 0; hit < 3; hit++) {
    scene.shake(cells, 1 + hit * 0.4)
    sound.synth('thud')
    await wait(turbo.value ? 170 : 300)
  }
  scene.burst(cells, 55, 1.2)
  sound.play('pinataBurst')
  sound.synth('pop', 1)
  prize.value = { amount, count: cells.length }
  sound.play('bonusPrize')
  sound.play('youWon', { delay: 0.2 })
  countWin(meterFrom + amount, 900)
  await wait(turbo.value ? 1200 : 2200)
  prize.value = null
}

// --- free spins -----------------------------------------------------------------
function waitForFsStart(autoStart: boolean) {
  fsIntro.value = true
  sound.play('freeSpinsPopup')
  sound.play('spinataVoice', { delay: 0.5 })
  nextTick(() => cabinetConfetti.value?.burst(0.5, 0.75, 160, 1.1, true))
  return new Promise<void>((resolve) => {
    fsIntroResolve = resolve
    if (autoStart) {
      fsIntroCountdown.value = 3
      const t = setInterval(() => {
        fsIntroCountdown.value--
        if (fsIntroCountdown.value <= 0 || !fsIntro.value) {
          clearInterval(t)
          startFreeSpins()
        }
      }, 1000)
    } else {
      fsIntroCountdown.value = 0
    }
  })
}

function startFreeSpins() {
  if (!fsIntro.value) return
  sound.play('press')
  fsIntro.value = false
  const r = fsIntroResolve
  fsIntroResolve = null
  r?.()
}

async function playFreeSpins(result: SpinataResult, meterFrom: number) {
  const spins = result.freeSpins!
  const betAmt = result.bet
  if (auto.on && auto.stopOnFeature) stopAuto()
  await waitForFsStart(auto.on)

  inFree.value = true
  fsRound.value = 0
  multiplier.value = SPN_TRACK_START
  pot.value = 0
  fsWin.value = 0
  scene.setFiesta(true)
  sound.setMusic('free', true)
  hurry = false

  try {
    for (const fs of spins) {
      if (destroyed) return
      fsRound.value = fs.round
      setMessage(`Free spin ${fs.round} of ${SPN_FREE_SPINS}`, 'feature')
      cancelPresentation()
      startReels()
      await landReels(fs.grid, [])
      hurry = false

      // Wilds fly to the multiplier; it climbs before the line wins pay.
      if (fs.trackAfter > fs.trackBefore) {
        const wilds = cellsOf(fs.grid, 'wild')
        scene.highlight(wilds, 0xffc93c, true)
        await Promise.all(wilds.map((c, k) => fly(c, '/slots/spinata/wild.png', multEl.value, k * 120).then(() => {
          if (multiplier.value < fs.trackAfter) {
            multiplier.value++
            multPulse.value++
            sound.play('bell', { rate: 1 + (multiplier.value - 1) * 0.03 })
          }
        })))
        multiplier.value = fs.trackAfter
        setMessage(`Multiplier ×${fs.trackAfter}`, 'feature')
        await wait(350)
        scene.clearWins()
      }

      if (fs.lines.length) {
        await presentLines(fs.lines, betAmt, fs.trackAfter, { cycle: false, meterFrom: meterFrom + fsWin.value })
      }
      fsWin.value += fs.spinPayout

      // Every piñata drops its prize into the pot.
      if (fs.pinataPrizes.length) {
        const cells = cellsOf(fs.grid, 'bonus')
        scene.clearWins()
        scene.highlight(cells, 0xff3d7f, true)
        await Promise.all(cells.map((c, k) => {
          const amount = (fs.pinataPrizes[k] ?? 0) * betAmt
          scene.floatAmount([c], `+${formatNumber(amount)}`, 0xff9ad0)
          return fly(c, '/slots/spinata/pinata.png', potEl.value, 250 + k * 160).then(() => {
            pot.value += amount
            potPulse.value++
            sound.play('potFill')
          })
        }))
        await wait(200)
      }
      await wait(turbo.value ? 200 : 450)
    }
  } finally {
    cancelPresentation()
  }

  const fsTotal = result.freeSpinsPayout + result.pinataPotTotal
  const settled = Math.min(fsTotal, Math.max(0, result.payout - meterFrom))
  if (fsTotal > 0) {
    setMessage(`Free spins won ${formatNumber(settled)}`, 'win')
    await bigWin.value?.show({
      amount: settled,
      bet: betAmt,
      title: 'Free Spins Win',
      breakdown: [
        { label: 'Line wins', value: result.freeSpinsPayout },
        { label: 'Piñata pot', value: result.pinataPotTotal }
      ],
      autoClose: auto.on,
      turbo: turbo.value
    })
  } else {
    sound.play('sorry')
    setMessage('No win in the free spins this time', 'feature')
    await wait(1600)
  }
  countWin(meterFrom + settled, 400)
  inFree.value = false
  pot.value = 0
  multiplier.value = SPN_TRACK_START
  scene.setFiesta(false)
  sound.setMusic('main')
}

// --- main spin flow --------------------------------------------------------------
async function spin(feature?: 'buyBonus') {
  if (!ready.value || isSpinning.value || destroyed) return
  sound.unlock()
  const cost = feature === 'buyBonus' ? buyCost.value : bet.value
  if (balance.value < cost) {
    sound.play('notEnough')
    noFunds.value++
    setMessage('Not enough coins for this bet', 'error')
    stopAuto()
    return
  }

  const before = balance.value
  let started = false
  hurry = false
  cancelPresentation()

  const data = await requestSpin(cost, feature ? { feature } : undefined, () => {
    started = true
    setBalance(before - cost)
    winShown.value = 0
    pinatasThisSpin.value = 0
    scattersThisSpin.value = 0
    setMessage('Good luck!', 'spin')
    if (feature) sound.play('buyFeature')
    startReels()
  })

  if (!data) {
    if (started) {
      setBalance(before)
      stopAuto()
      await landReels(lastGrid, [])
      setMessage(errorMsg.value || 'Spin failed', 'error')
    }
    return
  }

  const r = data.gameData
  let idleLines: LineWin[] = []
  try {
    const antic = [...new Set([
      ...anticipationReels(r.grid, 'scatter', SPN_SCATTER_TRIGGER),
      ...anticipationReels(r.grid, 'bonus', SPN_BONUS_TRIGGER)
    ])].sort((a, b) => a - b)
    await landReels(r.grid, antic)
    lastGrid = r.grid
    hurry = false
    pinatasThisSpin.value = r.bonusSymbolCount
    scattersThisSpin.value = r.scatterCount

    const bigBase = !r.freeSpinsTriggered && r.payout >= r.bet * BIG_WIN_MULT
    let meter = 0

    if (r.lines.length) {
      await presentLines(r.lines, r.bet, 1, { cycle: !bigBase && !turbo.value && !auto.on && !r.freeSpinsTriggered && !r.bonusPrizeTriggered, meterFrom: 0 })
      meter += r.lines.reduce((s, w) => s + lineAmount(w, r.bet, 1), 0)
      idleLines = r.lines
    }

    if (r.scatterCount >= SPN_SCATTER_TRIGGER) {
      scene.clearWins()
      scene.highlight(r.scatterCells, 0xffe066, true)
      scene.burst(r.scatterCells, 18, 0.8)
      sound.play('scatterWin')
      const pay = (SCATTER_PAY[Math.min(r.scatterCount, 5)] ?? 0) * r.bet
      setMessage(`${r.scatterCount} Scatters · ${SPN_FREE_SPINS} free spins`, 'feature')
      if (pay > 0) {
        scene.floatAmount(r.scatterCells, formatNumber(pay), 0xffe066, true)
        countWin(meter + pay, 700)
        meter += pay
      }
      await wait(1500)
    }

    if (r.bonusPrizeTriggered) {
      await breakPinatas(r.bonusSymbolCells, r.bonusPrizePayout, meter)
      meter += r.bonusPrizePayout
    }

    if (r.freeSpinsTriggered && r.freeSpins) {
      idleLines = []
      await playFreeSpins(r, meter)
    } else if (bigBase) {
      scene.clearWins()
      await bigWin.value?.show({ amount: r.payout, bet: r.bet, autoClose: auto.on, turbo: turbo.value })
    }

    winShown.value = r.payout
    if (r.payout > 0) {
      setMessage(`Win ${formatNumber(r.payout)}`, 'win')
      balancePulse.value++
      sound.play('balance')
    } else {
      showTip()
    }
    setBalance(data.balance)
    pushHistory({ payout: r.payout, bet: r.cost, bonus: r.freeSpinsTriggered })

    if (auto.on) {
      auto.left--
      const lost = auto.lossLimit > 0 && balance.value <= auto.startBalance * (1 - auto.lossLimit)
      const bigHit = auto.winLimit > 0 && r.payout >= r.bet * auto.winLimit
      if (auto.left <= 0 || lost || bigHit || balance.value < bet.value) stopAuto()
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    setMessage(errorMsg.value, 'error')
    setBalance(data.balance)
    stopAuto()
  } finally {
    stopSpinSounds()
    inFree.value = false
    isSpinning.value = false
    hurry = false
  }

  if (auto.on && !destroyed) {
    await new Promise(res => setTimeout(res, turbo.value ? 120 : 350))
    if (auto.on) void spin()
  } else if (idleLines.length) {
    void idleCycle(idleLines, r.bet, 1)
  }
}

function onSpinButton() {
  sound.unlock()
  if (auto.on) {
    stopAuto()
    sound.play('click')
    return
  }
  if (isSpinning.value) {
    if (scene.spinning) scene.slam()
    hurryUp()
    return
  }
  sound.play('spinButton')
  void spin()
}

function onBuy() {
  if (auto.on || isSpinning.value) return
  sound.play('click')
  if (balance.value < buyCost.value) {
    sound.play('notEnough')
    noFunds.value++
    setMessage('Not enough coins to buy free spins', 'error')
    return
  }
  showBuy.value = true
}

function confirmBuy() {
  showBuy.value = false
  void spin('buyBonus')
}

function openAuto() {
  if (isSpinning.value) return
  sound.play('click')
  showAuto.value = true
}

function openInfo() {
  sound.play('click')
  showInfo.value = true
}

// --- keyboard --------------------------------------------------------------------
function typingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

function onKeydown(e: KeyboardEvent) {
  if (e.code !== 'Space' || typingTarget(e.target)) return
  if (showInfo.value || showAuto.value || showBuy.value) return
  e.preventDefault()
  if (e.repeat) return
  if (fsIntro.value) {
    startFreeSpins()
    return
  }
  onSpinButton()
}

function onKeyup(e: KeyboardEvent) {
  // Stops a focused button from also clicking on Space release.
  if (e.code === 'Space' && !typingTarget(e.target)) e.preventDefault()
}

const soundWrap = ref<HTMLElement>()

function onFirstGesture(e: PointerEvent) {
  sound.unlock()
  if (showSound.value && soundWrap.value && !soundWrap.value.contains(e.target as Node)) showSound.value = false
}

// --- mount / unmount -------------------------------------------------------------

onMounted(async () => {
  try {
    turbo.value = localStorage.getItem('spinata-turbo') === 'true'
  } catch {
    // Storage blocked.
  }
  sound.start()
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('keyup', onKeyup)
  window.addEventListener('pointerdown', onFirstGesture, { capture: true })
  showTip()
  tipTimer = setInterval(() => {
    if (!isSpinning.value && messageKind.value === 'idle') showTip()
  }, 6000)

  try {
    const host = reelHost.value
    if (!host) return
    const ok = await scene.init(host)
    if (!ok || destroyed) return
    lastGrid = Array.from({ length: SPN_COLS }, (_, c) => Array.from({ length: SPN_ROWS }, (_, r) => (['ace', 'flower', 'king', 'sombrero', 'queen', 'maracas', 'cactus', 'wild', 'jack', 'ten'] as const)[(c * 3 + r * 7) % 10]!))
    resizeObs = new ResizeObserver(() => scene.fitResolution(host.clientWidth))
    resizeObs.observe(host)
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
    setMessage(errorMsg.value, 'error')
  }
})

onBeforeUnmount(() => {
  destroyed = true
  presentToken++
  hurryUp()
  if (tipTimer) clearInterval(tipTimer)
  if (meterRaf) cancelAnimationFrame(meterRaf)
  meterTick?.stop(0.02)
  stopSpinSounds()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keyup', onKeyup)
  window.removeEventListener('pointerdown', onFirstGesture, { capture: true })
  resizeObs?.disconnect()
  scene.destroy()
  sound.stop()
})

// --- view helpers ---------------------------------------------------------------
const pinataRows = computed(() => [5, 4, 3].map(n => ({ n, amount: (BONUS_PAY[n] ?? 0) * bet.value, lit: !inFree.value && Math.min(pinatasThisSpin.value, 5) === n })))
const trackStops = Array.from({ length: SPN_TRACK_CAP }, (_, i) => SPN_TRACK_CAP - i)
const canSpin = computed(() => ready.value)
const PICADO = ['#ff2d6f', '#ffb400', '#00c2a8', '#7b3cff', '#ff6a00', '#2ec5ff', '#7ed321', '#ff7ad9']
</script>

<template>
  <div
    class="spn-page"
    :class="{ 'spn-page--fiesta': inFree }"
  >
    <div class="spn-page__bg" />
    <div class="spn-page__shade" />

    <div class="spn-wrap">
      <!-- Logo -->
      <header class="spn-head">
        <img
          src="/slots/spinata/logo.png"
          alt="Spiñata Slots"
          class="spn-head__logo"
          draggable="false"
        >
      </header>

      <!-- Cabinet -->
      <section class="spn-cab">
        <div
          class="spn-picado"
          aria-hidden="true"
        >
          <span
            v-for="i in 18"
            :key="i"
            :style="{ '--c': PICADO[i % PICADO.length], '--d': `${(i % 5) * 0.35}s` }"
          />
        </div>

        <div class="spn-board">
          <!-- Multiplier track -->
          <aside
            class="spn-track"
            :class="{ 'spn-track--live': inFree }"
            aria-label="Free spins multiplier"
          >
            <p class="spn-track__title">
              Multiplier
            </p>
            <div
              ref="multEl"
              :key="multPulse"
              class="spn-track__now"
            >
              ×{{ multiplier }}
            </div>
            <ol class="spn-track__stops">
              <li
                v-for="lvl in trackStops"
                :key="lvl"
                :class="{ on: inFree && multiplier >= lvl, top: inFree && multiplier === lvl }"
              >
                {{ lvl }}
              </li>
            </ol>
            <p class="spn-track__hint">
              {{ inFree ? 'Wilds +1' : 'Free spins' }}
            </p>
          </aside>

          <!-- Reel window -->
          <div class="spn-window">
            <div class="spn-window__lights" />
            <div class="spn-window__inner">
              <div
                ref="reelHost"
                class="spn-reels"
                :style="{ aspectRatio: `${SPN_APP_W} / ${SPN_APP_H}` }"
              />
              <SpinataConfetti ref="cabinetConfetti" />

              <div
                v-if="!ready && !errorMsg"
                class="spn-window__loading"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-12 animate-spin"
                />
              </div>

              <!-- Piñata prize -->
              <Transition name="spn-pop">
                <div
                  v-if="prize"
                  class="spn-over spn-over--clear"
                >
                  <div class="spn-prize">
                    <img
                      src="/slots/spinata/pinata.png"
                      alt=""
                    >
                    <p class="spn-prize__title">
                      Piñata prize
                    </p>
                    <p class="spn-prize__amount">
                      {{ formatNumber(prize.amount) }}
                    </p>
                    <p class="spn-prize__sub">
                      {{ prize.count }} Piñatas · {{ BONUS_PAY[Math.min(prize.count, 5)] }}× bet
                    </p>
                  </div>
                </div>
              </Transition>

              <!-- Free spins intro -->
              <Transition name="spn-pop">
                <div
                  v-if="fsIntro"
                  class="spn-over"
                  @click="startFreeSpins"
                >
                  <div class="spn-fs">
                    <div class="spn-fs__icons">
                      <img
                        src="/slots/spinata/scatter.png"
                        alt=""
                      >
                      <img
                        src="/slots/spinata/scatter.png"
                        alt=""
                      >
                      <img
                        src="/slots/spinata/scatter.png"
                        alt=""
                      >
                    </div>
                    <p class="spn-fs__count">
                      {{ SPN_FREE_SPINS }}
                    </p>
                    <p class="spn-fs__title">
                      Free spins
                    </p>
                    <ul class="spn-fs__rules">
                      <li>
                        <img
                          src="/slots/spinata/wild.png"
                          alt=""
                        >Every Wild adds +1 to the multiplier, up to ×{{ SPN_TRACK_CAP }}
                      </li>
                      <li>
                        <img
                          src="/slots/spinata/pinata.png"
                          alt=""
                        >Every Piñata drops a prize into the pot
                      </li>
                    </ul>
                    <button
                      class="spn-fs__go"
                      @click.stop="startFreeSpins"
                    >
                      {{ fsIntroCountdown > 0 ? `Starting in ${fsIntroCountdown}` : 'Start' }}
                    </button>
                  </div>
                </div>
              </Transition>
            </div>
          </div>

          <!-- Feature rail -->
          <aside
            class="spn-rail"
            :class="{ 'spn-rail--base': !inFree }"
          >
            <div
              ref="potEl"
              class="spn-card spn-card--pinata"
              :class="{ 'spn-card--hot': inFree }"
            >
              <img
                :key="potPulse"
                src="/slots/spinata/pinata.png"
                alt=""
                class="spn-card__img"
                :class="{ 'spn-bump': potPulse > 0 }"
              >
              <template v-if="inFree">
                <p class="spn-card__title">
                  Piñata pot
                </p>
                <p
                  :key="`pot${potPulse}`"
                  class="spn-card__big spn-bump"
                >
                  {{ formatNumber(pot) }}
                </p>
              </template>
              <template v-else>
                <p class="spn-card__title">
                  Piñata prize
                </p>
                <div class="spn-card__table">
                  <p
                    v-for="row in pinataRows"
                    :key="row.n"
                    :class="{ lit: row.lit }"
                  >
                    <span>{{ row.n }}×</span>{{ formatNumber(row.amount) }}
                  </p>
                </div>
              </template>
            </div>

            <div
              class="spn-card spn-card--scatter"
              :class="{ 'spn-card--hot': inFree }"
            >
              <img
                src="/slots/spinata/scatter.png"
                alt=""
                class="spn-card__img"
              >
              <template v-if="inFree">
                <p class="spn-card__title">
                  Free spin
                </p>
                <p class="spn-card__big">
                  {{ fsRound }}<small>/{{ SPN_FREE_SPINS }}</small>
                </p>
              </template>
              <template v-else>
                <p class="spn-card__title">
                  {{ SPN_SCATTER_TRIGGER }}+ Scatters
                </p>
                <p class="spn-card__line">
                  {{ SPN_FREE_SPINS }} free spins
                </p>
              </template>
            </div>

            <button
              class="spn-buy"
              :disabled="!ready || isSpinning || auto.on"
              @click="onBuy"
            >
              <span class="spn-buy__top">Buy free spins</span>
              <span class="spn-buy__cost">{{ formatNumber(buyCost) }}</span>
            </button>
          </aside>
        </div>

        <!-- Message bar -->
        <div
          class="spn-msg"
          :class="`spn-msg--${messageKind}`"
          role="status"
          aria-live="polite"
        >
          <Transition
            name="spn-msg"
            mode="out-in"
          >
            <span :key="message">{{ message }}</span>
          </Transition>
          <button
            v-if="messageKind === 'error' && errorMsg"
            class="spn-msg__x"
            aria-label="Dismiss"
            @click="errorMsg = ''; showTip()"
          >
            <UIcon
              name="i-lucide-x"
              class="size-4"
            />
          </button>
        </div>

        <!-- Control deck -->
        <div class="spn-deck">
          <div class="spn-deck__tools">
            <button
              class="spn-tool"
              aria-label="How to play"
              title="How to play"
              @click="openInfo"
            >
              <UIcon
                name="i-lucide-info"
                class="size-5"
              />
            </button>
            <div
              ref="soundWrap"
              class="relative"
            >
              <button
                class="spn-tool"
                :class="{ 'spn-tool--on': showSound }"
                :aria-label="muted ? 'Sound off' : 'Sound'"
                title="Sound"
                @click="showSound = !showSound; sound.play('click')"
              >
                <UIcon
                  :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                  class="size-5"
                />
              </button>
              <Transition name="spn-pop">
                <div
                  v-if="showSound"
                  class="spn-sound"
                >
                  <label class="spn-sound__row">
                    <span>Sound</span>
                    <button
                      class="spn-chip"
                      :class="{ 'spn-chip--on': !muted }"
                      @click="muted = !muted; sound.unlock(); sound.play('click')"
                    >{{ muted ? 'Off' : 'On' }}</button>
                  </label>
                  <label class="spn-sound__row">
                    <span>Effects</span>
                    <input
                      v-model.number="sfxVolume"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      :disabled="muted"
                      @change="sound.play('click')"
                    >
                  </label>
                  <label class="spn-sound__row">
                    <span>Music</span>
                    <input
                      v-model.number="musicVolume"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      :disabled="muted"
                    >
                  </label>
                </div>
              </Transition>
            </div>
            <button
              class="spn-tool"
              :class="{ 'spn-tool--on': turbo }"
              :aria-pressed="turbo"
              aria-label="Turbo"
              title="Turbo"
              @click="toggleTurbo"
            >
              <UIcon
                name="i-lucide-zap"
                class="size-5"
              />
            </button>
          </div>

          <div
            :key="`bal${noFunds}`"
            class="spn-meter spn-meter--balance"
            :class="{ 'spn-shake': noFunds > 0, 'spn-meter--flash': balancePulse > 0 }"
          >
            <span class="spn-meter__label">Balance</span>
            <span class="spn-meter__val">{{ formatNumber(balance) }}</span>
          </div>

          <div class="spn-bet">
            <span class="spn-meter__label">Bet</span>
            <div class="spn-bet__row">
              <button
                class="spn-round spn-round--sm"
                aria-label="Lower bet"
                :disabled="betLocked || bet <= MIN_BET"
                @click="betDown"
              >
                <UIcon
                  name="i-lucide-minus"
                  class="size-5"
                />
              </button>
              <div class="spn-bet__val">
                <input
                  v-if="editingBet"
                  ref="betInputEl"
                  v-model="betText"
                  class="spn-bet__input"
                  aria-label="Bet amount"
                  inputmode="decimal"
                  @blur="commitBet"
                  @keydown.enter="commitBet"
                  @keydown.esc="editingBet = false"
                >
                <button
                  v-else
                  class="spn-bet__show"
                  :disabled="betLocked"
                  title="Type a bet"
                  @click="editBet"
                >
                  {{ formatNumber(bet) }}
                </button>
                <output
                  v-if="editingBet && amountPreview(betText, true)"
                  class="spn-bet__preview"
                >{{ amountPreview(betText, true) }}</output>
              </div>
              <button
                class="spn-round spn-round--sm"
                aria-label="Raise bet"
                :disabled="betLocked || bet >= MAX_BET"
                @click="betUp"
              >
                <UIcon
                  name="i-lucide-plus"
                  class="size-5"
                />
              </button>
            </div>
            <div class="spn-bet__sub">
              <span>Line {{ formatNumber(lineBet) }}</span>
              <button
                class="spn-maxbet"
                :disabled="betLocked"
                @click="betMax"
              >
                Max bet
              </button>
            </div>
          </div>

          <div class="spn-spin">
            <button
              class="spn-auto"
              :class="{ 'spn-auto--on': auto.on }"
              :disabled="!ready || (isSpinning && !auto.on)"
              :aria-label="auto.on ? 'Stop auto spin' : 'Auto spin'"
              @click="auto.on ? (stopAuto(), sound.play('click')) : openAuto()"
            >
              <UIcon
                :name="auto.on ? 'i-lucide-square' : 'i-lucide-repeat'"
                class="size-5"
              />
              <span v-if="auto.on">{{ auto.left }}</span>
              <span v-else>Auto</span>
            </button>
            <button
              class="spn-spinbtn"
              :class="{ 'spn-spinbtn--busy': isSpinning && !auto.on, 'spn-spinbtn--auto': auto.on }"
              :disabled="!canSpin"
              :aria-label="auto.on ? 'Stop auto spin' : isSpinning ? 'Stop reels' : 'Spin'"
              @click="onSpinButton"
            >
              <span class="spn-spinbtn__ring" />
              <span
                v-if="auto.on"
                class="spn-spinbtn__label"
              >Stop</span>
              <UIcon
                v-else
                name="i-lucide-refresh-cw"
                class="spn-spinbtn__icon"
              />
            </button>
          </div>

          <div
            :key="`win${winPulse}`"
            class="spn-meter spn-meter--win"
            :class="{ 'spn-meter--hot': winShown > 0 }"
          >
            <span class="spn-meter__label">{{ inFree ? 'Total win' : 'Win' }}</span>
            <span class="spn-meter__val">{{ formatNumber(winShown) }}</span>
          </div>
        </div>
      </section>

      <div class="spn-badges">
        <span class="spn-badge">{{ SPN_RTP }}% RTP</span>
        <span class="spn-badge spn-badge--vol"><SlotVolatility :level="SPN_VOLATILITY" /></span>
        <span class="spn-badge">{{ SPN_LINES }} lines</span>
        <span class="spn-badge">Up to {{ formatNumber(SPN_DISPLAY_MAX_WIN, false) }}×</span>
      </div>

      <!-- Recent rounds -->
      <div
        v-if="history.length"
        class="spn-history"
        aria-label="Recent rounds"
      >
        <span
          v-for="(h, i) in history"
          :key="i"
          class="spn-history__pill"
          :class="h.payout > h.bet ? 'up' : h.payout > 0 ? 'some' : 'none'"
        >
          <UIcon
            v-if="h.bonus"
            name="i-lucide-gift"
            class="size-3"
          />
          {{ h.payout > 0 ? formatNumber(h.payout) : '–' }}
        </span>
      </div>
    </div>

    <!-- Buy confirm -->
    <Teleport to="body">
      <Transition name="spn-modal">
        <div
          v-if="showBuy"
          class="spn-modal"
          role="dialog"
          aria-modal="true"
          @click.self="showBuy = false"
        >
          <div class="spn-modal__card spn-buyconfirm">
            <img
              src="/slots/spinata/scatter.png"
              alt=""
            >
            <h2>Buy {{ SPN_FREE_SPINS }} free spins?</h2>
            <p>Costs {{ SPN_BUY_BONUS_COST }}× your bet</p>
            <p class="spn-buyconfirm__cost">
              {{ formatNumber(buyCost) }}
            </p>
            <div class="spn-buyconfirm__row">
              <button
                class="spn-chip"
                @click="showBuy = false; sound.play('click')"
              >
                Cancel
              </button>
              <button
                class="spn-modal__go"
                @click="confirmBuy"
              >
                Buy
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <SpinataAutoSpin
      v-model:open="showAuto"
      @start="startAuto"
    />
    <SpinataInfo
      v-model:open="showInfo"
      :bet="bet"
      :rtp="SPN_RTP"
    />
    <SpinataBigWin ref="bigWin" />
  </div>
</template>

<style scoped>
/* ── Page ─────────────────────────────────────────────────────────────── */
.spn-page {
  --gold: #ffcb45;
  --gold-deep: #c9771a;
  --pink: #ff3d7f;
  --plum: #2a0a3a;
  --ink: #f6e8ff;
  position: relative;
  min-height: 100%;
  overflow: hidden;
  color: var(--ink);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  padding: 8px 16px 28px;
}
.spn-page__bg {
  position: absolute;
  inset: 0;
  background: url('/slots/spinata/bg.jpg') center 30% / cover no-repeat;
  transition: filter 0.8s ease;
}
.spn-page--fiesta .spn-page__bg { filter: hue-rotate(-25deg) saturate(1.35) brightness(1.08); }
.spn-page__shade {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 70% at 50% 45%, rgba(20, 4, 30, 0) 30%, rgba(10, 2, 20, 0.45) 80%, rgba(6, 1, 12, 0.8)),
    linear-gradient(180deg, rgba(10, 2, 20, 0) 50%, rgba(10, 2, 20, 0.45));
}
.spn-wrap {
  position: relative;
  max-width: 1120px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* ── Logo ─────────────────────────────────────────────────────────────── */
.spn-head {
  display: flex;
  justify-content: center;
  height: clamp(96px, 14vw, 172px);
  margin-bottom: -30px;
  position: relative;
  z-index: 3;
  pointer-events: none;
}
.spn-head__logo {
  height: 100%;
  aspect-ratio: 1536 / 560;
  object-fit: cover;
  object-position: 50% 0;
  filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 24px rgba(255, 120, 60, 0.35));
  animation: spn-bob 5s ease-in-out infinite;
}

/* ── Cabinet ──────────────────────────────────────────────────────────── */
.spn-cab {
  position: relative;
  padding: 30px 16px 14px;
  border-radius: 30px;
  background:
    radial-gradient(120% 60% at 50% 0%, rgba(255, 90, 140, 0.18), transparent 60%),
    linear-gradient(180deg, #4a1142 0%, #300a33 45%, #1d0621 100%);
  border: 3px solid var(--gold);
  box-shadow:
    0 0 0 5px #5b1a3e,
    0 0 0 8px rgba(255, 203, 69, 0.55),
    0 30px 80px rgba(0, 0, 0, 0.7),
    inset 0 2px 0 rgba(255, 255, 255, 0.18),
    inset 0 -20px 40px rgba(0, 0, 0, 0.35);
}
.spn-page--fiesta .spn-cab {
  border-color: #ff7ad9;
  box-shadow:
    0 0 0 5px #6a0f4a,
    0 0 0 8px rgba(255, 122, 217, 0.6),
    0 0 60px rgba(255, 61, 127, 0.45),
    0 30px 80px rgba(0, 0, 0, 0.7),
    inset 0 2px 0 rgba(255, 255, 255, 0.18);
}

.spn-picado {
  position: absolute;
  top: 6px;
  left: 28px;
  right: 28px;
  height: 26px;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}
.spn-picado::before {
  content: '';
  position: absolute;
  left: -6px;
  right: -6px;
  top: 1px;
  height: 2px;
  background: rgba(255, 230, 190, 0.5);
}
.spn-picado span {
  width: clamp(14px, 3.2%, 26px);
  height: 22px;
  background: var(--c);
  clip-path: polygon(0 0, 100% 0, 100% 78%, 87% 100%, 75% 78%, 62% 100%, 50% 78%, 37% 100%, 25% 78%, 12% 100%, 0 78%);
  -webkit-mask: radial-gradient(circle at 50% 42%, transparent 3px, #000 3.5px);
  mask: radial-gradient(circle at 50% 42%, transparent 3px, #000 3.5px);
  transform-origin: 50% 0;
  animation: spn-sway 2.8s ease-in-out infinite;
  animation-delay: var(--d);
  opacity: 0.92;
}

.spn-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 14px;
}
.spn-badge {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffe9b0;
  background: rgba(30, 6, 34, 0.85);
  border: 1.5px solid rgba(255, 203, 69, 0.55);
  white-space: nowrap;
}
.spn-badge--vol :deep(.text-muted) { color: #ffe9b0; }

.spn-board {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) 150px;
  gap: 12px;
  align-items: stretch;
}

/* ── Multiplier track ─────────────────────────────────────────────────── */
.spn-track {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 8px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.2));
  border: 1px solid rgba(255, 203, 69, 0.25);
  opacity: 0.72;
  transition: opacity 0.4s, border-color 0.4s, box-shadow 0.4s;
}
.spn-track--live {
  opacity: 1;
  border-color: rgba(255, 122, 217, 0.8);
  box-shadow: 0 0 24px rgba(255, 61, 127, 0.35), inset 0 0 20px rgba(255, 61, 127, 0.15);
}
.spn-track__title,
.spn-track__hint {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 220, 160, 0.75);
  text-align: center;
}
.spn-track__now {
  margin: 6px 0 8px;
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 30px;
  line-height: 1;
  color: var(--gold);
  text-shadow: 0 3px 0 #6b1640, 0 0 18px rgba(255, 190, 40, 0.5);
  animation: spn-bump 0.45s cubic-bezier(0.2, 1.8, 0.4, 1);
}
.spn-track__stops {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.spn-track__stops li {
  flex: 1;
  min-height: 12px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.05);
  transition: background 0.3s, color 0.3s;
}
.spn-track__stops li.on {
  color: #2a0616;
  background: linear-gradient(90deg, #ff3d7f, #ffb400);
}
.spn-track__stops li.top {
  background: linear-gradient(90deg, #fff1a8, #ffcb45);
  box-shadow: 0 0 14px rgba(255, 220, 90, 0.8);
}
.spn-track__hint { margin-top: 6px; }

/* ── Reel window ──────────────────────────────────────────────────────── */
.spn-window {
  position: relative;
  padding: 12px;
  border-radius: 24px;
  background: linear-gradient(180deg, #f6c453, #b8621b 50%, #f0b54a);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 2px 0 rgba(255, 255, 255, 0.6), inset 0 -2px 0 rgba(0, 0, 0, 0.3);
}
.spn-window__lights {
  position: absolute;
  inset: 3px;
  border-radius: 21px;
  pointer-events: none;
  background:
    radial-gradient(circle, #fff6c8 0 2.2px, rgba(255, 220, 120, 0.5) 3px, transparent 4.5px) 0 0 / 18px 18px;
  -webkit-mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
  padding: 6px;
  animation: spn-chase 1.2s steps(2) infinite;
}
.spn-page--fiesta .spn-window__lights { animation-duration: 0.45s; filter: hue-rotate(-60deg) saturate(1.6); }
.spn-window__inner {
  position: relative;
  border-radius: 14px;
  overflow: hidden;
  background: #16051f;
  box-shadow: inset 0 0 0 2px rgba(60, 10, 40, 0.9), inset 0 8px 24px rgba(0, 0, 0, 0.6);
}
.spn-reels { position: relative; width: 100%; }
.spn-reels :deep(canvas) { display: block; width: 100% !important; height: 100% !important; }
.spn-window__loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--gold);
}

.spn-over {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at center, rgba(40, 6, 50, 0.82), rgba(12, 2, 20, 0.94));
  backdrop-filter: blur(2px);
  cursor: pointer;
}
.spn-over--clear { background: radial-gradient(ellipse at center, rgba(40, 6, 50, 0.7), rgba(12, 2, 20, 0.2) 65%); backdrop-filter: none; cursor: default; pointer-events: none; }

.spn-prize { text-align: center; }
.spn-prize img { width: 120px; margin: 0 auto; animation: spn-swing 1s ease-in-out infinite; transform-origin: 50% 0; filter: drop-shadow(0 0 22px rgba(255, 61, 127, 0.8)); }
.spn-prize__title {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 40px;
  line-height: 1;
  text-transform: uppercase;
  color: #ff9ad0;
  text-shadow: 0 4px 0 #5a0a32, 0 0 20px rgba(255, 61, 127, 0.7);
}
.spn-prize__amount {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 64px;
  line-height: 1.05;
  color: #fff3c4;
  text-shadow: 0 5px 0 #7a3a00, 0 0 28px rgba(255, 200, 60, 0.8);
}
.spn-prize__sub { font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; font-size: 12px; color: rgba(255, 230, 190, 0.8); }

.spn-fs { text-align: center; padding: 16px; }
.spn-fs__icons { display: flex; justify-content: center; gap: 4px; }
.spn-fs__icons img { width: clamp(48px, 9vw, 84px); animation: spn-bob 1.6s ease-in-out infinite; }
.spn-fs__icons img:nth-child(2) { animation-delay: 0.2s; margin-top: -12px; }
.spn-fs__icons img:nth-child(3) { animation-delay: 0.4s; }
.spn-fs__count {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: clamp(64px, 13vw, 132px);
  line-height: 0.9;
  background: linear-gradient(180deg, #fff 0%, #ffe066 40%, #ff8a1f 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-stroke: 3px #4a0a30;
  paint-order: stroke fill;
  filter: drop-shadow(0 6px 0 #2a0418) drop-shadow(0 0 26px rgba(255, 180, 40, 0.7));
  animation: spn-slam-in 0.6s cubic-bezier(0.2, 1.6, 0.4, 1);
}
.spn-fs__title {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: clamp(26px, 4.4vw, 44px);
  line-height: 1;
  text-transform: uppercase;
  color: #ff9ad0;
  text-shadow: 0 4px 0 #5a0a32;
  margin-bottom: 12px;
}
.spn-fs__rules { display: grid; gap: 6px; justify-content: center; margin-bottom: 16px; }
.spn-fs__rules li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  font-size: clamp(12px, 1.6vw, 15px);
  font-weight: 700;
  text-align: left;
}
.spn-fs__rules img { width: 32px; height: 32px; object-fit: contain; }
.spn-fs__go {
  min-width: 200px;
  padding: 12px 28px;
  border-radius: 999px;
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 24px;
  letter-spacing: 0.04em;
  color: #fff;
  text-shadow: 0 2px 0 #0d5b2a;
  background: linear-gradient(180deg, #5cf08a, #19b34f 60%, #0e8a3a);
  border: 2px solid #c8ffd9;
  box-shadow: 0 6px 0 #075a24, 0 0 30px rgba(60, 240, 120, 0.5);
  cursor: pointer;
  animation: spn-throb 1.2s ease-in-out infinite;
}

/* ── Feature rail ─────────────────────────────────────────────────────── */
.spn-rail { display: flex; flex-direction: column; gap: 10px; }
.spn-card {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 8px 10px;
  border-radius: 18px;
  text-align: center;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.35), rgba(0, 0, 0, 0.18));
  border: 1px solid rgba(255, 203, 69, 0.28);
  transition: border-color 0.4s, box-shadow 0.4s;
}
.spn-card--hot {
  border-color: rgba(255, 122, 217, 0.8);
  box-shadow: 0 0 24px rgba(255, 61, 127, 0.3), inset 0 0 20px rgba(255, 61, 127, 0.12);
}
.spn-card__img { width: 62px; height: 62px; object-fit: contain; filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5)); }
.spn-card__title {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 220, 160, 0.8);
  margin-top: 2px;
}
.spn-card__big {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 26px;
  line-height: 1.1;
  color: var(--gold);
  text-shadow: 0 3px 0 #6b1640;
  font-variant-numeric: tabular-nums;
}
.spn-card__big small { font-size: 15px; color: rgba(255, 220, 160, 0.7); }
.spn-card__line { font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 17px; color: var(--gold); line-height: 1.2; }
.spn-card__table { width: 100%; margin-top: 4px; }
.spn-card__table p {
  display: flex;
  justify-content: space-between;
  padding: 1px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #fff0cc;
  transition: background 0.2s;
}
.spn-card__table span { color: rgba(255, 210, 120, 0.7); }
.spn-card__table p.lit { background: linear-gradient(90deg, #ff3d7f, #ff8a1f); color: #fff; }
.spn-card__table p.lit span { color: #fff; }

.spn-buy {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 6px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(180deg, #ff5f9a, #d0165a 60%, #9c0c43);
  border: 2px solid #ffc1d8;
  box-shadow: 0 5px 0 #5e0828, 0 8px 20px rgba(208, 22, 90, 0.4);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s, filter 0.15s;
}
.spn-buy:hover:not(:disabled) { filter: brightness(1.1); }
.spn-buy:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 2px 0 #5e0828; }
.spn-buy:disabled { opacity: 0.45; cursor: not-allowed; filter: saturate(0.5); }
.spn-buy__top { font-size: 11px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
.spn-buy__cost { font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 22px; line-height: 1.1; text-shadow: 0 2px 0 #6e0a30; }

/* ── Message bar ──────────────────────────────────────────────────────── */
.spn-msg {
  position: relative;
  margin: 12px auto 0;
  max-width: 720px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 40px;
  border-radius: 999px;
  background: linear-gradient(180deg, #12030f, #26071f);
  border: 1.5px solid rgba(255, 203, 69, 0.45);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.6);
  font-weight: 800;
  font-size: 14px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 230, 190, 0.8);
  white-space: nowrap;
  overflow: hidden;
}
.spn-msg span { overflow: hidden; text-overflow: ellipsis; }
.spn-msg--win, .spn-msg--line { color: var(--gold); text-shadow: 0 0 12px rgba(255, 190, 40, 0.6); }
.spn-msg--win { font-family: 'Lilita One', 'Arial Black', sans-serif; font-weight: 400; font-size: 20px; letter-spacing: 0.08em; }
.spn-msg--feature { color: #ff9ad0; text-shadow: 0 0 12px rgba(255, 61, 127, 0.6); }
.spn-msg--error { color: #ff8a8a; border-color: rgba(255, 90, 90, 0.6); }
.spn-msg__x { position: absolute; right: 10px; color: #ff8a8a; cursor: pointer; display: grid; place-items: center; }

/* ── Control deck ─────────────────────────────────────────────────────── */
.spn-deck {
  margin-top: 12px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 22px;
  background: linear-gradient(180deg, #1c0520, #2b0a2c);
  border: 1px solid rgba(255, 203, 69, 0.35);
  box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.06), inset 0 -3px 10px rgba(0, 0, 0, 0.4);
}
.spn-deck__tools { display: flex; gap: 8px; }
.spn-tool {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  color: #f4e4ff;
  background: linear-gradient(180deg, #4a1747, #2a0a2a);
  border: 1.5px solid rgba(255, 203, 69, 0.4);
  box-shadow: 0 3px 0 #12030f;
  cursor: pointer;
  transition: transform 0.1s, color 0.15s, box-shadow 0.15s;
}
.spn-tool:hover { color: var(--gold); }
.spn-tool:active { transform: translateY(2px); box-shadow: 0 1px 0 #12030f; }
.spn-tool--on { color: #2a0616; background: linear-gradient(180deg, #ffe38a, #ffb400); border-color: #fff1b8; box-shadow: 0 3px 0 #7a4a00, 0 0 16px rgba(255, 190, 40, 0.5); }

.spn-sound {
  position: absolute;
  bottom: calc(100% + 10px);
  left: -8px;
  z-index: 20;
  width: 230px;
  padding: 12px;
  border-radius: 16px;
  background: #22062a;
  border: 1.5px solid rgba(255, 203, 69, 0.55);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  display: grid;
  gap: 10px;
}
.spn-sound__row { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 700; }
.spn-sound__row input[type='range'] { width: 130px; accent-color: #ff3d7f; }

.spn-meter {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  height: 62px;
  padding: 0 14px;
  border-radius: 14px;
  background: linear-gradient(180deg, #0c020b, #1d0519);
  border: 1.5px solid rgba(255, 203, 69, 0.5);
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 1px 0 rgba(255, 255, 255, 0.06);
}
.spn-meter__label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(255, 210, 140, 0.7);
}
.spn-meter__val {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 24px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  color: #fff3d0;
}
.spn-meter--win .spn-meter__val { color: rgba(255, 243, 208, 0.45); }
.spn-meter--hot { border-color: var(--gold); box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 0 18px rgba(255, 190, 40, 0.4); animation: spn-bump 0.4s ease-out; }
.spn-meter--hot .spn-meter__val { color: var(--gold); text-shadow: 0 0 14px rgba(255, 190, 40, 0.7); }
.spn-meter--flash { animation: spn-flash 0.8s ease-out; }

.spn-bet { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.spn-bet__row { display: flex; align-items: center; gap: 6px; }
.spn-bet__val { position: relative; }
.spn-bet__show,
.spn-bet__input {
  width: 120px;
  height: 40px;
  border-radius: 12px;
  text-align: center;
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 22px;
  color: #fff3d0;
  background: linear-gradient(180deg, #0c020b, #1d0519);
  border: 1.5px solid rgba(255, 203, 69, 0.5);
  box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spn-bet__show { cursor: text; }
.spn-bet__show:disabled { cursor: default; opacity: 0.8; }
.spn-bet__input { outline: none; border-color: var(--gold); }
.spn-bet__preview {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  translate: -50% 0;
  padding: 2px 8px;
  border-radius: 8px;
  background: #2a0a2e;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
  z-index: 5;
}
.spn-bet__sub { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 700; color: rgba(255, 220, 160, 0.6); }
.spn-maxbet {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #2a0616;
  background: linear-gradient(180deg, #ffe38a, #ffb400);
  cursor: pointer;
}
.spn-maxbet:disabled { opacity: 0.4; cursor: not-allowed; }

.spn-round {
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s, filter 0.15s;
}
.spn-round--sm {
  width: 40px;
  height: 40px;
  background: linear-gradient(180deg, #ff8a3d, #e0521a 60%, #b23a0c);
  border: 2px solid #ffd2a8;
  box-shadow: 0 4px 0 #6e2406;
}
.spn-round:hover:not(:disabled) { filter: brightness(1.12); }
.spn-round:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #6e2406; }
.spn-round:disabled { opacity: 0.4; cursor: not-allowed; }

.spn-spin { display: flex; align-items: center; gap: 12px; }
.spn-auto {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f4e4ff;
  background: linear-gradient(180deg, #5a1b58, #2e0b2e);
  border: 2px solid rgba(255, 203, 69, 0.55);
  box-shadow: 0 4px 0 #12030f;
  cursor: pointer;
  transition: transform 0.1s;
}
.spn-auto:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 1px 0 #12030f; }
.spn-auto:disabled { opacity: 0.4; cursor: not-allowed; }
.spn-auto--on { color: #fff; background: linear-gradient(180deg, #ff5f9a, #b10d49); border-color: #ffc1d8; animation: spn-throb 1.2s ease-in-out infinite; }
.spn-auto--on span { font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 15px; letter-spacing: 0; }

.spn-spinbtn {
  position: relative;
  width: 104px;
  height: 104px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: #fff;
  background: radial-gradient(circle at 50% 30%, #7dffa6 0%, #1fc257 45%, #0b8a36 80%);
  border: 4px solid #eaffef;
  box-shadow: 0 7px 0 #05511f, 0 0 0 6px rgba(255, 203, 69, 0.85), 0 0 36px rgba(60, 240, 120, 0.45), inset 0 -8px 16px rgba(0, 60, 20, 0.45);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s, filter 0.2s;
}
.spn-spinbtn:hover:not(:disabled) { filter: brightness(1.08) saturate(1.1); }
.spn-spinbtn:active:not(:disabled) { transform: translateY(5px); box-shadow: 0 2px 0 #05511f, 0 0 0 6px rgba(255, 203, 69, 0.85), 0 0 24px rgba(60, 240, 120, 0.4); }
.spn-spinbtn:disabled { filter: grayscale(0.7) brightness(0.7); cursor: not-allowed; }
.spn-spinbtn__ring {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  border: 2px dashed rgba(255, 230, 150, 0.5);
  animation: spn-rot 14s linear infinite;
  pointer-events: none;
}
.spn-spinbtn__icon { width: 52px; height: 52px; filter: drop-shadow(0 3px 0 rgba(0, 70, 25, 0.8)); transition: transform 0.3s; }
.spn-spinbtn__label {
  font-family: 'Lilita One', 'Arial Black', sans-serif;
  font-size: 24px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: 0 2px 0 #05511f;
}
.spn-spinbtn:hover:not(:disabled) .spn-spinbtn__icon { transform: rotate(60deg); }
.spn-spinbtn--busy .spn-spinbtn__icon { animation: spn-rot 0.6s linear infinite; }
.spn-spinbtn--busy .spn-spinbtn__ring { animation-duration: 2s; }
.spn-spinbtn--auto {
  background: radial-gradient(circle at 50% 30%, #ff9ac2 0%, #ff3d7f 45%, #b10d49 80%);
  box-shadow: 0 7px 0 #5e0828, 0 0 0 6px rgba(255, 203, 69, 0.85), 0 0 36px rgba(255, 61, 127, 0.5), inset 0 -8px 16px rgba(80, 0, 30, 0.45);
}

/* ── History ──────────────────────────────────────────────────────────── */
.spn-history { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 14px; }
.spn-history__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  background: rgba(20, 3, 26, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.4);
}
.spn-history__pill.up { color: var(--gold); border-color: rgba(255, 203, 69, 0.55); }
.spn-history__pill.some { color: #ffc7e0; border-color: rgba(255, 122, 217, 0.35); }

/* ── Buy confirm ──────────────────────────────────────────────────────── */
.spn-buyconfirm { text-align: center; width: min(360px, 100%); }
.spn-buyconfirm img { width: 84px; margin: -4px auto 4px; }
.spn-buyconfirm h2 { font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 26px; color: #ffd23f; text-shadow: 0 3px 0 #6b1640; }
.spn-buyconfirm p { font-size: 14px; color: rgba(244, 228, 255, 0.8); }
.spn-buyconfirm__cost { font-family: 'Lilita One', 'Arial Black', sans-serif; font-size: 34px !important; color: #fff3d0 !important; margin: 4px 0 6px; }
.spn-buyconfirm__row { display: grid; grid-template-columns: 1fr 1.6fr; gap: 10px; align-items: center; }
.spn-buyconfirm__row .spn-chip { height: 52px; margin-top: 14px; font-size: 15px; }

/* ── Animations ───────────────────────────────────────────────────────── */
.spn-bump { animation: spn-bump 0.45s cubic-bezier(0.2, 1.8, 0.4, 1); }
.spn-shake { animation: spn-shake 0.45s ease; }
.spn-pop-enter-active { transition: opacity 0.2s, transform 0.35s cubic-bezier(0.2, 1.5, 0.4, 1); }
.spn-pop-leave-active { transition: opacity 0.2s, transform 0.2s; }
.spn-pop-enter-from { opacity: 0; transform: scale(0.85); }
.spn-pop-leave-to { opacity: 0; transform: scale(1.05); }
.spn-msg-enter-active, .spn-msg-leave-active { transition: opacity 0.15s, transform 0.15s; }
.spn-msg-enter-from { opacity: 0; transform: translateY(8px); }
.spn-msg-leave-to { opacity: 0; transform: translateY(-8px); }

@keyframes spn-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes spn-sway { 0%, 100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
@keyframes spn-swing { 0%, 100% { transform: rotate(-8deg); } 50% { transform: rotate(8deg); } }
@keyframes spn-rot { to { transform: rotate(360deg); } }
@keyframes spn-bump { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
@keyframes spn-throb { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes spn-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
@keyframes spn-flash { 0% { box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 0 0 rgba(255, 203, 69, 0); } 30% { box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 0 22px rgba(255, 203, 69, 0.75); } 100% { box-shadow: inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 0 0 rgba(255, 203, 69, 0); } }
@keyframes spn-chase { 0% { background-position: 0 0; } 100% { background-position: 9px 9px; } }
@keyframes spn-slam-in { 0% { transform: scale(2.4); opacity: 0; } 60% { transform: scale(0.94); opacity: 1; } 100% { transform: scale(1); } }

/* ── Responsive ───────────────────────────────────────────────────────── */
@media (max-width: 960px) {
  .spn-board { grid-template-columns: minmax(0, 1fr); }
  .spn-track {
    order: 2;
    flex-direction: row;
    gap: 8px;
    padding: 6px 10px;
  }
  .spn-track__title, .spn-track__hint { display: none; }
  .spn-track__now { margin: 0; font-size: 22px; min-width: 44px; }
  .spn-track__stops { flex-direction: row-reverse; height: 18px; }
  .spn-track__stops li { min-height: 0; font-size: 0; }
  .spn-window { order: 1; }
  .spn-rail { order: 3; flex-direction: row; }
  .spn-card { flex-direction: row; gap: 8px; padding: 6px 8px; flex: 1.2; }
  .spn-card__img { width: 40px; height: 40px; }
  .spn-card--pinata .spn-card__table { display: none; }
  .spn-card__title { margin: 0; }
  .spn-buy { flex: 1; }
}

@media (max-width: 760px) {
  .spn-page { padding: 4px 8px 20px; }
  .spn-cab { padding: 26px 8px 10px; border-radius: 22px; }
  .spn-window { padding: 7px; border-radius: 16px; }
  .spn-window__inner { border-radius: 10px; }
  .spn-deck {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas:
      'bal win'
      'bet bet'
      'tools spin';
    gap: 10px;
    padding: 10px;
  }
  .spn-deck__tools { grid-area: tools; justify-content: center; }
  .spn-meter--balance { grid-area: bal; }
  .spn-meter--win { grid-area: win; }
  .spn-bet { grid-area: bet; }
  .spn-spin { grid-area: spin; justify-content: center; }
  .spn-meter { height: 54px; }
  .spn-meter__val { font-size: 20px; }
  .spn-bet__show, .spn-bet__input { width: 92px; font-size: 18px; }
  .spn-spinbtn { width: 88px; height: 88px; }
  .spn-spinbtn__icon { width: 44px; height: 44px; }
  .spn-auto { width: 50px; height: 50px; }
  .spn-rail { flex-wrap: wrap; }
  .spn-card { flex: 1 1 40%; }
  .spn-rail--base .spn-card { display: none; }
  .spn-track:not(.spn-track--live) { display: none; }
  .spn-spin { justify-content: flex-end; gap: 10px; }
  .spn-buy { flex: 1 1 100%; flex-direction: row; justify-content: center; gap: 10px; padding: 6px; }
  .spn-buy__cost { font-size: 19px; }
  .spn-msg { font-size: 12px; height: 34px; padding: 0 30px; }
  .spn-msg--win { font-size: 17px; }
  .spn-picado span:nth-child(n + 12) { display: none; }
  .spn-badge { height: 22px; font-size: 9.5px; padding: 0 7px; }
}

@media (prefers-reduced-motion: reduce) {
  .spn-head__logo, .spn-picado span, .spn-window__lights, .spn-spinbtn__ring { animation: none; }
}
</style>
