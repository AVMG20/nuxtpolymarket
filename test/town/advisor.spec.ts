import { describe, expect, it } from 'vitest'
import {
    parseTownAdvisorRequest,
    townAdvisorInput,
    townAdvisorLabel,
    townAdvisorPicks
} from '#shared/utils/gamelogic/town-advisor'

const base = {
    happiness: 55,
    mood: 'Content',
    jobs: 30,
    residents: 22,
    coins: 2_000_000,
    buildersFree: 1,
    netPerHour: { planks: -30, wheat: 400, bogus: 5 },
    stock: { planks: 12, wheat: 900 }
}

describe('town advisor', () => {
    it('keeps known buildings only, one per type, below their cap', () => {
        const req = parseTownAdvisorRequest({
            ...base,
            candidates: [
                { type: 'sawmill', level: 2, affordable: true, short: 'planks' },
                { type: 'sawmill', level: 5, affordable: true },
                { type: 'road', level: 1, affordable: true },
                { type: 'nope', level: 1, affordable: true },
                { type: 'house', level: 0, affordable: true },
                { type: 'farm', level: 999, affordable: true },
                { type: 'house', level: 3, affordable: false, residents: true, short: 'bogus' }
            ]
        })!
        expect(req.candidates).toEqual([
            { type: 'sawmill', level: 2, affordable: true, short: 'planks', residents: false },
            { type: 'house', level: 3, affordable: false, short: undefined, residents: true }
        ])
        expect(req.netPerHour).toEqual({ planks: -30, wheat: 400 })
    })

    it('rejects a body without candidates', () => {
        expect(parseTownAdvisorRequest(null)).toBeNull()
        expect(parseTownAdvisorRequest({ ...base })).toBeNull()
    })

    it('describes the town and each candidate', () => {
        const req = parseTownAdvisorRequest({ ...base, candidates: [{ type: 'sawmill', level: 2, affordable: true, short: 'planks' }] })!
        const text = townAdvisorInput(req)
        expect(text).toContain('Jobs 30 for 22 residents (short of workers)')
        expect(text).toContain('Running down: Planks -30/h (stock 12)')
        expect(text).toContain(`- ${townAdvisorLabel(req.candidates[0]!)}: tier`)
        expect(text).toContain('town is short of Planks')
    })

    it('picks the best-scored types, ties in request order', () => {
        const candidates = [
            { type: 'house', level: 3, affordable: true },
            { type: 'farm', level: 1, affordable: true },
            { type: 'sawmill', level: 2, affordable: true }
        ]
        const scores = {
            [townAdvisorLabel(candidates[0]!)]: 0.2,
            [townAdvisorLabel(candidates[1]!)]: 0.2,
            [townAdvisorLabel(candidates[2]!)]: 0.9
        }
        expect(townAdvisorPicks(candidates, scores)).toEqual(['sawmill', 'house', 'farm'])
        expect(townAdvisorPicks(candidates, scores, 1)).toEqual(['sawmill'])
    })
})
