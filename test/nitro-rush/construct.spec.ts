import { describe, expect, it } from 'vitest'
import { nextLabel, nextSection, SLOPE_STEPS, BANK_STEPS, stateAfter, stepsFor, STRAIGHT_LENGTHS, type BendSize, type Construction, type Curve } from '#shared/utils/nitro-rush/construct'
import { PALETTE_SECTIONS, SECTIONS, walkCustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import type { TrackPiece } from '#shared/utils/nitro-rush/layout'

const LEVEL = { bank: 0, grade: 0 }
const choice = (over: Partial<Construction> = {}): Construction => ({ curve: 'straight', size: 'medium', length: 60, slope: 'slope-flat', bank: 'bank-flat', ...over })
const walkOf = (sections: SectionId[]) => walkCustomTrack({ id: 'custom-t', name: 'T', closed: false, sections })

describe('next section', () => {
    it('finds a bend for every direction, angle and size, tighter to wider', () => {
        for (const turn of ['left', 'right'] as const) {
            for (const angle of [45, 90, 180] as const) {
                const radii = (['tight', 'medium', 'wide'] as BendSize[]).map((size) => {
                    const id = nextSection(choice({ curve: `${turn}-${angle}` as Curve, size }), LEVEL)
                    const piece: TrackPiece = SECTIONS[id].piece
                    if (piece.type !== 'corner') throw new Error(`${id} isn't a bend`)
                    expect(piece.turn, id).toBe(turn)
                    expect(piece.angle, id).toBe(angle)
                    return piece.radius
                })
                expect([...radii].sort((a, b) => a - b)).toEqual(radii)
                expect(new Set(radii).size).toBe(3)
            }
        }
    })

    it('finds a straight for every length', () => {
        for (const length of STRAIGHT_LENGTHS) expect(SECTIONS[nextSection(choice({ length }), LEVEL)].piece).toEqual({ type: 'straight', length })
    })

    it('changes the state first, one piece at a time, before the road it was asked for', () => {
        const asked = choice({ curve: 'right-90', slope: 'slope-up', bank: 'bank-right' })
        expect(nextSection(asked, LEVEL)).toBe('slope-up')
        expect(nextSection(asked, { bank: 0, grade: 0.1 })).toBe('bank-right')
        expect(nextSection(asked, { bank: 25, grade: 0.1 })).toBe('right-medium')
    })

    it('levels off from either direction, gentle or steep, and goes straight between grades', () => {
        expect(nextSection(choice(), { bank: 0, grade: -0.2 })).toBe('slope-flat')
        expect(nextSection(choice(), { bank: 0, grade: 0.1 })).toBe('slope-flat')
        expect(nextSection(choice({ slope: 'slope-up' }), { bank: 0, grade: 0.2 })).toBe('slope-up')
        expect(nextSection(choice({ bank: 'bank-left' }), { bank: 25, grade: 0 })).toBe('bank-left')
    })

    it('only ever lays what the palette offers', () => {
        const palette = new Set(PALETTE_SECTIONS.map(([id]) => id))
        for (const { id } of [...SLOPE_STEPS, ...BANK_STEPS]) expect(palette.has(id), id).toBe(true)
    })

    it('says where a state piece leaves the road, whatever road it starts from', () => {
        expect(nextLabel('slope-up')).toBe('Slope to gentle up')
        expect(nextLabel('bank-left')).toBe('Bank to left')
        expect(nextLabel('straight-60')).toBe(SECTIONS['straight-60'].label)
    })
})

describe('road state at the cursor', () => {
    const walk = walkOf(['straight-20', 'slope-up', 'bank-right', 'straight-20'])

    it('reads the state a piece leaves, not the one it starts in', () => {
        expect(stateAfter(walk, -1)).toEqual(LEVEL)
        expect(stateAfter(walk, 0)).toEqual(LEVEL)
        expect(stateAfter(walk, 1)).toEqual({ bank: 0, grade: 0.1 })
        expect(stateAfter(walk, 2).bank).toBeCloseTo(25)
        expect(stateAfter(walk, 3).bank).toBeCloseTo(25)
    })

    it('reads level on an empty course', () => {
        expect(stateAfter(walkOf([]), -1)).toEqual(LEVEL)
    })

    it('sets the controls to the state that\'s there, so nothing is laid until they change', () => {
        const here = stateAfter(walk, 3)
        const steps = stepsFor(here)
        expect(steps).toEqual({ slope: 'slope-up', bank: 'bank-right' })
        expect(nextSection(choice(steps), here)).toBe('straight-60')
    })
})
