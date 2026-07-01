<script lang="ts" setup>
import type {
  CandyFeature,
  CandyMadnessResult,
  CandySymbol,
  Cell,
  MultSpot,
  TumbleSequence,
  TumbleStep
} from '#shared/utils/gamelogic/candymadness'
import {
  CANDY_KEYS,
  CANDY_WEIGHTS,
  clusterPayMult,
  CM_BONUS_HUNT_COST,
  CM_BUY_FREESPINS_COST,
  CM_CELLS,
  CM_COLS,
  CM_FREE_SPINS,
  CM_MIN_CLUSTER,
  CM_MULT_CAP,
  CM_ROWS,
  CM_SCATTER_TRIGGER,
  SCATTER_WEIGHT
} from '#shared/utils/gamelogic/candymadness'

const {user, setBalance} = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => {
  if (v !== undefined) balance.value = parseFloat(v ?? '0')
})

// --- bet control (half / double / free typing — no upper ladder cap)
const MIN_BET = 1
const MAX_BET = 1_000_000 // matches the server-side cap in play-game.post.ts
const bet = ref(10)
const betInput = ref('10')

function clampBet(v: number): number {
  if (!Number.isFinite(v) || v < MIN_BET) return MIN_BET
  return Math.min(MAX_BET, Math.floor(v))
}

function setBet(v: number) {
  if (isSpinning.value || autoSpinEnabled.value) return
  bet.value = clampBet(v)
}

// Keep the editable field mirrored when bet changes via the ½ / 2× buttons.
watch(bet, (v) => {
  betInput.value = String(v)
}, {immediate: true})

function commitBetInput() {
  setBet(parseInt(betInput.value.replace(/[^\d]/g, ''), 10) || MIN_BET)
  betInput.value = String(bet.value)
}

function betDown() {
  setBet(Math.floor(bet.value / 2))
}

function betUp() {
  setBet(bet.value * 2)
}

// --- feature buys
// Bonus Hunter is a toggle "ante" mode: while on, every spin (and auto-spin)
// costs CM_BONUS_HUNT_COST × bet and is guaranteed at least one scatter.
const huntMode = ref(false)
const buyFreeSpinsCost = computed(() => bet.value * CM_BUY_FREESPINS_COST)
const bonusHuntCost = computed(() => bet.value * CM_BONUS_HUNT_COST)

function costFor(feature?: CandyFeature): number {
  if (feature === 'buyFreeSpins') return buyFreeSpinsCost.value
  if (feature === 'bonusHunt') return bonusHuntCost.value
  return bet.value
}

// Cost of a tap on the main SPIN button right now.
const spinCost = computed(() => huntMode.value ? bonusHuntCost.value : bet.value)

function toggleHunt() {
  if (isSpinning.value || autoSpinEnabled.value) return
  huntMode.value = !huntMode.value
}

// --- round state
const turbo = ref(false)
const isSpinning = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const winFlash = ref(false)

// bonus HUD
const inBonus = ref(false)
const bonusBanner = ref(false)
const bonusSpinsLeft = ref(0)
const bonusTotal = ref(0)
const bonusStatus = ref('')

const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

// --- auto-spin state
const autoSpinEnabled = ref(false)
const autoSpinsLeft = ref(0)
const autoSpinPaused = ref(false)
const showAutoSpinModal = ref(false)
const AUTO_SPIN_OPTIONS = [25, 50, 100, 250, 500]

let _resumeAutoSpin: (() => void) | null = null

function startAutoSpin(count: number) {
  autoSpinsLeft.value = count
  autoSpinEnabled.value = true
  autoSpinPaused.value = false
  showAutoSpinModal.value = false
  if (!isSpinning.value) spin()
}

function stopAutoSpin() {
  autoSpinEnabled.value = false
  autoSpinsLeft.value = 0
  autoSpinPaused.value = false
  _resumeAutoSpin?.()
  _resumeAutoSpin = null
}

function onCanvasClick() {
  if (autoSpinPaused.value) {
    autoSpinPaused.value = false
    _resumeAutoSpin?.()
    _resumeAutoSpin = null
  }
}

const bonusOdds = computed(() => {
  const total = CANDY_KEYS.reduce((a, k) => a + CANDY_WEIGHTS[k], 0) + SCATTER_WEIGHT
  const p = SCATTER_WEIGHT / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (
        n - i
    ) / (
        i + 1
    )
    return r
  }
  let pLess = 0
  for (let k = 0; k < CM_SCATTER_TRIGGER; k++) pLess += choose(CM_CELLS, k) * p ** k * q ** (
      CM_CELLS - k
  )
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

// --- sound effects (synthesized with the Web Audio API — no asset files)
const muted = ref(false)
let audioCtx: AudioContext | null = null

function toggleMute() {
  muted.value = !muted.value
  if (import.meta.client) localStorage.setItem('cm_muted', muted.value ? '1' : '0')
  if (!muted.value) blip(660, 0.06, 'sine', 0.1) // little "sound on" tick
}

// The context can only be created after a user gesture; spin/space both qualify.
function ensureAudio(): AudioContext | null {
  if (muted.value || !import.meta.client) return null
  if (!audioCtx) {
    const Ctx = window.AudioContext ?? (
        window as any
    ).webkitAudioContext
    if (!Ctx) return null
    audioCtx = new Ctx()
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  return audioCtx
}

// A short percussive blip at a fixed pitch.
function blip(freq: number, dur = 0.12, type: OscillatorType = 'sine', gain = 0.16) {
  const ctx = ensureAudio()
  if (!ctx) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

// A pitch sweep, used for the spin whoosh and win flourish.
function sweep(from: number, to: number, dur = 0.18, type: OscillatorType = 'triangle', gain = 0.18) {
  const ctx = ensureAudio()
  if (!ctx) return
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

// Named cues, kept light and candy-ish.
const sfx = {
  spin: () => sweep(220, 460, 0.16, 'sawtooth', 0.1),
  pop: (chain = 1) => blip(420 + Math.min(chain, 12) * 60, 0.11, 'triangle', 0.15),
  mult: () => blip(720, 0.1, 'square', 0.1),
  win: () => sweep(480, 920, 0.24, 'triangle', 0.18),
  bonus: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.2), i * 110))
}

onMounted(() => {
  if (import.meta.client && localStorage.getItem('cm_muted') === '1') muted.value = true
})

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects)
const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let multLayer: any = null
let particleLayer: any = null
let floatLayer: any = null
// Currency multiplier for the sequence currently being replayed (× bet), so
// cascade pop-ups can show real money values.
let activeBet = 1
// The sequence's final multiplier (Σ of all multiplier spots, applied to the
// whole sequence at the end). Each cluster's true contribution to the win is
// cl.pay × this, so the cascade pop-ups must include it or they undercount.
let activeMult = 1
const TEX: Record<string, any> = {}
let destroyed = false

const CELL = 66
const GAP = 5
const REEL_W = CM_COLS * CELL + (
    CM_COLS - 1
) * GAP
const REEL_H = CM_ROWS * CELL + (
    CM_ROWS - 1
) * GAP
const APP_W = REEL_W + 28
const APP_H = REEL_H + 28
const OFFSET_X = (
    APP_W - REEL_W
) / 2
const OFFSET_Y = (
    APP_H - REEL_H
) / 2

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const SYMBOL_IDS: CandySymbol[] = [...CANDY_KEYS, 'scatter']

const GLYPH: Record<CandySymbol, string> = {
  grape: '🍇', blue: '🫐', banana: '🍌', green: '🍉', apple: '🍎', orange: '🍊', red: '🍓', scatter: '🍭'
}

const POP_COLOR: Record<CandySymbol, number> = {
  grape: 0x9b3fc4, blue: 0x2f7fd0, banana: 0xf5c518, green: 0x4caf2e,
  apple: 0x66cc33, orange: 0xf0921a, red: 0xe2392a, scatter: 0xff5cae
}

const PAY_SIZES = [5, 8, 12, 15] as const
const paytableRows = (
    [...CANDY_KEYS].reverse()
).map(sym => (
    {
      sym,
      glyph: GLYPH[sym],
      pays: PAY_SIZES.map(n => Math.round(clusterPayMult(sym, n) * 1000) / 1000)
    }
))

const MULT_RAMP: Record<number, number> = {
  2: 0xf9a8d4, 4: 0xf472b6, 8: 0xec4899, 16: 0xd946ef, 32: 0xa855f7,
  64: 0x6366f1, 128: 0x3b82f6, 256: 0x22d3ee, 512: 0x22c55e, 1024: 0xf59e0b, 2048: 0xef4444
}

function multColor(v: number): number {
  return MULT_RAMP[v] ?? MULT_RAMP[2048]!
}

// Render an emoji to a texture so it can be used as a reel symbol.
function makeEmojiTexture(emoji: string) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.font = `${Math.floor(size * 0.82)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.04)
  return PIXI.Texture.from(canvas)
}

// --- candy symbol class
function makeSymbolClass() {
  const {Sprite} = PIXI
  const Base = REELS.ReelSymbol

  class CandyTile extends Base {
    sprite = new Sprite()
    w = CELL
    h = CELL
    _tween: any = null

    constructor() {
      super()
      this.sprite.anchor.set(0.5)
      this.view.addChild(this.sprite)
    }

    _render(id: string) {
      const t = TEX[id]
      if (!t) return
      this.sprite.texture = t
      const max = Math.min(this.w, this.h) * 0.92
      const s = Math.min(max / t.width, max / t.height)
      this.sprite.scale.set(s)
      this.sprite.x = this.w / 2
      this.sprite.y = this.h / 2
    }

    onActivate(id: string) {
      this.view.alpha = 1;
      this._render(id)
    }

    onDeactivate() {
      this._kill()
    }

    resize(w: number, h: number) {
      this.w = w;
      this.h = h;
      if (this.symbolId) this._render(this.symbolId)
    }

    stopAnimation() {
      this._kill();
      this.view.scale.set(1, 1)
    }

    _kill() {
      if (this._tween) {
        this._tween.kill();
        this._tween = null
      }
      this.view.scale.set(1, 1)
    }

    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(
            this.view.scale,
            {x: 1.14, y: 1.14, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res}
        )
      })
    }
  }

  return CandyTile
}

// --- candy-pop particles
function spawnPops(step: TumbleStep) {
  if (!particleLayer) return
  const {Graphics} = PIXI
  const count = turbo.value ? 4 : 7
  for (const wc of step.winCells) {
    const sym = step.grid[wc.col]?.[wc.row] as CandySymbol | undefined
    const color = sym ? (
        POP_COLOR[sym] ?? 0xffffff
    ) : 0xffffff
    const p = cellLocal(wc.col, wc.row)
    for (let k = 0; k < count; k++) {
      const g = new Graphics()
      g.circle(0, 0, 2.5 + Math.random() * 4)
          .fill({color})
      g.position.set(p.x, p.y)
      particleLayer.addChild(g)
      const ang = Math.random() * Math.PI * 2
      const dist = 16 + Math.random() * 30
      const dur = 0.4 + Math.random() * 0.25
      GSAP.to(g, {x: p.x + Math.cos(ang) * dist, y: p.y + Math.sin(ang) * dist - 8, duration: dur, ease: 'power2.out'})
      GSAP.to(g.scale, {x: 0.1, y: 0.1, duration: dur, ease: 'power1.in'})
      GSAP.to(g, {
        alpha: 0, duration: dur, ease: 'power1.in', onComplete: () => {
          try {
            g.destroy()
          } catch { /* ignore */
          }
        }
      })
    }
  }
}

// --- floating "+win" text for each cascade
function spawnWinText(step: TumbleStep) {
  if (!floatLayer || !step.clusters.length) return
  const {Text} = PIXI
  for (const cl of step.clusters) {
    const money = cl.pay * activeBet * activeMult
    if (money <= 0) continue

    // centroid of the cluster's cells
    let sx = 0
    let sy = 0
    for (const c of cl.cells) {
      const p = cellLocal(c.col, c.row)
      sx += p.x
      sy += p.y
    }
    const cx = sx / cl.cells.length
    const cy = sy / cl.cells.length

    const t = new Text({
      text: `+${formatNumber(money, false)}`,
      style: {
        fontFamily: 'system-ui, sans-serif', fontSize: 24, fontWeight: '900', fill: 0xfde047, align: 'center',
        stroke: {color: 0x7a1296, width: 5, join: 'round'},
        dropShadow: {color: 0x000000, blur: 4, distance: 2, alpha: 0.5, angle: Math.PI / 2}
      }
    })
    t.anchor.set(0.5)
    t.position.set(cx, cy)
    floatLayer.addChild(t)

    const dur = turbo.value ? 0.95 : 1.6
    GSAP.fromTo(t.scale, {x: 0.4, y: 0.4}, {x: 1, y: 1, duration: 0.3, ease: 'back.out(2.6)'})
    GSAP.to(t, {y: cy - 40, duration: dur, ease: 'power1.out'})
    GSAP.to(t, {
      alpha: 0, duration: dur * 0.38, delay: dur * 0.62, ease: 'power1.in', onComplete: () => {
        try {
          t.destroy()
        } catch { /* ignore */
        }
      }
    })
  }
}

// --- multiplier badge overlay
const badges = new Map<string, { value: number, view: any, label: any, bg: any }>()

function cellLocal(col: number, row: number): { x: number, y: number } {
  return {
    x: col * (
        CELL + GAP
    ) + CELL / 2,
    y: row * (
        CELL + GAP
    ) + CELL / 2
  }
}

function styleBadge(b: { value: number, label: any, bg: any }) {
  const c = multColor(b.value)
  b.label.text = `×${b.value}`
  const w = Math.max(46, b.label.width + 14)
  const h = 34
  b.bg.clear()
  b.bg.roundRect(-w / 2, -h / 2, w, h, 10)
      .fill({color: c, alpha: 0.22})
      .stroke({color: c, width: 2, alpha: 0.7})
}

function makeBadge(col: number, row: number, value: number) {
  const {Container, Graphics, Text} = PIXI
  const view = new Container()
  const bg = new Graphics()
  const label = new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif', fontSize: 19, fontWeight: '900', fill: 0xffffff, align: 'center',
      stroke: {color: 0x2a0612, width: 4, join: 'round'},
      dropShadow: {color: 0x000000, blur: 3, distance: 1, alpha: 0.55, angle: Math.PI / 2}
    }
  })
  label.anchor.set(0.5)
  view.addChild(bg)
  view.addChild(label)
  const p = cellLocal(col, row)
  view.position.set(p.x, p.y)
  multLayer.addChild(view)
  const b = {value, view, label, bg}
  styleBadge(b)
  badges.set(`${col}:${row}`, b)
  GSAP.fromTo(view.scale, {x: 0, y: 0}, {x: 1, y: 1, duration: 0.3, ease: 'back.out(2)'})
}

function bumpBadge(b: { value: number, view: any, label: any, bg: any }, value: number) {
  b.value = value
  styleBadge(b)
  GSAP.fromTo(b.view.scale, {x: 1.5, y: 1.5}, {x: 1, y: 1, duration: 0.32, ease: 'back.out(2.5)'})
}

function syncBadges(spots: MultSpot[]) {
  for (const s of spots) {
    const k = `${s.col}:${s.row}`
    const existing = badges.get(k)
    if (!existing) makeBadge(s.col, s.row, s.value)
    else if (existing.value !== s.value) bumpBadge(existing, s.value)
  }
}

function pulseBadges() {
  for (const b of badges.values()) {
    GSAP.fromTo(b.view.scale, {x: 1.28, y: 1.28}, {x: 1, y: 1, duration: 0.38, ease: 'back.out(2)'})
  }
}

function clearBadges() {
  for (const b of badges.values()) {
    try {
      b.view.destroy({children: true})
    } catch { /* ignore */
    }
  }
  badges.clear()
}

// --- pixi bootstrap
function toTargets(grid: CandySymbol[][]) {
  return grid.map(col => (
      {visible: col}
  ))
}

onMounted(async () => {
  try {
    const [pixi, reels, gsapMod] = await Promise.all([
      import('pixi.js'),
      import('pixi-reels'),
      import('gsap')
    ])
    if (destroyed) return
    PIXI = pixi
    REELS = reels
    GSAP = gsapMod.gsap ?? gsapMod.default

    app = new PIXI.Application()
    await app.init({
      width: APP_W,
      height: APP_H,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1)
    })
    if (destroyed) {
      app.destroy(true);
      return
    }
    canvasWrap.value?.appendChild(app.canvas)

    await Promise.all(SYMBOL_IDS.map(async (id) => {
      if (id === 'scatter') {
        TEX[id] = makeEmojiTexture(GLYPH.scatter)
        return
      }
      TEX[id] = await PIXI.Assets.load(`/slots/candyblast/${id}.png`)
    }))
    if (destroyed) {
      app.destroy(true);
      return
    }

    const CandyTile = makeSymbolClass()

    const weights: Record<string, number> = {scatter: SCATTER_WEIGHT}
    for (const k of CANDY_KEYS) weights[k] = CANDY_WEIGHTS[k]

    reelSet = new REELS.ReelSetBuilder()
        .reels(CM_COLS)
        .visibleRows(CM_ROWS)
        .symbolSize(CELL, CELL)
        .symbolGap(GAP, GAP)
        .symbols((r: any) => {
          for (const id of SYMBOL_IDS) r.register(id, CandyTile, {})
        })
        .weights(weights)
        .tumble({
          fall: {duration: 240, ease: 'sine.in', rowStagger: 0},
          dropIn: {duration: 380, ease: 'back.out(1.4)', rowStagger: 40, distance: 'perHole'}
        })
        .speed('normal', REELS.SpeedPresets.NORMAL)
        .speed('turbo', REELS.SpeedPresets.TURBO)
        .ticker(app.ticker)
        .build()

    reelSet.x = OFFSET_X
    reelSet.y = OFFSET_Y
    app.stage.addChild(reelSet)

    multLayer = new PIXI.Container()
    multLayer.x = OFFSET_X
    multLayer.y = OFFSET_Y
    app.stage.addChild(multLayer)

    particleLayer = new PIXI.Container()
    particleLayer.x = OFFSET_X
    particleLayer.y = OFFSET_Y
    particleLayer.eventMode = 'none'
    app.stage.addChild(particleLayer)

    // floating "+win" text sits on top of everything
    floatLayer = new PIXI.Container()
    floatLayer.x = OFFSET_X
    floatLayer.y = OFFSET_Y
    floatLayer.eventMode = 'none'
    app.stage.addChild(floatLayer)

    reelSet.setResult(toTargets(randomGrid()))
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onUnmounted(() => {
  destroyed = true
  try {
    clearBadges()
  } catch { /* ignore */
  }
  try {
    multLayer?.destroy?.({children: true})
  } catch { /* ignore */
  }
  try {
    particleLayer?.destroy?.({children: true})
  } catch { /* ignore */
  }
  try {
    floatLayer?.destroy?.({children: true})
  } catch { /* ignore */
  }
  try {
    reelSet?.destroy?.()
  } catch { /* ignore */
  }
  try {
    app?.destroy?.(true)
  } catch { /* ignore */
  }
})

function randomGrid(): CandySymbol[][] {
  const grid: CandySymbol[][] = []
  for (let c = 0; c < CM_COLS; c++) {
    const col: CandySymbol[] = []
    for (let r = 0; r < CM_ROWS; r++) col.push(CANDY_KEYS[Math.floor(Math.random() * CANDY_KEYS.length)]!)
    grid.push(col)
  }
  return grid
}

// --- spin flow
// One-shot buy: pay the price and drop straight into free spins.
function buyFreeSpins() {
  if (!ready.value || isSpinning.value || autoSpinEnabled.value) return
  if (balance.value < buyFreeSpinsCost.value) return
  spin('buyFreeSpins')
}

async function spin(forceFeature?: CandyFeature) {
  // An explicit buy wins over the Bonus Hunter toggle.
  const feature: CandyFeature | undefined = forceFeature ?? (
      huntMode.value ? 'bonusHunt' : undefined
  )
  const cost = costFor(feature)
  if (!ready.value || isSpinning.value || balance.value < cost) return
  isSpinning.value = true
  sfx.spin()
  errorMsg.value = ''
  lastWin.value = 0
  winFlash.value = false

  let data: { gameData: CandyMadnessResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: {bet: bet.value, game: 'candymadness', options: feature ? {feature} : undefined}
    }) as { gameData: CandyMadnessResult, balance: number }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    isSpinning.value = false
    stopAutoSpin()
    return
  }

  const result = data.gameData
  activeBet = result.bet

  try {
    clearBadges()
    const baseWin = await spinAndCascade(result.base)
    lastWin.value = baseWin * result.bet

    if (result.bonusTriggered && result.bonus) {
      // Highlight the trigger scatters (bought bonuses now also drop 3 for show).
      if (result.scatterCells.length) {
        await reelSet.spotlight.show(result.scatterCells.map((c: Cell) => (
            {reelIndex: c.col, rowIndex: c.row}
        )))
        await wait(700)
        // show() dims the whole board and never restores it on its own; hide()
        // removes the dim overlay so the bonus doesn't play out darkened.
        reelSet.spotlight.hide()
      }
      if (autoSpinEnabled.value) {
        autoSpinPaused.value = true
        await new Promise<void>((res) => {
          _resumeAutoSpin = res
        })
      }
      await runBonus(result)
    }

    lastWin.value = result.payout
    winFlash.value = result.payout > 0
    if (result.payout > 0) sfx.win()
    balance.value = data.balance
    setBalance(data.balance)
    history.value.unshift({payout: result.payout, bet: result.cost, bonus: result.bonusTriggered})
    if (history.value.length > 10) history.value.pop()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
    stopAutoSpin()
  } finally {
    isSpinning.value = false
    if (autoSpinEnabled.value) {
      if (autoSpinPaused.value) {
        await new Promise<void>((res) => {
          _resumeAutoSpin = res
        })
      }
      if (autoSpinEnabled.value) {
        autoSpinsLeft.value--
        if (autoSpinsLeft.value > 0 && balance.value >= spinCost.value) spin()
        else stopAutoSpin()
      }
    }
  }
}

async function spinAndCascade(seq: TumbleSequence): Promise<number> {
  // The multiplier applies to the whole sequence at the end; surface it on the
  // per-cluster pop-ups so they reflect the real (multiplied) win, not base pay.
  activeMult = Math.max(1, seq.multiplierSum)
  reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
  const first = seq.steps[0]?.grid ?? seq.restGrid
  const spinPromise = reelSet.spin({mode: 'cascade'})
  reelSet.setResult(toTargets(first))
  await spinPromise

  await reelSet.runCascade({
    detectWinners: (_g: string[][], lvl: number) =>
        (
            seq.steps[lvl]?.winCells ?? []
        ).map((c: Cell) => (
            {reel: c.col, row: c.row}
        )),
    nextGrid: (_g: string[][], _w: any, lvl: number) =>
        (
            seq.steps[lvl + 1]?.grid ?? seq.restGrid
        ) as unknown as string[][],
    onCascade: ({chain}: { chain: number }) => onTumble(seq.steps[chain - 1], chain),
    pauseAfterDestroyMs: turbo.value ? 130 : 300,
    maxChain: 64
  })

  if (seq.basePay > 0 && seq.multiplierSum > 1 && badges.size) {
    pulseBadges()
    sfx.mult()
    await wait(turbo.value ? 250 : 550)
  }
  return seq.win
}

function onTumble(step: TumbleStep | undefined, chain = 1) {
  if (!step) return
  if (step.winCells.length) sfx.pop(chain)
  spawnPops(step)
  spawnWinText(step)
  syncBadges(step.spotsAfter)
}

async function runBonus(result: CandyMadnessResult) {
  const bonus = result.bonus!
  inBonus.value = true
  bonusBanner.value = true
  bonusTotal.value = 0
  bonusSpinsLeft.value = CM_FREE_SPINS
  bonusStatus.value = 'Free Spins!'
  sfx.bonus()
  clearBadges()
  await wait(1200)
  bonusBanner.value = false

  try {
    for (const fs of bonus.spins) {
      bonusStatus.value = `Spin ${fs.round} / ${CM_FREE_SPINS}`
      bonusSpinsLeft.value = CM_FREE_SPINS - fs.round
      const win = await spinAndCascade(fs.sequence)
      bonusTotal.value += win * result.bet
      await wait(turbo.value ? 150 : 380)
    }

    bonusTotal.value = result.bonusPayout
    bonusSpinsLeft.value = 0
    bonusStatus.value = result.bonusPayout > 0 ? 'Bonus complete!' : 'No win this time'
    await wait(1400)
  } finally {
    clearBadges()
    inBonus.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    if (!autoSpinEnabled.value) spin()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Candy background, scoped to the page (not the sidebar) -->
  <div class="page-root relative min-h-full flex flex-col items-center justify-start overflow-hidden px-3 pt-10 pb-6">
    <div class="page-bg"/>
    <div class="page-vignette"/>

    <!-- ── Title (centered over the board) ── -->
    <div class="cm-title relative z-[1] mb-2 sm:mb-3 text-center">
      <h1 class="cm-title__text">
        <span class="cm-title__emoji">🍭</span>
        Candy Madness
        <span class="cm-title__emoji">🍬</span>
      </h1>
      <div class="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <span class="cm-badge cm-badge--rtp">98% RTP</span>
        <span class="cm-badge cm-badge--vol">Low Volatility</span>
        <span class="cm-badge cm-badge--cascade">Cascade</span>
      </div>
    </div>

    <!-- Game + feature buys. The board stays centered on the page; the buy
         cards float to its left on desktop so they don't push it off-centre. -->
    <div class="game-layout relative w-full max-w-[600px] flex flex-col">
      <!-- ── Feature buy cards: below the board on mobile, floated left on desktop ── -->
      <div class="order-2 mt-3 lg:mt-0 lg:absolute lg:top-0 lg:right-full lg:mr-4 w-full lg:w-auto flex flex-row lg:flex-col gap-3">
        <!-- BUY FREE SPINS -->
        <button
            :disabled="!ready  || autoSpinEnabled || balance < buyFreeSpinsCost"
            class="group relative w-50 shrink-0 overflow-hidden flex flex-col gap-2 rounded-2xl p-3 text-left text-white cursor-pointer transition bg-gradient-to-b from-pink-500/25 to-[#0a041a]/60 border border-pink-500/45 shadow-[0_10px_30px_rgba(0,0,0,0.55)] hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:opacity-40 disabled:cursor-default disabled:saturate-[0.6] disabled:translate-y-0"
            @click="buyFreeSpins"
        >
          <span class="pointer-events-none absolute inset-x-0 -top-1/2 h-2/3 opacity-60 bg-[radial-gradient(ellipse_at_50%_0%,rgba(244,114,182,0.55),transparent_70%)]"/>

          <span class="relative flex items-center gap-2">
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-500/20 ring-1 ring-inset ring-pink-400/40 text-base leading-none">
        🍭
      </span>
      <span class="font-black uppercase tracking-wide leading-tight">Buy Free Spins</span>
    </span>

          <span class="relative text-sm leading-snug text-violet-300/70">
      Drop straight into {{ CM_FREE_SPINS }} free spins
    </span>

          <span class="relative mt-auto inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1 font-mono text-[12.5px] font-extrabold bg-black/30 ring-1 ring-inset ring-violet-500/20">
      <CoinBalance :compact="false" :value="buyFreeSpinsCost"/>
    </span>
        </button>

        <!-- BONUS HUNTER (toggle) -->
        <button
            :class="huntMode ? 'border-sky-400/70 shadow-[0_0_22px_rgba(56,189,248,0.45)]' : 'border-violet-500/35 shadow-[0_10px_30px_rgba(0,0,0,0.55)]'"
            :disabled="!ready || autoSpinEnabled"
            class="group relative w-50 shrink-0 overflow-hidden flex flex-col gap-2 rounded-2xl p-3 text-left text-white cursor-pointer transition bg-gradient-to-b from-violet-500/20 to-[#0a041a]/60 border hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0 disabled:opacity-40 disabled:cursor-default disabled:saturate-[0.6] disabled:translate-y-0"
            @click="toggleHunt"
        >
    <span
        :class="huntMode ? 'opacity-100' : 'opacity-50'"
        class="pointer-events-none absolute inset-x-0 -top-1/2 h-2/3 bg-[radial-gradient(ellipse_at_50%_0%,rgba(56,189,248,0.45),transparent_70%)] transition-opacity"
    />
          <span
              :class="huntMode ? 'text-sky-950 bg-gradient-to-b from-sky-300 to-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]' : 'text-violet-300/60 bg-black/35 ring-1 ring-inset ring-violet-500/25'"
              class="absolute top-2.5 right-2.5 rounded-full px-1.5 py-0.5 text-xs font-black tracking-wider"
          >{{ huntMode ? 'ON' : 'OFF' }}</span>

          <span class="relative flex items-center gap-2 pr-8">
      <span
          :class="huntMode ? 'bg-sky-400/20 ring-1 ring-inset ring-sky-300/50' : 'bg-violet-500/15 ring-1 ring-inset ring-violet-400/30'"
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base leading-none transition"
      >🔍</span>
      <span class="font-black uppercase tracking-wide leading-tight">Bonus Hunter</span>
    </span>

          <span class="relative text-sm leading-snug text-violet-300/70">
          Force a 🍭 every spin — far better bonus odds
        </span>

          <span class="relative mt-auto inline-flex items-center gap-1.5 self-start rounded-lg px-2.5 py-1 font-mono text-sm font-extrabold bg-black/30 ring-1 ring-inset ring-violet-500/20">
            <CoinBalance :compact="false" :value="bonusHuntCost"/>
            <span class="text-[9px] font-bold uppercase tracking-wider text-violet-300/50">+/ spin</span>
          </span>
        </button>
      </div>

      <!-- Slot machine -->
      <div class="machine order-1 w-full flex flex-col">
        <!-- ── Reel area: purple gradient ── -->
        <div
            class="reel-area relative select-none"
            @click="onCanvasClick"
        >
          <!-- inner sheen / vignette over the grid -->
          <div class="reel-sheen"/>
          <!-- Bonus banner -->
          <Transition name="pop">
            <div
                v-if="bonusBanner"
                class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
              <div class="bonus-banner text-center">
                <p class="text-3xl font-black text-white tracking-tight drop-shadow-lg">
                  CANDY MADNESS
                </p>
                <p
                    class="text-sm font-bold mt-1"
                    style="color: #fce7f3;"
                >
                  {{ CM_FREE_SPINS }} free spins — multipliers stay & grow!
                </p>
              </div>
            </div>
          </Transition>

          <!-- Auto-spin pause overlay -->
          <Transition name="pop">
            <div
                v-if="autoSpinPaused"
                class="absolute inset-0 z-20 flex items-center justify-center cursor-pointer"
                style="background: rgba(8,2,20,0.78); backdrop-filter: blur(3px);"
            >
              <div class="pause-card text-center px-6 py-4">
                <p class="font-black text-white text-base">
                  🍭 Bonus! Tap to play
                </p>
                <p
                    class="text-xs mt-1"
                    style="color: rgba(216,180,254,0.65);"
                >
                  {{ autoSpinsLeft }} spin{{ autoSpinsLeft !== 1 ? 's' : '' }} remaining
                </p>
              </div>
            </div>
          </Transition>

          <!-- Canvas -->
          <div
              ref="canvasWrap"
              class="relative z-10 w-full [&>canvas]:!w-full [&>canvas]:!h-auto [&>canvas]:block"
          />

          <!-- Loading -->
          <div
              v-if="!ready && !errorMsg"
              class="absolute inset-0 z-40 flex items-center justify-center"
          >
            <UIcon
                class="size-10 animate-spin"
                name="i-lucide-loader-circle"
                style="color: #c084fc;"
            />
          </div>
        </div>

        <!-- ── Control bar ── -->
        <div class="ctrl-bar flex items-center gap-2 sm:gap-4 px-4 py-3.5">
          <!-- LEFT: icons + credit/bet -->
          <div class="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
            <!-- Action icons stacked -->
            <div class="flex flex-col gap-1.5 shrink-0">
              <button
                  class="icon-btn"
                  title="Help"
                  @click="showHelp = true"
              >
                <UIcon
                    class="size-3.5"
                    name="i-lucide-info"
                />
              </button>
              <button
                  :class="{ 'icon-btn--active': turbo }"
                  class="icon-btn"
                  title="Turbo"
                  @click="turbo = !turbo"
              >
                <UIcon
                    class="size-3.5"
                    name="i-lucide-zap"
                />
              </button>
              <button
                  class="icon-btn"
                  :title="muted ? 'Unmute' : 'Mute'"
                  @click="toggleMute"
              >
                <UIcon
                    class="size-3.5"
                    :name="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
                />
              </button>
            </div>

            <!-- Credit + Bet readouts -->
            <div class="min-w-0 flex flex-col gap-1.5">
              <div class="readout w-full flex justify-between">
                <span class="ctrl-value truncate">
                  <CoinBalance
                      :compact="false"
                      :value="balance"
                  />
                </span>
              </div>
              <div class="readout w-full justify-between">
                <span class="ctrl-label">Bet</span>
                <input
                    v-model="betInput"
                    :disabled="isSpinning || autoSpinEnabled"
                    aria-label="Bet amount"
                    class="bet-input ctrl-value tabular-nums"
                    inputmode="numeric"
                    @blur="commitBetInput"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                >
              </div>
            </div>
          </div>

          <!-- CENTER: WIN -->
          <div class="flex flex-col items-center justify-center shrink-0 min-w-[84px]">
            <div
                v-if="inBonus"
                class="text-center"
            >
              <p
                  class="text-[9px] uppercase tracking-[0.2em] mb-1"
                  style="color: rgba(216,180,254,0.55);"
              >
                {{ bonusStatus }}
              </p>
              <p class="text-xl font-black tabular-nums leading-none text-emerald-400 drop-shadow-[0_0_12px_rgba(52,211,153,0.5)]">
                {{ formatNumber(bonusTotal, false) }}
              </p>
            </div>

            <template v-else>
              <span class="ctrl-label mb-1">Win</span>
              <Transition
                  mode="out-in"
                  name="pop"
              >
                <span
                    v-if="winFlash && lastWin > 0"
                    key="win"
                    class="win-amount"
                >{{ formatNumber(lastWin, false) }}</span>
                <span
                    v-else
                    key="idle"
                    class="win-idle"
                >0.00</span>
              </Transition>
            </template>
          </div>

          <!-- RIGHT: − SPIN + / AUTO -->
          <div class="flex items-center gap-2 sm:gap-2.5 flex-1 justify-end">
            <!-- Halve bet -->
            <button
                :disabled="isSpinning || autoSpinEnabled || bet <= MIN_BET"
                class="adj-btn"
                title="Halve bet"
                @click="betDown"
            >
              <span class="text-sm font-black leading-none">½</span>
            </button>

            <!-- SPIN + AUTO stacked -->
            <div class="flex flex-col items-center gap-1.5">
              <button
                  :disabled="!ready || balance < spinCost || isSpinning"
                  class="spin-btn"
                  @click="autoSpinEnabled ? stopAutoSpin() : spin()"
              >
                <span class="spin-btn__ring"/>
                <UIcon
                    v-if="isSpinning"
                    class="size-6 animate-spin relative"
                    name="i-lucide-loader-circle"
                />
                <span
                    v-else-if="autoSpinEnabled"
                    class="flex flex-col items-center leading-none relative"
                >
                  <span class="text-[10px] tracking-wider opacity-80">{{ autoSpinsLeft }}×</span>
                  <span class="text-xs font-black">STOP</span>
                </span>
                <span
                    v-else
                    class="relative"
                >SPIN</span>
              </button>

              <button
                  v-if="!autoSpinEnabled"
                  :disabled="!ready || balance < spinCost || isSpinning"
                  class="auto-btn"
                  @click="showAutoSpinModal = true"
              >
                AUTO
              </button>
              <button
                  v-else
                  class="auto-btn auto-btn--stop"
                  @click="stopAutoSpin"
              >
                STOP
              </button>
            </div>

            <!-- Double bet -->
            <button
                :disabled="isSpinning || autoSpinEnabled || bet >= MAX_BET"
                class="adj-btn"
                title="Double bet"
                @click="betUp"
            >
              <span class="text-xs font-black leading-none">2×</span>
            </button>
          </div>
        </div>

        <!-- Error strip -->
        <Transition name="fade-up">
          <div
              v-if="errorMsg"
              class="error-strip flex items-center justify-between gap-3 px-4 py-2"
          >
            <p class="text-xs text-red-400">
              {{ errorMsg }}
            </p>
            <button
                class="text-red-400/50 hover:text-red-300 text-sm transition-colors"
                @click="errorMsg = ''"
            >
              ✕
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <!-- History -->
    <div class="min-h-8">
      <div
          v-if="history.length"
          class="flex gap-1.5 flex-wrap justify-center mt-3"
      >
      <span
          v-for="(h, i) in history"
          :key="i"
          :class="h.payout > h.bet ? 'bg-emerald-500/15 text-emerald-400' : 'text-white/20'"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold"
          style="background: rgba(255,255,255,0.04);"
      >
        <UIcon
            v-if="h.bonus"
            class="size-3"
            name="i-lucide-gift"
        />
        {{ h.payout > 0 ? formatNumber(h.payout) : '—' }}
      </span>
      </div>
    </div>

    <!-- Auto-spin modal -->
    <UModal
        v-model:open="showAutoSpinModal"
        title="Auto Spin"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-muted">
            Select number of spins. Auto-spin pauses before a bonus round so you can watch — tap the board to resume.
          </p>
          <div class="grid grid-cols-5 gap-2">
            <UButton
                v-for="count in AUTO_SPIN_OPTIONS"
                :key="count"
                block
                class="font-bold"
                color="neutral"
                variant="soft"
                @click="startAutoSpin(count)"
            >
              {{ count }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Help modal -->
    <UModal
        v-model:open="showHelp"
        title="How Candy Madness works"
    >
      <template #body>
        <div class="space-y-4 text-sm text-muted">
          <ul class="space-y-1.5 list-disc list-inside">
            <li>Land <strong class="text-default">{{ CM_MIN_CLUSTER }}+</strong> matching candies connected
              up/down/left/right to win a <strong class="text-default">cluster</strong>.
            </li>
            <li>Winning candies pop and <strong class="text-default">tumble</strong> — new candies drop in, so one spin
              can chain many wins.
            </li>
            <li>Every popped position leaves a <strong class="text-primary">multiplier</strong> starting at <strong
                class="text-default">×2</strong>, doubling each time it wins again (up to <strong class="text-default">×{{
                formatNumber(
                    CM_MULT_CAP,
                    true,
                    0
                )
              }}</strong>). When tumbling stops, the <strong class="text-default">sum of all multipliers</strong>
              multiplies the whole spin's win.
            </li>
            <li>Land <strong class="text-default">{{ CM_SCATTER_TRIGGER }}+ 🍭</strong> to win
              <strong class="text-default">{{ CM_FREE_SPINS }} free spins</strong> (~1 in {{
                formatNumber(
                    bonusOdds,
                    true,
                    0
                )
              }}). During free spins the multipliers <strong class="text-default">stay on the grid and keep
                growing</strong> all feature long.
            </li>
          </ul>
          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Cluster pays × your bet
            </p>
            <div class="rounded-lg border border-default overflow-hidden">
              <div class="grid grid-cols-[auto_1fr] text-xs text-muted bg-elevated/60 border-b border-default">
                <div class="px-3 py-1"/>
                <div class="px-3 py-1 flex justify-end gap-3 font-medium">
                  <span class="w-12 text-right">5</span>
                  <span class="w-12 text-right">8</span>
                  <span class="w-12 text-right">12</span>
                  <span class="w-12 text-right text-default">15+</span>
                </div>
              </div>
              <div class="grid grid-cols-[auto_1fr] items-center text-sm">
                <template
                    v-for="(row, i) in paytableRows"
                    :key="row.sym"
                >
                  <div
                      :class="i % 2 ? 'bg-elevated/40' : ''"
                      class="px-3 py-1.5 flex items-center justify-center"
                  >
                    <img
                        :alt="row.sym"
                        :src="`/slots/candyblast/${row.sym}.png`"
                        class="h-7 w-7 object-contain"
                    >
                  </div>
                  <div
                      :class="i % 2 ? 'bg-elevated/40' : ''"
                      class="px-3 py-1.5 font-mono tabular-nums flex justify-end gap-3"
                  >
                    <span class="w-12 text-right text-muted">{{ row.pays[0] }}×</span>
                    <span class="w-12 text-right text-muted">{{ row.pays[1] }}×</span>
                    <span class="w-12 text-right text-muted">{{ row.pays[2] }}×</span>
                    <span class="w-12 text-right font-bold text-default">{{ row.pays[3] }}×</span>
                  </div>
                </template>
              </div>
            </div>
            <p class="text-[11px] text-muted mt-1.5">
              Base pays are small on purpose — the stacked multipliers are where the big wins come from.
            </p>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* ── Page background, scoped to the main content area ───────────────────── */
.page-root {
  /* fill the <main> scroll area so the bg never reaches the sidebar */
  min-height: 100%;
}

.page-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: url('/slots/candyblast/candy_madness_bg.jpg') center / cover no-repeat;
}

/* dark vignette so the machine pops and the art doesn't compete with it */
.page-vignette {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(ellipse 70% 60% at 50% 45%, rgba(8, 2, 20, 0.45) 0%, rgba(8, 2, 20, 0.78) 70%, rgba(5, 1, 14, 0.92) 100%);
}

.page-root > .game-layout {
  position: relative;
  z-index: 1;
}

.page-root > div:not(.page-bg):not(.page-vignette):not(.game-layout) {
  position: relative;
  z-index: 1;
}

/* ── Title ──────────────────────────────────────────────────────────────── */
.cm-title__text {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-size: clamp(30px, 6vw, 46px);
  font-weight: 900;
  letter-spacing: 0.5px;
  line-height: 1;
  /* glossy candy gradient poured top-to-bottom over the letters */
  background: linear-gradient(180deg, #ffffff 0%, #ffe3f4 26%, #ff86d3 58%, #b06bff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  /* candy-shell drop + soft fuchsia glow */
  filter: drop-shadow(0 2px 0 rgba(122, 18, 150, 0.55))
  drop-shadow(0 6px 16px rgba(217, 70, 239, 0.5));
}

/* emojis keep their own colour (not clipped by the gradient fill) */
.cm-title__emoji {
  -webkit-text-fill-color: initial;
  filter: drop-shadow(0 3px 5px rgba(0, 0, 0, 0.45));
}

.cm-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #fff;
  background: rgba(10, 4, 26, 0.45);
  border: 1px solid rgba(232, 121, 249, 0.3);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(2px);
}

.cm-badge--rtp {
  color: #bbf7d0;
  border-color: rgba(52, 211, 153, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(52, 211, 153, 0.28);
}

.cm-badge--vol {
  color: #bae6fd;
  border-color: rgba(56, 189, 248, 0.5);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(56, 189, 248, 0.28);
}

.cm-badge--cascade {
  color: #fbcfe8;
  border-color: rgba(244, 114, 182, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 12px rgba(244, 114, 182, 0.3);
}

/* ── Machine shell ──────────────────────────────────────────────────────── */
.machine {
  border-radius: 22px;
  padding: 8px;
  background: linear-gradient(160deg, rgba(168, 85, 247, 0.25), rgba(76, 29, 149, 0.12) 40%, rgba(10, 4, 26, 0.6));
  box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.35),
  inset 0 1px 0 rgba(232, 121, 249, 0.25),
  0 0 60px rgba(139, 92, 246, 0.25),
  0 30px 80px rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(2px);
}

/* ── Reel area ──────────────────────────────────────────────────────────── */
.reel-area {
  background: radial-gradient(ellipse 120% 75% at 50% 0%, #7c3aed 0%, #5b21b6 26%, #3b0f7a 52%, #1e0a47 78%, #160835 100%);
  border-radius: 16px 16px 0 0;
  box-shadow: inset 0 0 0 1px rgba(232, 121, 249, 0.18), inset 0 2px 18px rgba(0, 0, 0, 0.35);
  cursor: default;
  overflow: hidden;
}

/* soft inner vignette + top sheen on the grid */
.reel-sheen {
  position: absolute;
  inset: 0;
  z-index: 15;
  pointer-events: none;
  background: radial-gradient(ellipse 80% 55% at 50% 110%, rgba(0, 0, 0, 0.35) 0%, transparent 60%),
  linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, transparent 18%);
}

/* ── Bonus / pause overlays ─────────────────────────────────────────────── */
.bonus-banner {
  padding: 20px 32px;
  border-radius: 18px;
  transform: rotate(-2deg);
  background: linear-gradient(135deg, #ec4899, #a855f7);
  box-shadow: 0 8px 40px rgba(236, 72, 153, 0.55);
}

.pause-card {
  border-radius: 14px;
  background: rgba(18, 6, 38, 0.95);
  border: 1px solid rgba(139, 92, 246, 0.35);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

/* ── Control bar ────────────────────────────────────────────────────────── */
.ctrl-bar {
  background: linear-gradient(180deg, #150a2e 0%, #0c0420 100%);
  border-top: 1px solid rgba(168, 85, 247, 0.28);
  border-radius: 0 0 16px 16px;
  box-shadow: inset 0 1px 0 rgba(232, 121, 249, 0.12);
}

/* Credit / Bet readout chips */
.readout {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.28);
  box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.14);
}

.ctrl-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: rgba(216, 180, 254, 0.45);
  flex-shrink: 0;
}

.ctrl-value {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.01em;
}

/* Editable bet field — looks like the readout value, free typing for any stake */
.bet-input {
  min-width: 0;
  flex: 1;
  text-align: right;
  background: transparent;
  border: none;
  outline: none;
  padding: 0;
  appearance: textfield;
}

.bet-input:focus {
  color: #fde047;
}

.bet-input:disabled {
  opacity: 0.6;
  cursor: default;
}

.bet-input::-webkit-inner-spin-button,
.bet-input::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

/* Win amount */
.win-amount {
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: #fde047;
  text-shadow: 0 0 18px rgba(250, 204, 21, 0.6), 0 1px 1px rgba(0, 0, 0, 0.4);
}

.win-idle {
  font-size: 22px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgba(216, 180, 254, 0.18);
}

/* Info / Turbo icon buttons */
.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(216, 180, 254, 0.5);
  border: 1px solid rgba(168, 85, 247, 0.2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.icon-btn:hover {
  background: rgba(168, 85, 247, 0.18);
  color: #fff;
  border-color: rgba(168, 85, 247, 0.4);
}

.icon-btn--active {
  background: rgba(250, 204, 21, 0.18);
  color: #fde047;
  border-color: rgba(250, 204, 21, 0.4);
  box-shadow: 0 0 10px rgba(250, 204, 21, 0.3);
}

/* Bet adjustment − / + buttons */
.adj-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(245, 235, 255, 0.85);
  background: radial-gradient(circle at 50% 30%, #3b1c6b 0%, #25104a 100%);
  border: 1px solid rgba(168, 85, 247, 0.35);
  box-shadow: inset 0 1px 0 rgba(232, 121, 249, 0.2), 0 2px 6px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: filter 0.15s, transform 0.1s;
}

.adj-btn:hover:not(:disabled) {
  filter: brightness(1.3);
}

.adj-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.adj-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

/* SPIN button */
.spin-btn {
  position: relative;
  width: 74px;
  height: 74px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  background: radial-gradient(circle at 50% 28%, #f5abff 0%, #d946ef 38%, #a21caf 78%, #7a1296 100%);
  box-shadow: 0 5px 0 #5b0d77,
  0 10px 28px rgba(217, 70, 239, 0.55),
  inset 0 2px 4px rgba(255, 255, 255, 0.45);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: transform 0.08s, box-shadow 0.08s, filter 0.15s, opacity 0.15s;
  border: none;
  outline: none;
}

/* glossy ring */
.spin-btn__ring {
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, transparent 45%);
  pointer-events: none;
}

.spin-btn:hover:not(:disabled) {
  filter: brightness(1.08);
}

.spin-btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: 0 1px 0 #5b0d77, 0 4px 14px rgba(217, 70, 239, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.35);
}

.spin-btn:disabled {
  opacity: 0.5;
  cursor: default;
  filter: saturate(0.6);
}

/* AUTO / STOP text button */
.auto-btn {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  font-weight: 800;
  color: rgba(216, 180, 254, 0.5);
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.15s;
  padding: 0;
}

.auto-btn:hover:not(:disabled) {
  color: #e9d5ff;
}

.auto-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.auto-btn--stop {
  color: rgba(248, 113, 113, 0.75);
}

.auto-btn--stop:hover {
  color: #f87171;
}

/* Error strip */
.error-strip {
  background: rgba(127, 29, 29, 0.55);
  border-top: 1px solid rgba(185, 28, 28, 0.4);
  border-radius: 0 0 16px 16px;
}

/* ── Transitions ────────────────────────────────────────────────────────── */
.fade-up-enter-active, .fade-up-leave-active {
  transition: all 0.2s ease;
}

.fade-up-enter-from, .fade-up-leave-to {
  opacity: 0;
  transform: translateY(5px);
}

.pop-enter-active {
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.pop-leave-active {
  transition: all 0.18s ease;
}

.pop-enter-from {
  opacity: 0;
  transform: scale(0.7);
}

.pop-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
