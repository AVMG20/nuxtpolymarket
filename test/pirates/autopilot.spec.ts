import { describe, expect, it } from 'vitest'
import {
    pirateHeadingAngle,
    pirateHeadingOf,
    pirateKegTarget,
    pirateLayaAdvice,
    pirateLayaQuestions,
    PIRATE_AUTOPILOT_HEADINGS,
    type PirateAutopilotSnapshot
} from '../../shared/utils/gamelogic/pirates-autopilot'

const base: PirateAutopilotSnapshot = {
    t: 30_000,
    x: 700,
    y: 410,
    hull: 0.5,
    shield: 0,
    range: 260,
    keg: true,
    enemies: [],
    hazards: [],
    mines: [],
    islands: [],
    supply: null,
    repair: null,
    treasure: null
}

const twoSloops = [
    { tier: 'sloop', x: 900, y: 400, hp: 1, range: 160 },
    { tier: 'sloop', x: 950, y: 420, hp: 1, range: 160 }
]

describe('pirate autopilot geometry', () => {
    it('round-trips headings', () => {
        for (const heading of PIRATE_AUTOPILOT_HEADINGS) {
            const a = pirateHeadingAngle(heading)
            expect(pirateHeadingOf(Math.cos(a), Math.sin(a))).toBe(heading)
        }
        expect(pirateHeadingOf(0, -1)).toBe('north')
        expect(pirateHeadingOf(1, 0)).toBe('east')
    })

    it('aims the keg at the biggest cluster', () => {
        const target = pirateKegTarget([
            { tier: 'sloop', x: 100, y: 100, hp: 1, range: 160 },
            { tier: 'sloop', x: 900, y: 400, hp: 1, range: 160 },
            { tier: 'sloop', x: 950, y: 420, hp: 1, range: 160 },
            { tier: 'sloop', x: 920, y: 460, hp: 1, range: 160 }
        ])
        expect(target?.ships).toBe(3)
        expect(target?.x).toBeGreaterThan(900)
        expect(pirateKegTarget([])).toBeNull()
    })
})

describe('pirate autopilot laya questions', () => {
    it('gives each question its own short state', () => {
        const questions = pirateLayaQuestions({
            ...base,
            enemies: [{ tier: 'dreadnought', x: 800, y: 410, hp: 1, range: 310 }],
            hazards: [{ x: 700, y: 410, r: 110 }]
        })
        expect(questions.danger!.state).toBe('Hull: damaged, about half left. One enemy ship can hit you, including the flagship boss. A cannon blast is about to land on you.')
        expect(questions.sail_east!.state).toContain('including the flagship boss')
        expect(questions.sail_west!.state).toContain('no enemy ship there')
        for (const question of Object.values(questions)) {
            expect(question.type).toBe('noul')
            // Laya cuts a state off at 512 tokens; these stay far below it.
            expect(question.state.length).toBeLessThan(300)
        }
    })

    it('asks only about pickups on the sea and a keg worth throwing', () => {
        expect(Object.keys(pirateLayaQuestions(base))).toEqual(['danger', ...PIRATE_AUTOPILOT_HEADINGS.map(h => `sail_${h}`)])

        const questions = pirateLayaQuestions({ ...base, repair: { x: 600, y: 410 }, enemies: twoSloops })
        expect(questions.grab_repair!.state).toContain('The repair kit is very close to the west.')
        expect(questions.grab_supply).toBeUndefined()
        expect(questions.throw_keg!.state).toContain('catches two enemy ships')

        expect(pirateLayaQuestions({ ...base, keg: false, enemies: twoSloops }).throw_keg).toBeUndefined()
        expect(pirateLayaQuestions({ ...base, enemies: twoSloops.slice(0, 1) }).throw_keg).toBeUndefined()
    })

    it('calls blocked water blocked', () => {
        const questions = pirateLayaQuestions({ ...base, x: 60, y: 410 })
        expect(questions.sail_west!.state).toContain('blocked by the coast')
        expect(questions.sail_east!.state).toContain('open water for a long way')
    })
})

describe('pirate autopilot laya answers', () => {
    it('normalises answers and picks the most open heading', () => {
        const advice = pirateLayaAdvice({
            danger: { type: 'noul', noul: 1.4 },
            sail_east: { type: 'noul', noul: 0.2 },
            'sail_south-west': { type: 'noul', noul: 0.7 },
            grab_supply: { type: 'noul', noul: 0.9 }
        })
        expect(advice).toMatchObject({
            danger: 1,
            heading: 'south-west',
            headingConfidence: 0.7,
            grabSupply: 0.9,
            grabRepair: 0,
            grabTreasure: 0,
            throwKeg: 0
        })
        expect(advice.openWater?.east).toBe(0.2)
        expect(advice.openWater?.north).toBe(0)
    })

    it('has no heading when nothing was judged', () => {
        expect(pirateLayaAdvice({}).heading).toBeNull()
    })
})
