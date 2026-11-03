/**
 * The Rail Tycoon world registry against the real tables: who sees which
 * world, who may open it as what, creating and joining worlds, and the
 * owner-only stop and delete, including bursts of parallel creates, joins,
 * closes and deletes.
 *
 * Needs a local Postgres with the migrations applied. Skips when DATABASE_URL is unset.
 * Worlds the listing, access, cap and owner-control cases need are seeded straight into the
 * table (with an empty save); the create and join cases use real generated worlds.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '#server/database'
import { railTycoonChunks, railTycoonMembers, railTycoonWorlds } from '#server/database/schema'
import {
    rtCloseWorld,
    rtCreateWorld,
    rtDeleteWorld,
    rtGetAccess,
    rtJoinWorld,
    rtListPublicWorlds,
    rtListWorldsForUser,
    rtSetWorldLook,
    rtWorldAvatars,
    type RtCreateOptions,
    type RtCreatedWorld
} from '#server/utils/rail-tycoon/registry'
import { rtLoadWorld } from '#server/utils/rail-tycoon/store'
import {
    isRtInviteCode,
    RT_INVITE_CODE_ALPHABET,
    RT_INVITE_CODE_LENGTH,
    RT_MAX_OPEN_WORLDS,
    RT_MAX_WORLDS_PER_OWNER
} from '#shared/utils/rail-tycoon/limits'
import { randomInt } from '#shared/utils/random'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const RUN = `rt-reg-${Date.now().toString(36)}-${randomInt(0, 1e9).toString(36)}`
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

interface WorldSeed {
    status?: 'open' | 'closed'
    members?: [userId: string, companyId: number][]
    lastActiveAt?: Date
    maxCompanies?: number
    isPublic?: boolean
    avatar?: string | null
}

/** A world row as rtCreateWorld would leave it, with the owner as company 0 unless members says otherwise. */
async function seedWorld(ownerId: string, seed: WorldSeed = {}) {
    const id = `${RUN}-w${worldSeq++}`
    const now = new Date()
    const [world] = await db.insert(railTycoonWorlds).values({
        id,
        ownerId,
        name: `World ${worldSeq}`,
        status: seed.status ?? 'open',
        inviteCode: newInviteCode(),
        side: 64,
        maxCompanies: seed.maxCompanies ?? 4,
        isPublic: seed.isPublic ?? false,
        avatar: seed.avatar ?? null,
        save: Buffer.alloc(0),
        savedAt: now,
        lastActiveAt: seed.lastActiveAt ?? now
    }).returning()
    const members = seed.members ?? [[ownerId, 0]]
    if (members.length) {
        await db.insert(railTycoonMembers).values(members.map(([userId, companyId]) => ({ worldId: id, userId, companyId })))
    }
    return world!
}

afterAll(async () => {
    if (SKIP) return
    // worlds go with their owner and members with their user, through the foreign keys
    for (const id of users) await cleanupUser(id)
})

const SMALL: RtCreateOptions = { side: 64, maxCompanies: 4 }

async function worldRow(id: string) {
    const [row] = await db.select().from(railTycoonWorlds).where(eq(railTycoonWorlds.id, id))
    return row
}

async function membersOf(worldId: string) {
    return db.select({ userId: railTycoonMembers.userId, companyId: railTycoonMembers.companyId })
        .from(railTycoonMembers)
        .where(eq(railTycoonMembers.worldId, worldId))
        .orderBy(railTycoonMembers.companyId)
}

async function ownedCounts(ownerId: string) {
    const rows = await db.select({ status: railTycoonWorlds.status }).from(railTycoonWorlds).where(eq(railTycoonWorlds.ownerId, ownerId))
    return { open: rows.filter(r => r.status === 'open').length, total: rows.length }
}

/**
 * Runs a burst of creates that truly overlap. World generation is synchronous, so creates fired
 * together would otherwise reach their transactions one by one and pass without any guard. A
 * SHARE lock on the worlds table lets reads through but queues inserts; it is released once
 * `count` backends wait on it or on an advisory lock (or after 3 s), so every create has counted
 * before any of them inserts, unless the guard makes them wait their turn.
 */
async function lineUp<T>(count: number, start: () => Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
    let burst!: Promise<PromiseSettledResult<T>[]>
    await db.transaction(async (tx) => {
        await tx.execute(sql`lock table rail_tycoon_worlds in share mode`)
        burst = Promise.allSettled(start())
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
            const { rows } = await db.execute<{ waiting: number }>(sql`select count(*)::int as waiting from pg_locks
                where not granted
                and ((locktype = 'relation' and relation = 'rail_tycoon_worlds'::regclass) or locktype = 'advisory')`)
            if (rows[0]!.waiting >= count) break
            await new Promise(resolve => setTimeout(resolve, 10))
        }
    })
    return burst
}

function statusCodes(results: PromiseSettledResult<unknown>[]) {
    return results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => (r.reason as { statusCode?: number }).statusCode ?? r.reason)
}

describe.skipIf(SKIP)('rail tycoon world registry', () => {
    describe('rtListWorldsForUser', () => {
        it('shows a world to its owner and its members, with the invite code, and not to others', async () => {
            const owner = await newUser('list-owner')
            const member = await newUser('list-member')
            const stranger = await newUser('list-stranger')
            const world = await seedWorld(owner, { members: [[owner, 0], [member, 1]], maxCompanies: 6 })

            const [mine] = await rtListWorldsForUser(owner)
            expect(mine).toEqual({
                id: world.id,
                name: world.name,
                status: 'open',
                ownerId: owner,
                isOwner: true,
                memberCount: 2,
                maxCompanies: 6,
                myCompanyId: 0,
                lastActiveAt: world.lastActiveAt,
                inviteCode: world.inviteCode,
                isPublic: false
            })

            const [joined] = await rtListWorldsForUser(member)
            expect(joined).toMatchObject({ id: world.id, isOwner: false, myCompanyId: 1, memberCount: 2, inviteCode: world.inviteCode })

            expect(await rtListWorldsForUser(stranger)).toEqual([])
        })

        it('lists closed worlds and owned worlds without a company too, newest activity first', async () => {
            const owner = await newUser('list-order')
            const other = await newUser('list-order-other')
            const t = Date.now()
            const old = await seedWorld(owner, { lastActiveAt: new Date(t - 60_000) })
            const closed = await seedWorld(owner, { status: 'closed', lastActiveAt: new Date(t - 30_000) })
            const joined = await seedWorld(other, { members: [[other, 0], [owner, 2]], lastActiveAt: new Date(t - 10_000) })
            const bare = await seedWorld(owner, { members: [], lastActiveAt: new Date(t - 90_000) })

            const list = await rtListWorldsForUser(owner)
            expect(list.map(w => w.id)).toEqual([joined.id, closed.id, old.id, bare.id])
            expect(list[1]!.status).toBe('closed')
            expect(list[3]).toMatchObject({ isOwner: true, myCompanyId: null, memberCount: 0 })
        })

        it('returns at most 50 worlds', async () => {
            const owner = await newUser('list-cap')
            const now = Date.now()
            const rows = Array.from({ length: 51 }, (_, i) => ({
                id: `${RUN}-cap-${i}`,
                ownerId: owner,
                name: `Cap ${i}`,
                inviteCode: newInviteCode(),
                save: Buffer.alloc(0),
                savedAt: new Date(now),
                lastActiveAt: new Date(now - i * 1000)
            }))
            await db.insert(railTycoonWorlds).values(rows)

            const list = await rtListWorldsForUser(owner)
            expect(list).toHaveLength(50)
            expect(list.map(w => w.id)).not.toContain(`${RUN}-cap-50`)
        })
    })

    describe('the public lobby and the owner\'s world look', () => {
        const AVATAR = '{"background":"#123456","elements":[]}'

        it('lists an open public world to a stranger with its owner, invite code and drawing, and nothing else', async () => {
            const owner = await newUser('lobby-owner')
            const member = await newUser('lobby-member')
            const stranger = await newUser('lobby-stranger')
            const listed = await seedWorld(owner, { isPublic: true, avatar: AVATAR, members: [[owner, 0], [member, 1]] })
            await seedWorld(owner, { isPublic: false })
            await seedWorld(owner, { isPublic: true, status: 'closed' })

            const lobby = (await rtListPublicWorlds(stranger)).filter(w => w.id.startsWith(RUN))
            expect(lobby).toEqual([{
                id: listed.id,
                name: listed.name,
                ownerName: 'concurrency test user',
                memberCount: 2,
                maxCompanies: 4,
                lastActiveAt: listed.lastActiveAt,
                inviteCode: listed.inviteCode,
                avatar: AVATAR
            }])
            // the owner and a member find it in their own list, not the lobby
            expect((await rtListPublicWorlds(owner)).map(w => w.id)).not.toContain(listed.id)
            expect((await rtListPublicWorlds(member)).map(w => w.id)).not.toContain(listed.id)
            expect((await rtListWorldsForUser(member)).find(w => w.id === listed.id)).toMatchObject({ isPublic: true })
        })

        it('gives the drawings of the worlds the user owns or joined, and no one else\'s', async () => {
            const owner = await newUser('avatars-owner')
            const member = await newUser('avatars-member')
            const stranger = await newUser('avatars-stranger')
            const drawn = await seedWorld(owner, { avatar: AVATAR, members: [[owner, 0], [member, 1]] })
            await seedWorld(owner, { avatar: null })
            await seedWorld(stranger, { avatar: AVATAR, isPublic: true, members: [[stranger, 0]] })

            expect(await rtWorldAvatars(owner)).toEqual({ [drawn.id]: AVATAR })
            expect(await rtWorldAvatars(member)).toEqual({ [drawn.id]: AVATAR })
            expect(Object.keys(await rtWorldAvatars(stranger))).not.toContain(drawn.id)
        })

        it('lets the owner set the lobby setting and the drawing, and refuses everyone else', async () => {
            const owner = await newUser('look-owner')
            const member = await newUser('look-member')
            const world = await seedWorld(owner, { members: [[owner, 0], [member, 1]] })

            expect(await rtSetWorldLook(owner, world.id, { isPublic: true })).toEqual({ isPublic: true, avatar: null })
            expect(await rtSetWorldLook(owner, world.id, { avatar: AVATAR })).toEqual({ isPublic: true, avatar: AVATAR })
            expect(await rtSetWorldLook(owner, world.id, { avatar: null, isPublic: false })).toEqual({ isPublic: false, avatar: null })

            const refused = await Promise.allSettled([
                rtSetWorldLook(member, world.id, { isPublic: true }),
                rtSetWorldLook(owner, `${RUN}-missing`, { isPublic: true }),
                rtSetWorldLook(owner, world.id, {})
            ])
            expect(statusCodes(refused)).toEqual([403, 404, 400])
            expect(await worldRow(world.id)).toMatchObject({ isPublic: false, avatar: null })
        })

        it('creates a public world when asked, private by default, and refuses a public that is not a boolean', async () => {
            const owner = await newUser('create-public')
            const open = await rtCreateWorld(owner, 'Ada', 'Open House', { ...SMALL, isPublic: true })
            const closed = await rtCreateWorld(owner, 'Ada', 'Members Only', SMALL)
            expect(await worldRow(open.worldId)).toMatchObject({ isPublic: true })
            expect(await worldRow(closed.worldId)).toMatchObject({ isPublic: false })

            const refused = await Promise.allSettled([rtCreateWorld(owner, 'Ada', 'Odd', { ...SMALL, isPublic: 'yes' as unknown as boolean })])
            expect(statusCodes(refused)).toEqual([400])
            expect(await ownedCounts(owner)).toEqual({ open: 2, total: 2 })
        })
    })

    describe('rtCreateWorld', () => {
        it('creates an open world with its owner as company 0 and returns its id and invite code', async () => {
            const owner = await newUser('create-owner')
            const created = await rtCreateWorld(owner, 'Ada Rail', '  Iron Valley  ', SMALL)

            expect(isRtInviteCode(created.inviteCode)).toBe(true)
            expect(created.inviteCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
            expect(Buffer.byteLength(created.worldId)).toBeLessThanOrEqual(32)

            const row = await worldRow(created.worldId)
            expect(row).toMatchObject({
                ownerId: owner,
                name: 'Iron Valley',
                status: 'open',
                inviteCode: created.inviteCode,
                side: 64,
                maxCompanies: 4,
                revision: 0,
                tick: 0
            })
            // the row holds the entity part, one chunk row per 16x16 chunk holds the rest
            const chunks = await db.select().from(railTycoonChunks).where(eq(railTycoonChunks.worldId, created.worldId)).orderBy(railTycoonChunks.chunkId)
            expect(chunks.map(chunk => chunk.chunkId)).toEqual(Array.from({ length: 16 }, (_, i) => i))
            expect(row!.bytes).toBe(row!.save.length + chunks.reduce((sum, chunk) => sum + chunk.data.length, 0))
            expect(await membersOf(created.worldId)).toEqual([{ userId: owner, companyId: 0 }])

            const loaded = await rtLoadWorld(created.worldId)
            expect(loaded!.world.settings).toEqual({ side: 64, maxCompanies: 4, sharing: true })
            expect(loaded!.world.companyList().map(c => [c.id, c.name])).toEqual([[0, 'Ada Rail']])
        })

        it('stores sharing off in the world settings when asked', async () => {
            const owner = await newUser('create-sharing')
            const { worldId } = await rtCreateWorld(owner, 'Ada', 'No Sharing', { side: 64, maxCompanies: 2, sharing: false })
            expect((await rtLoadWorld(worldId))!.world.settings).toEqual({ side: 64, maxCompanies: 2, sharing: false })
        })

        it('refuses a name the wire would not carry with 400 and creates nothing', async () => {
            const owner = await newUser('create-names')
            const bad: unknown[] = [
                '',
                '   ',
                'é'.repeat(17),
                '🚂'.repeat(9),
                'bell\u0007',
                'next\u0085line',
                'half\uD800',
                `${' '.repeat(300)}ok`,
                42,
                null
            ]
            for (const name of bad) {
                await expect(rtCreateWorld(owner, 'Ada', name as string, SMALL), JSON.stringify(name)).rejects.toMatchObject({ statusCode: 400 })
            }
            expect(await ownedCounts(owner)).toEqual({ open: 0, total: 0 })

            // 32 bytes exactly is fine, in two- and four-byte characters
            const { worldId } = await rtCreateWorld(owner, 'Ada', 'é'.repeat(16), SMALL)
            expect((await worldRow(worldId))!.name).toBe('é'.repeat(16))
            await rtCreateWorld(owner, 'Ada', '🚂'.repeat(8), SMALL)
        })

        it('refuses options out of range with 400 and creates nothing', async () => {
            const owner = await newUser('create-options')
            const bad: unknown[] = [
                { side: 100, maxCompanies: 4 },
                { side: '64', maxCompanies: 4 },
                { side: 512, maxCompanies: 4 },
                { side: 64, maxCompanies: 1 },
                { side: 64, maxCompanies: 9 },
                { side: 64, maxCompanies: 2.5 },
                { side: 64, maxCompanies: '4' },
                { side: 64, maxCompanies: 4, sharing: 'yes' },
                { side: 64, maxCompanies: 4, sharing: 1 },
                null,
                undefined,
                'small'
            ]
            for (const options of bad) {
                await expect(rtCreateWorld(owner, 'Ada', 'Bad Options', options as RtCreateOptions), JSON.stringify(options)).rejects.toMatchObject({ statusCode: 400 })
            }
            expect(await ownedCounts(owner)).toEqual({ open: 0, total: 0 })
        })

        it(`refuses a sixth open world with 409, and closed worlds do not count toward the ${RT_MAX_OPEN_WORLDS}`, async () => {
            const owner = await newUser('create-open-cap')
            for (let i = 0; i < RT_MAX_OPEN_WORLDS - 1; i++) await seedWorld(owner)
            for (let i = 0; i < 3; i++) await seedWorld(owner, { status: 'closed' })

            await rtCreateWorld(owner, 'Ada', 'Last Open', SMALL)
            await expect(rtCreateWorld(owner, 'Ada', 'One Too Many', SMALL)).rejects.toMatchObject({ statusCode: 409 })
            expect(await ownedCounts(owner)).toEqual({ open: RT_MAX_OPEN_WORLDS, total: RT_MAX_OPEN_WORLDS + 3 })
        })

        it(`refuses a world past ${RT_MAX_WORLDS_PER_OWNER} in total with 409, even with none open`, async () => {
            const owner = await newUser('create-total-cap')
            for (let i = 0; i < RT_MAX_WORLDS_PER_OWNER; i++) await seedWorld(owner, { status: 'closed' })
            await expect(rtCreateWorld(owner, 'Ada', 'Twenty One', SMALL)).rejects.toMatchObject({ statusCode: 409 })
            expect(await ownedCounts(owner)).toEqual({ open: 0, total: RT_MAX_WORLDS_PER_OWNER })
        })

        it('lets exactly one of ten parallel creates take the last open slot', async () => {
            const owner = await newUser('create-burst')
            for (let i = 0; i < RT_MAX_OPEN_WORLDS - 1; i++) await seedWorld(owner)

            const results = await lineUp(10, () => Array.from({ length: 10 }, (_, i) => rtCreateWorld(owner, 'Ada', `Burst ${i}`, SMALL)))
            const done = results.filter((r): r is PromiseFulfilledResult<RtCreatedWorld> => r.status === 'fulfilled')
            expect(done).toHaveLength(1)
            expect(statusCodes(results)).toEqual(Array(9).fill(409))
            expect(await ownedCounts(owner)).toEqual({ open: RT_MAX_OPEN_WORLDS, total: RT_MAX_OPEN_WORLDS })
            expect(await membersOf(done[0]!.value.worldId)).toEqual([{ userId: owner, companyId: 0 }])
        })

        it('lets exactly one of ten parallel creates take the last of the owner\'s worlds', async () => {
            const owner = await newUser('create-burst-total')
            for (let i = 0; i < RT_MAX_WORLDS_PER_OWNER - 1; i++) await seedWorld(owner, { status: 'closed' })

            const results = await lineUp(10, () => Array.from({ length: 10 }, (_, i) => rtCreateWorld(owner, 'Ada', `Burst ${i}`, SMALL)))
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
            expect(statusCodes(results)).toEqual(Array(9).fill(409))
            expect(await ownedCounts(owner)).toEqual({ open: 1, total: RT_MAX_WORLDS_PER_OWNER })
        })
    })

    describe('rtJoinWorld', () => {
        it('joins as a new company named after the player, writing the save and the member together', async () => {
            const owner = await newUser('join-owner')
            const joiner = await newUser('join-joiner')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Joinable', SMALL)

            expect(await rtJoinWorld(joiner, 'Bob Freight', inviteCode)).toEqual({ worldId, companyId: 1, joined: true })
            expect(await membersOf(worldId)).toEqual([{ userId: owner, companyId: 0 }, { userId: joiner, companyId: 1 }])
            const loaded = await rtLoadWorld(worldId)
            expect(loaded!.revision).toBe(1)
            expect(loaded!.world.companyList().map(c => [c.id, c.name])).toEqual([[0, 'Ada'], [1, 'Bob Freight']])
        })

        it('gives an existing member their membership back unchanged', async () => {
            const owner = await newUser('join-again-owner')
            const joiner = await newUser('join-again')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Again', SMALL)

            expect(await rtJoinWorld(owner, 'Ada', inviteCode)).toEqual({ worldId, companyId: 0, joined: false })
            await rtJoinWorld(joiner, 'Bob', inviteCode)
            expect(await rtJoinWorld(joiner, 'Someone Else', inviteCode)).toEqual({ worldId, companyId: 1, joined: false })

            expect((await worldRow(worldId))!.revision).toBe(1)
            expect((await rtLoadWorld(worldId))!.world.companyList().map(c => c.name)).toEqual(['Ada', 'Bob'])
        })

        it('refuses a closed world with 409, but its members keep their membership', async () => {
            const owner = await newUser('join-closed-owner')
            const member = await newUser('join-closed-member')
            const late = await newUser('join-closed-late')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Closing', SMALL)
            await rtJoinWorld(member, 'Bob', inviteCode)
            await rtCloseWorld(owner, worldId)

            await expect(rtJoinWorld(late, 'Cy', inviteCode)).rejects.toMatchObject({ statusCode: 409 })
            expect(await rtJoinWorld(member, 'Bob', inviteCode)).toEqual({ worldId, companyId: 1, joined: false })
            expect(await membersOf(worldId)).toHaveLength(2)
            expect((await worldRow(worldId))!.revision).toBe(1)
        })

        it('refuses a full world with 409 and changes nothing', async () => {
            const owner = await newUser('join-full-owner')
            const second = await newUser('join-full-second')
            const third = await newUser('join-full-third')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Two Seats', { side: 64, maxCompanies: 2 })
            await rtJoinWorld(second, 'Bob', inviteCode)

            await expect(rtJoinWorld(third, 'Cy', inviteCode)).rejects.toMatchObject({ statusCode: 409 })
            expect(await membersOf(worldId)).toHaveLength(2)
            expect((await rtLoadWorld(worldId))!.world.companyList()).toHaveLength(2)
        })

        it('answers 404 for a code no world has and 400 for anything not shaped like a code', async () => {
            const owner = await newUser('join-codes-owner')
            const joiner = await newUser('join-codes')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Codes', SMALL)

            let unknown = newInviteCode()
            while (unknown === inviteCode) unknown = newInviteCode()
            await expect(rtJoinWorld(joiner, 'Bob', unknown)).rejects.toMatchObject({ statusCode: 404 })
            for (const code of [inviteCode.toLowerCase(), inviteCode.slice(1), `${inviteCode}0`, '', `${inviteCode.slice(1)}I`, 42, null]) {
                await expect(rtJoinWorld(joiner, 'Bob', code as string), JSON.stringify(code)).rejects.toMatchObject({ statusCode: 400 })
            }
            expect(await membersOf(worldId)).toHaveLength(1)
        })

        it('lets exactly three of ten parallel joins into three free slots, each member on its own company', async () => {
            const owner = await newUser('join-burst-owner')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Owner', 'Rush Hour', SMALL)
            const joiners = await Promise.all(Array.from({ length: 10 }, (_, i) => newUser(`join-burst-${i}`)))

            const results = await Promise.allSettled(joiners.map((userId, i) => rtJoinWorld(userId, `Player ${i}`, inviteCode)))
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3)
            expect(statusCodes(results)).toEqual(Array(7).fill(409))

            const members = await membersOf(worldId)
            expect(members.map(m => m.companyId)).toEqual([0, 1, 2, 3])
            const loaded = await rtLoadWorld(worldId)
            expect(loaded!.revision).toBe(3)
            const companies = loaded!.world.companyList()
            expect(companies.map(c => c.id)).toEqual([0, 1, 2, 3])
            // each member row points at the company created for that very player
            for (const member of members) {
                const name = member.userId === owner ? 'Owner' : `Player ${joiners.indexOf(member.userId)}`
                expect(loaded!.world.company(member.companyId)!.name).toBe(name)
            }
        })

        it('gives one player one company however many joins they send at once', async () => {
            const owner = await newUser('join-dup-owner')
            const joiner = await newUser('join-dup')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Duplicates', SMALL)

            const results = await Promise.all(Array.from({ length: 10 }, () => rtJoinWorld(joiner, 'Bob', inviteCode)))
            expect(results.filter(r => r.joined)).toHaveLength(1)
            expect(new Set(results.map(r => r.companyId))).toEqual(new Set([1]))
            expect(await membersOf(worldId)).toEqual([{ userId: owner, companyId: 0 }, { userId: joiner, companyId: 1 }])
            const loaded = await rtLoadWorld(worldId)
            expect(loaded!.revision).toBe(1)
            expect(loaded!.world.companyList()).toHaveLength(2)
        })
    })

    describe('invite codes', () => {
        it('lists the created world\'s code to its owner and a joined member, and that code joins a third player', async () => {
            const owner = await newUser('code-owner')
            const member = await newUser('code-member')
            const third = await newUser('code-third')
            const { worldId, inviteCode } = await rtCreateWorld(owner, 'Ada', 'Shared Code', SMALL)

            expect((await rtListWorldsForUser(owner)).find(w => w.id === worldId)).toMatchObject({ inviteCode, isOwner: true, myCompanyId: 0 })
            await rtJoinWorld(member, 'Bob', inviteCode)
            const [listed] = await rtListWorldsForUser(member)
            expect(listed).toMatchObject({ id: worldId, inviteCode, isOwner: false, myCompanyId: 1, memberCount: 2 })

            expect(await rtJoinWorld(third, 'Cy', listed!.inviteCode)).toEqual({ worldId, companyId: 2, joined: true })
            const [mine] = await db.select().from(railTycoonMembers)
                .where(and(eq(railTycoonMembers.worldId, worldId), eq(railTycoonMembers.userId, third)))
            expect(mine!.companyId).toBe(2)
        })
    })

    describe('rtCloseWorld', () => {
        it('closes an open world for its owner, then refuses a second close with 409', async () => {
            const owner = await newUser('close-owner')
            const world = await seedWorld(owner)

            const closed = await rtCloseWorld(owner, world.id)
            expect(closed).toMatchObject({ id: world.id, status: 'closed', ownerId: owner })
            expect(closed).not.toHaveProperty('save')

            await expect(rtCloseWorld(owner, world.id)).rejects.toMatchObject({ statusCode: 409 })
        })

        it('refuses a non-owner with 403 and leaves the world open, even a member', async () => {
            const owner = await newUser('close-o2')
            const member = await newUser('close-member')
            const world = await seedWorld(owner, { members: [[owner, 0], [member, 1]] })

            await expect(rtCloseWorld(member, world.id)).rejects.toMatchObject({ statusCode: 403 })
            const [row] = await db.select({ status: railTycoonWorlds.status }).from(railTycoonWorlds).where(eq(railTycoonWorlds.id, world.id))
            expect(row!.status).toBe('open')
        })

        it('answers 404 for a world that does not exist', async () => {
            const owner = await newUser('close-missing')
            await expect(rtCloseWorld(owner, `${RUN}-nope`)).rejects.toMatchObject({ statusCode: 404 })
        })

        it('lets exactly one of ten parallel closes through', async () => {
            const owner = await newUser('close-burst')
            const world = await seedWorld(owner)

            const results = await Promise.allSettled(Array.from({ length: 10 }, () => rtCloseWorld(owner, world.id)))
            const done = results.filter(r => r.status === 'fulfilled')
            const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            expect(done).toHaveLength(1)
            expect(refused.map(r => (r.reason as { statusCode: number }).statusCode)).toEqual(Array(9).fill(409))
        })
    })

    describe('rtDeleteWorld', () => {
        it('refuses a non-owner with 403 and deletes nothing', async () => {
            const owner = await newUser('del-owner')
            const member = await newUser('del-member')
            const world = await seedWorld(owner, { members: [[owner, 0], [member, 1]] })

            await expect(rtDeleteWorld(member, world.id)).rejects.toMatchObject({ statusCode: 403 })
            expect(await db.select().from(railTycoonWorlds).where(eq(railTycoonWorlds.id, world.id))).toHaveLength(1)
            expect(await db.select().from(railTycoonMembers).where(eq(railTycoonMembers.worldId, world.id))).toHaveLength(2)
        })

        it('deletes the owner\'s world with its members, then answers 404', async () => {
            const owner = await newUser('del-o2')
            const member = await newUser('del-m2')
            const world = await seedWorld(owner, { status: 'closed', members: [[owner, 0], [member, 1]] })

            const deleted = await rtDeleteWorld(owner, world.id)
            expect(deleted).toMatchObject({ id: world.id, ownerId: owner })
            expect(await db.select().from(railTycoonWorlds).where(eq(railTycoonWorlds.id, world.id))).toHaveLength(0)
            expect(await db.select().from(railTycoonMembers).where(inArray(railTycoonMembers.userId, [owner, member]))).toHaveLength(0)

            await expect(rtDeleteWorld(owner, world.id)).rejects.toMatchObject({ statusCode: 404 })
            expect(await rtListWorldsForUser(member)).toEqual([])
        })

        it('lets exactly one of ten parallel deletes through', async () => {
            const owner = await newUser('del-burst')
            const world = await seedWorld(owner)

            const results = await Promise.allSettled(Array.from({ length: 10 }, () => rtDeleteWorld(owner, world.id)))
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
        })
    })

    describe('rtGetAccess', () => {
        it('makes a member of an open world a player with their company', async () => {
            const owner = await newUser('acc-owner')
            const member = await newUser('acc-member')
            const world = await seedWorld(owner, { members: [[owner, 0], [member, 3]] })

            expect(await rtGetAccess(member, world.id)).toEqual({ role: 'player', status: 'open', companyId: 3 })
            expect(await rtGetAccess(owner, world.id)).toEqual({ role: 'player', status: 'open', companyId: 0 })
        })

        it('makes the owner and the members of a closed world spectators', async () => {
            const owner = await newUser('acc-o2')
            const member = await newUser('acc-m2')
            const world = await seedWorld(owner, { status: 'closed', members: [[owner, 0], [member, 1]] })

            expect(await rtGetAccess(member, world.id)).toEqual({ role: 'spectator', status: 'closed', companyId: null })
            expect(await rtGetAccess(owner, world.id)).toEqual({ role: 'spectator', status: 'closed', companyId: null })
        })

        it('makes an owner without a company a spectator', async () => {
            const owner = await newUser('acc-o3')
            const world = await seedWorld(owner, { members: [] })
            expect(await rtGetAccess(owner, world.id)).toEqual({ role: 'spectator', status: 'open', companyId: null })
        })

        it('makes a stranger with the invite code a spectator and one without it nothing', async () => {
            const owner = await newUser('acc-o4')
            const stranger = await newUser('acc-stranger')
            const world = await seedWorld(owner)
            const closed = await seedWorld(owner, { status: 'closed' })

            expect(await rtGetAccess(stranger, world.id, world.inviteCode)).toEqual({ role: 'spectator', status: 'open', companyId: null })
            expect(await rtGetAccess(stranger, closed.id, closed.inviteCode)).toEqual({ role: 'spectator', status: 'closed', companyId: null })
            const none = { role: 'none', status: null, companyId: null }
            expect(await rtGetAccess(stranger, world.id)).toEqual(none)
            expect(await rtGetAccess(stranger, world.id, closed.inviteCode)).toEqual(none)
            expect(await rtGetAccess(stranger, world.id, world.inviteCode.toLowerCase())).toEqual(none)
            expect(await rtGetAccess(stranger, world.id, '')).toEqual(none)
        })

        it('gives nothing for a world that does not exist, even with a code', async () => {
            const stranger = await newUser('acc-s2')
            expect(await rtGetAccess(stranger, `${RUN}-nope`, newInviteCode())).toEqual({ role: 'none', status: null, companyId: null })
        })
    })
})
