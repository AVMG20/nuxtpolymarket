import { describe, expect, it } from 'vitest'
import {
    PATHWARDEN_ROOM_TEMPLATES,
    transformPathwardenRoomTemplate
} from '#shared/utils/gamelogic/pathwarden-room-templates'

function key(point: { col: number, row: number }) {
    return `${point.col}:${point.row}`
}

describe('Pathwarden room templates', () => {
    it('keeps every road edge cardinal and inside its transformed bounds', () => {
        for (const template of PATHWARDEN_ROOM_TEMPLATES) {
            for (const rotation of [0, 90, 180, 270] as const) {
                for (const reflected of [false, true]) {
                    const transformed = transformPathwardenRoomTemplate(template, { rotation, reflected })
                    for (const [from, to] of transformed.roadEdges) {
                        expect(Math.abs(from.col - to.col) + Math.abs(from.row - to.row)).toBe(1)
                    }
                    for (const cell of [
                        ...transformed.roadCells,
                        ...transformed.buildableCells,
                        ...transformed.features.flatMap(feature => feature.cells)
                    ]) {
                        expect(cell.col).toBeGreaterThanOrEqual(0)
                        expect(cell.col).toBeLessThan(transformed.width)
                        expect(cell.row).toBeGreaterThanOrEqual(0)
                        expect(cell.row).toBeLessThan(transformed.height)
                    }
                }
            }
        }
    })

    it('keeps roads and buildable cells disjoint', () => {
        for (const template of PATHWARDEN_ROOM_TEMPLATES) {
            const roads = new Set(template.roadCells.map(key))
            expect(template.buildableCells.every(cell => !roads.has(key(cell)))).toBe(true)
        }
    })

    it('provides a true split-and-rejoin road island', () => {
        const island = PATHWARDEN_ROOM_TEMPLATES.find(template => template.archetype === 'road-island')!
        const degree = new Map<string, number>()
        for (const [from, to] of island.roadEdges) {
            degree.set(key(from), (degree.get(key(from)) ?? 0) + 1)
            degree.set(key(to), (degree.get(key(to)) ?? 0) + 1)
        }
        expect([...degree.values()].filter(value => value >= 3)).toHaveLength(2)
        expect(island.buildableCells.length).toBeGreaterThanOrEqual(3)
    })

    it('owns every water crossing through a bridge', () => {
        for (const template of PATHWARDEN_ROOM_TEMPLATES.filter(template =>
            template.features.some(feature => feature.kind === 'river'))) {
            const river = new Set(template.features
                .filter(feature => feature.kind === 'river')
                .flatMap(feature => feature.cells)
                .map(key))
            const bridge = new Set(template.features
                .filter(feature => feature.kind === 'bridge')
                .flatMap(feature => feature.cells)
                .map(key))
            const roadOnWater = template.roadCells.filter(cell => river.has(key(cell)))
            expect(roadOnWater.length).toBeGreaterThan(0)
            expect(roadOnWater.every(cell => bridge.has(key(cell)))).toBe(true)
        }
    })
})
