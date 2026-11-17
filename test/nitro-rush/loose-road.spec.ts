import { describe, expect, it } from 'vitest'
import { compileCustomTrack, importCustomTrack, exportCustomTrack, roadKey, sanitizeCustomTrack, sectionCount, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { walkForks } from '#shared/utils/nitro-rush/custom-forks'
import { bridgeTo } from '#shared/utils/nitro-rush/finish-loop'
import { cutLoose, cutOut, endOf, headOf, joinLoose, meets, mirrorLoose, onOneGround, turnLoose, walkLoose } from '#shared/utils/nitro-rush/loose-road'

const CLOSING: SectionId[] = ['start', 'straight-100', 'right-tight', 'right-tight', 'straight-100', 'straight-20', 'right-tight', 'right-tight']
const loop = (sections: SectionId[], extra: Partial<CustomTrack> = {}): CustomTrack => ({ id: 'custom-t', name: 'T', closed: true, sections, ...extra })

describe('loose road', () => {
    it('survives storage and JSON, and leaves the road key alone', () => {
        const t = loop(['start', 'straight-60'], { loose: [{ x: 100, z: -200, eighths: 2, y: 8, sections: ['straight-20', 'left-tight'] }] })
        expect(sanitizeCustomTrack(t)).toEqual(t)
        expect(importCustomTrack(exportCustomTrack(t), 'custom-x').track?.loose).toEqual(t.loose)
        expect(roadKey(t)).toBe(roadKey({ ...t, loose: undefined }))
        expect(sectionCount(t)).toBe(4)
    })

    it('rejects malformed loose road', () => {
        const base = loop(['start'])
        expect(sanitizeCustomTrack({ ...base, loose: [{ x: 0, z: 0, eighths: 9, y: 0, sections: ['straight-20'] }] })).toBeNull()
        expect(sanitizeCustomTrack({ ...base, loose: [{ x: 0, z: 0, eighths: 0, y: 0, sections: ['split-y'] }] })).toBeNull()
        expect(sanitizeCustomTrack({ ...base, loose: [{ x: 'a', z: 0, eighths: 0, y: 0, sections: ['straight-20'] }] })).toBeNull()
    })

    it('is never driven', () => {
        const t = loop(CLOSING, { loose: [{ x: 500, z: 500, eighths: 0, y: 0, sections: ['straight-20'] }] })
        expect(compileCustomTrack(t).error).toBeNull()
    })

    it('cuts the road after a section out of the middle off where it is, and joins it back on', () => {
        const t = loop(CLOSING)
        const before = walkForks(t).walks[0]!
        const cut = cutOut(t, 0, 3)!
        expect(cut.sections).toEqual(CLOSING.slice(0, 3))
        expect(cut.loose).toHaveLength(1)
        const ground = onOneGround(walkForks(cut).walks, cut.loose!)
        // The cut-off road is drawn exactly where it was.
        const after = ground.loose[0]!
        const from = before.pieceStarts[4]!
        expect(after.pts[0]![0]).toBeCloseTo(before.pts[from]![0], 3)
        expect(after.pts[0]![1]).toBeCloseTo(before.pts[from]![1], 3)
        // Laying the missing section back joins it all up again.
        const back = joinLoose({ ...cut, sections: [...cut.sections, CLOSING[3]!] })
        expect(back.loose).toBeUndefined()
        expect(back.sections).toEqual(CLOSING)
        expect(compileCustomTrack(back).error).toBeNull()
    })

    it('keeps heights when road on a slope is cut', () => {
        const t = loop(['start', 'slope-up', 'straight-60', 'slope-flat', 'straight-60', 'straight-20'])
        const cut = cutOut(t, 0, 4)!
        expect(cut.loose![0]!.y).toBeGreaterThan(0)
        const back = joinLoose({ ...cut, sections: [...cut.sections, 'straight-60'] })
        expect(back.sections).toEqual(t.sections)
    })

    it('splits loose road in two and joins it again', () => {
        const t = loop(['start'], { loose: [{ x: 200, z: 0, eighths: 0, y: 0, sections: ['straight-20', 'straight-60', 'right-tight'] }] })
        const cut = cutLoose(t, 0, 1)
        expect(cut.loose).toHaveLength(2)
        const tail = cut.loose![1]!
        expect(tail.z).toBeCloseTo(-80, 4)
        const back = joinLoose({ ...cut, loose: [{ ...cut.loose![0]!, sections: ['straight-20', 'straight-60'] }, tail] })
        expect(back.loose).toEqual([{ x: 200, z: 0, eighths: 0, y: 0, sections: ['straight-20', 'straight-60', 'right-tight'] }])
    })

    it('meets only road heading on the same way at the same height', () => {
        const r = { x: 0, z: -60, eighths: 0, y: 0, sections: ['straight-20'] as SectionId[] }
        const end = endOf(walkForks(loop(['start', 'straight-20', 'straight-20'])).walks[0]!)
        expect(meets(end, headOf(r, 0))).toBe(true)
        expect(meets(end, headOf({ ...r, y: 8 }, 0))).toBe(false)
        expect(meets(end, headOf({ ...r, eighths: 2 }, 0))).toBe(false)
    })

    it('turns and mirrors about its start', () => {
        const t = loop(['start'], { loose: [{ x: 0, z: -200, eighths: 0, y: 0, sections: ['straight-20', 'left-tight'] }] })
        expect(turnLoose(t, 0, 1).loose![0]!.eighths).toBe(2)
        expect(turnLoose(t, 0, -1).loose![0]!.eighths).toBe(6)
        expect(mirrorLoose(t, 0).loose![0]!.sections).toEqual(['straight-20', 'right-tight'])
        expect(walkLoose(mirrorLoose(t, 0).loose![0]!).end.x).toBeCloseTo(40, 4)
    })

    it('lifts the whole course when loose road would dig in', () => {
        const t = loop(['start', 'straight-60'], { loose: [{ x: 300, z: 0, eighths: 0, y: -10, sections: ['straight-20'] }] })
        const ground = onOneGround(walkForks(t).walks, t.loose!)
        expect(ground.rise).toBeCloseTo(10, 6)
        expect(ground.loose[0]!.ys[0]).toBeCloseTo(0, 6)
    })

    it('bridges a line\'s end onto loose road', () => {
        const t = loop(['start', 'straight-60'], { loose: [{ x: 200, z: 100, eighths: 4, y: 8, sections: ['straight-60'] }] })
        const { sections, error } = bridgeTo(t, 0, 0)
        expect(error).toBeNull()
        const joined = joinLoose({ ...t, sections: [...t.sections, ...sections!] })
        expect(joined.loose).toBeUndefined()
        expect(joined.sections.slice(-1)).toEqual(['straight-60'])
    })

    it('carries obstacles off the course with the road they stand on, and back on with it', () => {
        const t = loop(CLOSING, { obstacles: [
            { kind: 'barrel', line: 0, at: 1, along: 20, lateral: 2 },
            { kind: 'block', line: 0, at: 4, along: 40, lateral: -3 },
            { kind: 'oil', line: 0, at: 3, along: 10, lateral: 0 }
        ] })
        const cut = cutOut(t, 0, 3)!
        expect(cut.obstacles).toEqual([t.obstacles![0]])
        expect(cut.loose![0]!.obstacles).toEqual([{ kind: 'block', line: 0, at: 0, along: 40, lateral: -3 }])
        expect(sanitizeCustomTrack(cut)).toEqual(cut)
        const back = joinLoose({ ...cut, sections: [...cut.sections, CLOSING[3]!] })
        expect(back.obstacles).toEqual([t.obstacles![0], t.obstacles![1]])
        expect(compileCustomTrack(back).error).toBeNull()
    })

    it('mirrors the obstacles loose road carries', () => {
        const t = loop(['start'], { loose: [{ x: 0, z: -200, eighths: 0, y: 0, sections: ['straight-60'], obstacles: [{ kind: 'barrel', line: 0, at: 0, along: 10, lateral: 3 }] }] })
        expect(mirrorLoose(t, 0).loose![0]!.obstacles![0]!.lateral).toBe(-3)
        const split = cutLoose({ ...t, loose: [{ ...t.loose![0]!, sections: ['straight-20', 'straight-60'], obstacles: [{ kind: 'barrel', line: 0, at: 1, along: 10, lateral: 3 }] }] }, 0, 0)
        expect(split.loose![0]!.obstacles).toEqual([{ kind: 'barrel', line: 0, at: 0, along: 10, lateral: 3 }])
    })
})
