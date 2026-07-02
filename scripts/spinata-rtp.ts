#!/usr/bin/env bun
// Monte Carlo RTP simulation for Spiñata Slots
// Run: bun scripts/spinata-rtp.ts
//
// Uses Math.random() for speed (the production engine uses crypto.getRandomValues,
// which is statistically equivalent for simulation purposes).

// ── Constants (must match shared/utils/gamelogic/spinata.ts) ─────────────────

const SPN_COLS = 5
const SPN_ROWS = 3
const SPN_LINES = 50
const SPN_FREE_SPINS = 12
const SPN_SCATTER_TRIGGER = 3
const SPN_TRACK_CAP = 20
const SPN_TRACK_START = 1
const SPN_BONUS_TRIGGER = 3
const SPN_MAX_WIN_MULT = 5000

type SpinPaySymbol = 'ten'|'jack'|'queen'|'king'|'ace'|'maracas'|'cactus'|'sombrero'|'flower'
type SpinSymbol = SpinPaySymbol | 'wild' | 'scatter' | 'bonus'

const PAY_KEYS: SpinPaySymbol[] = ['ten','jack','queen','king','ace','maracas','cactus','sombrero','flower']

// Normal weights (DEBUG_BONUS = false)
const SYMBOL_WEIGHTS: Record<SpinSymbol, number> = {
    ten: 33, jack: 30, queen: 26, king: 22, ace: 18,
    maracas: 13, cactus: 9, sombrero: 6, flower: 4,
    wild: 3, scatter: 3, bonus: 4,
}

const PAYTABLE: Record<SpinPaySymbol | 'wild', [number, number, number]> = {
    ten:      [   8,   43,  173],
    jack:     [   8,   43,  173],
    queen:    [  14,   69,  260],
    king:     [  17,   87,  347],
    ace:      [  26,  130,  520],
    maracas:  [  35,  173,  693],
    cactus:   [  52,  260, 1040],
    sombrero: [  87,  433, 1733],
    flower:   [ 165,  750, 3500],
    wild:     [ 520, 2600, 8650],
}

const SCATTER_PAY: Record<number, number> = { 3: 2, 4: 10, 5: 50 }
const BONUS_PAY:   Record<number, number> = { 3: 5, 4: 15, 5: 50 }

const PAYLINES: number[][] = [
    [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
    [0,1,2,1,0], [2,1,0,1,2],
    [0,0,1,2,2], [2,2,1,0,0], [0,1,2,2,2], [2,1,0,0,0],
    [0,1,1,1,2], [2,1,1,1,0], [1,0,0,0,1], [1,2,2,2,1],
    [0,0,1,1,2], [2,2,1,1,0], [1,1,0,0,1], [1,1,2,2,1],
    [0,1,0,1,0], [2,1,2,1,2], [1,0,1,0,1], [1,2,1,2,1],
    [0,1,0,0,1], [2,1,2,2,1], [1,0,0,1,2], [1,2,2,1,0],
    [0,0,0,1,2], [2,2,2,1,0], [0,1,1,2,1], [2,1,1,0,1],
    [1,1,2,1,0], [1,1,0,1,2], [0,0,1,0,1], [2,2,1,2,1],
    [0,1,1,0,0], [2,1,1,2,2], [1,0,1,1,0], [1,2,1,1,2],
    [0,0,0,0,1], [2,2,2,2,1], [1,0,0,0,0], [1,2,2,2,2],
    [0,0,0,1,1], [2,2,2,1,1], [1,1,1,0,0], [1,1,1,2,2],
    [0,1,0,2,1], [2,1,2,0,1], [1,0,1,2,1], [1,2,1,0,1],
    [0,1,2,0,1], [2,1,0,2,1], [0,0,1,2,1], [2,2,1,0,1],
]

// ── RNG helpers ───────────────────────────────────────────────────────────────

const SYM_KEYS = Object.keys(SYMBOL_WEIGHTS) as SpinSymbol[]
const SYM_W    = SYM_KEYS.map(k => SYMBOL_WEIGHTS[k])
const SYM_TOT  = SYM_W.reduce((a, b) => a + b, 0)

const NS_KEYS  = SYM_KEYS.filter(k => k !== 'scatter')
const NS_W     = NS_KEYS.map(k => SYMBOL_WEIGHTS[k])
const NS_TOT   = NS_W.reduce((a, b) => a + b, 0)

function drawCell(noScatter: boolean): SpinSymbol {
    const keys = noScatter ? NS_KEYS : SYM_KEYS
    const w    = noScatter ? NS_W    : SYM_W
    const tot  = noScatter ? NS_TOT  : SYM_TOT
    let r = Math.random() * tot
    for (let i = 0; i < keys.length; i++) { r -= w[i]!; if (r < 0) return keys[i]! }
    return keys[keys.length - 1]!
}

function fullDrop(noScatter: boolean): SpinSymbol[][] {
    return Array.from({ length: SPN_COLS }, () =>
        Array.from({ length: SPN_ROWS }, () => drawCell(noScatter))
    )
}

// ── Win evaluation ────────────────────────────────────────────────────────────

const PAY_AND_WILD = [...PAY_KEYS, 'wild'] as (SpinPaySymbol | 'wild')[]

// Returns total × LINE_BET multiplier across all paylines (before bet scaling)
function evalGrid(grid: SpinSymbol[][]): number {
    let total = 0
    for (let li = 0; li < PAYLINES.length; li++) {
        const line = PAYLINES[li]!
        let best = 0
        for (const sym of PAY_AND_WILD) {
            let count = 0
            for (let reel = 0; reel < SPN_COLS; reel++) {
                const cell = grid[reel]![line[reel]!]!
                if (cell === sym || (sym !== 'wild' && cell === 'wild')) count++
                else break
            }
            if (count >= 3) {
                const pay = PAYTABLE[sym][Math.min(count - 3, 2)]!
                if (pay > best) best = pay
            }
        }
        total += best
    }
    return total
}

function countSym(grid: SpinSymbol[][], sym: SpinSymbol): number {
    let n = 0
    for (let c = 0; c < SPN_COLS; c++)
        for (let r = 0; r < SPN_ROWS; r++)
            if (grid[c]![r] === sym) n++
    return n
}

// ── Piñata pot prizes (awarded per bonus symbol that lands during free spins) ─

const PINATA_PRIZES  = [2,  4,  6, 10, 15]  // × bet
const PINATA_WEIGHTS = [45, 30, 15,  7,  3]
const PINATA_W_TOT   = PINATA_WEIGHTS.reduce((a, b) => a + b, 0)

function drawPinataPrize(): number {
    let r = Math.random() * PINATA_W_TOT
    for (let i = 0; i < PINATA_PRIZES.length; i++) {
        r -= PINATA_WEIGHTS[i]!
        if (r < 0) return PINATA_PRIZES[i]!
    }
    return PINATA_PRIZES[PINATA_PRIZES.length - 1]!
}

// ── Free spins simulation ─────────────────────────────────────────────────────

function simFreeSpins(bet: number): [linePayout: number, pinataPot: number] {
    const lineBet = bet / SPN_LINES
    let linePayout = 0
    let pinataPot  = 0
    let track      = SPN_TRACK_START
    for (let i = 0; i < SPN_FREE_SPINS; i++) {
        const grid  = fullDrop(true)
        const wilds = countSym(grid, 'wild')
        track = Math.min(track + wilds, SPN_TRACK_CAP)
        linePayout += evalGrid(grid) * lineBet * track
        const bonusN = countSym(grid, 'bonus')
        for (let b = 0; b < bonusN; b++) pinataPot += drawPinataPrize() * bet
    }
    return [linePayout, pinataPot]
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const SPINS = 5_000_000
const BET   = 100

let totalCost     = 0
let totalPayout   = 0
let baseRTP       = 0
let fsRTP         = 0
let pinataPotRTP  = 0
let bonusRTP      = 0

let fsTriggers    = 0
let bonusTriggers = 0
let wins          = 0

let fsLineSum     = 0
let pinataPotSum  = 0
let bonusPaySum   = 0

// Win distribution buckets: 0, <0.5x, 0.5-1x, 1-2x, 2-5x, 5-10x, 10-50x, 50-100x, 100x+
const BUCKETS    = [0, 0.5, 1, 2, 5, 10, 50, 100, Infinity]
const bucketHits = new Array(BUCKETS.length - 1).fill(0) as number[]

const start = Date.now()

for (let i = 0; i < SPINS; i++) {
    totalCost += BET
    const grid   = fullDrop(false)
    const linePay = evalGrid(grid)
    const lineBet = BET / SPN_LINES
    const scatN   = countSym(grid, 'scatter')
    const bonusN  = countSym(grid, 'bonus')

    const scatPay = (SCATTER_PAY[Math.min(scatN, 5)] ?? 0) * BET
    const base    = linePay * lineBet + scatPay

    let spin = base
    baseRTP += base

    if (scatN >= SPN_SCATTER_TRIGGER) {
        fsTriggers++
        const [fl, pp] = simFreeSpins(BET)
        spin += fl + pp
        fsRTP += fl
        pinataPotRTP += pp
        fsLineSum  += fl
        pinataPotSum += pp
    }

    if (bonusN >= SPN_BONUS_TRIGGER) {
        bonusTriggers++
        const bp = (BONUS_PAY[Math.min(bonusN, 5)] ?? 0) * BET
        spin += bp
        bonusRTP += bp
        bonusPaySum += bp
    }

    spin = Math.min(spin, BET * SPN_MAX_WIN_MULT)
    totalPayout += spin
    if (spin > 0) wins++

    const mult = spin / BET
    for (let b = 0; b < BUCKETS.length - 1; b++) {
        if (mult >= BUCKETS[b]! && mult < BUCKETS[b + 1]!) { bucketHits[b]++; break }
    }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
const rtp     = totalPayout / totalCost * 100
const hitRate = wins / SPINS * 100

console.log(`\n╔══════════════════════════════════════════════════════╗`)
console.log(`║        Spiñata Slots — RTP Simulation Results        ║`)
console.log(`╚══════════════════════════════════════════════════════╝`)
console.log(`\n  Spins:           ${SPINS.toLocaleString()}  (${elapsed}s)`)
console.log(`  Bet per spin:    ${BET}`)
console.log(`  Total wagered:   ${totalCost.toLocaleString()}`)
console.log(`  Total paid out:  ${Math.round(totalPayout).toLocaleString()}`)
console.log(`\n┌─ Overall ────────────────────────────────────────────┐`)
console.log(`│  RTP:            ${rtp.toFixed(2)}%`)
console.log(`│  Hit rate:       ${hitRate.toFixed(2)}%  (spins with any win)`)
console.log(`├─ Contribution breakdown ─────────────────────────────┤`)
console.log(`│  Base game:      ${(baseRTP      / totalCost * 100).toFixed(2)}%`)
console.log(`│  FS line wins:   ${(fsRTP        / totalCost * 100).toFixed(2)}%`)
console.log(`│  Piñata pot:     ${(pinataPotRTP / totalCost * 100).toFixed(2)}%`)
console.log(`│  Bonus prize:    ${(bonusRTP     / totalCost * 100).toFixed(2)}%`)
console.log(`├─ Feature frequency ──────────────────────────────────┤`)
console.log(`│  Free spins:     1 in ${(SPINS / fsTriggers).toFixed(0)} spins  (${fsTriggers.toLocaleString()} triggers)`)
console.log(`│  Bonus prize:    1 in ${(SPINS / bonusTriggers).toFixed(0)} spins  (${bonusTriggers.toLocaleString()} triggers)`)
console.log(`│  Avg FS lines:   ${(fsLineSum   / fsTriggers   / BET).toFixed(1)}× bet`)
console.log(`│  Avg piñata pot: ${(pinataPotSum / fsTriggers   / BET).toFixed(1)}× bet  (per FS trigger)`)
console.log(`│  Avg bonus win:  ${(bonusPaySum  / bonusTriggers / BET).toFixed(1)}× bet`)
console.log(`├─ Win distribution (% of spins) ──────────────────────┤`)

const labels = ['0×', '<0.5×', '0.5-1×', '1-2×', '2-5×', '5-10×', '10-50×', '50-100×', '100×+']
for (let b = 0; b < bucketHits.length; b++) {
    const pct = (bucketHits[b]! / SPINS * 100).toFixed(2)
    const bar = '█'.repeat(Math.round(bucketHits[b]! / SPINS * 50))
    console.log(`│  ${labels[b]!.padEnd(9)} ${pct.padStart(6)}%  ${bar}`)
}
console.log(`└──────────────────────────────────────────────────────┘\n`)
