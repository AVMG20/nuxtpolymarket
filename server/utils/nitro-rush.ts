import { sql } from 'drizzle-orm'
import { db } from '#server/database'
import { nitroRushLaps } from '#server/database/schema'
import { findTrack, Track } from '#shared/utils/nitro-rush/track'

export const NR_LEADERBOARD_TOP = 20
/** Longer than any honest lap, so a stray clock can't land on the board. */
const MAX_LAP_MS = 30 * 60 * 1000

export interface NrBoardRow {
    rank: number
    name: string
    lapMs: number
    you: boolean
}

export interface NrBoard {
    trackId: string
    /** Players with a time on this course. */
    entries: number
    top: NrBoardRow[]
    /** The viewer's own row, also when it sits below the top list; null before their first lap. */
    me: NrBoardRow | null
}

/** A lap the server will accept: a known course and a time the car could physically set. */
export function validLap(trackId: unknown, lapMs: unknown): { trackId: string, lapMs: number } | null {
    if (typeof trackId !== 'string' || typeof lapMs !== 'number' || !Number.isInteger(lapMs)) return null
    if (!findTrack(trackId)) return null
    if (lapMs < nrMinLapMs(trackId) || lapMs > MAX_LAP_MS) return null
    return { trackId, lapMs }
}

const minLapCache = new Map<string, number>()

function nrMinLapMs(trackId: string) {
    let ms = minLapCache.get(trackId)
    if (ms === undefined) {
        ms = Math.ceil(new Track(findTrack(trackId)!).minLapSeconds * 1000)
        minLapCache.set(trackId, ms)
    }
    return ms
}

/** Records a lap; it only replaces the player's entry when quicker, so parallel submits keep the best. */
export async function submitNrLap(userId: string, trackId: string, lapMs: number) {
    const now = new Date()
    const [row] = await db.insert(nitroRushLaps)
        .values({ userId, trackId, lapMs, setAt: now })
        .onConflictDoUpdate({
            target: [nitroRushLaps.userId, nitroRushLaps.trackId],
            set: { lapMs, setAt: now },
            setWhere: sql`${nitroRushLaps.lapMs} > ${lapMs}`
        })
        .returning({ id: nitroRushLaps.id })
    return { improved: !!row }
}

export async function nrLeaderboard(trackId: string, userId: string): Promise<NrBoard> {
    const result = await db.execute(sql`
        with ranked as (
            select l.user_id, u.name, l.lap_ms,
                   row_number() over (order by l.lap_ms asc, l.set_at asc, l.user_id collate "C")::int as rank
            from nitro_rush_laps l
            join "user" u on u.id = l.user_id
            where l.track_id = ${trackId}
        )
        select r.user_id, r.name, r.lap_ms, r.rank, (select count(*) from ranked)::int as entries
        from ranked r
        where r.rank <= ${NR_LEADERBOARD_TOP} or r.user_id = ${userId}
        order by r.rank
    `)
    const rows = result.rows as { user_id: string, name: string, lap_ms: number, rank: number, entries: number }[]
    const toRow = (r: typeof rows[number]): NrBoardRow => ({ rank: Number(r.rank), name: r.name, lapMs: Number(r.lap_ms), you: r.user_id === userId })
    const mine = rows.find(r => r.user_id === userId)
    return {
        trackId,
        entries: rows.length ? Number(rows[0]!.entries) : 0,
        top: rows.filter(r => Number(r.rank) <= NR_LEADERBOARD_TOP).map(toRow),
        me: mine ? toRow(mine) : null
    }
}
