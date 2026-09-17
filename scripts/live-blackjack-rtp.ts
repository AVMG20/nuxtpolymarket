#!/usr/bin/env bun
// Monte Carlo RTP simulation for the live blackjack table.
//
// Run: bun scripts/live-blackjack-rtp.ts
//      ROUNDS=40000000 bun scripts/live-blackjack-rtp.ts
//      VARIANTS=1 bun scripts/live-blackjack-rtp.ts    (per-rule EV breakdown)
//
// Every decision the table would gate — canSplit, canDouble, canSurrender,
// dealerShouldHit — and the whole of settleHand are imported from the shared
// rules, so the sim cannot drift from what the server actually pays. The round
// flow below mirrors Table.deal/afterDeal/peek/doHit/doDouble/doSplit/dealerTurn.
//
// The shoe is reimplemented here rather than importing server/utils Shoe: same
// deck count and cut card, but plain ranks and Math.random instead of card ids
// and crypto RNG. Statistically equivalent for RTP, several times faster.

import {
  LB_RULES, canDouble, canSplit, canSurrender, dealerShouldHit,
  handScore, hiLoValue, isBlackjack, rankValue, settleHand
} from '../shared/utils/live-blackjack/rules'
import { basicStrategy } from '../shared/utils/live-blackjack/strategy'
import {
  LB_21P3_PAYS, LB_PERFECT_PAIRS_PAYS, perfectPairsTier, twentyOnePlusThreeTier
} from '../shared/utils/live-blackjack/sidebets'
import { RAKEBACK_RATE } from '../shared/utils/profile'
import type { LbAction, LbCard, LbHand, LbHandStatus, LbRank, LbSuit } from '../shared/utils/live-blackjack/types'

const ROUNDS = Number(process.env.ROUNDS ?? 10_000_000)
const VARIANT_ROUNDS = Number(process.env.VARIANT_ROUNDS ?? 4_000_000)
const TUNE_ROUNDS = Number(process.env.TUNE_ROUNDS ?? 20_000_000)
const TARGET_RTP = Number(process.env.TARGET ?? 0.98)
const SESSION_LEN = Number(process.env.SESSION ?? 100)
const BET = 100

// ── Shoe ──────────────────────────────────────────────────────────────────────

const RANKS: LbRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
const SUITS: LbSuit[] = ['hearts', 'diamonds', 'clubs', 'spades']
const SHOE_SIZE = LB_RULES.decks * 52
// Shoe.untilShuffle floors at this many cards left, which is where the cut card
// sits. Read live rather than cached so the penetration sweep can move it.
const cutCard = () => Math.round(SHOE_SIZE * (1 - LB_RULES.penetration))

// Cards are held as codes so suits survive for the side bets: rank is code % 13,
// suit is code / 13. Cheaper than carrying objects through a shuffle this hot.
let shoe: number[] = []
let pos = 0
let runningCount = 0
let holeCard: LbRank | null = null

function shuffle() {
  runningCount = 0
  holeCard = null
  shoe = new Array(SHOE_SIZE)
  let i = 0
  for (let d = 0; d < LB_RULES.decks; d++) {
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 13; r++) shoe[i++] = s * 13 + r
    }
  }
  for (let j = SHOE_SIZE - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1))
    const tmp = shoe[j]!
    shoe[j] = shoe[k]!
    shoe[k] = tmp
  }
  pos = 0
}

function decode(code: number): LbCard {
  return { id: '', rank: RANKS[code % 13]!, suit: SUITS[(code / 13) | 0]! }
}

function draw(): LbCard {
  if (pos >= SHOE_SIZE) shuffle()
  const card = decode(shoe[pos++]!)
  runningCount += hiLoValue(card.rank!)
  return card
}

/** The hole card is face down, so a counter cannot fold it in until the reveal. */
function drawHole(): LbCard {
  if (pos >= SHOE_SIZE) shuffle()
  const card = decode(shoe[pos++]!)
  holeCard = card.rank!
  return card
}

function revealHole() {
  if (holeCard === null) return
  runningCount += hiLoValue(holeCard)
  holeCard = null
}

/** Hi-Lo true count: the running count per deck still behind the cut card. */
function trueCount(): number {
  return runningCount / Math.max(1, (SHOE_SIZE - pos) / 52)
}

const needsShuffle = () => SHOE_SIZE - pos <= cutCard()

function newHand(bet: number, fromSplit: boolean): LbHand {
  return { id: '', cards: [], bet, status: 'playing', doubled: false, fromSplit, score: 0, soft: false }
}

// ── Player models ─────────────────────────────────────────────────────────────

interface PlayerModel {
  key: string
  name: string
  note: string
  insurance: boolean | ((tc: number) => boolean)
  decide: (hand: LbHand, up: LbRank, hands: LbHand[]) => LbAction
  /** Units to bet given the true count. Omit for a flat bettor. */
  wager?: (tc: number) => number
}

/**
 * A Hi-Lo counter's bet ramp, in units. Counting only pays through bet sizing —
 * the edge at any one true count is small, so it has to be bet into. The spread
 * is the whole story, which is why it is the knob worth sweeping.
 */
const SPREAD = Number(process.env.SPREAD ?? 12)
let spread = SPREAD

function betRamp(tc: number): number {
  if (tc < 2) return 1
  if (tc < 3) return Math.max(1, Math.round(spread / 6))
  if (tc < 4) return Math.max(1, Math.round(spread / 3))
  if (tc < 5) return Math.max(1, Math.round(spread / 1.5))
  return spread
}

/**
 * The surrender layer the shipped basicStrategy has no opinion on — it can only
 * return hit/stand/double/split, so the in-game hint never surrenders. Totals
 * are the standard 6-deck stand-on-soft-17 chart, applied to split hands too
 * because this table uniquely allows it. Near-optimal rather than provably so.
 */
function surrenderAdvised(hand: LbHand, up: number, hands: LbHand[]): boolean {
  if (!canSurrender(hand, hands)) return false
  const { total, soft } = handScore(hand.cards)
  if (soft) return false
  const [a, b] = hand.cards
  const isPair = a?.rank && b?.rank && rankValue(a.rank) === rankValue(b.rank)
  // Splitting eights beats bailing on them even against a ten.
  if (isPair && rankValue(a!.rank!) === 8 && canSplit(hand, hands)) return false
  if (total === 16) return up === 9 || up === 10 || up === 11
  if (total === 15) return up === 10
  return false
}

const MODELS: PlayerModel[] = [
  {
    key: 'basic',
    name: 'Basic strategy (the in-game hint)',
    note: 'exactly what the hint button and the auto-play bot do — never surrenders',
    insurance: false,
    decide: (hand, up, hands) => basicStrategy(hand, up, hands, Infinity)
  },
  {
    key: 'sharp',
    name: 'Basic strategy + surrender',
    note: 'the practical ceiling for a flat-betting player who uses every rule on offer',
    insurance: false,
    decide: (hand, up, hands) => {
      if (surrenderAdvised(hand, rankValue(up), hands)) return 'surrender'
      return basicStrategy(hand, up, hands, Infinity)
    }
  },
  {
    key: 'casual',
    name: 'Casual "never bust" player',
    note: 'stands on every hard 12+, doubles only 10/11, splits only aces and eights, always insures',
    insurance: true,
    decide: (hand, up, hands) => {
      const [a, b] = hand.cards
      if (hand.cards.length === 2 && a?.rank && b?.rank && rankValue(a.rank) === rankValue(b.rank)) {
        const pair = rankValue(a.rank)
        if ((a.rank === 'A' || pair === 8) && canSplit(hand, hands)) return 'split'
      }
      const { total, soft } = handScore(hand.cards)
      const upValue = rankValue(up)
      if (!soft && (total === 10 || total === 11) && upValue <= 9 && canDouble(hand)) return 'double'
      if (soft) return total >= 18 ? 'stand' : 'hit'
      return total >= 12 ? 'stand' : 'hit'
    }
  },
  {
    key: 'counter',
    name: `Hi-Lo card counter (1-${SPREAD} spread)`,
    note: 'basic strategy plus surrender, betting the count, insuring at true 3 or better',
    insurance: (tc: number) => tc >= 3,
    wager: betRamp,
    decide: (hand, up, hands) => {
      if (surrenderAdvised(hand, rankValue(up), hands)) return 'surrender'
      return basicStrategy(hand, up, hands, Infinity)
    }
  }
]

// ── Stats ─────────────────────────────────────────────────────────────────────

// A partial loss is a surrender, or an insurance bet lost on a hand that pushed.
const NET_BUCKETS: { label: string, test: (m: number) => boolean }[] = [
  { label: 'lost 3x or more', test: m => m <= -3 },
  { label: 'lost 2x to 3x', test: m => m <= -2 },
  { label: 'lost 1x to 2x', test: m => m < -1 },
  { label: 'lost the bet', test: m => m <= -1 },
  { label: 'lost part of it', test: m => m < 0 },
  { label: 'push, level', test: m => m === 0 },
  { label: 'won up to 1x', test: m => m <= 1 },
  { label: 'won 1x to 2x', test: m => m <= 2 },
  { label: 'won 2x to 3x', test: m => m <= 3 },
  { label: 'won 3x or more', test: () => true }
]

const STATUSES: LbHandStatus[] = ['blackjack', 'won', 'push', 'lost', 'busted', 'surrendered']

interface Stats {
  label: string
  rounds: number
  hands: number
  staked: number
  returned: number
  netSum: number
  netSqSum: number
  /** Hands that collected the blackjack bonus, and the winning volume a commission would bite. */
  bjPaid: number
  winNetTotal: number
  charlies: number
  /** Opening-bet units committed, so a spread bettor's average bet is visible. */
  wagerUnits: number
  outcomes: Map<LbHandStatus, number>
  doubles: number
  splits: number
  splitRounds: number
  surrenders: number
  insuranceTaken: number
  insuranceWon: number
  maxHandsSeen: number
  buckets: number[]
  sessions: number[]
}

function blankStats(label: string): Stats {
  return {
    label, rounds: 0, hands: 0, staked: 0, returned: 0, netSum: 0, netSqSum: 0,
    bjPaid: 0, winNetTotal: 0, charlies: 0, wagerUnits: 0,
    outcomes: new Map(STATUSES.map(s => [s, 0])),
    doubles: 0, splits: 0, splitRounds: 0, surrenders: 0,
    insuranceTaken: 0, insuranceWon: 0, maxHandsSeen: 0,
    buckets: new Array(NET_BUCKETS.length).fill(0),
    sessions: []
  }
}

// ── One round ─────────────────────────────────────────────────────────────────

interface RoundOptions {
  /** Variant harness only: split aces get one card and freeze, the casino-standard rule. */
  freezeSplitAces?: boolean
  /**
   * Proposals, not current behaviour. These are not in LB_RULES because the
   * table does not implement them; they are modelled here to price the only
   * levers big enough to move RTP a whole point.
   */
  push22?: boolean
  charlieCards?: number
  charliePays?: number
}

/**
 * settleHand, plus the proposed overrides. Push 22 is the Free Bet Blackjack
 * rule: a dealer bust of exactly 22 pushes instead of paying. A player
 * blackjack is deliberately left alone, which is how the real game runs it.
 */
function settle(hand: LbHand, dealer: LbCard[], isCharlie: boolean, opts: RoundOptions) {
  const staked = hand.doubled ? hand.bet * 2 : hand.bet
  if (isCharlie) {
    const payout = staked * (1 + (opts.charliePays ?? 1))
    return { status: 'won' as LbHandStatus, payout, net: payout - staked }
  }
  const result = settleHand(hand, dealer)
  if (opts.push22 && result.status === 'won' && handScore(dealer).total === 22) {
    return { status: 'push' as LbHandStatus, payout: staked, net: 0 }
  }
  return result
}

function playRound(model: PlayerModel, s: Stats, opts: RoundOptions) {
  if (needsShuffle()) shuffle()

  // The bet is committed before any card is dealt, off the count as it stands.
  const tc = trueCount()
  const bet = BET * (model.wager ? model.wager(tc) : 1)

  const hands: LbHand[] = [newHand(bet, false)]
  const dealer: LbCard[] = []
  let staked = bet

  hands[0]!.cards.push(draw())
  dealer.push(draw())
  hands[0]!.cards.push(draw())
  dealer.push(drawHole())

  if (isBlackjack(hands[0]!)) hands[0]!.status = 'blackjack'

  const up = dealer[0]!.rank!
  const wantsInsurance = typeof model.insurance === 'function' ? model.insurance(tc) : model.insurance
  let insurance = 0
  if (up === 'A' && wantsInsurance) {
    insurance = bet / 2
    staked += insurance
    s.insuranceTaken++
  }

  // The dealer peeks on an ace or a ten, so a natural is always caught before
  // anyone can put a second bet at risk on a split or a double.
  const dealerBj = handScore(dealer).total === 21

  const charlies = new Set<LbHand>()

  if (!dealerBj) {
    let i = 0
    while (i < hands.length) {
      const hand = hands[i]!
      while (hand.status === 'playing') {
        if (opts.freezeSplitAces && hand.fromSplit && hand.cards[0]!.rank === 'A') {
          hand.status = 'stood'
          break
        }
        const action = model.decide(hand, up, hands)

        if (action === 'stand') {
          hand.status = 'stood'
        } else if (action === 'hit') {
          hand.cards.push(draw())
          const total = handScore(hand.cards).total
          if (total > 21) {
            hand.status = 'busted'
          } else if (opts.charlieCards && hand.cards.length >= opts.charlieCards) {
            charlies.add(hand)
            s.charlies++
            hand.status = 'stood'
          } else if (total === 21) {
            hand.status = 'stood'
          }
        } else if (action === 'double' && canDouble(hand)) {
          staked += hand.bet
          s.doubles++
          hand.doubled = true
          hand.cards.push(draw())
          hand.status = handScore(hand.cards).total > 21 ? 'busted' : 'stood'
        } else if (action === 'split' && canSplit(hand, hands)) {
          staked += hand.bet
          s.splits++
          const moved = hand.cards.pop()!
          const sibling = newHand(hand.bet, true)
          sibling.cards.push(moved)
          hand.fromSplit = true
          hand.cards.push(draw())
          sibling.cards.push(draw())
          hands.splice(i + 1, 0, sibling)
          if (handScore(hand.cards).total === 21) hand.status = 'stood'
        } else if (action === 'surrender' && canSurrender(hand, hands)) {
          s.surrenders++
          hand.status = 'surrendered'
        } else {
          // A model asked for something the rules refuse; stand rather than loop.
          hand.status = 'stood'
        }
      }
      i++
    }

    // Table.dealerTurn only draws when a stood hand could still be beaten.
    if (hands.some(h => h.status === 'stood')) {
      while (dealerShouldHit(dealer)) dealer.push(draw())
    }
  }

  revealHole()

  let returned = 0
  for (const hand of hands) {
    const result = settle(hand, dealer, charlies.has(hand), opts)
    hand.status = result.status
    returned += result.payout
    if (result.status === 'blackjack') s.bjPaid++
    s.outcomes.set(result.status, s.outcomes.get(result.status)! + 1)
  }
  if (insurance > 0 && dealerBj) {
    returned += insurance * (1 + LB_RULES.insurancePays)
    s.insuranceWon++
  }

  s.rounds++
  s.hands += hands.length
  s.wagerUnits += bet / BET
  s.staked += staked
  s.returned += returned
  if (hands.length > 1) s.splitRounds++
  if (hands.length > s.maxHandsSeen) s.maxHandsSeen = hands.length

  const mult = (returned - staked) / BET
  s.netSum += mult
  s.netSqSum += mult * mult
  if (returned > staked) s.winNetTotal += returned - staked
  for (let b = 0; b < NET_BUCKETS.length; b++) {
    if (NET_BUCKETS[b]!.test(mult)) {
      s.buckets[b]!++
      break
    }
  }
  return mult
}

function simulate(model: PlayerModel, rounds: number, label: string, opts: RoundOptions = {}): Stats {
  const s = blankStats(label)
  shuffle()
  let session = 0
  for (let r = 0; r < rounds; r++) {
    session += playRound(model, s, opts)
    if ((r + 1) % SESSION_LEN === 0) {
      s.sessions.push(session)
      session = 0
    }
  }
  return s
}

// ── Report ────────────────────────────────────────────────────────────────────

/** Return per unit actually wagered, doubles/splits/insurance included. */
const rtp = (s: Stats) => s.returned / s.staked
/** What blackjack literature quotes: loss as a share of the opening bet only. */
const houseEdge = (s: Stats) => -s.netSum / s.rounds
/** One standard error on that house edge, so nobody reads noise as a rule effect. */
function stdErr(s: Stats): number {
  const mean = s.netSum / s.rounds
  const variance = s.netSqSum / s.rounds - mean * mean
  return Math.sqrt(variance / s.rounds)
}

const pct = (v: number) => (v * 100).toFixed(3) + '%'
const share = (part: number, total: number) => (part / total * 100).toFixed(2) + '%'

function report(s: Stats, model: PlayerModel, elapsed: string) {
  const line = (text: string) => console.log('| ' + text)
  console.log(`\n+- ${s.label} ${'-'.repeat(Math.max(1, 60 - s.label.length))}+`)
  line(`${model.note}`)
  line('')
  line(`Rounds:            ${s.rounds.toLocaleString()}  (${elapsed}s)`)
  line(`Hands played:      ${s.hands.toLocaleString()}`)
  line(`Wagered:           ${Math.round(s.staked).toLocaleString()}  (${(s.staked / s.rounds / BET).toFixed(4)}x the opening bet per round)`)
  line(`Returned:          ${Math.round(s.returned).toLocaleString()}`)
  line('')
  line(`RTP (per unit wagered):   ${pct(rtp(s))}`)
  line(`  + ${(RAKEBACK_RATE * 100).toFixed(1)}% rakeback:        ${pct(rtp(s) + RAKEBACK_RATE)}   <- what the player actually keeps`)
  line(`House edge (per bet):     ${pct(houseEdge(s))}  +/- ${pct(stdErr(s))}`)
  if (s.wagerUnits) line(`Average bet:              ${(s.wagerUnits / s.rounds).toFixed(2)} units`)
  line('')
  line('Hand outcomes')
  for (const status of STATUSES) {
    const n = s.outcomes.get(status)!
    line(`  ${status.padEnd(12)} ${share(n, s.hands).padStart(7)}  ${'#'.repeat(Math.round(n / s.hands * 40))}`)
  }
  line('')
  line('Player actions')
  line(`  Doubled:         ${share(s.doubles, s.rounds)} of rounds`)
  line(`  Split:           ${share(s.splitRounds, s.rounds)} of rounds  (${s.splits.toLocaleString()} splits, up to ${s.maxHandsSeen} hands)`)
  line(`  Surrendered:     ${share(s.surrenders, s.rounds)} of rounds`)
  if (s.insuranceTaken > 0) {
    line(`  Insurance:       ${share(s.insuranceTaken, s.rounds)} of rounds, won ${share(s.insuranceWon, s.insuranceTaken)} of those`)
  }
  line('')
  line('Round result (net, as a multiple of the opening bet)')
  for (let b = 0; b < NET_BUCKETS.length; b++) {
    const n = s.buckets[b]!
    if (n === 0) continue
    line(`  ${NET_BUCKETS[b]!.label.padEnd(18)} ${share(n, s.rounds).padStart(7)}  ${'#'.repeat(Math.round(n / s.rounds * 40))}`)
  }

  const wins = s.buckets.slice(6).reduce((a, b) => a + b, 0)
  const pushes = s.buckets[5]!
  line('')
  line(`  Rounds ahead:    ${share(wins, s.rounds)}`)
  line(`  Rounds level:    ${share(pushes, s.rounds)}`)
  line(`  Rounds behind:   ${share(s.rounds - wins - pushes, s.rounds)}`)

  if (s.sessions.length > 0) {
    const ahead = s.sessions.filter(n => n > 0).length
    const level = s.sessions.filter(n => n === 0).length
    const sorted = [...s.sessions].sort((a, b) => a - b)
    const q = (p: number) => sorted[Math.floor(sorted.length * p)]!.toFixed(1)
    line('')
    line(`${SESSION_LEN}-round sessions (${s.sessions.length.toLocaleString()} of them, net in bets)`)
    line(`  Ended ahead:     ${share(ahead, s.sessions.length)}`)
    line(`  Ended level:     ${share(level, s.sessions.length)}`)
    line(`  Ended behind:    ${share(s.sessions.length - ahead - level, s.sessions.length)}`)
    line(`  Median:          ${q(0.5)}   worst 5%: ${q(0.05)}   best 5%: ${q(0.95)}`)
  }
  console.log('+' + '-'.repeat(63) + '+')
}

// ── Rule variants ─────────────────────────────────────────────────────────────

// LB_RULES is `as const` for callers; the harness swaps values in and restores
// them so every variant runs through the real canSplit/canDouble/settleHand.
type RuleKey = keyof typeof LB_RULES
const mutableRules = LB_RULES as unknown as Record<RuleKey, number | boolean>

interface Variant {
  label: string
  overrides?: Partial<Record<RuleKey, number | boolean>>
  opts?: RoundOptions
}

const VARIANT_LIST: Variant[] = [
  { label: 'Our rules, as shipped' },
  { label: 'Split aces get one card', opts: { freezeSplitAces: true } },
  { label: 'No resplitting aces', overrides: { resplitAces: false } },
  { label: 'No double after split', overrides: { doubleAfterSplit: false } },
  { label: 'No surrender after split', overrides: { surrenderAfterSplit: false } },
  { label: 'No surrender at all', overrides: { lateSurrender: false } },
  { label: 'Split to 4 hands, not 8', overrides: { maxHands: 4 } },
  { label: 'Dealer hits soft 17', overrides: { dealerStandsSoft17: false } },
  { label: 'Blackjack pays 6 to 5', overrides: { blackjackPays: 1.2 } },
  {
    label: 'Every casino rule at once',
    overrides: {
      resplitAces: false, doubleAfterSplit: false, surrenderAfterSplit: false,
      maxHands: 4
    },
    opts: { freezeSplitAces: true }
  }
]

function runVariants(model: PlayerModel) {
  console.log(`\n+- Rule-by-rule EV, ${VARIANT_ROUNDS.toLocaleString()} rounds each ${'-'.repeat(20)}+`)
  console.log(`| Played by: ${model.name}`)
  console.log('|')
  console.log('| ' + 'Rule change'.padEnd(28) + 'RTP'.padStart(9) + 'House edge'.padStart(12) + 'Worth'.padStart(10))

  const snapshot = { ...LB_RULES }
  let baseline = 0

  for (const variant of VARIANT_LIST) {
    for (const [key, value] of Object.entries(variant.overrides ?? {})) {
      mutableRules[key as RuleKey] = value
    }
    const s = simulate(model, VARIANT_ROUNDS, variant.label, variant.opts ?? {})
    for (const [key, value] of Object.entries(snapshot)) {
      mutableRules[key as RuleKey] = value
    }

    const edge = houseEdge(s)
    if (variant === VARIANT_LIST[0]) baseline = edge
    const worth = variant === VARIANT_LIST[0] ? '--' : (edge - baseline >= 0 ? '+' : '') + ((edge - baseline) * 100).toFixed(3)
    console.log('| ' + variant.label.padEnd(28)
      + pct(rtp(s)).padStart(9)
      + pct(edge).padStart(12)
      + worth.padStart(10))
  }
  console.log('|')
  console.log(`| "Worth" is how much house edge the change hands back, in points.`)
  console.log(`| One standard error is about ${((1.15 / Math.sqrt(VARIANT_ROUNDS)) * 100).toFixed(3)} points, so treat anything`)
  console.log('| under roughly 0.02 as noise rather than a real difference.')
  console.log('+' + '-'.repeat(63) + '+')
}

// ── Tuning to a target RTP ────────────────────────────────────────────────────

// Each lever is linear in the volume it touches, so one run is enough to solve
// for the value that lands on target — no bisection, and no simulation noise
// beyond the frequency estimate itself. All three assume basic strategy does
// not shift in response, which is close enough at these magnitudes.

/** The blackjack multiplier that would put this configuration on target. */
function solveBlackjackPays(s: Stats, target: number): number {
  return LB_RULES.blackjackPays - (s.returned - target * s.staked) / (s.bjPaid * BET)
}

/** The share of every net win the house would need to rake instead. */
function solveCommission(s: Stats, target: number): number {
  return (s.returned - target * s.staked) / s.winNetTotal
}

/** The per-round ante, as a fraction of the bet, that would do it instead. */
function solveAnte(s: Stats, target: number): number {
  return (s.returned / target - s.staked) / (BET * s.rounds)
}

interface Package {
  label: string
  overrides?: Partial<Record<RuleKey, number | boolean>>
  opts?: RoundOptions
}

const PACKAGES: Package[] = [
  { label: 'As shipped' },
  { label: 'Dealer hits soft 17', overrides: { dealerStandsSoft17: false } },
  {
    label: 'Every casino rule + H17',
    overrides: {
      resplitAces: false, doubleAfterSplit: false, surrenderAfterSplit: false,
      maxHands: 4, dealerStandsSoft17: false
    },
    opts: { freezeSplitAces: true }
  },
  {
    label: 'The above + 6:5 blackjack',
    overrides: {
      resplitAces: false, doubleAfterSplit: false, surrenderAfterSplit: false,
      maxHands: 4, dealerStandsSoft17: false, blackjackPays: 1.2
    },
    opts: { freezeSplitAces: true }
  },
  { label: 'Push 22', opts: { push22: true } },
  { label: 'Push 22 + blackjack 2:1', overrides: { blackjackPays: 2 }, opts: { push22: true } },
  { label: 'Push 22 + 5-card Charlie', opts: { push22: true, charlieCards: 5, charliePays: 1 } },
  {
    label: 'Push 22 + 2:1 + Charlie',
    overrides: { blackjackPays: 2 },
    opts: { push22: true, charlieCards: 5, charliePays: 1 }
  }
]

function runTuning(model: PlayerModel, rounds: number, target: number) {
  console.log(`\n+- Hitting ${(target * 100).toFixed(2)}% RTP, ${rounds.toLocaleString()} rounds each ${'-'.repeat(12)}+`)
  console.log(`| Measured against: ${model.name}`)
  console.log('|')
  console.log('| ' + 'Configuration'.padEnd(26) + 'RTP'.padStart(9) + '  then BJ pays'.padStart(15) + 'or rake'.padStart(9) + 'or ante'.padStart(9))

  const snapshot = { ...LB_RULES }
  for (const pkg of PACKAGES) {
    for (const [key, value] of Object.entries(pkg.overrides ?? {})) {
      mutableRules[key as RuleKey] = value
    }
    const s = simulate(model, rounds, pkg.label, pkg.opts ?? {})
    const bjPays = solveBlackjackPays(s, target)
    const commission = solveCommission(s, target)
    const ante = solveAnte(s, target)
    for (const [key, value] of Object.entries(snapshot)) {
      mutableRules[key as RuleKey] = value
    }

    console.log('| ' + pkg.label.padEnd(26)
      + pct(rtp(s)).padStart(9)
      + `${bjPays.toFixed(2)} to 1`.padStart(15)
      + (commission * 100).toFixed(1).padStart(8) + '%'
      + (ante * 100).toFixed(1).padStart(8) + '%')
  }
  console.log('|')
  console.log('| The last three columns are alternatives, not a stack: each on its own')
  console.log(`| lands that configuration on ${(target * 100).toFixed(2)}%. A blackjack multiple above 1.5,`)
  console.log('| a negative rake or a negative ante means the configuration has already')
  console.log('| overshot and has room to give something back.')
  console.log('+' + '-'.repeat(63) + '+')
}

// ── Counter containment ───────────────────────────────────────────────────────

// Basic-strategy RTP and the counter's edge do not move independently: rule
// changes shift both by the same amount, leaving the gap between them intact.
// Only penetration and the bet spread change the gap, which makes them the
// levers for containing a counter without touching what everyone else gets.

function runCounterSweep(rounds: number) {
  const basic = MODELS[0]!
  const counter = MODELS[3]!
  const snapshot = { ...LB_RULES }
  const original = spread

  console.log(`\n+- Counter containment, ${rounds.toLocaleString()} rounds each ${'-'.repeat(17)}+`)
  console.log('|')
  console.log('| ' + 'Penetration'.padEnd(14) + 'Basic RTP'.padStart(11) + 'Counter RTP'.padStart(13) + 'Counter edge'.padStart(14))
  for (const penetration of [0.5, 0.6, 0.667, 0.75, 0.85]) {
    mutableRules.penetration = penetration
    const b = simulate(basic, rounds, 'basic')
    const c = simulate(counter, rounds, 'counter')
    console.log('| ' + `${Math.round(penetration * 100)}%`.padEnd(14)
      + pct(rtp(b)).padStart(11)
      + pct(rtp(c)).padStart(13)
      + `${((rtp(c) - 1) * 100 >= 0 ? '+' : '')}${((rtp(c) - 1) * 100).toFixed(2)}%`.padStart(14))
  }
  for (const [key, value] of Object.entries(snapshot)) mutableRules[key as RuleKey] = value

  console.log('|')
  console.log('| ' + `Bet spread (at ${Math.round(LB_RULES.penetration * 100)}% penetration)`.padEnd(25) + 'Counter RTP'.padStart(13) + 'Counter edge'.padStart(14))
  for (const s of [1, 2, 4, 8, 12, 20]) {
    spread = s
    const c = simulate(counter, rounds, 'counter')
    console.log('| ' + `1 to ${s}`.padEnd(25)
      + pct(rtp(c)).padStart(13)
      + `${((rtp(c) - 1) * 100 >= 0 ? '+' : '')}${((rtp(c) - 1) * 100).toFixed(2)}%`.padStart(14))
  }
  spread = original

  console.log('|')
  console.log(`| Counter edge is before rakeback. Add ${(RAKEBACK_RATE * 100).toFixed(1)} points for what they keep.`)
  console.log('+' + '-'.repeat(63) + '+')
}

// ── Side bets ─────────────────────────────────────────────────────────────────

// Measured off the real shoe rather than a fresh deck: the cards come out of a
// partially dealt six-deck shoe exactly as they would at the table, so the
// pair frequencies reflect depletion instead of textbook combinatorics.

function runSideBets(rounds: number) {
  const ppHits = new Map<string, number>()
  const tpHits = new Map<string, number>()
  let ppReturn = 0
  let tpReturn = 0

  shuffle()
  for (let r = 0; r < rounds; r++) {
    if (needsShuffle()) shuffle()
    // Same order the table deals in: player, dealer up, player, dealer hole.
    const first = draw()
    const upcard = draw()
    const second = draw()
    drawHole()
    revealHole()

    const pp = perfectPairsTier(first, second)
    if (pp) {
      ppHits.set(pp, (ppHits.get(pp) ?? 0) + 1)
      ppReturn += 1 + LB_PERFECT_PAIRS_PAYS[pp]
    }
    const tp = twentyOnePlusThreeTier(first, second, upcard)
    if (tp) {
      tpHits.set(tp, (tpHits.get(tp) ?? 0) + 1)
      tpReturn += 1 + LB_21P3_PAYS[tp]
    }
  }

  const show = (
    title: string,
    pays: Record<string, number>,
    hits: Map<string, number>,
    returned: number
  ) => {
    console.log(`|`)
    console.log(`| ${title}`)
    console.log(`|   ${'Outcome'.padEnd(24)}${'Pays'.padStart(7)}${'Frequency'.padStart(12)}${'Of RTP'.padStart(10)}`)
    let hitTotal = 0
    for (const [tier, pay] of Object.entries(pays)) {
      const n = hits.get(tier) ?? 0
      hitTotal += n
      const contribution = n * (1 + pay) / rounds
      console.log(`|   ${tier.padEnd(24)}${`${pay}:1`.padStart(7)}`
        + `${(n ? `1 in ${Math.round(rounds / n).toLocaleString()}` : 'never').padStart(12)}`
        + `${pct(contribution).padStart(10)}`)
    }
    console.log(`|   ${'any win'.padEnd(24)}${''.padStart(7)}${share(hitTotal, rounds).padStart(12)}${pct(returned / rounds).padStart(10)}`)
    console.log(`|   RTP ${pct(returned / rounds)}   house edge ${pct(1 - returned / rounds)}`)
  }

  console.log(`\n+- Side bets, ${rounds.toLocaleString()} rounds ${'-'.repeat(29)}+`)
  show('Perfect Pairs', LB_PERFECT_PAIRS_PAYS, ppHits, ppReturn)
  show('21+3', LB_21P3_PAYS, tpHits, tpReturn)
  console.log('|')
  console.log('| Side bet RTP is independent of how the hand is played, so it does not')
  console.log('| move with the base game or with counting.')

  // What the table actually returns depends on how much of the action goes on
  // the side spots, so the blend is the number worth tuning against.
  const base = Number(process.env.BASE_RTP ?? 0.99844)
  const sideRtp = (ppReturn / rounds + tpReturn / rounds) / 2
  console.log('|')
  console.log(`| Blended RTP, with the base game at ${pct(base)}`)
  console.log('| ' + 'Side action (per 1 main)'.padEnd(26) + 'Blended'.padStart(10) + `+ ${(RAKEBACK_RATE * 100).toFixed(0)}% rakeback`.padStart(18))
  for (const s of [0, 0.25, 0.5, 1, 1.5, 2]) {
    const blended = (base + s * sideRtp) / (1 + s)
    const note = s === 0 ? 'nobody takes them' : s === 2 ? 'both spots matched to the main bet' : ''
    console.log('| ' + `${s.toFixed(2)}x`.padEnd(26)
      + pct(blended).padStart(10)
      + pct(blended + RAKEBACK_RATE).padStart(18)
      + (note ? `   ${note}` : ''))
  }
  console.log('+' + '-'.repeat(63) + '+')
}

// ── Go ────────────────────────────────────────────────────────────────────────

console.log('\n=======================================================')
console.log('   Live Blackjack - RTP simulation')
console.log('=======================================================')
console.log(`${LB_RULES.decks} decks, ${Math.round(LB_RULES.penetration * 100)}% penetration, `
  + `dealer ${LB_RULES.dealerStandsSoft17 ? 'stands on' : 'hits'} soft 17, blackjack pays ${LB_RULES.blackjackPays} to 1`)
console.log(`split to ${LB_RULES.maxHands} hands, DAS ${LB_RULES.doubleAfterSplit}, resplit aces ${LB_RULES.resplitAces}, `
  + `surrender ${LB_RULES.lateSurrender}${LB_RULES.surrenderAfterSplit ? ' (after splits too)' : ''}`)
console.log('Flat bets, unlimited bankroll, one player against the dealer.')

for (const model of MODELS) {
  const t = Date.now()
  const s = simulate(model, ROUNDS, model.name)
  report(s, model, ((Date.now() - t) / 1000).toFixed(1))
}

if (process.env.VARIANTS) runVariants(MODELS[1]!)
if (process.env.TUNE) runTuning(MODELS[0]!, TUNE_ROUNDS, TARGET_RTP)
if (process.env.COUNTER) runCounterSweep(Number(process.env.COUNTER_ROUNDS ?? 20_000_000))
if (process.env.SIDEBETS) runSideBets(Number(process.env.SIDEBET_ROUNDS ?? 20_000_000))

console.log()
