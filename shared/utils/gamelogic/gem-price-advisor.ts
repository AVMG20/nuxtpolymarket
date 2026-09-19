import { GEM_EXCHANGE_MIN_PRICE } from './gem-exchange'

// The gem exchange's AI price button. A player who is placing an offer asks
// for a good price; code prices a handful of offers that would rest on the
// book (none of them trade instantly) and describes each in words, and Jev
// picks the one that best balances price against how soon it should fill.
// Advice only: the price lands in the input and the player still places the
// order themselves.

export type GemAdvisorSide = 'buy' | 'sell'

export interface GemAdvisorMarket {
    guidePrice: number
    bestBid: number | null
    bestAsk: number | null
    /** Gems resting on each side of the whole book. */
    gemsForSale: number
    gemsWanted: number
    /** Recent player-to-player trades, newest first. */
    trades: { price: number, quantity: number }[]
    trades24h: number
}

export interface GemAdvisorOption {
    id: string
    price: number
    description: string
    /** Heads its side of the book: the pick when Jev is unsure. */
    front: boolean
}

/** Below this probability for its pick the button falls back to the front of the queue. */
export const GEM_ADVISOR_MIN_PROBABILITY = 0.35

function cents(value: number) {
    return Math.max(GEM_EXCHANGE_MIN_PRICE, Math.round(value * 100) / 100)
}

function pct(price: number, guide: number) {
    const diff = (price - guide) / guide * 100
    if (Math.abs(diff) < 0.5) return 'right at the guide price'
    return `${Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)}% ${diff > 0 ? 'above' : 'below'} the guide price`
}

/** How many of the recent trades went at or better than `price` for this side. */
function tradedAt(market: GemAdvisorMarket, side: GemAdvisorSide, price: number) {
    const hits = market.trades.filter(trade => side === 'sell' ? trade.price >= price : trade.price <= price).length
    if (!market.trades.length) return 'no recent trades to compare'
    if (hits === 0) return `none of the last ${market.trades.length} trades went this ${side === 'sell' ? 'high' : 'low'}`
    if (hits === market.trades.length) return `every one of the last ${market.trades.length} trades went at this price or ${side === 'sell' ? 'higher' : 'lower'}`
    return `${hits} of the last ${market.trades.length} trades went at this price or ${side === 'sell' ? 'higher' : 'lower'}`
}

/**
 * Offers worth considering, sorted from quickest to fill to best price. Every
 * price rests on the book: a sell stays above the best bid and a buy below the
 * best ask. Descriptions state facts only, so the book and the recent trades
 * decide which one reads as a good deal, not a label.
 */
export function gemAdvisorOptions(side: GemAdvisorSide, market: GemAdvisorMarket): GemAdvisorOption[] {
    const guide = market.guidePrice
    const sell = side === 'sell'
    const dir = sell ? 1 : -1
    // The tightest price that still rests instead of trading right away.
    const limit = sell
        ? (market.bestBid !== null ? market.bestBid + 0.01 : GEM_EXCHANGE_MIN_PRICE)
        : (market.bestAsk !== null ? market.bestAsk - 0.01 : Infinity)
    const rest = (price: number) => cents(sell ? Math.max(limit, price) : Math.min(limit, price))
    // Our side of the book: sells compete with the best ask, buys with the best bid.
    const rival = sell ? market.bestAsk : market.bestBid

    const prices = [guide, guide * (1 + dir * 0.05), guide * (1 + dir * 0.15)]
    if (rival !== null) prices.push(rival - dir * 0.01)
    if (Number.isFinite(limit) && limit > GEM_EXCHANGE_MIN_PRICE) prices.push(limit)

    const ladder = [...new Set(prices.map(rest))].sort((a, b) => dir * (a - b))
    return ladder.map((price, index) => {
        const queue = rival === null
            ? `no other ${side} offers on the book`
            : dir * (price - rival) < 0
                ? `first in line, ahead of every other ${side} offer`
                : dir * (price - rival) === 0
                    ? `level with the best other ${side} offer`
                    : `behind other ${side} offers`
        return {
            id: `offer_${index + 1}`,
            price,
            description: `${pct(price, guide)}; ${queue}; ${tradedAt(market, side, price)}`,
            front: rival !== null && price === rest(rival - dir * 0.01)
        }
    })
}

function trendWords(trades: { price: number }[]) {
    if (trades.length < 6) return 'too few trades to tell'
    const half = Math.floor(trades.length / 2)
    const avg = (list: { price: number }[]) => list.reduce((sum, trade) => sum + trade.price, 0) / list.length
    const recent = avg(trades.slice(0, half))
    const older = avg(trades.slice(half))
    const change = (recent - older) / older
    if (change > 0.05) return 'prices are rising quickly'
    if (change > 0.01) return 'prices are drifting up'
    if (change < -0.05) return 'prices are falling quickly'
    if (change < -0.01) return 'prices are drifting down'
    return 'prices are steady'
}

function balanceWords(forSale: number, wanted: number) {
    if (forSale === 0 && wanted === 0) return 'the book is empty'
    if (wanted === 0) return 'nobody is bidding for gems'
    if (forSale === 0) return 'nobody is selling gems'
    const ratio = forSale / wanted
    if (ratio > 3) return 'far more gems are offered than wanted'
    if (ratio > 1.3) return 'more gems are offered than wanted'
    if (ratio < 1 / 3) return 'far more gems are wanted than offered'
    if (ratio < 1 / 1.3) return 'more gems are wanted than offered'
    return 'supply and demand are balanced'
}

export function gemAdvisorState(side: GemAdvisorSide, quantity: number, market: GemAdvisorMarket) {
    const onSide = side === 'sell' ? market.gemsForSale : market.gemsWanted
    const share = onSide > 0 ? quantity / onSide : Infinity
    return {
        player: {
            wants: side === 'sell' ? 'to sell gems' : 'to buy gems',
            size: share > 1 ? 'a large order, bigger than everything on that side of the book' : share > 0.25 ? 'a sizeable order' : 'a small order'
        },
        market: {
            trend: trendWords(market.trades),
            balance: balanceWords(market.gemsForSale, market.gemsWanted),
            activity: market.trades24h >= 20 ? 'busy, many trades today' : market.trades24h >= 3 ? 'some trades today' : 'quiet, few or no trades today'
        }
    }
}

export function gemAdvisorQuestion(side: GemAdvisorSide, options: GemAdvisorOption[]) {
    return {
        type: 'choice',
        instructions: {
            question: `Which offer gets the player the best ${side === 'sell' ? 'selling' : 'buying'} price that is still likely to fill within a few hours, given \`market\`?`,
            focus: `A ${side === 'sell' ? 'higher' : 'lower'} price is better only while buyers and sellers still trade near it. In a busy or ${side === 'sell' ? 'rising' : 'falling'} market the player can ask for more; in a quiet or ${side === 'sell' ? 'falling' : 'rising'} market or for a large order, staying near the front of the queue matters more.`
        },
        criteria: Object.fromEntries(options.map(option => [option.id, option.description]))
    }
}

/** The option Jev chose, or the front of the queue (else the guide) when it is unsure. */
export function gemAdvisorPick(
    options: GemAdvisorOption[],
    guide: number,
    answer: { choice?: string, probabilities?: Record<string, number> } | null | undefined
) {
    const chosen = options.find(option => option.id === answer?.choice)
    const probability = chosen ? answer?.probabilities?.[chosen.id] ?? 0 : 0
    if (chosen && probability >= GEM_ADVISOR_MIN_PROBABILITY) return { option: chosen, probability, jev: true }
    const fallback = options.find(option => option.front)
        ?? options.reduce((best, option) => Math.abs(option.price - guide) < Math.abs(best.price - guide) ? option : best)
    return { option: fallback, probability: 0, jev: false }
}
