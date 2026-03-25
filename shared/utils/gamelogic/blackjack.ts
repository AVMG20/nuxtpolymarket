export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades'
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  suit: Suit
  rank: Rank
  isHidden: boolean
}

export type HandStatus = 'playing' | 'stood' | 'busted' | 'blackjack' | 'surrendered' | 'won' | 'lost' | 'push'

export interface Hand {
  id: string
  cards: Card[]
  bet: number
  status: HandStatus
}

export interface BlackjackState {
  deck: Card[]
  dealerHand: Hand
  playerHands: Hand[]
  currentHandIndex: number
  phase: 'betting' | 'dealing' | 'insurance' | 'playing' | 'dealerTurn' | 'resolved'
  insuranceBet: number
  message: string
}

export type BlackjackAction = 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'surrender' | 'insurance' | 'no-insurance'

export interface BlackjackResult {
  state: BlackjackState
  netPayout: number // net change to balance (negative = loss, positive = win)
  finished: boolean
}

/** Visible state sent to the client (hidden cards masked) */
export interface BlackjackClientState {
  dealerHand: Hand
  playerHands: Hand[]
  currentHandIndex: number
  phase: BlackjackState['phase']
  insuranceBet: number
  message: string
  dealerScore: number
  playerScores: number[]
}

const clone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj))

export function createDeck(numDecks: number = 6): Card[] {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
  const deck: Card[] = []
  for (let d = 0; d < numDecks; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, isHidden: false })
      }
    }
  }
  // Fisher-Yates shuffle using crypto
  const arr = new Uint32Array(deck.length)
  crypto.getRandomValues(arr)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = arr[i]! % (i + 1)
    ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
  }
  return deck
}

export function calculateScore(cards: Card[]): number {
  let score = 0
  let aces = 0
  for (const card of cards) {
    if (card.isHidden) continue
    if (card.rank === 'A') {
      aces += 1
      score += 11
    } else if (['J', 'Q', 'K'].includes(card.rank)) {
      score += 10
    } else {
      score += parseInt(card.rank)
    }
  }
  while (score > 21 && aces > 0) {
    score -= 10
    aces -= 1
  }
  return score
}

function cardValue(card: Card): number {
  if (['J', 'Q', 'K'].includes(card.rank)) return 10
  if (card.rank === 'A') return 11
  return parseInt(card.rank)
}

export function toClientState(state: BlackjackState): BlackjackClientState {
  const s = clone(state)
  // Mask hidden cards
  for (const card of s.dealerHand.cards) {
    if (card.isHidden) {
      card.suit = 'spades'
      card.rank = '2'
    }
  }
  return {
    dealerHand: s.dealerHand,
    playerHands: s.playerHands,
    currentHandIndex: s.currentHandIndex,
    phase: s.phase,
    insuranceBet: s.insuranceBet,
    message: s.message,
    dealerScore: calculateScore(s.dealerHand.cards),
    playerScores: s.playerHands.map(h => calculateScore(h.cards)),
  }
}

export function startGame(bet: number): BlackjackResult {
  const deck = createDeck(6)
  const state: BlackjackState = {
    deck,
    dealerHand: { id: 'dealer', cards: [], bet: 0, status: 'playing' },
    playerHands: [{ id: 'hand-0', cards: [], bet, status: 'playing' }],
    currentHandIndex: 0,
    phase: 'dealing',
    insuranceBet: 0,
    message: 'Dealing cards...',
  }

  // Deal: player, dealer, player, dealer(hidden)
  state.playerHands[0]!.cards.push(state.deck.pop()!)
  state.dealerHand.cards.push(state.deck.pop()!)
  state.playerHands[0]!.cards.push(state.deck.pop()!)
  const hiddenCard = state.deck.pop()!
  hiddenCard.isHidden = true
  state.dealerHand.cards.push(hiddenCard)

  const playerScore = calculateScore(state.playerHands[0]!.cards)
  const dealerUpcard = state.dealerHand.cards[0]!

  if (playerScore === 21) {
    state.playerHands[0]!.status = 'blackjack'
    state.phase = 'dealerTurn'
    state.message = 'Blackjack!'
    return finishDealerTurn(state, bet)
  }

  if (dealerUpcard.rank === 'A') {
    state.phase = 'insurance'
    state.message = 'Dealer shows an Ace. Buy insurance?'
  } else {
    state.phase = 'playing'
    state.message = 'Your turn. Hit or Stand?'
  }

  return { state, netPayout: 0, finished: false }
}

export function performAction(state: BlackjackState, action: BlackjackAction, bet: number): BlackjackResult {
  const s = clone(state) as BlackjackState

  switch (action) {
    case 'insurance':
      return doInsurance(s, bet)
    case 'no-insurance':
      return doDeclineInsurance(s, bet)
    case 'hit':
      return doHit(s, bet)
    case 'stand':
      return doStand(s, bet)
    case 'double':
      return doDouble(s, bet)
    case 'split':
      return doSplit(s, bet)
    case 'surrender':
      return doSurrender(s, bet)
    default:
      throw createError({ statusCode: 400, message: `Invalid action: ${action}` })
  }
}

function doInsurance(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'insurance') throw createError({ statusCode: 400, message: 'Cannot buy insurance now' })
  const cost = s.playerHands[0]!.bet / 2
  s.insuranceBet = cost

  s.dealerHand.cards[1]!.isHidden = false
  const dealerScore = calculateScore(s.dealerHand.cards)
  if (dealerScore === 21) {
    s.message = 'Dealer has Blackjack! Insurance pays 2:1.'
    s.phase = 'resolved'
    s.playerHands[0]!.status = 'lost'
    // Player loses bet but wins insurance 2:1 (gets back cost * 3)
    const netPayout = -bet + (cost * 3) - cost // net = -bet + 2*cost = -bet + bet = 0 (breaks even)
    return { state: s, netPayout, finished: true }
  } else {
    s.message = 'Dealer does not have Blackjack. Insurance lost.'
    s.phase = 'playing'
    s.dealerHand.cards[1]!.isHidden = true
    return { state: s, netPayout: -cost, finished: false }
  }
}

function doDeclineInsurance(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'insurance') throw createError({ statusCode: 400, message: 'Cannot decline insurance now' })

  s.dealerHand.cards[1]!.isHidden = false
  const dealerScore = calculateScore(s.dealerHand.cards)
  if (dealerScore === 21) {
    s.message = 'Dealer has Blackjack!'
    s.phase = 'resolved'
    s.playerHands[0]!.status = 'lost'
    return { state: s, netPayout: -bet, finished: true }
  } else {
    s.message = 'Your turn. Hit or Stand?'
    s.phase = 'playing'
    s.dealerHand.cards[1]!.isHidden = true
    return { state: s, netPayout: 0, finished: false }
  }
}

function doHit(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'playing') throw createError({ statusCode: 400, message: 'Cannot hit now' })
  const hand = s.playerHands[s.currentHandIndex]!
  hand.cards.push(s.deck.pop()!)

  const score = calculateScore(hand.cards)
  if (score > 21) {
    hand.status = 'busted'
    s.message = 'Bust!'
    return advanceHand(s, bet)
  } else if (score === 21) {
    hand.status = 'stood'
    return advanceHand(s, bet)
  }
  return { state: s, netPayout: 0, finished: false }
}

function doStand(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'playing') throw createError({ statusCode: 400, message: 'Cannot stand now' })
  s.playerHands[s.currentHandIndex]!.status = 'stood'
  return advanceHand(s, bet)
}

function doDouble(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'playing') throw createError({ statusCode: 400, message: 'Cannot double now' })
  const hand = s.playerHands[s.currentHandIndex]!
  if (hand.cards.length !== 2) throw createError({ statusCode: 400, message: 'Can only double on first two cards' })

  hand.bet *= 2
  hand.cards.push(s.deck.pop()!)

  const score = calculateScore(hand.cards)
  if (score > 21) {
    hand.status = 'busted'
  } else {
    hand.status = 'stood'
  }
  return advanceHand(s, bet)
}

function doSplit(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'playing') throw createError({ statusCode: 400, message: 'Cannot split now' })
  const hand = s.playerHands[s.currentHandIndex]!
  if (hand.cards.length !== 2) throw createError({ statusCode: 400, message: 'Can only split with two cards' })

  const val1 = cardValue(hand.cards[0]!)
  const val2 = cardValue(hand.cards[1]!)
  if (val1 !== val2) throw createError({ statusCode: 400, message: 'Can only split equal value cards' })

  const newHand: Hand = {
    id: `hand-${s.playerHands.length}`,
    cards: [hand.cards.pop()!],
    bet: hand.bet,
    status: 'playing',
  }

  hand.cards.push(s.deck.pop()!)
  newHand.cards.push(s.deck.pop()!)

  s.playerHands.splice(s.currentHandIndex + 1, 0, newHand)
  s.message = `Playing hand ${s.currentHandIndex + 1}`
  return { state: s, netPayout: 0, finished: false }
}

function doSurrender(s: BlackjackState, bet: number): BlackjackResult {
  if (s.phase !== 'playing') throw createError({ statusCode: 400, message: 'Cannot surrender now' })
  const hand = s.playerHands[s.currentHandIndex]!
  if (hand.cards.length !== 2) throw createError({ statusCode: 400, message: 'Can only surrender on first two cards' })

  hand.status = 'surrendered'
  return advanceHand(s, bet)
}

function advanceHand(s: BlackjackState, bet: number): BlackjackResult {
  if (s.currentHandIndex < s.playerHands.length - 1) {
    s.currentHandIndex++
    s.message = `Playing hand ${s.currentHandIndex + 1}`
    return { state: s, netPayout: 0, finished: false }
  } else {
    s.phase = 'dealerTurn'
    return finishDealerTurn(s, bet)
  }
}

function finishDealerTurn(s: BlackjackState, _bet: number): BlackjackResult {
  s.dealerHand.cards[1]!.isHidden = false

  const allDone = s.playerHands.every(h => h.status === 'busted' || h.status === 'surrendered' || h.status === 'blackjack')
  if (!allDone) {
    let dealerScore = calculateScore(s.dealerHand.cards)
    while (dealerScore < 17) {
      s.dealerHand.cards.push(s.deck.pop()!)
      dealerScore = calculateScore(s.dealerHand.cards)
    }
  }

  return resolveGame(s)
}

function resolveGame(s: BlackjackState): BlackjackResult {
  const dealerScore = calculateScore(s.dealerHand.cards)
  const dealerBusted = dealerScore > 21
  let totalPayout = 0

  for (const hand of s.playerHands) {
    if (hand.status === 'surrendered') {
      // Player gets half bet back
      totalPayout += hand.bet / 2
      continue
    }
    if (hand.status === 'busted') continue

    const playerScore = calculateScore(hand.cards)

    if (hand.status === 'blackjack') {
      if (dealerScore === 21 && s.dealerHand.cards.length === 2) {
        hand.status = 'push'
        totalPayout += hand.bet
      } else {
        totalPayout += hand.bet + (hand.bet * 1.5)
      }
    } else if (dealerBusted || playerScore > dealerScore) {
      hand.status = 'won'
      totalPayout += hand.bet * 2
    } else if (playerScore < dealerScore) {
      hand.status = 'lost'
    } else {
      hand.status = 'push'
      totalPayout += hand.bet
    }
  }

  s.phase = 'resolved'
  s.message = 'Game Over. Place a new bet to play again.'

  // Calculate total bet across all hands
  const totalBet = s.playerHands.reduce((sum, h) => sum + h.bet, 0)
  // Surrendered hands had their original bet, but we already counted half back
  // Net payout is totalPayout - totalBet (what was wagered)
  const netPayout = totalPayout - totalBet

  return { state: s, netPayout, finished: true }
}

/** Get basic strategy hint */
export function getHint(
  hand: Hand,
  dealerUpcard: Card,
  canDouble: boolean,
  canSurrender: boolean,
  canSplit: boolean,
): BlackjackAction {
  const dealerVal = cardValue(dealerUpcard)

  // Pairs
  if (canSplit && hand.cards.length === 2 && hand.cards[0]!.rank === hand.cards[1]!.rank) {
    const pVal = cardValue(hand.cards[0]!)
    if (pVal === 11 || pVal === 8) return 'split'
    if (pVal === 10) return 'stand'
    if (pVal === 9) return (dealerVal === 7 || dealerVal >= 10) ? 'stand' : 'split'
    if (pVal === 7) return dealerVal <= 7 ? 'split' : 'hit'
    if (pVal === 6) return dealerVal <= 6 ? 'split' : 'hit'
    if (pVal === 5) return (canDouble && dealerVal <= 9) ? 'double' : 'hit'
    if (pVal === 4) return (dealerVal === 5 || dealerVal === 6) ? 'split' : 'hit'
    if (pVal === 2 || pVal === 3) return dealerVal <= 7 ? 'split' : 'hit'
  }

  let total = 0
  let aces = 0
  for (const c of hand.cards) {
    total += cardValue(c)
    if (c.rank === 'A') aces += 1
  }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1 }
  const isSoft = aces > 0 && total <= 21

  // Soft totals
  if (isSoft) {
    if (total >= 19) return 'stand'
    if (total === 18) {
      if (dealerVal >= 3 && dealerVal <= 6) return canDouble ? 'double' : 'stand'
      if (dealerVal === 2 || dealerVal === 7 || dealerVal === 8) return 'stand'
      return 'hit'
    }
    if (total === 17) {
      if (dealerVal >= 3 && dealerVal <= 6) return canDouble ? 'double' : 'hit'
      return 'hit'
    }
    if (total === 15 || total === 16) {
      if (dealerVal >= 4 && dealerVal <= 6) return canDouble ? 'double' : 'hit'
      return 'hit'
    }
    if (total === 13 || total === 14) {
      if (dealerVal === 5 || dealerVal === 6) return canDouble ? 'double' : 'hit'
      return 'hit'
    }
  }

  // Hard totals
  if (total >= 17) return 'stand'
  if (total === 16) {
    if (dealerVal >= 9 && canSurrender) return 'surrender'
    if (dealerVal >= 2 && dealerVal <= 6) return 'stand'
    return 'hit'
  }
  if (total === 15) {
    if (dealerVal === 10 && canSurrender) return 'surrender'
    if (dealerVal >= 2 && dealerVal <= 6) return 'stand'
    return 'hit'
  }
  if (total === 13 || total === 14) {
    if (dealerVal >= 2 && dealerVal <= 6) return 'stand'
    return 'hit'
  }
  if (total === 12) {
    if (dealerVal >= 4 && dealerVal <= 6) return 'stand'
    return 'hit'
  }
  if (total === 11) return canDouble ? 'double' : 'hit'
  if (total === 10) {
    if (dealerVal <= 9) return canDouble ? 'double' : 'hit'
    return 'hit'
  }
  if (total === 9) {
    if (dealerVal >= 3 && dealerVal <= 6) return canDouble ? 'double' : 'hit'
    return 'hit'
  }

  return 'hit'
}
