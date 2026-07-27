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
    it('reproduces canonical plans for 1,000 seeds', () => {
        for (let seed = 0; seed < 1_000; seed++) {
            const first = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            const second = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            expect(serializePathwardenMapPlan(first)).toBe(serializePathwardenMapPlan(second))
            expect(hashPathwardenMapPlan(first)).toBe(hashPathwardenMapPlan(second))
        }
    }, 120_000)

    it('round-trips through JSON without changing canonical output', () => {
        const plan = createPathwardenMapPlan({ seed: 4_294_967_295, realm: 5 })
        const restored = JSON.parse(JSON.stringify(plan))
        expect(serializePathwardenMapPlan(restored)).toBe(serializePathwardenMapPlan(plan))
    })

    it('uses the seed to create different initial layouts', () => {
        const hashes = new Set(
            Array.from({ length: 64 }, (_, seed) => hashPathwardenMapPlan(
                createPathwardenMapPlan({ seed, realm: 1 })
            ))
        )
        expect(hashes.size).toBeGreaterThan(8)
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

    it('generates structurally valid depth-13 plans', () => {
        for (let seed = 0; seed < 250; seed++) {
            const plan = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            const validation = validatePathwardenMapPlan(plan)
            expect(validation.errors, `seed ${seed}`).toEqual([])
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
                ['y-junction', 't-junction', 'crossroads'].includes(room.archetype))).toBe(true)
            expect(plan.metrics.archetypeCounts['road-island']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['bridge-river']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['mountain-pass']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['lake-shore']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['forest-road']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['y-junction']).toBeGreaterThanOrEqual(1)
            expect(plan.metrics.archetypeCounts['t-junction']).toBeGreaterThanOrEqual(1)
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
            }
            for (const room of plan.rooms.filter(room => room.id !== plan.castleRoomId)) {
                const dimensions = pathwardenRoomFootprintDimensions(room.footprint)
                expect(dimensions.width, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(8)
                expect(dimensions.height, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(8)
                expect(dimensions.area, `${room.id} in seed ${seed}`).toBeLessThanOrEqual(36)
            }
        }
    }, 60_000)

    it('applies junction grammar to every branch depth', () => {
        const junctions = new Set(['y-junction', 't-junction', 'crossroads'])
        for (let seed = 0; seed < 250; seed++) {
            const plan = createPathwardenMapPlan({ seed, realm: seed % 5 + 1 })
            for (const room of plan.rooms) {
                if (room.depth === 1) expect(room.archetype, `seed ${seed} ${room.id}`).toBe('crossroads')
                if (room.depth >= 3 && room.depth % 2 === 1) {
                    expect(junctions.has(room.archetype), `seed ${seed} ${room.id}`).toBe(true)
                }
            }
        }
    }, 60_000)

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
