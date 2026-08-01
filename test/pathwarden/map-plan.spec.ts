import { describe, expect, it, vi } from 'vitest'
import {
    createPathwardenMapPlan,
    createPathwardenSeededRandom,
    hashPathwardenMapPlan,
    serializePathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map'
import {
    pathwardenRoomFootprintDimensions,
    validatePathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map-validation'

describe('Pathwarden seeded map model', () => {
    // A plan costs ~6ms to generate and ~4ms to hash, so seed count is this
    // file's entire runtime. These 13 are pinned rather than swept because each
    // sits at an extreme of the generator's output over seeds 0-1199: a
    // structural regression has to push an invariant past a boundary a real plan
    // already sits on. Realm is fixed at 1 throughout — it is stored on the plan
    // and never read by the generator, so varying it only re-tests the hash.
    // Re-derive the list with a one-off wide sweep if the generator changes.
    const CASES = [
        { seed: 164, extreme: 'fewest junctions, 17' },
        { seed: 571, extreme: 'most junctions, 37' },
        { seed: 1, extreme: 'a required archetype appears exactly once' },
        { seed: 996, extreme: 'no t-junctions at all' },
        { seed: 998, extreme: 'fewest y-junctions, 2' },
        { seed: 57, extreme: 'fewest crossroads, 3' },
        { seed: 5, extreme: 'largest castle footprint, area 50' },
        { seed: 913, extreme: 'fewest rooms, 33' },
        { seed: 432, extreme: 'most rooms, 57' },
        { seed: 0, extreme: 'a single depth-13 room' },
        { seed: 16, extreme: 'most depth-13 rooms, 5' },
        { seed: 136, extreme: 'fewest terminal approaches, 23' },
        { seed: 204, extreme: 'most terminal approaches, 50' }
    ]
    const junctions = new Set(['y-junction', 't-junction', 'crossroads'])

    it('round-trips through JSON without changing canonical output', () => {
        const plan = createPathwardenMapPlan({ seed: 4_294_967_295, realm: 5 })
        const restored = JSON.parse(JSON.stringify(plan))
        expect(serializePathwardenMapPlan(restored)).toBe(serializePathwardenMapPlan(plan))
    })

    it('regenerates an identical plan from the same seed and realm', () => {
        // Determinism can only break in seed-independent ways (global randomness,
        // Map iteration order), so a handful of seeds proves it as well as a sweep.
        for (let seed = 0; seed < 12; seed++) {
            const options = { seed, realm: seed % 5 + 1 }
            expect(hashPathwardenMapPlan(createPathwardenMapPlan(options)), `seed ${seed}`)
                .toBe(hashPathwardenMapPlan(createPathwardenMapPlan(options)))
        }
    })

    it('treats realm as plan metadata rather than a layout input', () => {
        // This is why the structural cases above can pin realm 1. If the
        // generator ever starts reading realm, this fails and they need widening.
        const plans = [1, 2, 3, 4, 5].map(realm => createPathwardenMapPlan({ seed: 7, realm }))
        const layouts = plans.map(plan => JSON.stringify([plan.rooms, plan.roadLinks, plan.metrics.archetypeCounts]))
        expect(new Set(layouts).size).toBe(1)
        expect(new Set(plans.map(hashPathwardenMapPlan)).size).toBe(plans.length)
    })

    it('does not depend on global Math.random', () => {
        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('Global randomness is forbidden')
        })
        expect(() => createPathwardenMapPlan({ seed: 42, realm: 1 })).not.toThrow()
        expect(random).not.toHaveBeenCalled()
        random.mockRestore()
    })

    it('can resume an explicit random state', () => {
        const first = createPathwardenSeededRandom(73)
        first.next()
        first.next()
        const resumed = createPathwardenSeededRandom(first.state)
        expect(resumed.next()).toBe(first.next())
        expect(resumed.state).toBe(first.state)
    })

    it('rejects terminal road exits without a concealed planned approach', () => {
        const plan = createPathwardenMapPlan({ seed: 42, realm: 1 })
        const terminalRoom = plan.rooms.find(room => room.terminalApproaches?.length)
        expect(terminalRoom).toBeDefined()
        terminalRoom!.terminalApproaches = []
        const validation = validatePathwardenMapPlan(plan)
        expect(validation.errors.some(error => error.includes('omits terminal approach'))).toBe(true)
    })

    it('rejects a terminal approach that revisits itself', () => {
        const plan = createPathwardenMapPlan({ seed: 42, realm: 1 })
        const terminalRoom = plan.rooms.find(room => room.terminalApproaches?.length)!
        const approach = terminalRoom.terminalApproaches![0]!
        approach.cells[2] = { ...approach.cells[0]! }
        const validation = validatePathwardenMapPlan(plan)
        expect(validation.errors.some(error => error.includes('revisits a road cell'))).toBe(true)
    })

    it('generates a distinct, structurally valid depth-13 plan for every seed', () => {
        const hashes = new Set<string>()
        for (const { seed, extreme } of CASES) {
            const plan = createPathwardenMapPlan({ seed, realm: 1 })
            hashes.add(hashPathwardenMapPlan(plan))
            const validation = validatePathwardenMapPlan(plan)
            expect(validation.errors, `seed ${seed} (${extreme})`).toEqual([])
            expect(plan.metrics.maxDepth).toBe(13)
            expect(plan.rooms.some(room => room.depth === 13)).toBe(true)
            const castle = plan.rooms.find(room => room.id === plan.castleRoomId)!
            expect(castle.ports.filter(port => port.kind === 'exit')).toHaveLength(3)
            const castleDegrees = new Map<string, number>()
            for (const link of plan.roadLinks.filter(link => link.roomId === castle.id)) {
                for (const cell of [link.from, link.to]) {
                    const key = `${cell.col}:${cell.row}`
                    castleDegrees.set(key, (castleDegrees.get(key) ?? 0) + 1)
                }
            }
            expect([...castleDegrees.values()].some(degree => degree === 4)).toBe(true)
            expect(plan.rooms.filter(room => room.depth === 3).some(room =>
                junctions.has(room.archetype))).toBe(true)
            expect(plan.metrics.archetypeCounts['road-island']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['bridge-river']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['mountain-pass']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['lake-shore']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['forest-road']).toBeGreaterThanOrEqual(1)
            // The generator forces a junction at every odd depth but picks its
            // type at random, so a plan can legitimately omit y- or t-junctions
            // — seed 996 has none. Junction *density* is the real invariant,
            // asserted below; requiring both types individually is flaky.
            // Observed minimum across seeds 0-1199 is 17, held by seed 164.
            expect(plan.metrics.archetypeCounts.crossroads).toBeGreaterThanOrEqual(2)
            const junctionCount = (plan.metrics.archetypeCounts['y-junction'] ?? 0)
                + (plan.metrics.archetypeCounts['t-junction'] ?? 0)
                + (plan.metrics.archetypeCounts.crossroads ?? 0)
                + 1 // The always-visible castle approach is itself a crossroads.
            expect(junctionCount, `junction density in seed ${seed}`).toBeGreaterThanOrEqual(6)
            for (const room of plan.rooms) {
                for (const approach of room.terminalApproaches ?? []) {
                    expect(approach.cells, `${approach.portId} in seed ${seed}`).toHaveLength(6)
                }
                if (room.id === plan.castleRoomId) continue
                if (room.depth === 1) expect(room.archetype, `seed ${seed} ${room.id}`).toBe('crossroads')
                if (room.depth >= 3 && room.depth % 2 === 1) {
                    expect(junctions.has(room.archetype), `seed ${seed} ${room.id}`).toBe(true)
                }
                const dimensions = pathwardenRoomFootprintDimensions(room.footprint)
                expect(dimensions.width, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(8)
                expect(dimensions.height, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(8)
                expect(dimensions.area, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(36)
            }
        }
        expect(hashes.size, 'distinct plans across the pinned seeds').toBe(CASES.length)
    })

    it('keeps expansion links connected from source exits to destination rooms', () => {
        const plan = createPathwardenMapPlan({ seed: 1, realm: 1 })
        const rooms = new Map(plan.rooms.map(room => [room.id, room]))
        const links = new Map(plan.roadLinks.map(link => [link.id, link]))
        for (const connection of plan.connections.filter(connection => connection.kind === 'expansion')) {
            const sourceRoom = rooms.get(connection.fromRoomId)!
            const destinationRoom = rooms.get(connection.toRoomId)!
            const source = sourceRoom.ports.find(port => port.id === connection.fromPortId)!
            const destination = destinationRoom.ports.find(port => port.id === connection.toPortId)!
            const connectionLinks = connection.roadLinkIds.map(linkId => links.get(linkId)!)
            expect(connectionLinks[0]!.from).toEqual(source.cell)
            expect(connectionLinks.at(-1)!.to).toEqual(destination.cell)
        }
    })
})
