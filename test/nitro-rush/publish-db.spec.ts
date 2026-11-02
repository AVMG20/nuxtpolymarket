import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { db } from '#server/database'
import { nitroRushTracks } from '#server/database/schema'
import { nrGhost, nrLeaderboard, nrRecordGhost, saveNrGhost, submitNrLap } from '#server/utils/nitro-rush'
import { nrPublishedTracks, nrTrackDef, publishNrTrack, unpublishNrTrack } from '#server/utils/nitro-rush-tracks'
import { encodeGhost, GHOST_HZ, GHOST_POSE, ghostSampleCount } from '#shared/utils/nitro-rush/ghost'
import { MAX_PUBLISHED_TRACKS, type CustomTrack } from '#shared/utils/nitro-rush/custom'
import { LONG_RECTANGLE, publishLap, RECTANGLE } from './bot-lap'

const tag = Date.now().toString(36)
const A = `nrp-a-${tag}`
const B = `nrp-b-${tag}`

const course = (id: string, sections = RECTANGLE, name = 'Neon Ring'): CustomTrack => ({ id: `custom-${id}-${tag}`, name, closed: true, sections })
const LAPS = new Map([[RECTANGLE, publishLap(true, RECTANGLE)], [LONG_RECTANGLE, publishLap(true, LONG_RECTANGLE)]])
/** Publishes with the bot's real lap on that road. */
const publish = (userId: string, c: CustomTrack) => publishNrTrack(userId, c, LAPS.get(c.sections))

function ghostOf(seconds: number) {
    const n = ghostSampleCount(seconds, GHOST_HZ)
    const data = new Float32Array(n * GHOST_POSE)
    for (let k = 0; k < n; k++) data[k * GHOST_POSE + 6] = 1
    return encodeGhost({ hz: GHOST_HZ, end: seconds, data })!
}

describe.skipIf(SKIP)('nitro rush published tracks (db)', () => {
    beforeAll(async () => {
        await seedUser(A)
        await seedUser(B)
    })
    afterAll(async () => {
        await cleanupUser(A)
        await cleanupUser(B)
    })

    it('publishes a course that others can race, and refuses one that isn\'t finished or named', async () => {
        const id = await publish(A, course('ring'))
        expect(id.startsWith('pub-')).toBe(true)
        expect((await nrTrackDef(id))?.id).toBe(id)
        expect(await nrTrackDef('pub-nowhere')).toBeNull()
        expect(await nrTrackDef(course('ring').id)).toBeNull()
        await expect(publish(A, course('open', ['start', 'straight-100']))).rejects.toMatchObject({ statusCode: 400 })
        await expect(publish(A, course('blank', RECTANGLE, '  '))).rejects.toMatchObject({ statusCode: 400 })
        await expect(publish(A, { ...course('bad'), id: 'polytown-oval' })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('keeps one published copy per course under a burst of publishes', async () => {
        const ids = await Promise.all(Array.from({ length: 8 }, () => publish(A, course('burst'))))
        expect(new Set(ids).size).toBe(1)
        const rows = await db.select().from(nitroRushTracks).where(eq(nitroRushTracks.sourceId, course('burst').id))
        expect(rows).toHaveLength(1)
    })

    it('keeps the board through a rename, and starts a fresh one when the road changes', async () => {
        const id = await publish(A, course('edit'))
        await submitNrLap(B, id, 30_000)
        await saveNrGhost(B, id, { ghost: ghostOf(30), standing: false })
        // A rename needs no lap: the board it keeps already has one.
        expect(await publishNrTrack(A, course('edit', RECTANGLE, 'Renamed'))).toBe(id)
        expect((await nrPublishedTracks(B)).community.find(t => t.id === id)).toMatchObject({ name: 'Renamed', summary: { myLapMs: 30_000 } })

        const next = await publish(A, course('edit', LONG_RECTANGLE))
        expect(next).not.toBe(id)
        expect(await nrTrackDef(id)).toBeNull()
        expect(await nrGhost(B, id)).toBeNull()
        const { community } = await nrPublishedTracks(B)
        // The fresh board holds only the builder's lap.
        expect(community.filter(t => t.sourceId === course('edit').id).map(t => [t.id, t.summary.entries])).toEqual([[next, 1]])
    })

    it('starts the board with the builder\'s lap and their ghost as the record ghost', async () => {
        const lap = LAPS.get(RECTANGLE)!
        const id = await publish(A, course('seeded'))
        const board = await nrLeaderboard(id, B)
        expect(board.entries).toBe(1)
        expect(board.top[0]).toMatchObject({ rank: 1, lapMs: lap.ghost.end, you: false })
        expect(await nrGhost(A, id)).toEqual(lap)
        expect(await nrRecordGhost(id, B)).toMatchObject({ lapMs: lap.ghost.end, ghost: lap.ghost, standing: lap.standing })
    })

    it('refuses a new course or a changed road without a lap really driven on it', async () => {
        const lap = LAPS.get(RECTANGLE)!
        await expect(publishNrTrack(A, course('no-lap'))).rejects.toMatchObject({ statusCode: 400 })
        await expect(publishNrTrack(A, course('no-lap'), { ghost: null, standing: true })).rejects.toMatchObject({ statusCode: 400 })
        // Long enough for the clock, but it never leaves the grid.
        await expect(publishNrTrack(A, course('no-lap'), { ghost: ghostOf(30), standing: false })).rejects.toMatchObject({ statusCode: 400 })
        // A real lap, on another road.
        await expect(publishNrTrack(A, course('no-lap'), LAPS.get(LONG_RECTANGLE))).rejects.toMatchObject({ statusCode: 400 })
        await expect(publishNrTrack(A, course('no-lap'), { ghost: { ...lap.ghost, d: 'not base64!' }, standing: true })).rejects.toMatchObject({ statusCode: 400 })
        expect(await db.select().from(nitroRushTracks).where(eq(nitroRushTracks.sourceId, course('no-lap').id))).toEqual([])

        const id = await publish(A, course('kept'))
        await expect(publishNrTrack(A, course('kept', LONG_RECTANGLE))).rejects.toMatchObject({ statusCode: 400 })
        // The refused change leaves the published copy and its board as they were.
        expect((await nrTrackDef(id))?.id).toBe(id)
        expect((await nrLeaderboard(id, A)).entries).toBe(1)
    })

    it('lists the viewer\'s own tracks apart from everyone else\'s', async () => {
        const mine = await nrPublishedTracks(A)
        expect(mine.mine.map(t => t.sourceId)).toContain(course('ring').id)
        expect(mine.community.some(t => t.sourceId === course('ring').id)).toBe(false)
        const theirs = await nrPublishedTracks(B)
        expect(theirs.community.find(t => t.sourceId === course('ring').id)).toMatchObject({ author: 'concurrency test user', closed: true, sections: RECTANGLE })
        expect(theirs.mine).toEqual([])
    })

    it('takes a track down with its times, and only its author can', async () => {
        const id = await publish(A, course('gone'))
        await submitNrLap(B, id, 30_000)
        await expect(unpublishNrTrack(B, course('gone').id)).rejects.toMatchObject({ statusCode: 404 })
        await unpublishNrTrack(A, course('gone').id)
        expect(await nrTrackDef(id)).toBeNull()
        expect((await nrPublishedTracks(B)).community.some(t => t.id === id)).toBe(false)
        await expect(unpublishNrTrack(A, course('gone').id)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('caps how many tracks one player may publish', async () => {
        const have = (await nrPublishedTracks(B)).mine.length
        await Promise.all(Array.from({ length: MAX_PUBLISHED_TRACKS - have }, (_, i) => publish(B, course(`cap${i}`))))
        await expect(publish(B, course('one-more'))).rejects.toMatchObject({ statusCode: 400 })
        expect(await publish(B, course('cap0', RECTANGLE, 'Still editable'))).toBeTruthy()
    })
})
