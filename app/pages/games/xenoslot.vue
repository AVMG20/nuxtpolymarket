<script setup lang="ts">
import type { XenoSlotResult, BonusWave, Cell, SlotSymbol } from '#shared/utils/gamelogic/xenoslot'
import { XENOSLOT_LINES, XENOSLOT_MAX_WIN_MULT, BONUS_FREE_SPINS, BONUS_TRIGGER_COUNT, XENOSLOT_CELLS, PAYTABLE, SYMBOL_WEIGHTS } from '#shared/utils/gamelogic/xenoslot'

const { user, setBalance } = useAuth()
const balance = ref(parseFloat(user.value?.balance ?? '0'))
watch(() => user.value?.balance, (v) => { if (v !== undefined) balance.value = parseFloat(v ?? '0') })

// --- bet / round state ------------------------------------------------------
const bet = ref(10)
const turbo = ref(false)
const isSpinning = ref(false)
const errorMsg = ref('')
const showHelp = ref(false)
const ready = ref(false)

const lastWin = ref(0)
const lastLines = ref(0)
const winFlash = ref(false)

// bonus HUD
const inBonus = ref(false)
const bonusBanner = ref(false)
const bonusSpinsLeft = ref(0)
const bonusTotal = ref(0)
const bonusStatus = ref('')

const history = ref<{ payout: number, bet: number, bonus: boolean }[]>([])

const lineBet = computed(() => bet.value / XENOSLOT_LINES)

// Approx odds of triggering the bonus (3+ bonus symbols across the 15 cells),
// expressed as "1 in N". Binomial, p = bonus weight / total weight per cell.
const bonusOdds = computed(() => {
  const total = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0)
  const p = SYMBOL_WEIGHTS.bonus / total
  const q = 1 - p
  const choose = (n: number, k: number) => {
    let r = 1
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1)
    return r
  }
  let pLess = 0
  for (let k = 0; k < BONUS_TRIGGER_COUNT; k++) pLess += choose(XENOSLOT_CELLS, k) * p ** k * q ** (XENOSLOT_CELLS - k)
  const pTrigger = 1 - pLess
  return pTrigger > 0 ? Math.round(1 / pTrigger) : 0
})

// --- pixi (non-reactive on purpose; Vue proxies break PixiJS objects) -------
const canvasWrap = ref<HTMLDivElement>()
let app: any = null
let reelSet: any = null
let REELS: any = null
let PIXI: any = null
let GSAP: any = null
let CoinSymbolClass: any = null
let CollectorSymbolClass: any = null
let GloverSymbolClass: any = null
let destroyed = false

const APP_W = 600
const APP_H = 380
const CELL = 108
const GAP = 6
const REEL_W = 5 * CELL + 4 * GAP
const REEL_H = 3 * CELL + 2 * GAP
const B_CELL = 100
const B_GAP = 6
const B_W = 5 * (B_CELL + B_GAP) - B_GAP
const B_H = 3 * (B_CELL + B_GAP) - B_GAP

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Symbol tiers follow an RPG item-quality ramp so value is immediately readable:
//   common (gray) → uncommon (green) → rare (blue) → epic (purple) → legendary (gold) → wild (red)
//   bonus is its own fuchsia category (trigger, not a pay symbol).
const VISUALS: Record<SlotSymbol, { bg: number, border: number, fg: number, label: string, size?: number }> = {
  // ── Common (gray) ──────────────────────────────────────────────────────────
  ten:     { bg: 0x18181b, border: 0x52525b, fg: 0xa1a1aa, label: '10',  size: 38 },
  jack:    { bg: 0x1c1c1f, border: 0x71717a, fg: 0xd4d4d8, label: 'J',   size: 46 },
  // ── Uncommon (green) ───────────────────────────────────────────────────────
  queen:   { bg: 0x061a0e, border: 0x16a34a, fg: 0x86efac, label: 'Q',   size: 46 },
  king:    { bg: 0x072b12, border: 0x22c55e, fg: 0xbbf7d0, label: 'K',   size: 46 },
  // ── Rare (blue) ────────────────────────────────────────────────────────────
  ace:     { bg: 0x0b1533, border: 0x3b82f6, fg: 0x93c5fd, label: 'A',   size: 46 },
  bell:    { bg: 0x051a22, border: 0x06b6d4, fg: 0x67e8f9, label: '🌱',  size: 50 },
  // ── Epic (purple) ──────────────────────────────────────────────────────────
  seven:   { bg: 0x150929, border: 0x9333ea, fg: 0xd8b4fe, label: '🌿',  size: 52 },
  // ── Legendary (gold) ───────────────────────────────────────────────────────
  diamond: { bg: 0x1a1200, border: 0xf59e0b, fg: 0xfde68a, label: '🍀',  size: 52 },
  // ── Wild (red — highest pay) ───────────────────────────────────────────────
  wild:    { bg: 0x250404, border: 0xef4444, fg: 0xfecaca, label: '🍄‍',  size: 54 },
  // ── Bonus (fuchsia — trigger only, not a pay symbol) ──────────────────────
  bonus:   { bg: 0x1e0528, border: 0xe879f9, fg: 0xf5d0fe, label: '🃏',  size: 52 }
}

// Paytable rows for the help modal, high → low (× line bet for 3/4/5 of a kind).
const PAY_ORDER: Exclude<SlotSymbol, 'bonus'>[] = ['wild', 'diamond', 'seven', 'bell', 'ace', 'king', 'queen', 'jack', 'ten']
const paytableRows = PAY_ORDER.map(sym => ({ sym, label: VISUALS[sym].label, pays: PAYTABLE[sym] }))

// Coin metal tiers, picked from a coin's bet-multiplier so colour is stable
// regardless of stake. face = disc, rim = edge, shine = gloss, ring = inner
// hairline, text = value colour.
type CoinTier = { face: number, rim: number, shine: number, ring: number, text: number }
const COIN_TIERS: Record<'bronze' | 'silver' | 'gold' | 'platinum', CoinTier> = {
  bronze: { face: 0xc97b3c, rim: 0x6e3f17, shine: 0xe8b27a, ring: 0xf0c79a, text: 0x3a210c },
  silver: { face: 0xc7d2e0, rim: 0x59697f, shine: 0xf6f9fc, ring: 0xeef3f9, text: 0x27313f },
  gold: { face: 0xf5c518, rim: 0x9a5b09, shine: 0xfde98a, ring: 0xfff0b3, text: 0x40260a },
  platinum: { face: 0xd6e7f7, rim: 0x3b82c4, shine: 0xffffff, ring: 0xbfe3ff, text: 0x0c3a5e }
}
function tierFor(mult: number): CoinTier {
  if (mult >= 25) return COIN_TIERS.platinum
  if (mult >= 5) return COIN_TIERS.gold
  if (mult >= 1) return COIN_TIERS.silver
  return COIN_TIERS.bronze
}

// Glover (multiplier starburst) look per multiplier — progressively brighter green tiers.
type GloverLook = { face: number, ring: number, glow: number, text: number }
const GLOVER_LOOKS: Record<number, GloverLook> = {
  2: { face: 0x166534, ring: 0xbbf7d0, glow: 0x16a34a, text: 0xffffff },
  5: { face: 0x14532d, ring: 0x86efac, glow: 0x22c55e, text: 0xffffff },
  10: { face: 0x052e16, ring: 0x4ade80, glow: 0x4ade80, text: 0xecfdf5 }
}
function gloverLook(mult: number): GloverLook {
  return GLOVER_LOOKS[mult] ?? GLOVER_LOOKS[2]!
}

// --- build the symbol classes once Pixi is loaded ---------------------------
function makeSymbolClasses() {
  const { Graphics, Text } = PIXI
  const Base = REELS.ReelSymbol

  class GraphicsSymbol extends Base {
    bg = new Graphics()
    label: any
    w = CELL
    h = CELL
    _tween: any = null

    constructor() {
      super()
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 40, fontWeight: '900', fill: 0xffffff, align: 'center' } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.label)
    }

    _render(id: string) {
      const v = VISUALS[id as SlotSymbol] ?? VISUALS.ten
      const pad = 5
      const r = 16
      this.bg.clear()
      this.bg.roundRect(pad, pad, this.w - 2 * pad, this.h - 2 * pad, r).fill({ color: v.bg }).stroke({ color: v.border, width: 3 })
      this.label.text = v.label
      this.label.style.fontSize = v.size ?? 40
      this.label.style.fill = v.fg
      this.label.x = this.w / 2
      this.label.y = this.h / 2
    }

    onActivate(id: string) { this._render(id) }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; if (this.symbolId) this._render(this.symbolId) }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        // Pulse inward so it never spills outside the cell.
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  // A coin/value symbol for the Hold & Win board.
  class CoinSymbol extends Base {
    bg = new Graphics()
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null
    _tier: CoinTier = COIN_TIERS.gold

    constructor() {
      super()
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 24, fontWeight: '900', fill: 0x40260a, align: 'center' } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.label)
    }

    _drawCoin() {
      const cx = this.w / 2
      const cy = this.h / 2
      const rad = Math.min(this.w, this.h) / 2 - 9
      const t = this._tier
      this.bg.clear()
      // edge → face → hairline ring → top-left gloss
      this.bg.circle(cx, cy, rad).fill({ color: t.rim })
      this.bg.circle(cx, cy, rad - 3).fill({ color: t.face })
      this.bg.circle(cx, cy, rad - 9).stroke({ color: t.ring, width: 2, alpha: 0.9 })
      this.bg.ellipse(cx - rad * 0.32, cy - rad * 0.42, rad * 0.44, rad * 0.26).fill({ color: t.shine, alpha: 0.4 })
      this.label.style.fill = t.text
      this.label.x = cx
      this.label.y = cy
    }

    setValue(amount: number, mult?: number) {
      if (mult !== undefined) { this._tier = tierFor(mult); this._drawCoin() }
      this.label.text = formatNumber(amount, true)
    }

    onActivate() { this.view.alpha = 1; this._drawCoin(); if (!this.label.text) this.label.text = '' }
    onDeactivate() { this._kill(); this.label.text = '' }
    resize(w: number, h: number) { this.w = w; this.h = h; this._drawCoin() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  class CollectorSymbol extends Base {
    bg = new Graphics()
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null

    constructor() {
      super()
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 19, fontWeight: '900', fill: 0xfef3c7, align: 'center', stroke: { color: 0x3a1c02, width: 3 } } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.label)
    }

    _draw() {
      this.bg.clear()
      this._drawBasket(this.w / 2, this.h / 2 - 8)
      this.label.x = this.w / 2
      this.label.y = this.h - 17
    }

    // A clean little wicker basket with an open top for coins to drop into.
    _drawBasket(cx: number, cy: number) {
      const g = this.bg
      const topHalf = 28
      const botHalf = 19
      const topY = cy - 11
      const botY = cy + 21
      // body
      g.moveTo(cx - topHalf, topY).lineTo(cx + topHalf, topY).lineTo(cx + botHalf, botY).lineTo(cx - botHalf, botY).closePath()
        .fill({ color: 0xc07f2a }).stroke({ color: 0x6e4715, width: 2 })
      // horizontal weave bands
      for (const fy of [0.34, 0.68]) {
        const y = topY + (botY - topY) * fy
        const half = topHalf + (botHalf - topHalf) * fy
        g.moveTo(cx - half, y).lineTo(cx + half, y).stroke({ color: 0x6e4715, width: 1.5, alpha: 0.55 })
      }
      // vertical weave slats
      for (const fx of [-0.6, -0.2, 0.2, 0.6]) {
        g.moveTo(cx + topHalf * fx, topY + 2).lineTo(cx + botHalf * fx, botY - 2).stroke({ color: 0x6e4715, width: 1, alpha: 0.4 })
      }
      // rim band + dark open mouth
      g.ellipse(cx, topY, topHalf + 2, 7).fill({ color: 0xd9982f }).stroke({ color: 0x6e4715, width: 2 })
      g.ellipse(cx, topY, topHalf - 4, 4.5).fill({ color: 0x2a1908 })
    }

    setCollected(amount: number) {
      this.label.text = `+${formatNumber(amount, true)}`
    }

    onActivate() { this.view.alpha = 1; this.label.text = ''; this._draw() }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; this._draw() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  // A glover (multiplier clover). It lands showing 🍀 + ×N, boosts the coins around it,
  // then vanishes — it never stays on the board.
  class GloverSymbol extends Base {
    bg = new Graphics()
    icon: any
    label: any
    w = B_CELL
    h = B_CELL
    _tween: any = null
    _look: GloverLook = GLOVER_LOOKS[2]!

    constructor() {
      super()
      this.icon = new Text({ text: '🍀', style: { fontFamily: 'system-ui, sans-serif', fontSize: 36, align: 'center' } })
      this.icon.anchor.set(0.5)
      this.label = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 20, fontWeight: '900', fill: 0xffffff, align: 'center' } })
      this.label.anchor.set(0.5)
      this.view.addChild(this.bg)
      this.view.addChild(this.icon)
      this.view.addChild(this.label)
    }

    _draw() {
      const pad = 5
      const r = 16
      const L = this._look
      this.bg.clear()
      this.bg.roundRect(pad, pad, this.w - 2 * pad, this.h - 2 * pad, r).fill({ color: L.face }).stroke({ color: L.ring, width: 3 })
      this.icon.x = this.w / 2
      this.icon.y = this.h / 2 - 12
      this.label.style.fill = L.text
      this.label.x = this.w / 2
      this.label.y = this.h / 2 + 20
    }

    setMult(mult: number) {
      this._look = gloverLook(mult)
      this.label.text = `×${mult}`
      this._draw()
    }

    onActivate() { this.view.alpha = 1; this.label.text = ''; this._draw() }
    onDeactivate() { this._kill() }
    resize(w: number, h: number) { this.w = w; this.h = h; this._draw() }
    stopAnimation() { this._kill(); this.view.scale.set(1, 1) }
    _kill() { if (this._tween) { this._tween.kill(); this._tween = null } this.view.scale.set(1, 1) }
    playWin() {
      this._kill()
      return new Promise<void>((res) => {
        this._tween = GSAP.to(this.view.scale, { x: 0.9, y: 0.9, duration: 0.12, yoyo: true, repeat: 1, ease: 'sine.inOut', onComplete: res })
      })
    }
  }

  CoinSymbolClass = CoinSymbol
  CollectorSymbolClass = CollectorSymbol
  GloverSymbolClass = GloverSymbol
  return GraphicsSymbol
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
    // Transparent canvas so the surrounding card background shows through and
    // the board blends into the site.
    await app.init({ width: APP_W, height: APP_H, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) })
    if (destroyed) { app.destroy(true); return }
    canvasWrap.value?.appendChild(app.canvas)

    const GraphicsSymbol = makeSymbolClasses()

    reelSet = new REELS.ReelSetBuilder()
      .reels(5).visibleRows(3).symbolSize(CELL, CELL).symbolGap(GAP, GAP)
      .symbols((r: any) => {
        for (const id of Object.keys(VISUALS)) r.register(id, GraphicsSymbol, {})
      })
      .weights({ ten: 30, jack: 28, queen: 24, king: 20, ace: 16, bell: 12, seven: 7, diamond: 4, wild: 4, bonus: 5 })
      .speed('normal', REELS.SpeedPresets.NORMAL)
      .speed('turbo', REELS.SpeedPresets.TURBO)
      .ticker(app.ticker)
      .build()

    reelSet.x = (APP_W - REEL_W) / 2
    reelSet.y = (APP_H - REEL_H) / 2
    app.stage.addChild(reelSet)
    ready.value = true
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Failed to load the slot engine'
  }
})

onUnmounted(() => {
  destroyed = true
  try { reelSet?.destroy?.() } catch { /* ignore */ }
  try { app?.destroy?.(true) } catch { /* ignore */ }
})

// --- spin flow --------------------------------------------------------------
async function spin() {
  if (!ready.value || isSpinning.value || balance.value < bet.value) return
  isSpinning.value = true
  errorMsg.value = ''
  lastWin.value = 0
  lastLines.value = 0
  winFlash.value = false

  let data: { gameData: XenoSlotResult, balance: number }
  try {
    data = await $fetch('/api/games/play-game', {
      method: 'POST',
      body: { bet: bet.value, game: 'xenoslot' }
    }) as { gameData: XenoSlotResult, balance: number }
  } catch (e: unknown) {
    errorMsg.value = e instanceof Error ? e.message : 'Something went wrong'
    isSpinning.value = false
    return
  }

  const result = data.gameData

  try {
    // 1. Spin the base reels onto the server grid (turbo only affects the base
    // spin; the bonus board below always plays at its own pace).
    reelSet.setSpeed?.(turbo.value ? 'turbo' : 'normal')
    const spinPromise = reelSet.spin()
    reelSet.setResult(result.grid.map((col: SlotSymbol[]) => ({ visible: col })))
    await spinPromise

    // 2. Celebrate line wins.
    if (result.lines.length) {
      lastLines.value = result.lines.length
      const winLines = result.lines.map(l => ({ positions: l.cells.map(c => ({ reelIndex: c.col, rowIndex: c.row })) }))
      await reelSet.spotlight.cycle(winLines, { displayDuration: 850, gapDuration: 180, cycles: 1 })
    }

    // 3. Bonus feature.
    if (result.bonusTriggered && result.bonus) {
      await reelSet.spotlight.show(result.bonusCells.map(c => ({ reelIndex: c.col, rowIndex: c.row })), { displayDuration: 600 } as any)
      await runBonus(result)
    }

    // 4. Settle balance + HUD.
    lastWin.value = result.payout
    winFlash.value = result.payout > 0
    balance.value = data.balance
    setBalance(data.balance)
    history.value.unshift({ payout: result.payout, bet: result.bet, bonus: result.bonusTriggered })
    if (history.value.length > 10) history.value.pop()
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : 'Animation error'
    balance.value = data.balance
    setBalance(data.balance)
  } finally {
    isSpinning.value = false
  }
}

// --- bonus animation driven entirely by the server's precomputed waves ------
async function runBonus(result: XenoSlotResult) {
  const bonus = result.bonus!
  inBonus.value = true
  bonusBanner.value = true
  bonusTotal.value = 0
  bonusSpinsLeft.value = BONUS_FREE_SPINS
  bonusStatus.value = 'Hold & Win!'
  await wait(1100)
  bonusBanner.value = false

  reelSet.visible = false

  const board = new REELS.HoldAndWinBuilder()
    .grid(5, 3).cellSize(B_CELL, { gap: B_GAP })
    .symbols((r: any) => {
      r.register('coin', CoinSymbolClass, {})
      r.register('glover', GloverSymbolClass, {})
      r.register('collector', CollectorSymbolClass, {})
    })
    .weights({ coin: 3, collector: 1, glover: 1, empty: 9 })
    .respins(99) // we drive the loop from server waves, not the board's counter
    .cellChrome((g: any, size: number) => {
      g.roundRect(0, 0, size, size, 14).fill({ color: 0x0b1220, alpha: 0.55 }).stroke({ color: 0x1e293b, width: 2 })
    })
    .ticker(app.ticker)
    .build()

  // Coins show their value on landing. Collectors land as a plain magnet —
  // their total stays hidden and ticks up later as coins fly into them.
  board.events.on('coin:locked', ({ coin }: any) => {
    if (coin.id === 'coin') {
      const mult = coin.data?.value ?? 0
      board.symbolAt(coin.cell)?.setValue?.(mult * result.bet, mult)
    } else if (coin.id === 'glover') {
      board.symbolAt(coin.cell)?.setMult?.(coin.data?.mult ?? 2)
    }
  })

  board.container.x = (APP_W - B_W) / 2
  board.container.y = (APP_H - B_H) / 2
  app.stage.addChild(board.container)

  try {
    // Seed from the trigger cells.
    const seed = bonus.seed.map(c => ({ cell: c.cell, id: 'coin', data: { value: c.value } }))
    board.enter(seed)
    for (const c of bonus.seed) board.symbolAt(c.cell)?.setValue?.(c.value * result.bet, c.value)
    await wait(500)

    // Replay each bonus spin.
    for (const wave of bonus.waves) {
      bonusStatus.value = `Spin ${wave.round} / ${BONUS_FREE_SPINS}`
      bonusSpinsLeft.value = BONUS_FREE_SPINS - wave.round
      // Coins that land the same wave as a glover neighbour them already have
      // their post-boost value in wave.coins (the server mutates in place).
      // Capture the pre-boost value from glover.upgrades so the coin spawns at
      // its original value and the upgrade animation has something to animate.
      const preGloverMap = new Map<string, number>()
      for (const g of wave.glovers) {
        for (const up of g.upgrades) {
          const k = `${up.cell.col}:${up.cell.row}`
          if (!preGloverMap.has(k)) preGloverMap.set(k, up.from)
        }
      }
      const hits = [
        ...wave.coins.map(c => ({ cell: c.cell, id: 'coin', data: { value: preGloverMap.get(`${c.cell.col}:${c.cell.row}`) ?? c.value } })),
        ...wave.glovers.map(g => ({ cell: g.cell, id: 'glover', data: { mult: g.mult } })),
        ...wave.collectors.map(c => ({ cell: c.cell, id: 'collector', data: { collected: c.collected } }))
      ]
      await board.respin(hits)

      // Glovers resolve first: each boosts its neighbouring coins, then vanishes.
      if (wave.glovers.length) {
        await wait(160)
        await applyGlovers(board, wave, result.bet)
        board.release(wave.glovers.map(g => g.cell))
        await wait(120)
      }

      // A collector pulls every coin in, ticking the total up coin by coin,
      // then the whole board is wiped clean.
      if (wave.collectors.length) {
        await wait(200)
        await collectIntoOrb(board, wave, result.bet)
        const occupied = [...wave.collectedCoins.map(c => c.cell), ...wave.collectors.map(c => c.cell)]
        board.release(occupied)
        await wait(220)
      } else {
        await wait(wave.hit ? 220 : 160)
      }
    }

    // Snap to the exact server total (covers float drift) and hold.
    bonusTotal.value = bonus.bonusPayout
    bonusSpinsLeft.value = 0
    bonusStatus.value = bonus.bonusPayout > 0 ? 'Bonus complete!' : 'No collectors — no win'
    await wait(1300)
  } finally {
    try { app.stage.removeChild(board.container) } catch { /* ignore */ }
    try { board.destroy() } catch { /* ignore */ }
    reelSet.visible = true
    inBonus.value = false
  }
}

// Absolute (stage-space) centre of a board cell.
function absCenter(board: any, cell: Cell): { x: number, y: number } {
  const c = board.cellCenter(cell)
  return { x: board.container.x + c.x, y: board.container.y + c.y }
}

// A small tier-coloured coin carrying a value, used for the fly-into-basket clones.
function makeFlyClone(amount: number, tier: CoinTier): any {
  const { Container, Graphics, Text } = PIXI
  const c = new Container()
  const g = new Graphics()
  const rad = 19
  g.circle(0, 0, rad).fill({ color: tier.rim })
  g.circle(0, 0, rad - 2.5).fill({ color: tier.face })
  g.circle(0, 0, rad - 6).stroke({ color: tier.ring, width: 1.5, alpha: 0.9 })
  g.ellipse(-rad * 0.3, -rad * 0.4, rad * 0.42, rad * 0.25).fill({ color: tier.shine, alpha: 0.4 })
  const t = new Text({ text: formatNumber(amount, true), style: { fontFamily: 'system-ui, sans-serif', fontSize: 15, fontWeight: '900', fill: tier.text } })
  t.anchor.set(0.5)
  c.addChild(g)
  c.addChild(t)
  return c
}

// Tween a value clone along a quadratic bezier arc from a coin to a collector.
function flyValue(board: any, fromCell: Cell, toCell: Cell, amount: number, mult: number, onArrive: () => void): Promise<void> {
  const f = absCenter(board, fromCell)
  const to = absCenter(board, toCell)
  const ctrl = { x: (f.x + to.x) / 2 + (Math.random() * 60 - 30), y: Math.min(f.y, to.y) - 70 }
  const clone = makeFlyClone(amount, tierFor(mult))
  clone.position.set(f.x, f.y)
  app.stage.addChild(clone)
  return new Promise<void>((res) => {
    const o = { t: 0 }
    GSAP.to(o, {
      t: 1,
      duration: 0.52,
      ease: 'power1.in',
      onUpdate: () => {
        const u = o.t
        const mu = 1 - u
        clone.x = mu * mu * f.x + 2 * mu * u * ctrl.x + u * u * to.x
        clone.y = mu * mu * f.y + 2 * mu * u * ctrl.y + u * u * to.y
        clone.scale.set(1 - 0.35 * u)
      },
      onComplete: () => {
        onArrive()
        clone.destroy({ children: true })
        res()
      }
    })
  })
}

// A small "×N" label that floats up from a cell and fades — used when a glover
// boosts a neighbouring coin.
function floatText(board: any, cell: Cell, text: string, mult: number) {
  const { Text } = PIXI
  const p = absCenter(board, cell)
  const look = gloverLook(mult)
  const t = new Text({ text, style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '900', fill: look.glow, stroke: { color: 0x052e16, width: 3 } } })
  t.anchor.set(0.5)
  t.position.set(p.x, p.y - 6)
  app.stage.addChild(t)
  GSAP.to(t, { y: p.y - 40, alpha: 0, duration: 0.7, ease: 'power1.out', onComplete: () => t.destroy() })
}

// Replay each glover this wave: pulse the orb, raise the value (and recolour the
// tier) of every neighbouring coin it boosted, then fade the orb away.
async function applyGlovers(board: any, wave: BonusWave, bet: number) {
  bonusStatus.value = 'Multiplier!'
  for (const glover of wave.glovers) {
    const orb = board.symbolAt(glover.cell)
    await orb?.playWin?.()
    await wait(110)
    for (const up of glover.upgrades) {
      const coin = board.symbolAt(up.cell)
      coin?.setValue?.(up.to * bet, up.to)
      coin?.playWin?.()
      floatText(board, up.cell, `×${glover.mult}`, glover.mult)
    }
    await wait(glover.upgrades.length ? 320 : 140)
    if (orb?.view) await new Promise<void>(res => GSAP.to(orb.view, { alpha: 0, duration: 0.22, ease: 'power1.in', onComplete: () => res() }))
  }
}

// Each collector pulls in EVERY coin on the board, one collector at a time.
// A clone of each coin's value flies into the orb along an arc and the orb's
// running total ticks up on every arrival. Coins stay put until all collectors
// have harvested, then they fade out (the caller clears the board).
async function collectIntoOrb(board: any, wave: BonusWave, bet: number) {
  bonusStatus.value = 'Collecting…'

  for (const collector of wave.collectors) {
    const orb = board.symbolAt(collector.cell)
    let running = 0
    orb?.setCollected?.(0)
    await orb?.playWin?.()

    const flights = wave.collectedCoins.map((coin, i) =>
      wait(i * 110).then(() => flyValue(board, coin.cell, collector.cell, coin.value * bet, coin.value, () => {
        running += coin.value * bet
        bonusTotal.value += coin.value * bet
        const o = board.symbolAt(collector.cell)
        o?.setCollected?.(running)
        o?.playWin?.()
      })))
    await Promise.allSettled(flights)
    await wait(250)
  }

  // Fade the harvested coins out before the board is wiped clean.
  for (const coin of wave.collectedCoins) {
    const cs = board.symbolAt(coin.cell)
    if (cs?.view) GSAP.to(cs.view, { alpha: 0, duration: 0.2 })
  }
  await wait(220)
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); spin() }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="p-6 max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold flex items-center gap-2">
        <UIcon
          name="i-lucide-cherry"
          class="size-6 text-primary"
        />
        Xeno Slot
      </h1>
      <p class="text-sm text-muted mt-0.5">
        5×3 line slot · ~98% RTP
      </p>
    </div>

    <div class="grid lg:grid-cols-3 gap-6">
      <!-- Controls -->
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">
              Controls
            </h2>
            <UButton
              icon="i-lucide-circle-help"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="showHelp = true"
            />
          </div>
        </template>

        <div class="space-y-4">
          <!-- Bet -->
          <div>
            <label class="text-xs text-muted uppercase tracking-wide font-medium block mb-1.5">Bet Amount</label>
            <div class="flex items-center gap-2">
              <UInput
                v-model.number="bet"
                type="number"
                min="1"
                :disabled="isSpinning"
                class="flex-1 font-mono"
                size="lg"
              />
              <div class="flex gap-1">
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isSpinning"
                  @click="bet = Math.max(1, Math.floor(bet / 2))"
                >
                  ½
                </UButton>
                <UButton
                  color="neutral"
                  variant="soft"
                  :disabled="isSpinning"
                  @click="bet = bet * 2"
                >
                  2×
                </UButton>
              </div>
            </div>
          </div>

          <!-- Turbo -->
          <div class="flex items-center justify-between rounded-lg bg-elevated border border-default p-3">
            <div class="min-w-0">
              <p class="text-sm font-medium flex items-center gap-1.5">
                <UIcon
                  name="i-lucide-zap"
                  class="size-4 text-warning"
                /> Turbo spin
              </p>
            </div>
            <USwitch v-model="turbo" />
          </div>

          <!-- Stats -->
          <div class="rounded-lg bg-elevated border border-default p-3 space-y-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Lines</span>
              <span class="font-bold tabular-nums">{{ XENOSLOT_LINES }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Bet / line</span>
              <span class="font-bold tabular-nums">${{ formatNumber(lineBet, false) }}</span>
            </div>
            <USeparator />
            <div class="flex items-center justify-between text-sm">
              <span class="text-muted">Max win</span>
              <span class="font-bold tabular-nums text-warning">{{ formatNumber(XENOSLOT_MAX_WIN_MULT) }}×</span>
            </div>
          </div>

          <!-- Error -->
          <Transition name="fade-up">
            <UAlert
              v-if="errorMsg"
              color="error"
              variant="soft"
              :description="errorMsg"
              :close-button="{ icon: 'i-lucide-x', color: 'neutral', variant: 'ghost' }"
              @close="errorMsg = ''"
            />
          </Transition>

          <!-- Balance -->
          <div class="rounded-lg bg-elevated border border-default p-3 flex justify-between items-center">
            <span class="text-xs text-muted uppercase tracking-wide font-medium">Balance</span>
            <span class="font-bold text-sm"><CoinBalance
              :value="balance"
              :compact="false"
            /></span>
          </div>

          <!-- Recent -->
          <div
            v-if="history.length"
            class="space-y-1.5"
          >
            <p class="text-xs text-muted uppercase tracking-wide font-medium">
              Recent
            </p>
            <div class="flex gap-1.5 flex-wrap">
              <span
                v-for="(h, i) in history"
                :key="i"
                class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-mono font-bold"
                :class="h.payout > h.bet ? 'bg-success/20 text-success' : 'bg-elevated text-muted'"
              >
                <UIcon
                  v-if="h.bonus"
                  name="i-lucide-gift"
                  class="size-3"
                />
                {{ h.payout > 0 ? formatNumber(h.payout) : '—' }}
              </span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Game area -->
      <div class="lg:col-span-2 flex flex-col gap-4">
        <UCard :ui="{ body: 'relative overflow-hidden p-4' }">
          <!-- Bonus banner -->
          <Transition name="pop">
            <div
              v-if="bonusBanner"
              class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
            >
              <div class="bg-linear-to-br from-fuchsia-600 to-purple-700 px-8 py-5 rounded-2xl shadow-2xl shadow-fuchsia-500/30 text-center -rotate-3">
                <p class="text-3xl font-black text-white tracking-tight">
                  HOLD &amp; WIN
                </p>
                <p class="text-sm text-fuchsia-100 font-bold">
                  {{ BONUS_FREE_SPINS }} free spins!
                </p>
              </div>
            </div>
          </Transition>

          <!-- Pixi canvas -->
          <div class="relative flex items-center justify-center min-h-75">
            <div
              ref="canvasWrap"
              class="w-full max-w-150 [&>canvas]:w-full [&>canvas]:h-auto [&>canvas]:block"
            />
            <div
              v-if="!ready && !errorMsg"
              class="absolute inset-0 flex items-center justify-center"
            >
              <UIcon
                name="i-lucide-loader-circle"
                class="size-8 text-muted animate-spin"
              />
            </div>
          </div>

          <!-- Below-grid readout -->
          <div class="mt-3 min-h-12 flex items-center justify-center">
            <!-- Bonus: collected total counts up, with spins remaining -->
            <div
              v-if="inBonus"
              class="flex items-center justify-center gap-5"
            >
              <div class="text-center">
                <p class="text-[10px] uppercase tracking-wide text-muted leading-none mb-0.5">
                  {{ bonusStatus }}
                </p>
                <p class="text-3xl font-black tabular-nums text-success leading-none">
                  ${{ formatNumber(bonusTotal, false) }}
                </p>
              </div>
            </div>
            <!-- Base game win flash -->
            <Transition
              v-else
              name="pop"
            >
              <span
                v-if="winFlash && lastWin > 0"
                class="text-success font-black text-2xl"
              >
                +${{ formatNumber(lastWin, false) }}
                <span
                  v-if="lastLines"
                  class="text-muted text-sm font-medium"
                >· {{ lastLines }} line{{ lastLines > 1 ? 's' : '' }}</span>
              </span>
            </Transition>
          </div>
        </UCard>

        <!-- Play button -->
        <UCard>
          <div class="flex items-center gap-4">
            <UButton
              block
              :loading="isSpinning"
              :disabled="!ready || balance < bet"
              color="primary"
              size="xl"
              class="flex-1 h-16 text-lg font-black uppercase tracking-widest transition-transform active:scale-[0.98]"
              @click="spin"
            >
              {{ isSpinning ? 'Spinning…' : 'Spin' }}
            </UButton>
            <div class="hidden sm:flex flex-col items-end px-4 text-sm font-mono text-muted whitespace-nowrap">
              <span>Press <kbd class="px-2 py-1 bg-elevated rounded text-xs font-sans font-bold border border-default">SPACE</kbd></span>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Help -->
    <UModal
      v-model:open="showHelp"
      title="How Xeno Slot works"
    >
      <template #body>
        <div class="space-y-4 text-sm text-muted">
          <!-- Quick rules -->
          <ul class="space-y-1.5 list-disc list-inside">
            <li>Match <strong class="text-default">3, 4 or 5</strong> of the same symbol left-to-right on any of the <strong class="text-default">{{ XENOSLOT_LINES }} paylines</strong>. 🍄‍ WILD substitutes for any symbol.</li>
            <li>Land <strong class="text-default">3+ 🃏</strong> anywhere to trigger <strong class="text-default">Hold &amp; Win</strong> (~1 in {{ formatNumber(bonusOdds, true, 0) }} spins).</li>
          </ul>

          <!-- Paytable -->
          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Pays × line bet
            </p>
            <div class="rounded-lg border border-default overflow-hidden">
              <!-- Header -->
              <div class="grid grid-cols-[auto_1fr] text-xs text-muted bg-elevated/60 border-b border-default">
                <div class="px-3 py-1" />
                <div class="px-3 py-1 flex justify-end gap-3 font-medium">
                  <span class="w-10 text-right">3×</span>
                  <span class="w-10 text-right">4×</span>
                  <span class="w-10 text-right text-default">5×</span>
                </div>
              </div>
              <div class="grid grid-cols-[auto_1fr] items-center text-sm">
                <template
                  v-for="(row, i) in paytableRows"
                  :key="row.sym"
                >
                  <div
                    class="px-3 py-1.5 font-black text-center text-base"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    {{ row.label }}
                  </div>
                  <div
                    class="px-3 py-1.5 font-mono tabular-nums flex justify-end gap-3"
                    :class="i % 2 ? 'bg-elevated/40' : ''"
                  >
                    <span class="w-10 text-right text-muted">{{ row.pays[0] }}×</span>
                    <span class="w-10 text-right text-muted">{{ row.pays[1] }}×</span>
                    <span class="w-10 text-right font-bold text-default">{{ row.pays[2] }}×</span>
                  </div>
                </template>
              </div>
            </div>
          </div>

          <!-- Bonus mechanics -->
          <div>
            <p class="text-xs uppercase tracking-wide text-muted font-medium mb-2">
              Hold &amp; Win bonus
            </p>
            <ul class="space-y-1.5 list-disc list-inside">
              <li><strong class="text-default">{{ BONUS_FREE_SPINS }} spins.</strong> Coins stick to the board with a cash value — bigger coins glow brighter.</li>
              <li><strong class="text-default">🍀 Glovers</strong> (<span class="text-success font-bold">×2</span> / <span class="text-success font-bold">×5</span> / <span class="text-success font-bold">×10</span>) multiply all adjacent coins, then vanish.</li>
              <li><strong class="text-default">🧺 Baskets</strong> collect every coin on the board and wipe it clean. <strong class="text-default">Only collected coins pay out</strong> — max {{ formatNumber(XENOSLOT_MAX_WIN_MULT, false, 0) }}× bet.</li>
            </ul>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(5px); }

.pop-enter-active { transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1); }
.pop-leave-active { transition: all 0.2s ease; }
.pop-enter-from { opacity: 0; transform: scale(0.7); }
.pop-leave-to { opacity: 0; transform: scale(0.9); }

input[type=number]::-webkit-inner-spin-button,
input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
</style>
