import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'
import { db } from '#server/database'
import { nitroRushTrackVotes, nitroRushTracks } from '#server/database/schema'
import { nrPublishedTracks, publishNrTrack, unpublishNrTrack, voteNrTrack } from '#server/utils/nitro-rush-tracks'
import type { CustomTrack } from '#shared/utils/nitro-rush/custom'
import { LONG_RECTANGLE, publishLap, RECTANGLE } from './bot-lap'

const tag = Date.now().toString(36)
const A = `nrv-a-${tag}`
const B = `nrv-b-${tag}`
const C = `nrv-c-${tag}`

const LAPS = new Map([[RECTANGLE, publishLap(true, RECTANGLE)], [LONG_RECTANGLE, publishLap(true, LONG_RECTANGLE)]])
const course = (id: string, sections = RECTANGLE, name = 'Vote Ring'): CustomTrack => ({ id: `custom-vote-${id}-${tag}`, name, closed: true, sections })

const publish = (userId: string, c: CustomTrack) => publishNrTrack(userId, c, LAPS.get(c.sections))

const voteRows = (trackId: string, userId?: string) => db.select().from(nitroRushTrackVotes)
    .where(userId ? and(eq(nitroRushTrackVotes.trackId, trackId), eq(nitroRushTrackVotes.userId, userId)) : eq(nitroRushTrackVotes.trackId, trackId))

/** Resolves once some backend is waiting on a lock that `pid` holds. */
async function waitUntilBlocked(pid: number) {
    for (let i = 0; i < 500; i++) {
        const { rows } = await db.execute(sql`select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`)
        if (rows.length) return
        await new Promise(r => setTimeout(r, 10))
    }
    throw new Error('nothing ever waited on the lock')
}

describe.skipIf(SKIP)('nitro rush track votes (db)', () => {
    beforeAll(async () => {
        await seedUser(A)
        await seedUser(B)
        await seedUser(C)
    })
    afterAll(async () => {
        await cleanupUser(A)
        await cleanupUser(B)
        await cleanupUser(C)
    })

    it('sets a vote, switches it and clears it', async () => {
        const id = await publish(A, course('flip'))
        expect(await voteNrTrack(B, id, 1)).toEqual({ trackId: id, up: 1, down: 0, myVote: 1 })
        expect(await voteNrTrack(C, id, 1)).toMatchObject({ up: 2, down: 0, myVote: 1 })
        expect(await voteNrTrack(B, id, -1)).toMatchObject({ up: 1, down: 1, myVote: -1 })
        expect(await voteNrTrack(B, id, -1)).toMatchObject({ up: 1, down: 1, myVote: -1 })
        expect(await voteNrTrack(B, id, 0)).toMatchObject({ up: 1, down: 0, myVote: 0 })
        expect(await voteNrTrack(B, id, 0)).toMatchObject({ up: 1, down: 0, myVote: 0 })
        expect(await voteRows(id, B)).toEqual([])
    })

    it('keeps one vote per player per track under a burst', async () => {
        const id = await publish(A, course('burst'))
        const votes = [1, -1, 0, 1, -1, 1, 1, -1, 0, 1] as const
        await Promise.all([...votes.map(v => voteNrTrack(B, id, v)), ...votes.map(() => voteNrTrack(C, id, 1))])
        // Whichever of B's votes landed last, the row and the list agree on it.
        const bVote = (await nrPublishedTracks(B)).community.find(t => t.id === id)!.votes.myVote
        expect((await voteRows(id, B)).map(r => r.value)).toEqual(bVote ? [bVote] : [])
        expect(await voteRows(id, C)).toHaveLength(1)
        const { community } = await nrPublishedTracks(C)
        const { votes: tally } = community.find(t => t.id === id)!
        expect(tally.myVote).toBe(1)
        expect(tally.up + tally.down).toBe((await voteRows(id)).length)
    })

    it('refuses a vote on the player\'s own track', async () => {
        const id = await publish(A, course('own'))
        await expect(voteNrTrack(A, id, 1)).rejects.toMatchObject({ statusCode: 403 })
        await expect(voteNrTrack(A, id, 0)).rejects.toMatchObject({ statusCode: 403 })
        expect(await voteRows(id)).toEqual([])
    })

    it('refuses built-in, private, unknown and malformed tracks, and anything but 1, -1 or 0', async () => {
        const id = await publish(A, course('input'))
        await expect(voteNrTrack(B, 'polytown-oval', 1)).rejects.toMatchObject({ statusCode: 400 })
        await expect(voteNrTrack(B, course('input').id, 1)).rejects.toMatchObject({ statusCode: 400 })
        await expect(voteNrTrack(B, 'pub-nowhere', 1)).rejects.toMatchObject({ statusCode: 404 })
        await expect(voteNrTrack(B, `pub-${'x'.repeat(100)}`, 1)).rejects.toMatchObject({ statusCode: 400 })
        await expect(voteNrTrack(B, undefined, 1)).rejects.toMatchObject({ statusCode: 400 })
        for (const bad of [2, '1', 0.5, true, null, undefined, Number.NaN]) {
            await expect(voteNrTrack(B, id, bad)).rejects.toMatchObject({ statusCode: 400 })
        }
        expect(await voteRows(id)).toEqual([])
    })

    it('drops the votes when a track is taken down, and answers 404 after', async () => {
        const id = await publish(A, course('gone'))
        await voteNrTrack(B, id, 1)
        await voteNrTrack(C, id, -1)
        await unpublishNrTrack(A, course('gone').id)
        expect(await voteRows(id)).toEqual([])
        await expect(voteNrTrack(B, id, 1)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('answers a vote that lands while the track is being taken down with a 404', async () => {
        const id = await publish(A, course('race'))
        let deleted!: () => void
        let release!: () => void
        const isDeleted = new Promise<void>((r) => {
            deleted = r
        })
        const held = new Promise<void>((r) => {
            release = r
        })
        let holder = 0
        // Holds the delete open so the vote runs against a row that is going away.
        const removing = db.transaction(async (tx) => {
            const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`)
            holder = Number((rows[0] as { pid: number }).pid)
            await tx.delete(nitroRushTracks).where(eq(nitroRushTracks.id, id))
            deleted()
            await held
        })
        await isDeleted
        const vote = voteNrTrack(B, id, 1)
        const outcome = vote.then(() => 'voted', (e: { statusCode?: number }) => e.statusCode)
        await waitUntilBlocked(holder)
        release()
        await removing
        expect(await outcome).toBe(404)
        expect(await voteRows(id)).toEqual([])
    })

    it('keeps every vote through a rename and through a road change, onto the new id', async () => {
        const id = await publish(A, course('edit'))
        await voteNrTrack(B, id, 1)
        await voteNrTrack(C, id, -1)
        expect(await publish(A, course('edit', RECTANGLE, 'Renamed'))).toBe(id)
        expect(await voteRows(id)).toHaveLength(2)
        const next = await publish(A, course('edit', LONG_RECTANGLE))
        expect(next).not.toBe(id)
        expect(await voteRows(id)).toEqual([])
        expect((await nrPublishedTracks(B)).community.find(t => t.id === next)?.votes).toEqual({ up: 1, down: 1, myVote: 1 })
        expect((await nrPublishedTracks(C)).community.find(t => t.id === next)?.votes).toEqual({ up: 1, down: 1, myVote: -1 })
        expect(await voteNrTrack(B, next, -1)).toMatchObject({ up: 0, down: 2, myVote: -1 })
        await unpublishNrTrack(A, course('edit').id)
        expect(await voteRows(next)).toEqual([])
    })

    it('carries a vote that was mid-flight when the road changed, with no deadlock and nothing left on the old id', async () => {
        const id = await publish(A, course('swap'))
        await voteNrTrack(C, id, 1)
        let locked!: () => void
        let release!: () => void
        const isLocked = new Promise<void>((r) => {
            locked = r
        })
        const held = new Promise<void>((r) => {
            release = r
        })
        let holder = 0
        // B's vote, as the endpoint runs it, paused between its key share on the track and its vote row.
        const voting = db.transaction(async (tx) => {
            const { rows } = await tx.execute(sql`select pg_backend_pid() as pid`)
            holder = Number((rows[0] as { pid: number }).pid)
            await tx.select({ id: nitroRushTracks.id }).from(nitroRushTracks).where(eq(nitroRushTracks.id, id)).for('key share')
            locked()
            await held
            await tx.insert(nitroRushTrackVotes).values({ userId: B, trackId: id, value: -1 })
        })
        await isLocked
        const replacing = publish(A, course('swap', LONG_RECTANGLE))
        await waitUntilBlocked(holder)
        release()
        await voting
        const next = await replacing
        expect(await voteRows(id)).toEqual([])
        expect((await voteRows(next)).map(r => [r.userId, r.value]).sort()).toEqual([[B, -1], [C, 1]].sort())
        await expect(voteNrTrack(B, id, 1)).rejects.toMatchObject({ statusCode: 404 })
    })

    it('lists each track\'s counts with the viewer\'s own vote', async () => {
        const id = await publish(A, course('list'))
        await voteNrTrack(B, id, 1)
        await voteNrTrack(C, id, -1)
        expect((await nrPublishedTracks(B)).community.find(t => t.id === id)?.votes).toEqual({ up: 1, down: 1, myVote: 1 })
        expect((await nrPublishedTracks(C)).community.find(t => t.id === id)?.votes).toEqual({ up: 1, down: 1, myVote: -1 })
        expect((await nrPublishedTracks(A)).mine.find(t => t.id === id)?.votes).toEqual({ up: 1, down: 1, myVote: 0 })
    })

    it('lets two authors replace their tracks while voting on each other\'s without a deadlock', async () => {
        const a = course('cross-a')
        const b = course('cross-b')
        let ids = await Promise.all([publish(A, a), publish(B, b)])
        for (let round = 0; round < 6; round++) {
            const sections = round % 2 ? RECTANGLE : LONG_RECTANGLE
            const results = await Promise.allSettled([
                voteNrTrack(A, ids[1]!, 1),
                voteNrTrack(B, ids[0]!, -1),
                publish(A, { ...a, sections }),
                publish(B, { ...b, sections }),
                voteNrTrack(A, ids[1]!, -1),
                voteNrTrack(B, ids[0]!, 1)
            ])
            // A vote on a road replaced under it is a 404; anything else, a deadlock included, is a failure.
            const failures = results.flatMap(r => r.status === 'rejected' && (r.reason as { statusCode?: number }).statusCode !== 404 ? [r.reason] : [])
            expect(failures).toEqual([])
            ids = [results[2], results[3]].map(r => (r as PromiseFulfilledResult<string>).value)
        }
    })

    it('lists a well-voted track past the newest hundred, once, with the list still newest first', async () => {
        const old = await publish(A, course('classic'))
        await db.update(nitroRushTracks).set({ publishedAt: new Date('2001-01-01') }).where(eq(nitroRushTracks.id, old))
        await voteNrTrack(B, old, 1)
        // A hundred newer than it push it out of the newest; dated long ago, so they don't push out other specs' tracks.
        const filler = (i: number) => `pub-vote-filler-${i}-${tag}`
        await db.insert(nitroRushTracks).values(Array.from({ length: 100 }, (_, i) => ({
            id: filler(i), authorId: A, sourceId: `custom-vote-filler-${i}-${tag}`, name: 'Filler', closed: true, sections: RECTANGLE, publishedAt: new Date(Date.UTC(2002, 0, 1, 0, 0, i))
        })))
        try {
            await voteNrTrack(B, filler(0), 1)
            const { community } = await nrPublishedTracks(C)
            const ids = community.map(t => t.id)
            expect(ids.filter(id => id === old)).toHaveLength(1)
            expect(ids.filter(id => id === filler(0))).toHaveLength(1)
            expect(ids.at(-1)).toBe(old)
            expect(community.find(t => t.id === old)?.votes).toEqual({ up: 1, down: 0, myVote: 0 })
        } finally {
            await db.delete(nitroRushTracks).where(sql`${nitroRushTracks.id} like ${`pub-vote-filler-%-${tag}`}`)
        }
    })
})

