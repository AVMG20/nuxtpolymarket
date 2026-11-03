/**
 * Rail Tycoon world storage against the real tables: a stored save comes back as the same world,
 * a save that is corrupt, a gzip bomb or oversized loads as null instead of crashing, and a
 * checkpoint is revision-guarded, joins its caller's transaction and writes a member row atomically.
 *
 * Needs a local Postgres with the migrations applied. Skips when DATABASE_URL is unset.
 * Ids carry a run-unique prefix, so parallel runs against one database never collide.
 */
import { randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '#server/database'
import { railTycoonChunks, railTycoonMembers, railTycoonWorlds } from '#server/database/schema'
import { rtGzipParts } from '#server/utils/rail-tycoon/compress'
import { rtLoadWorld, rtSaveCheckpoint } from '#server/utils/rail-tycoon/store'
import { RT_GUNZIP_MAX_BYTES, RT_INVITE_CODE_ALPHABET, RT_INVITE_CODE_LENGTH, RT_MAX_SAVE_BYTES } from '#shared/utils/rail-tycoon/limits'
import { RtTileKind } from '#shared/utils/rail-tycoon/map'
import { encodeWorld, encodeWorldParts, rtChunkCount, rtChunkOfTile, rtPartHash } from '#shared/utils/rail-tycoon/save'
import { RT_OWNER_NONE } from '#shared/utils/rail-tycoon/types'
import { RtWorld } from '#shared/utils/rail-tycoon/world'
import { generateWorld } from '#shared/utils/rail-tycoon/worldgen'
import { randomInt } from '#shared/utils/random'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const RUN = `rt-store-${Date.now().toString(36)}-${randomInt(0, 1e9).toString(36)}`
const users: string[] = []
let worldSeq = 0

async function newUser(label: string) {
    const id = `${RUN}-${label}`
    await seedUser(id)
    users.push(id)
    return id
}

function newInviteCode() {
    let code = ''
    for (let i = 0; i < RT_INVITE_CODE_LENGTH; i++) code += RT_INVITE_CODE_ALPHABET[randomInt(0, RT_INVITE_CODE_ALPHABET.length - 1)]
    return code
}

function newWorld(seed: number) {
    return RtWorld.create(generateWorld(seed, { side: 64 }), { side: 64, maxCompanies: 4, sharing: false })
}

interface RowSeed {
    revision?: number
    status?: 'open' | 'closed'
    lastActiveAt?: Date
}

/** A world row holding `save` as its stored bytes, exactly as given. */
async function seedRow(ownerId: string, save: Buffer, seed: RowSeed = {}) {
    const id = `${RUN}-w${worldSeq++}`
    const now = new Date()
    const [row] = await db.insert(railTycoonWorlds).values({
        id,
        ownerId,
        name: `Store ${worldSeq}`,
        status: seed.status ?? 'open',
        inviteCode: newInviteCode(),
        side: 64,
        maxCompanies: 4,
        revision: seed.revision ?? 0,
        save,
        bytes: save.length,
        tick: 0,
        savedAt: now,
        lastActiveAt: seed.lastActiveAt ?? now
    }).returning()
    return row!
}

afterEach(() => {
    vi.restoreAllMocks()
})

afterAll(async () => {
    if (SKIP) return
    // the worlds go with their owner through the foreign key
    for (const id of users) await cleanupUser(id)
})

describe.skipIf(SKIP)('rail tycoon store', () => {
    describe('rtLoadWorld', () => {
        it('loads a stored save as the same world, with the row metadata', async () => {
            const owner = await newUser('load-owner')
            const world = newWorld(4242)
            const lastActiveAt = new Date(Date.now() - 86_400_000)
            const row = await seedRow(owner, gzipSync(encodeWorld(world)), { revision: 7, status: 'closed', lastActiveAt })

            const loaded = await rtLoadWorld(row.id)
            expect(loaded).not.toBeNull()
            expect(loaded!.world.hash()).toBe(world.hash())
            expect(loaded!.world.tick).toBe(world.tick)
            expect(loaded).toMatchObject({ id: row.id, ownerId: owner, status: 'closed', revision: 7, lastActiveAt: row.lastActiveAt })
        })

        it('answers null for a world that does not exist, without logging', async () => {
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})
            expect(await rtLoadWorld(`${RUN}-nope`)).toBeNull()
            expect(log).not.toHaveBeenCalled()
        })

        it('loads a corrupted save as null and logs the world id once, never the bytes', async () => {
            const owner = await newUser('load-corrupt')
            const good = encodeWorld(newWorld(77))
            const flipped = Uint8Array.from(good)
            flipped[4] = 0xff
            const saves = {
                notGzip: Buffer.from('not a gzip stream at all'),
                truncated: gzipSync(good).subarray(0, 64),
                notASave: gzipSync(Buffer.from('RTWD but nothing else')),
                badFormat: gzipSync(flipped),
                trailing: gzipSync(Buffer.concat([good, Buffer.from([0])])),
                empty: Buffer.alloc(0)
            }
            for (const [label, save] of Object.entries(saves)) {
                const row = await seedRow(owner, save)
                const log = vi.spyOn(console, 'error').mockImplementation(() => {})

                expect(await rtLoadWorld(row.id), label).toBeNull()
                expect(log, label).toHaveBeenCalledTimes(1)
                const line = String(log.mock.calls[0]![0])
                expect(line, label).toContain(row.id)
                expect(line, label).not.toContain('gzip stream')
                expect(line, label).not.toContain('nothing else')
                log.mockRestore()
            }
        })

        it('refuses a gzip bomb that inflates past the cap', async () => {
            const owner = await newUser('load-bomb')
            const bomb = gzipSync(Buffer.alloc(RT_GUNZIP_MAX_BYTES + 1))
            expect(bomb.length).toBeLessThan(RT_MAX_SAVE_BYTES)
            const row = await seedRow(owner, bomb)
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})

            expect(await rtLoadWorld(row.id)).toBeNull()
            expect(log).toHaveBeenCalledTimes(1)
            expect(String(log.mock.calls[0]![0])).toContain('ERR_BUFFER_TOO_LARGE')
        })

        it('refuses a compressed save over its own cap without inflating it', async () => {
            const owner = await newUser('load-big')
            // a real save padded past the cap: the size check refuses it before any gunzip
            const save = Buffer.concat([gzipSync(encodeWorld(newWorld(5))), Buffer.alloc(RT_MAX_SAVE_BYTES)])
            const row = await seedRow(owner, save)
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})

            expect(await rtLoadWorld(row.id)).toBeNull()
            expect(log).toHaveBeenCalledTimes(1)
            expect(String(log.mock.calls[0]![0])).toContain(`${save.length} bytes, over the ${RT_MAX_SAVE_BYTES} cap`)
        }, 20_000)
    })

    describe('rtSaveCheckpoint', () => {
        /** A fresh world row at revision 0, holding a gzipped save of `world`. */
        async function seedWorld(ownerId: string, world: RtWorld) {
            return seedRow(ownerId, gzipSync(encodeWorld(world)))
        }

        async function readRow(id: string) {
            const [row] = await db.select().from(railTycoonWorlds).where(eq(railTycoonWorlds.id, id))
            return row!
        }

        /** Each stored chunk with its hash, its bytes and xmin, the transaction that last wrote it. */
        async function readChunks(id: string) {
            const result = await db.execute<{ chunk_id: number, hash: string, data: Buffer, xmin: string }>(sql`
                select chunk_id, hash, data, xmin::text as xmin from rail_tycoon_chunks where world_id = ${id} order by chunk_id`)
            return result.rows
        }

        /** Waits, up to 5 s, until at least `count` sessions are blocked on a lock touching the worlds table. */
        async function waitForLockWaiters(count: number) {
            const deadline = Date.now() + 5000
            while (Date.now() < deadline) {
                const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity
                    where datname = current_database() and wait_event_type = 'Lock' and query ilike '%rail_tycoon_worlds%'`)
                if (Number(result.rows[0]!.n) >= count) return
                await new Promise(resolve => setTimeout(resolve, 20))
            }
        }

        async function memberOf(worldId: string, userId: string) {
            const [row] = await db.select().from(railTycoonMembers)
                .where(and(eq(railTycoonMembers.worldId, worldId), eq(railTycoonMembers.userId, userId)))
            return row ?? null
        }

        it('checkpoints a world that loads back losslessly at the next revision', async () => {
            const owner = await newUser('save-owner')
            const world = newWorld(901)
            const row = await seedWorld(owner, world)
            for (let i = 0; i < 25; i++) world.step()
            const before = world.hash()
            const now = new Date(Date.now() + 1000)

            const revision = await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 0, now)
            expect(revision).toBe(1)

            const loaded = await rtLoadWorld(row.id)
            expect(loaded!.revision).toBe(1)
            expect(loaded!.world.hash()).toBe(before)
            expect(loaded!.world.tick).toBe(world.tick)
            const stored = await readRow(row.id)
            const chunks = await readChunks(row.id)
            const parts = encodeWorldParts(world)
            expect(stored).toMatchObject({ tick: world.tick, savedAt: now, lastActiveAt: now })
            expect(stored.bytes).toBe(stored.save.length + chunks.reduce((sum, chunk) => sum + chunk.data.length, 0))
            // the row holds the entity part, each chunk row its chunk under the chunk's hash
            expect(Buffer.from(gunzipSync(stored.save)).equals(Buffer.from(parts[0]!))).toBe(true)
            expect(chunks.map(chunk => chunk.chunk_id)).toEqual(Array.from({ length: rtChunkCount(64) }, (_, c) => c))
            for (const chunk of chunks) {
                expect(chunk.hash).toBe(rtPartHash(parts[chunk.chunk_id + 1]!))
                expect(Buffer.from(gunzipSync(chunk.data)).equals(Buffer.from(parts[chunk.chunk_id + 1]!))).toBe(true)
            }
        })

        it('rewrites only the chunks whose hash changed', async () => {
            const owner = await newUser('save-chunks')
            const world = newWorld(911)
            const row = await seedWorld(owner, world)
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 0, new Date())).toBe(1)
            const first = await readChunks(row.id)

            // the same world again: the row moves on, no chunk is touched
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 1, new Date())).toBe(2)
            expect(await readChunks(row.id)).toEqual(first)

            // a town renamed: the entity part in the row's save changes, no chunk is written
            world.towns[0]!.name = 'Renamed Town'
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 2, new Date())).toBe(3)
            expect(await readChunks(row.id)).toEqual(first)
            expect((await rtLoadWorld(row.id))!.world.towns[0]!.name).toBe('Renamed Town')

            // a tree planted: only the chunk it stands in is written
            let tile = 40 * 64 + 20
            while (world.map.kind[tile] !== RtTileKind.clear) tile++
            world.map.setTile(tile, RtTileKind.tree, RT_OWNER_NONE, 0)
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 3, new Date())).toBe(4)
            const after = await readChunks(row.id)
            const changed = after.filter((chunk, c) => chunk.xmin !== first[c]!.xmin).map(chunk => chunk.chunk_id)
            expect(changed).toEqual([rtChunkOfTile(64, tile)])
            expect((await rtLoadWorld(row.id))!.world.map.kind[tile]).toBe(RtTileKind.tree)
        })

        it('loads a whole-world save from before chunks, and its first checkpoint stores it as parts', async () => {
            const owner = await newUser('save-legacy')
            const world = newWorld(912)
            const row = await seedWorld(owner, world)
            expect(await readChunks(row.id)).toEqual([])
            const loaded = await rtLoadWorld(row.id)
            expect(loaded!.world.hash()).toBe(world.hash())

            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(loaded!.world), world.tick, 0, new Date())).toBe(1)
            expect(await readChunks(row.id)).toHaveLength(rtChunkCount(64))
            expect((await rtLoadWorld(row.id))!.world.hash()).toBe(world.hash())
        })

        it('drops a stray chunk past the last, and loads a world missing a chunk or holding a corrupt one as null', async () => {
            const owner = await newUser('save-stray')
            const world = newWorld(913)
            const row = await seedWorld(owner, world)
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 0, new Date())).toBe(1)
            const log = vi.spyOn(console, 'error').mockImplementation(() => {})

            // a chunk the map has no room for: the parts no longer fit together
            await db.insert(railTycoonChunks).values({ worldId: row.id, chunkId: 99, hash: '0'.repeat(16), data: gzipSync(Buffer.from([1])) })
            expect(await rtLoadWorld(row.id)).toBeNull()
            // the next checkpoint removes it
            expect(await rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, 1, new Date())).toBe(2)
            expect((await readChunks(row.id)).map(chunk => chunk.chunk_id)).toEqual(Array.from({ length: rtChunkCount(64) }, (_, c) => c))
            expect((await rtLoadWorld(row.id))!.world.hash()).toBe(world.hash())

            await db.update(railTycoonChunks).set({ data: gzipSync(Buffer.from('not a chunk')) })
                .where(and(eq(railTycoonChunks.worldId, row.id), eq(railTycoonChunks.chunkId, 5)))
            expect(await rtLoadWorld(row.id)).toBeNull()
            await db.delete(railTycoonChunks).where(and(eq(railTycoonChunks.worldId, row.id), eq(railTycoonChunks.chunkId, 5)))
            expect(await rtLoadWorld(row.id)).toBeNull()
            expect(log).toHaveBeenCalledTimes(3)
            for (const [line] of log.mock.calls) expect(String(line)).toContain(row.id)
        })

        it('lets exactly one of ten parallel checkpoints with the same revision win; the rest get 409', async () => {
            const owner = await newUser('save-race')
            const world = newWorld(902)
            const row = await seedWorld(owner, world)
            const bytes = encodeWorldParts(world)

            // Hold the row lock until all ten are queued on it, so every one reads before any
            // writes and the race is forced rather than left to scheduling.
            let held!: () => void
            let release!: () => void
            const lockHeld = new Promise<void>(resolve => { held = resolve })
            const released = new Promise<void>(resolve => { release = resolve })
            const holder = db.transaction(async (tx) => {
                await tx.select({ id: railTycoonWorlds.id }).from(railTycoonWorlds).where(eq(railTycoonWorlds.id, row.id)).for('update')
                held()
                await released
            })
            await lockHeld
            const saves = Array.from({ length: 10 }, (_, i) => rtSaveCheckpoint(row.id, bytes, 100 + i, 0, new Date()))
            await waitForLockWaiters(10)
            release()
            await holder

            const results = await Promise.allSettled(saves)
            const won = results.flatMap((r, i) => (r.status === 'fulfilled' ? [{ i, revision: r.value }] : []))
            const lost = results.filter(r => r.status === 'rejected')
            expect(won).toHaveLength(1)
            expect(won[0]!.revision).toBe(1)
            expect(lost).toHaveLength(9)
            for (const r of lost) expect((r as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 })

            const stored = await readRow(row.id)
            expect(stored.revision).toBe(1)
            expect(stored.tick).toBe(100 + won[0]!.i)
        })

        it('refuses a stale revision with 409 and a missing world with 404, writing nothing', async () => {
            const owner = await newUser('save-stale')
            const world = newWorld(903)
            const row = await seedWorld(owner, world)
            const bytes = encodeWorldParts(world)
            expect(await rtSaveCheckpoint(row.id, bytes, 1, 0, new Date())).toBe(1)

            await expect(rtSaveCheckpoint(row.id, bytes, 2, 0, new Date())).rejects.toMatchObject({ statusCode: 409 })
            await expect(rtSaveCheckpoint(row.id, bytes, 2, 5, new Date())).rejects.toMatchObject({ statusCode: 409 })
            await expect(rtSaveCheckpoint(`${RUN}-missing`, bytes, 2, 0, new Date())).rejects.toMatchObject({ statusCode: 404 })
            expect(await readRow(row.id)).toMatchObject({ revision: 1, tick: 1 })
        })

        it('refuses parts that compress past the cap together with 413, leaving the stored save', async () => {
            const owner = await newUser('save-big')
            const world = newWorld(904)
            const row = await seedWorld(owner, world)
            // random chunks do not compress: each is under the cap, all of them together over it
            const each = Math.ceil(RT_MAX_SAVE_BYTES / rtChunkCount(64)) + 1024
            const parts = encodeWorldParts(world).map((part, k) => (k === 0 ? part : new Uint8Array(randomBytes(each))))

            await expect(rtSaveCheckpoint(row.id, parts, 1, 0, new Date())).rejects.toMatchObject({ statusCode: 413 })
            // parts the caller compressed already are held to the same cap
            const zipped = await rtGzipParts(parts)
            await expect(rtSaveCheckpoint(row.id, encodeWorldParts(world), 1, 0, new Date(), { stored: zipped })).rejects.toMatchObject({ statusCode: 413 })
            const stored = await readRow(row.id)
            expect(stored.revision).toBe(0)
            expect(stored.save.equals(row.save)).toBe(true)
            expect(await readChunks(row.id)).toEqual([])
        }, 20_000)

        it('completes inside a transaction that already holds the world row FOR UPDATE (options.tx)', async () => {
            const owner = await newUser('save-tx')
            const world = newWorld(905)
            const row = await seedWorld(owner, world)
            world.step()

            const revision = await db.transaction(async (tx) => {
                const [locked] = await tx.select({ revision: railTycoonWorlds.revision })
                    .from(railTycoonWorlds)
                    .where(eq(railTycoonWorlds.id, row.id))
                    .for('update')
                return rtSaveCheckpoint(row.id, encodeWorldParts(world), world.tick, locked!.revision, new Date(), { tx })
            })

            expect(revision).toBe(1)
            expect((await rtLoadWorld(row.id))!.world.hash()).toBe(world.hash())
        }, 5_000)

        it('writes options.member in the same transaction as the save', async () => {
            const owner = await newUser('save-member-owner')
            const joiner = await newUser('save-member-joiner')
            const row = await seedWorld(owner, newWorld(906))
            const bytes = encodeWorldParts(newWorld(906))

            expect(await rtSaveCheckpoint(row.id, bytes, 1, 0, new Date(), { member: { userId: joiner, companyId: 2 } })).toBe(1)
            expect(await memberOf(row.id, joiner)).toMatchObject({ worldId: row.id, userId: joiner, companyId: 2 })

            // inside a caller's transaction that then fails, the save and the member row go together
            const other = await newUser('save-member-rollback')
            await expect(db.transaction(async (tx) => {
                await rtSaveCheckpoint(row.id, bytes, 2, 1, new Date(), { tx, member: { userId: other, companyId: 3 } })
                throw new Error('caller gave up')
            })).rejects.toThrow('caller gave up')
            expect(await memberOf(row.id, other)).toBeNull()
            expect(await readRow(row.id)).toMatchObject({ revision: 1, tick: 1 })
        })

        it('rolls the save back when the member insert violates the (worldId, userId) key', async () => {
            const owner = await newUser('save-dup-owner')
            const joiner = await newUser('save-dup-joiner')
            const row = await seedWorld(owner, newWorld(907))
            await db.insert(railTycoonMembers).values({ worldId: row.id, userId: joiner, companyId: 1 })
            const changed = newWorld(907)
            changed.step()

            await expect(rtSaveCheckpoint(row.id, encodeWorldParts(changed), changed.tick, 0, new Date(), { member: { userId: joiner, companyId: 2 } }))
                .rejects.toThrow()

            // the row and the chunks roll back together
            const stored = await readRow(row.id)
            expect(stored.revision).toBe(0)
            expect(stored.bytes).toBe(row.bytes)
            expect(stored.save.equals(row.save)).toBe(true)
            expect(await readChunks(row.id)).toEqual([])
            expect(await memberOf(row.id, joiner)).toMatchObject({ companyId: 1 })
        })
    })
})
