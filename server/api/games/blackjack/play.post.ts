import { eq } from 'drizzle-orm'
import { auth } from '#server/utils/auth'
import { debit, credit, accumulateRake } from '#server/utils/balance'
import { getHint, performAction, startGame, toClientState } from '#shared/utils/gamelogic/blackjack'
import type { BlackjackAction, BlackjackResult, BlackjackState, Card, Hand } from '#shared/utils/gamelogic/blackjack'
import { db } from '#server/database'
import { blackjackSessions, user } from '#server/database/schema'

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
    const session = await auth.api.getSession({ headers: event.headers })
    if (!session?.user?.id) {
        throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    }

    const { bet: rawBet } = await readBody<{ bet: number }>(event)
    const bet = Number(rawBet)
    if (!Number.isFinite(bet) || bet < 1 || bet > 1_000_000) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid bet amount' })
    }

    const userId = session.user.id

    return db.transaction(async (tx) => {
        // Locking the user row keeps the whole auto-played hand atomic: no other
        // blackjack request can stake or settle against this player mid-resolution.
        const [currentUser] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId)).for('update')
        const startingBalance = Number(currentUser!.balance)

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
                const [funds] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
                const availableBalance = Number(funds!.balance)
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

        const totalBets = result.state.playerHands.reduce((sum, hand) => sum + hand.bet, 0) + result.state.insuranceBet
        const payout = totalBets + result.netPayout
        if (payout > 0) {
            await credit(userId, payout.toFixed(4), 'blackjack', tx)
        }

        const [settled] = await tx.select({ balance: user.balance }).from(user).where(eq(user.id, userId))
        const balance = Number(settled!.balance)
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
