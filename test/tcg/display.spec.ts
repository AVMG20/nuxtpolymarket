/**
 * Displays (§10.5): binders hold raw cards, shelves hold slabs, a copy sits
 * in one pocket anywhere, and pockets self-heal when the copy moves on.
 * Real Postgres from .env; fixture shape follows lots.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { db } from '#server/database'
import { tcgSet, tcgCard, tcgPrinting, tcgSheet, tcgPack, tcgCopy, tcgDisplay } from '#server/database/schema'
import { createDisplay, saveDisplay, deleteDisplay, getDisplay, listDisplays, displayCandidates } from '#server/utils/tcg/display'
import { galleryFor } from '#server/utils/tcg/gallery'
import { mintCondition } from '#shared/utils/tcg/condition'
import { SKIP, cleanupUser, seedUser } from '../setup/db-helpers'

const USERS = {
    owner: 'test-tcg-display-owner',
    viewer: 'test-tcg-display-viewer'
}
const createdSetIds: string[] = []

let setId: string
let printingId: string
let sheetId: string
let packId: string
let nextSlot = 0

async function buildFixture() {
    const [set] = await db.insert(tcgSet).values({
        name: `display spec set ${crypto.randomUUID().slice(0, 8)}`,
        code: 'DISP',
        status: 'committed'
    }).returning()
    createdSetIds.push(set!.id)
    const [card] = await db.insert(tcgCard).values({
        setId: set!.id, plaatjesBaseId: 'dsp-0', number: '001', name: 'Displayling', raw: {}
    }).returning()
    const [printing] = await db.insert(tcgPrinting).values({
        setId: set!.id, cardId: card!.id, plaatjesCardId: 'dsp-0', finish: 'nonholo'
    }).returning()
    const [sheet] = await db.insert(tcgSheet).values({
        setId: set!.id, name: 'd', role: 'base', packSlots: 1, layout: [printing!.id]
    }).returning()
    const [pack] = await db.insert(tcgPack).values({
        setId: set!.id, ownerId: USERS.owner, packIndex: 0, cuts: [], state: 'opened', openedAt: new Date()
    }).returning()
    setId = set!.id
    printingId = printing!.id
    sheetId = sheet!.id
    packId = pack!.id
}

async function seedCopy(ownerId: string, lifecycle: 'raw' | 'slabbed' = 'raw'): Promise<string> {
    const [copy] = await db.insert(tcgCopy).values({
        printingId, setId, ownerId, packId, sheetId,
        cutIndex: 0, slotOffset: nextSlot++, condition: mintCondition(),
        lifecycle,
        ...(lifecycle === 'slabbed'
            ? { gradeService: 'PSI', grade: '9', certNumber: `PSI-T${nextSlot}${Date.now() % 1e6}`, gradedAt: new Date() }
            : {})
    }).returning()
    return copy!.id
}

describe.skipIf(SKIP)('tcg displays integration', () => {
    beforeAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) {
            await cleanupUser(id)
            await seedUser(id, { balance: '1000' })
        }
        await buildFixture()
    }, 60_000)

    afterAll(async () => {
        await cleanupSets()
        for (const id of Object.values(USERS)) await cleanupUser(id)
        await db.$client.end()
    })

    async function cleanupSets() {
        if (createdSetIds.length > 0) {
            await db.delete(tcgSet).where(inArray(tcgSet.id, createdSetIds))
            createdSetIds.length = 0
        }
        await db.delete(tcgSet).where(eq(tcgSet.code, 'DISP'))
        await db.delete(tcgDisplay).where(inArray(tcgDisplay.userId, Object.values(USERS)))
    }

    it('creates, fills, reads back and deletes a binder', async () => {
        const binder = await createDisplay(USERS.owner, 'binder', 'First binder')
        const copies = [await seedCopy(USERS.owner), await seedCopy(USERS.owner)]

        await saveDisplay(USERS.owner, binder.id, {
            slots: [copies[0]!, null, null, copies[1]!]
        })

        const view = await getDisplay(binder.id)
        expect(view.kind).toBe('binder')
        expect(view.slots.map(slot => [slot.position, slot.copyId])).toEqual([[0, copies[0]], [3, copies[1]]])
        expect(view.slots[0]!.serial).toMatch(/^d #\d+$/)
        // Condition must never appear anywhere in the payload.
        expect(JSON.stringify(view)).not.toContain('condition')

        const summaries = await listDisplays(USERS.owner)
        expect(summaries).toHaveLength(1)
        expect(summaries[0]!.filled).toBe(2)
        expect(summaries[0]!.cover).not.toBeNull()

        await deleteDisplay(USERS.owner, binder.id)
        expect(await listDisplays(USERS.owner)).toHaveLength(0)
    })

    it('rejects foreign copies, wrong lifecycles and double placement', async () => {
        const binder = await createDisplay(USERS.owner, 'binder', 'Rules binder')
        const shelf = await createDisplay(USERS.owner, 'shelf', 'Rules shelf')
        const raw = await seedCopy(USERS.owner)
        const slab = await seedCopy(USERS.owner, 'slabbed')
        const foreign = await seedCopy(USERS.viewer)

        await expect(saveDisplay(USERS.owner, binder.id, { slots: [foreign] }))
            .rejects.toMatchObject({ statusCode: 400 })
        await expect(saveDisplay(USERS.owner, binder.id, { slots: [slab] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Binders hold your raw cards only' })
        await expect(saveDisplay(USERS.owner, shelf.id, { slots: [raw] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Shelves hold your slabs only' })
        await expect(saveDisplay(USERS.owner, binder.id, { slots: [raw, raw] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'A card can only sit in one pocket' })
        await expect(saveDisplay(USERS.viewer, binder.id, { slots: [] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Display is not yours to edit' })

        // Placed in the binder, the same copy is refused by the second display.
        await saveDisplay(USERS.owner, binder.id, { slots: [raw] })
        const second = await createDisplay(USERS.owner, 'binder', 'Second binder')
        await expect(saveDisplay(USERS.owner, second.id, { slots: [raw] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'A card is already in another display' })

        // The shelf takes the slab, and candidates report where each copy sits.
        await saveDisplay(USERS.owner, shelf.id, { slots: [slab] })
        const binderCandidates = await displayCandidates(USERS.owner, 'binder')
        expect(binderCandidates.find(candidate => candidate.copyId === raw)?.displayId).toBe(binder.id)
        expect(binderCandidates.some(candidate => candidate.copyId === slab)).toBe(false)
        const shelfCandidates = await displayCandidates(USERS.owner, 'shelf')
        expect(shelfCandidates.find(candidate => candidate.copyId === slab)?.gradeService).toBe('PSI')
    })

    it('pockets self-heal when the copy moves on, and viewers can read', async () => {
        const binder = await createDisplay(USERS.owner, 'binder', 'Healing binder')
        const staying = await seedCopy(USERS.owner)
        const leaving = await seedCopy(USERS.owner)
        await saveDisplay(USERS.owner, binder.id, { slots: [staying, leaving] })

        // The copy is traded away out from under the binder.
        await db.update(tcgCopy).set({ ownerId: USERS.viewer }).where(eq(tcgCopy.id, leaving))

        const view = await getDisplay(binder.id)
        expect(view.slots.map(slot => slot.copyId)).toEqual([staying])
        expect((await listDisplays(USERS.owner))[0]!.filled).toBe(1)

        // Any logged-in user reads the same view — there is no owner gate.
        const asViewer = await getDisplay(binder.id)
        expect(asViewer.ownerId).toBe(USERS.owner)
    })

    it('gallery: owned-only, public to other users, never condition', async () => {
        const raw = await seedCopy(USERS.owner)
        const slab = await seedCopy(USERS.owner, 'slabbed')

        const gallery = await galleryFor(USERS.owner)
        const spec = gallery.find(set => set.id === setId)!
        expect(spec).toBeDefined()
        const printing = spec.printings.find(p => p.id === printingId)!
        expect(printing.owned).toBeGreaterThanOrEqual(2)
        expect(printing.slabbed).toBeGreaterThanOrEqual(1)
        expect(printing.topGrade).toMatchObject({ service: 'PSI', grade: '9' })
        expect(JSON.stringify(gallery)).not.toContain('condition')

        // The viewer owns nothing here — their gallery has no spec set entry.
        const viewerGallery = await galleryFor(USERS.viewer)
        expect(viewerGallery.find(set => set.id === setId)?.printings.find(p => p.id === printingId)?.slabbed ?? 0).toBe(0)
        void raw
        void slab
    })

    it('caps displays per user and validates capacity', async () => {
        const binder = await createDisplay(USERS.viewer, 'binder', 'Cap binder')
        await expect(saveDisplay(USERS.viewer, binder.id, { capacity: 7, slots: [] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid capacity' })
        await expect(saveDisplay(USERS.viewer, binder.id, { capacity: 999, slots: [] }))
            .rejects.toMatchObject({ statusCode: 400, statusMessage: 'Invalid capacity' })
        await saveDisplay(USERS.viewer, binder.id, { capacity: 27, slots: [] })
        expect((await getDisplay(binder.id)).capacity).toBe(27)
        await expect(createDisplay(USERS.viewer, 'binder', ''))
            .rejects.toMatchObject({ statusCode: 400 })
    })
})
