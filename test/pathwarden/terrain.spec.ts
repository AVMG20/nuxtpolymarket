import { describe, expect, it } from 'vitest'
import { createPathwardenHeightMap, PATHWARDEN_MAX_HEIGHT, PATHWARDEN_MIN_HEIGHT } from '#shared/utils/gamelogic/pathwarden-terrain'

const KEEP = { col: 80, row: 80 }
const SEEDS = [1, 42, 777, 123_456, 999_999]

function heightMap(seed: number) {
    return createPathwardenHeightMap(seed, 161, 161, KEEP)
}

describe('createPathwardenHeightMap', () => {
    it('is deterministic for a seed', () => {
        expect(heightMap(42).cells).toEqual(heightMap(42).cells)
    })

    it('produces a different field for a different seed', () => {
        expect(heightMap(42).cells).not.toEqual(heightMap(43).cells)
    })

    it.each(SEEDS)('keeps every cell inside the three drawable levels (seed %i)', (seed) => {
        for (const row of heightMap(seed).cells) {
            for (const height of row) {
                expect(height).toBeGreaterThanOrEqual(PATHWARDEN_MIN_HEIGHT)
                expect(height).toBeLessThanOrEqual(PATHWARDEN_MAX_HEIGHT)
            }
        }
    })

    it.each(SEEDS)('never steps more than one level between neighbours (seed %i)', (seed) => {
        const map = heightMap(seed)
        for (let row = 0; row < map.rows; row++) {
            for (let col = 0; col < map.cols; col++) {
                if (col < map.cols - 1) expect(Math.abs(map.at(col, row) - map.at(col + 1, row))).toBeLessThanOrEqual(1)
                if (row < map.rows - 1) expect(Math.abs(map.at(col, row) - map.at(col, row + 1))).toBeLessThanOrEqual(1)
            }
        }
    })

    it.each(SEEDS)('flattens the ground the keep and its approach sit on (seed %i)', (seed) => {
        const map = heightMap(seed)
        for (let row = KEEP.row - 6; row <= KEEP.row + 6; row++) {
            for (let col = KEEP.col - 6; col <= KEEP.col + 6; col++) {
                if (Math.hypot(col - KEEP.col, row - KEEP.row) > 6) continue
                expect(map.at(col, row)).toBe(PATHWARDEN_MIN_HEIGHT)
            }
        }
    })

    it('reads out of bounds as the lowest level rather than throwing', () => {
        const map = heightMap(42)
        expect(map.at(-1, 0)).toBe(PATHWARDEN_MIN_HEIGHT)
        expect(map.at(0, 1000)).toBe(PATHWARDEN_MIN_HEIGHT)
    })
})
