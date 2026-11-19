import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { db } from '#server/database'
import { nitroRushPlays, nitroRushTracks } from '#server/database/schema'
import { nrGhost, nrLeaderboard, nrRecordGhost, recordNrPlay, saveNrGhost, submitNrLap } from '#server/utils/nitro-rush'
import { nrPublishedTracks, nrTrackDef, publishNrTrack, unpublishNrTrack } from '#server/utils/nitro-rush-tracks'
import { encodeGhost, GHOST_HZ, GHOST_POSE, ghostSampleCount } from '#shared/utils/nitro-rush/ghost'
import { MAX_CUSTOM_TRACKS, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { CustomField } from '#shared/utils/nitro-rush/custom-fields'
import { publishedCourse } from '../../app/utils/nitro-rush/community'
import { LONG_RECTANGLE, publishLap, RECTANGLE } from './bot-lap'

const tag = Date.now().toString(36)
const A = `nrp-a-${tag}`
const B = `nrp-b-${tag}`
const C = `nrp-c-${tag}`
const D = `nrp-d-${tag}`
const E = `nrp-e-${tag}`
const F = `nrp-f-${tag}`
const G = `nrp-g-${tag}`
const H = `nrp-h-${tag}`
const USERS = [A, B, C, D, E, F, G, H]

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
        for (const u of USERS) await seedUser(u)
    })
    afterAll(async () => {
        for (const u of USERS) await cleanupUser(u)
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

    it('lists the viewer\'s own tracks on their own and in the community list', async () => {
        const mine = await nrPublishedTracks(A)
        expect(mine.mine.map(t => t.sourceId)).toContain(course('ring').id)
        expect(mine.community.filter(t => t.sourceId === course('ring').id)).toHaveLength(1)
        const theirs = await nrPublishedTracks(B)
        expect(theirs.community.find(t => t.sourceId === course('ring').id)).toMatchObject({ author: 'concurrency test user', closed: true, sections: RECTANGLE })
        expect(theirs.mine).toEqual([])
    })

    it('takes a track down out of sight with its times kept, and only its author can', async () => {
        // Its own author, since the tests above leave A at the cap.
        const id = await publish(C, course('gone'))
        await submitNrLap(B, id, 30_000)
        await expect(unpublishNrTrack(B, course('gone').id)).rejects.toMatchObject({ statusCode: 404 })
        await unpublishNrTrack(C, course('gone').id)
        expect(await nrTrackDef(id)).toBeNull()
        expect((await nrPublishedTracks(B)).community.some(t => t.id === id)).toBe(false)
        const own = await nrPublishedTracks(C)
        expect(own.mine.some(t => t.id === id)).toBe(false)
        expect(own.hidden.find(t => t.id === id)).toMatchObject({ sourceId: course('gone').id, summary: { entries: 2 } })
        await expect(unpublishNrTrack(C, course('gone').id)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('brings the board back when the same road is published again, renamed or rebuilt, with no lap needed', async () => {
        const id = await publish(D, course('back'))
        await submitNrLap(B, id, 30_000)
        await saveNrGhost(B, id, { ghost: ghostOf(30), standing: false })
        await unpublishNrTrack(D, course('back').id)
        expect(await publishNrTrack(D, course('back', RECTANGLE, 'Back Again'))).toBe(id)
        expect((await nrPublishedTracks(B)).community.find(t => t.id === id)).toMatchObject({ name: 'Back Again', summary: { entries: 2, myLapMs: 30_000 } })
        expect(await nrGhost(B, id)).not.toBeNull()

        await unpublishNrTrack(D, course('back').id)
        expect(await publishNrTrack(D, course('rebuilt'))).toBe(id)
        expect((await nrPublishedTracks(D)).mine.find(t => t.id === id)?.sourceId).toBe(course('rebuilt').id)
    })

    it('publishes a changed road fresh, keeping the hidden board for that old road to come back to', async () => {
        const old = await publish(E, course('swap'))
        await submitNrLap(B, old, 30_000)
        await unpublishNrTrack(E, course('swap').id)
        // A changed road still needs its lap.
        await expect(publishNrTrack(E, course('swap', LONG_RECTANGLE))).rejects.toMatchObject({ statusCode: 400 })
        const next = await publish(E, course('swap', LONG_RECTANGLE))
        expect(next).not.toBe(old)
        expect((await nrLeaderboard(next, E)).entries).toBe(1)
        expect((await nrPublishedTracks(E)).hidden.map(t => t.id)).toEqual([old])
        expect(await publishNrTrack(E, course('swap-back'))).toBe(old)
        expect((await nrLeaderboard(old, E)).entries).toBe(2)
    })

    it('keeps one consistent copy under a burst of unpublishes and republishes', async () => {
        const id = await publish(F, course('flip'))
        await Promise.allSettled(Array.from({ length: 10 }, (_, i) => i % 2 ? publishNrTrack(F, course('flip')) : unpublishNrTrack(F, course('flip').id)))
        const rows = await db.select().from(nitroRushTracks).where(eq(nitroRushTracks.authorId, F))
        expect(rows.map(r => [r.id, r.sourceId])).toEqual([[id, course('flip').id]])
        expect((await nrLeaderboard(id, F)).entries).toBe(1)
    })

    it('keeps only the newest unpublished tracks per author', async () => {
        const stale = Array.from({ length: MAX_CUSTOM_TRACKS }, (_, i) => ({
            id: `pub-stale-${i}-${tag}`,
            authorId: G,
            sourceId: `custom-stale-${i}-${tag}`,
            name: 'Stale',
            closed: true,
            sections: LONG_RECTANGLE,
            roadHash: `stale-${i}`,
            unpublishedAt: new Date(Date.now() - (i + 1) * 60_000)
        }))
        await db.insert(nitroRushTracks).values(stale)
        const id = await publish(G, course('fresh'))
        await unpublishNrTrack(G, course('fresh').id)
        const hidden = (await nrPublishedTracks(G)).hidden.map(t => t.id)
        expect(hidden).toHaveLength(MAX_CUSTOM_TRACKS)
        expect(hidden).toContain(id)
        expect(hidden).not.toContain(stale.at(-1)!.id)
    })

    it('counts the builder\'s lap as a play, and carries every play over to a changed road', async () => {
        const old = await publish(H, course('played'))
        // An hour back, past any lap's spam guard, so the next play counts.
        const age = () => db.update(nitroRushPlays).set({ lastLapAt: new Date(Date.now() - 3_600_000) }).where(eq(nitroRushPlays.trackId, old))
        await recordNrPlay(B, old, 10_000)
        await age()
        await recordNrPlay(B, old, 10_000)
        await age()
        const next = await publish(H, course('played', LONG_RECTANGLE))
        expect(await db.select().from(nitroRushPlays).where(eq(nitroRushPlays.trackId, old))).toEqual([])
        expect((await nrPublishedTracks(B)).community.find(t => t.id === next)?.summary.plays).toEqual({ racers: 2, laps: 4 })
    })

    it('lists a well-played track past the newest hundred, once', async () => {
        const old = await publish(H, course('classic'))
        // After the vote spec's oldest, which it expects last on the same list.
        await db.update(nitroRushTracks).set({ publishedAt: new Date('2001-06-01') }).where(eq(nitroRushTracks.id, old))
        // Dated long ago, so they don't push out other specs' tracks.
        const filler = (i: number) => `pub-play-filler-${i}-${tag}`
        await db.insert(nitroRushTracks).values(Array.from({ length: 100 }, (_, i) => ({
            id: filler(i), authorId: H, sourceId: `custom-play-filler-${i}-${tag}`, name: 'Filler', closed: true, sections: RECTANGLE, publishedAt: new Date(Date.UTC(2002, 0, 1, 0, 0, i))
        })))
        try {
            const ids = (await nrPublishedTracks(B)).community.map(t => t.id)
            expect(ids.filter(id => id === old)).toHaveLength(1)
        } finally {
            await db.delete(nitroRushTracks).where(sql`${nitroRushTracks.id} like ${`pub-play-filler-%-${tag}`}`)
        }
    })

    it('stores a course\'s fields and serves them back', async () => {
        const sections: SectionId[] = RECTANGLE.map((s, i) => i === 4 ? 'field' : s)
        const fields: CustomField[] = [{ at: { branch: 0, at: 4 }, width: 40, length: 100, entry: 1, exit: { edge: 'exit', tile: 1 }, tiles: [{ col: 0, row: 2, kind: 'pillar' }] }]
        const c: CustomTrack = { ...course('field', sections), fields }
        const id = await publishNrTrack(H, c, publishLap(true, sections, fields))
        expect((await nrTrackDef(id))?.fields?.[0]?.plan.tiles).toEqual(fields[0]!.tiles)
        const row = (await nrPublishedTracks(H)).mine.find(t => t.id === id)!
        expect(row.fields).toEqual(fields)
        expect(publishedCourse(row).fields).toEqual(fields)
        // The same road unpublished and published again finds its board; a moved item makes a new one.
        await unpublishNrTrack(H, c.id)
        expect(await publishNrTrack(H, c)).toBe(id)
        const moved = { ...c, fields: [{ ...fields[0]!, tiles: [{ col: 1, row: 2, kind: 'pillar' as const }] }] }
        await expect(publishNrTrack(H, moved)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('caps how many tracks one player may publish', async () => {
        const have = (await nrPublishedTracks(B)).mine.length
        await Promise.all(Array.from({ length: MAX_CUSTOM_TRACKS - have }, (_, i) => publish(B, course(`cap${i}`))))
        await expect(publish(B, course('one-more'))).rejects.toMatchObject({ statusCode: 400 })
        expect(await publish(B, course('cap0', RECTANGLE, 'Still editable'))).toBeTruthy()
    })
})
