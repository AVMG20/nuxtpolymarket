import { sql } from 'drizzle-orm'
import { db } from '#server/database'
import { nitroRushLaps } from '#server/database/schema'
import { findTrack, Track, TRACKS } from '#shared/utils/nitro-rush/track'

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

/** One course on the track menu: its record and the viewer's own best. */
export interface NrTrackSummary {
    trackId: string
    entries: number
    record: { name: string, lapMs: number } | null
    myLapMs: number | null
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

/** Every course in `trackIds` (all of them by default), in that order; a course nobody has driven gets an empty row. */
export async function nrTrackSummaries(userId: string, trackIds: string[] = TRACKS.map(t => t.id)): Promise<NrTrackSummary[]> {
    if (!trackIds.length) return []
    const result = await db.execute(sql`
        with ranked as (
            select l.track_id, l.user_id, u.name, l.lap_ms,
                   row_number() over (partition by l.track_id order by l.lap_ms asc, l.set_at asc, l.user_id collate "C")::int as rank,
                   count(*) over (partition by l.track_id)::int as entries
            from nitro_rush_laps l
            join "user" u on u.id = l.user_id
            where l.track_id in (${sql.join(trackIds.map(id => sql`${id}`), sql`, `)})
        )
        select track_id, user_id, name, lap_ms, rank, entries
        from ranked
        where rank = 1 or user_id = ${userId}
    `)
    const rows = result.rows as { track_id: string, user_id: string, name: string, lap_ms: number, rank: number, entries: number }[]
    return trackIds.map((trackId) => {
        const top = rows.find(r => r.track_id === trackId && Number(r.rank) === 1)
        const mine = rows.find(r => r.track_id === trackId && r.user_id === userId)
        return {
            trackId,
            entries: top ? Number(top.entries) : 0,
            record: top ? { name: top.name, lapMs: Number(top.lap_ms) } : null,
            myLapMs: mine ? Number(mine.lap_ms) : null
        }
    })
}
