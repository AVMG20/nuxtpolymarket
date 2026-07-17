import { requireUserId } from '#server/utils/auth'
import { debit, accumulateRake } from '#server/utils/balance'
import { getHint, performAction, startGame, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackAction, BlackjackResult, BlackjackState, Card, Hand } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions } from '#server/database/schema'
import { eq } from 'drizzle-orm'
import { lockUserBalance, readUserBalance, settleFinishedHand } from '#server/utils/blackjack'
import { AI_CASINO_MAX_BET } from '#shared/utils/limits'

function visibleCard(card: Card) {
    return `${card.rank} of ${card.suit}`
}

function handSummary(hand: Hand) {
    const score = hand.cards.reduce((total, card) => {
        if (card.rank === 'A') return total + 11
        return total + (['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank))
    }, 0)
    let adjustedScore = score
    let aces = hand.cards.filter(card => card.rank === 'A').length
    while (adjustedScore > 21 && aces > 0) {
        adjustedScore -= 10
        aces--
    }
    return {
        cards: hand.cards.map(visibleCard),
        score: adjustedScore,
        bet: hand.bet,
        status: hand.status
    }
}

export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    const { bet: rawBet } = await readBody<{ bet: number }>(event)
    const bet = Number(rawBet)
    if (!Number.isFinite(bet) || bet < 1 || bet > AI_CASINO_MAX_BET) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
    }

    return db.transaction(async (tx) => {
        // Locking the user row keeps the whole auto-played hand atomic: no other
        // blackjack request can stake or settle against this player mid-resolution.
        const startingBalance = await lockUserBalance(tx, userId)

        const existing = await tx.select().from(blackjackSessions).where(eq(blackjackSessions.userId, userId)).limit(1)
        if (existing.length > 0) {
            throw createError({ statusCode: 400, statusMessage: 'You already have an active blackjack game. Finish it first.' })
        }

        await debit(userId, bet.toFixed(4), 'blackjack', tx)
        await accumulateRake(userId, bet, tx)

        let result: BlackjackResult = startGame(bet)
        const actions: BlackjackAction[] = []

        // Resolve the whole hand in this request. Insurance is declined because its
        // expected value is negative; all other choices follow the existing hint.
        while (!result.finished) {
            const state: BlackjackState = result.state
            let action: BlackjackAction

            if (state.phase === 'insurance') {
                action = 'no-insurance'
            } else if (state.phase === 'playing') {
                const hand = state.playerHands[state.currentHandIndex]
                const availableBalance = await readUserBalance(tx, userId)
                if (!hand) throw createError({ statusCode: 500, statusMessage: 'Blackjack hand is missing' })

                const canFundExtraBet = availableBalance >= hand.bet
                action = getHint(
                    hand,
                    state.dealerHand.cards[0]!,
                    hand.cards.length === 2 && canFundExtraBet,
                    hand.cards.length === 2,
                    hand.cards.length === 2 && canFundExtraBet
                )

                if (action === 'double' || action === 'split') {
                    await debit(userId, hand.bet.toFixed(4), 'blackjack', tx)
                    await accumulateRake(userId, hand.bet, tx)
                }
            } else {
                throw createError({ statusCode: 500, statusMessage: 'Blackjack could not be resolved' })
            }

            actions.push(action)
            result = performAction(state, action, bet)
        }

        const { totalBets, payout } = await settleFinishedHand(tx, userId, result)
        const balance = await readUserBalance(tx, userId)

        return {
            bet,
            totalWagered: totalBets,
            payout,
            net: balance - startingBalance,
            balance,
            actions,
            message: result.state.message,
            dealer: handSummary(result.state.dealerHand),
            hands: result.state.playerHands.map(handSummary),
            clientState: toClientState(result.state)
        }
    })
})
