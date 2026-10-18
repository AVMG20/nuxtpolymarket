import { describe, expect, it } from 'vitest'
import { DfNav } from '#server/utils/dead-front/nav'
import type { DfNavLink, DfNavNode } from '#shared/utils/dead-front/map'

// A square room A (0-1-2) with a door to room B (3-4), and a staircase node
// (5) up to a loft (6).
const nodes: DfNavNode[] = [
    { id: 10, pos: { x: 0, y: 0, z: 0 }, zone: 'a' },
    { id: 11, pos: { x: 4, y: 0, z: 0 }, zone: 'a' },
    { id: 12, pos: { x: 4, y: 0, z: 4 }, zone: 'a' },
    { id: 13, pos: { x: 8, y: 0, z: 4 }, zone: 'b' },
    { id: 14, pos: { x: 12, y: 0, z: 4 }, zone: 'b' },
    { id: 15, pos: { x: 0, y: 1.5, z: 4 }, zone: 'a' },
    { id: 16, pos: { x: 0, y: 3, z: 8 }, zone: 'a' }
]
const links: DfNavLink[] = [
    { a: 10, b: 11 },
    { a: 11, b: 12 },
    { a: 12, b: 13, door: 'ab' },
    { a: 13, b: 14 },
    { a: 10, b: 15 },
    { a: 15, b: 16 }
]

describe('DfNav', () => {
    it('finds the shortest path with A*', () => {
        const nav = new DfNav({ nodes, links }, ['ab'])
        expect(nav.findPath(0, 4)).toEqual([0, 1, 2, 3, 4])
        expect(nav.findPath(2, 6)).toEqual([2, 1, 0, 5, 6])
        expect(nav.findPath(3, 3)).toEqual([3])
    })

    it('respects closed doors and reopens them', () => {
        const nav = new DfNav({ nodes, links })
        expect(nav.findPath(0, 4)).toBeNull()
        expect(nav.field(4)[0]).toBe(Infinity)
        nav.setOpenDoors(['ab'])
        expect(nav.findPath(0, 4)).toEqual([0, 1, 2, 3, 4])
        expect(nav.field(4)[0]).toBeCloseTo(16)
    })

    it('builds a distance field and steps down it', () => {
        const nav = new DfNav({ nodes, links }, ['ab'])
        const field = nav.field(6)
        expect(field[6]).toBe(0)
        expect(nav.nextHop(field, 2)).toBe(1)
        expect(nav.nextHop(field, 0)).toBe(5)
        expect(nav.nextHop(field, 6)).toBe(-1)
        expect(nav.field(6)).toBe(field)
    })

    it('keeps floors apart when picking the nearest node', () => {
        const nav = new DfNav({ nodes, links })
        expect(nav.nearest({ x: 0, y: 3, z: 7 })).toBe(6)
        expect(nav.nearest({ x: 0.2, y: 0, z: 0.5 })).toBe(0)
        expect(nav.around({ x: 4, y: 0, z: 2 }, 3, 1)).toEqual([1, 2])
    })
})
