import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgBattlerRun, tcgBattlerSnapshot, tcgBattlerRating } from '#server/database/schema'
import type { BattleUnit } from '#shared/utils/battler/combat'
import type { BattlerStadiumEffect } from '#shared/utils/battler/items'
import type { RunRender } from './run'

/*
 * The public battler profile (§12.10's display surface): a player's ladder
 * record and their finished boards as browsable trophies. Everything here is
 * snapshot data — card-level specs and renders only, never copies, serials
 * or condition.
 */

export interface BattlerTrophyBoard {
    runId: string
    state: string
    wins: number
    losses: number
    round: number
    deckName: string | null
    finishedAt: string | null
    units: (BattleUnit & { render: RunRender })[]
    stadium: { name: string, effect: BattlerStadiumEffect } | null
}

export async function battlerPublicProfile(userId: string) {
    const runs = await db.select({
        id: tcgBattlerRun.id,
        state: tcgBattlerRun.state,
        wins: tcgBattlerRun.wins,
        losses: tcgBattlerRun.losses,
        round: tcgBattlerRun.round,
        deckName: tcgBattlerRun.deckName,
        finishedAt: tcgBattlerRun.finishedAt,
        createdAt: tcgBattlerRun.createdAt
    })
        .from(tcgBattlerRun)
        .where(and(eq(tcgBattlerRun.userId, userId), ne(tcgBattlerRun.state, 'active')))
        .orderBy(desc(tcgBattlerRun.createdAt))

    const [ratingRow] = await db.select().from(tcgBattlerRating).where(eq(tcgBattlerRating.userId, userId))
    const completed = runs.filter(run => run.state === 'won' || run.state === 'lost')
    const best = [...completed].sort((a, b) => b.wins - a.wins || a.losses - b.losses)[0] ?? null
    const record = {
        rating: ratingRow?.rating ?? null,
        ratedFights: ratingRow?.fights ?? 0,
        runsWon: completed.filter(run => run.state === 'won').length,
        runsLost: completed.filter(run => run.state === 'lost').length,
        battlesWon: runs.reduce((sum, run) => sum + run.wins, 0),
        battlesLost: runs.reduce((sum, run) => sum + run.losses, 0),
        best: best ? { wins: best.wins, losses: best.losses } : null
    }

    // Trophy boards: the best run first, then the latest completed ones.
    const pickIds: string[] = []
    if (best) pickIds.push(best.id)
    for (const run of completed) {
        if (pickIds.length >= 3) break
        if (!pickIds.includes(run.id)) pickIds.push(run.id)
    }
    const boards: BattlerTrophyBoard[] = []
    if (pickIds.length > 0) {
        const snapshots = await db.select().from(tcgBattlerSnapshot)
            .where(inArray(tcgBattlerSnapshot.runId, pickIds))
            .orderBy(desc(tcgBattlerSnapshot.round))
        for (const id of pickIds) {
            const snapshot = snapshots.find(row => row.runId === id)
            const run = runs.find(row => row.id === id)
            if (!snapshot || !run) continue
            // Snapshots from before items were a bare board array.
            const raw = snapshot.board as unknown
            const wrapped = Array.isArray(raw)
                ? { units: raw as (BattleUnit & { render: RunRender })[], stadium: null }
                : raw as { units: (BattleUnit & { render: RunRender })[], stadium: { name: string, effect: BattlerStadiumEffect } | null }
            boards.push({
                runId: id,
                state: run.state,
                wins: run.wins,
                losses: run.losses,
                round: run.round,
                deckName: run.deckName,
                finishedAt: run.finishedAt?.toISOString() ?? null,
                units: wrapped.units,
                stadium: wrapped.stadium ?? null
            })
        }
    }
    return { record, boards }
}
