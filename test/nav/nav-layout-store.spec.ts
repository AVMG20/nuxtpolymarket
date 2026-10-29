/**
 * The sidebar layout's revision compare-and-swap against the real Postgres
 * from .env. Skips unless DATABASE_URL points at a local database.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '#server/database'
import { userNavLayout } from '#server/database/schema'
import { readNavLayout, saveNavLayout } from '#server/utils/nav-layout'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import { defaultNavLayout, removeNavLink, type NavLayout } from '#shared/utils/nav-layout'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USER = 'test-nav-layout-store'
const layout = defaultNavLayout(NAV_CATALOG)

async function results<T>(n: number, fn: (i: number) => Promise<T>) {
    return Promise.all(Array.from({ length: n }, (_, i) => fn(i)))
}

describe.skipIf(SKIP)('nav layout store', () => {
    beforeEach(async () => {
        await cleanupUser(USER)
        await seedUser(USER)
    })

    afterAll(async () => {
        await cleanupUser(USER)
    })

    it('lets exactly one of a burst of saves from the same revision land', async () => {
        await saveNavLayout(USER, layout, 0)
        const revisions = await results(10, i => saveNavLayout(USER, removeNavLink(layout, `/games/${i}`), 1))
        expect(revisions.filter(r => r === 2)).toHaveLength(1)
        expect((await readNavLayout(USER)).revision).toBe(2)
    })

    it('rejects a stale revision', async () => {
        await saveNavLayout(USER, layout, 0)
        await saveNavLayout(USER, layout, 1)
        expect(await saveNavLayout(USER, removeNavLink(layout, '/xeno'), 1)).toBeNull()
        expect((await readNavLayout(USER)).layout).toEqual(layout)
    })

    it('converts a stored version 1 layout on read', async () => {
        await db.insert(userNavLayout).values({
            userId: USER,
            layout: { sections: ['slots', 'idle'], items: {}, collapsed: ['idle'] } as unknown as NavLayout
        })
        const { layout: read, revision } = await readNavLayout(USER)
        expect(revision).toBe(0)
        expect(read?.root.slice(0, 2)).toEqual(['f-slots', 'f-idle'])
        expect(read?.folders['f-idle']?.collapsed).toBe(true)
    })
})
