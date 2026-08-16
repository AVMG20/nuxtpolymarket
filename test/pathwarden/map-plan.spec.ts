import { describe, expect, it, vi } from 'vitest'
import {
    createPathwardenMapPlan,
    createPathwardenSeededRandom,
    hashPathwardenMapPlan,
    serializePathwardenMapPlan
} from '#shared/utils/gamelogic/pathwarden-map'
import { validatePathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map-validation'

describe('Pathwarden seeded map model', () => {
    // The generator is a seeded road-graph growth, so every seed exercises the
    // same code path and a sweep is the honest test. 60 seeds costs ~0.6s.
    // Bounds below come from a 400-seed sweep, widened for headroom.
    const SEEDS = Array.from({ length: 60 }, (_, index) => index)
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
        expect(validation.errors.some(error => error.includes('leads nowhere'))).toBe(true)
    })

    it('rejects a terminal approach that revisits itself', () => {
        const plan = createPathwardenMapPlan({ seed: 42, realm: 1 })
        const terminalRoom = plan.rooms.find(room => room.terminalApproaches?.length)!
        const approach = terminalRoom.terminalApproaches![0]!
        approach.cells[2] = { ...approach.cells[0]! }
        const validation = validatePathwardenMapPlan(plan)
        expect(validation.errors.some(error => error.includes('revisits'))).toBe(true)
    })

    it('generates a distinct, structurally valid depth-13 plan for every seed', () => {
        const hashes = new Set<string>()
        for (const seed of SEEDS) {
            const plan = createPathwardenMapPlan({ seed, realm: 1 })
            hashes.add(hashPathwardenMapPlan(plan))
            expect(validatePathwardenMapPlan(plan).errors, `seed ${seed}`).toEqual([])
            expect(plan.metrics.maxDepth).toBe(13)
            // A twelve-wave run claims twelve sections, so the trunk has to
            // reach the final depth or the player runs out of frontiers.
            expect(plan.rooms.some(room => room.depth === 13), `seed ${seed} reaches depth 13`).toBe(true)
            const castle = plan.rooms.find(room => room.id === plan.castleRoomId)!
            expect(castle.ports.filter(port => port.kind === 'exit')).toHaveLength(3)
            expect(plan.rooms.length, `room count in seed ${seed}`).toBeGreaterThanOrEqual(15)
            expect(plan.rooms.length, `room count in seed ${seed}`).toBeLessThanOrEqual(170)
            expect(plan.rooms.some(room => junctions.has(room.archetype)), `seed ${seed} branches`).toBe(true)
            for (const room of plan.rooms) {
                for (const approach of room.terminalApproaches ?? []) {
                    expect(approach.cells, `${approach.portId} in seed ${seed}`).toHaveLength(6)
                }
            }
        }
        expect(hashes.size, 'distinct plans across the swept seeds').toBe(SEEDS.length)
    })

    it('never lays a road cell the shortest-path router cannot walk', () => {
        // The old room-stamp generator emitted a cycle in every road-island
        // room, and enemies only ever walked the shorter arm. The validator now
        // rejects any loop; this pins that it stays rejected.
        for (const seed of [0, 1, 42, 164, 571]) {
            const plan = createPathwardenMapPlan({ seed, realm: 1 })
            const nodes = new Set<string>()
            let edges = 0
            const visit = (from: { col: number, row: number }, to: { col: number, row: number }) => {
                nodes.add(`${from.col}:${from.row}`)
                nodes.add(`${to.col}:${to.row}`)
                edges++
            }
            for (const link of plan.roadLinks) visit(link.from, link.to)
            for (const room of plan.rooms) {
                for (const approach of room.terminalApproaches ?? []) {
                    const port = room.ports.find(candidate => candidate.id === approach.portId)!
                    let previous = port.cell
                    for (const cell of approach.cells) {
                        visit(previous, cell)
                        previous = cell
                    }
                }
            }
            expect(edges, `seed ${seed} road graph is a tree`).toBe(nodes.size - 1)
        }
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
