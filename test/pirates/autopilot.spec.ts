import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    pirateHeadingAngle,
    pirateHeadingOf,
    pirateKegGroups,
    pirateLayaBias,
    pirateLayaCalibrationQuestions,
    pirateLayaDecision,
    pirateLayaQuestions,
    PIRATE_AUTOPILOT_HEADINGS,
    type PirateAutopilotSnapshot
} from '../../shared/utils/gamelogic/pirates-autopilot'
import { PirateAutopilot } from '../../app/utils/pirates-engine/autopilot'
import type { PirateGame } from '../../app/utils/pirates-engine/pirate-game'

const base: PirateAutopilotSnapshot = {
    t: 30_000,
    x: 700,
    y: 410,
    hull: 0.5,
    shield: 0,
    range: 260,
    keg: true,
    powerUps: 0,
    enemies: [],
    hazards: [],
    mines: [],
    islands: [],
    supply: null,
    repair: null,
    treasure: null
}

let nextId = 1
function enemy(tier: string, x: number, y: number, hp = 1, range = 160) {
    return { id: nextId++, tier, x, y, hp, range }
}

describe('pirate autopilot geometry', () => {
    it('round-trips headings', () => {
        for (const heading of PIRATE_AUTOPILOT_HEADINGS) {
            const a = pirateHeadingAngle(heading)
            expect(pirateHeadingOf(Math.cos(a), Math.sin(a))).toBe(heading)
        }
        expect(pirateHeadingOf(0, -1)).toBe('north')
        expect(pirateHeadingOf(1, 0)).toBe('east')
    })

    it('finds separate groups for the keg, biggest first', () => {
        const groups = pirateKegGroups([
            enemy('sloop', 100, 100),
            enemy('sloop', 900, 400),
            enemy('sloop', 950, 420),
            enemy('sloop', 920, 460)
        ])
        expect(groups.map(group => group.ships)).toEqual([3, 1])
        expect(groups[0]!.x).toBeGreaterThan(900)
        expect(pirateKegGroups([])).toEqual([])
    })
})

describe('pirate laya questions', () => {
    it('offers every sailable heading, pickups on the sea, and the nearest ships to attack', () => {
        const questions = pirateLayaQuestions({
            ...base,
            repair: { x: 600, y: 410 },
            enemies: [enemy('dreadnought', 800, 410, 1, 310)]
        })
        expect(Object.keys(questions)).toContain('sail_west')
        expect(questions.grab_repair!.instructions).toBe('Is it safe to sail to the repair kit right now?')
        expect(questions.grab_supply).toBeUndefined()
        const attack = Object.entries(questions).find(([key]) => key.startsWith('attack_'))!
        expect(attack[1].state).toContain('the flagship boss')
        expect(questions.sail_east!.state).toContain('including the flagship boss')
    })

    it('leaves out headings straight into the coast', () => {
        const questions = pirateLayaQuestions({ ...base, x: 60, y: 760 })
        expect(questions.sail_west).toBeUndefined()
        expect(questions.sail_south).toBeUndefined()
        expect(questions['sail_north-east']!.state).toContain('toward the open middle of the sea')
    })

    it('tells Laya how built up the ship is', () => {
        const questions = pirateLayaQuestions({ ...base, powerUps: 3, enemies: [enemy('sloop', 800, 410)] })
        const attack = Object.entries(questions).find(([key]) => key.startsWith('attack_'))!
        expect(attack[1].state).toContain('three power-ups adding damage and survivability')
    })

    it('asks about the keg only when it is ready, and where only with a choice', () => {
        const cluster = [enemy('sloop', 900, 400), enemy('sloop', 950, 420), enemy('sloop', 200, 700)]
        expect(pirateLayaQuestions({ ...base, keg: false, enemies: cluster }).throw_keg).toBeUndefined()
        const questions = pirateLayaQuestions({ ...base, enemies: cluster })
        expect(questions.throw_keg).toBeDefined()
        expect(questions.keg_0!.state).toContain('two enemy ships')
        expect(questions.keg_1!.state).toContain('one enemy ship')
    })
})

describe('pirate laya decisions', () => {
    it('carries out the move Laya rates highest', () => {
        const target = enemy('sloop', 800, 410)
        const snap = { ...base, repair: { x: 600, y: 410 }, enemies: [target] }
        expect(pirateLayaDecision(snap, { sail_east: { noul: 0.6 }, grab_repair: { noul: 0.9 } }).move).toEqual({ kind: 'grab', pickup: 'repair' })
        expect(pirateLayaDecision(snap, { sail_east: { noul: 0.6 }, [`attack_${target.id}`]: { noul: 0.7 } }).move).toEqual({ kind: 'attack', enemyId: target.id })
        // A pickup that has gone, or a ship that has sunk, is not a move.
        expect(pirateLayaDecision(base, { grab_repair: { noul: 0.9 }, attack_999: { noul: 0.9 } }).move).toBeNull()
    })

    it('throws the keg only when Laya says so, at the group it rates best', () => {
        const cluster = [enemy('sloop', 900, 400), enemy('sloop', 950, 420), enemy('sloop', 200, 700)]
        const snap = { ...base, enemies: cluster }
        expect(pirateLayaDecision(snap, { throw_keg: { noul: 0.2 }, keg_0: { noul: 0.9 } }).keg).toBeNull()
        expect(pirateLayaDecision(snap, { throw_keg: { noul: 0.9 }, keg_0: { noul: 0.1 }, keg_1: { noul: 0.6 } }).keg).toEqual({ x: 200, y: 700 })
    })

    it('takes Laya\'s word bias out before comparing', () => {
        const questions = pirateLayaCalibrationQuestions()
        expect(Object.keys(questions)).toHaveLength(8)
        const answers = Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(h => [`sail_${h}`, { noul: h === 'west' ? 0.9 : 0.8 }]))
        const bias = pirateLayaBias(answers)!
        expect(bias.sail_west).toBeCloseTo(0.0875)
        // West only looked better because Laya favours the word; with the bias out, east wins.
        const decision = pirateLayaDecision(base, { sail_west: { noul: 0.85 }, sail_east: { noul: 0.8 } }, bias)
        expect(decision.move).toEqual({ kind: 'sail', heading: 'east' })
        expect(pirateLayaBias({ sail_west: { noul: 0.9 } })).toBeNull()
    })
})

describe('pirate autopilot', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function fakeGame(snap: PirateAutopilotSnapshot) {
        let hook: ((deltaMS: number) => void) | null = null
        const game = {
            autopilotView: () => ({ ...snap, speed: 200 }),
            setFrameHook: (h: typeof hook) => { hook = h },
            autopilotSail: vi.fn(),
            autopilotAttack: vi.fn(() => true),
            autopilotHeaveTo: vi.fn(),
            autopilotCastAbility: vi.fn(() => true)
        }
        return { game, tick: (ms: number) => hook!(ms) }
    }

    /** Let answers land; the pilot asks at most every 100 ms of real time. */
    async function settle() {
        await new Promise(resolve => setTimeout(resolve, 110))
    }

    it('calibrates first, then sails where Laya says', async () => {
        const { game, tick } = fakeGame(base)
        const calibration = Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(h => [`sail_${h}`, { noul: 0.8 }]))
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ answers: calibration }) })
            .mockResolvedValue({ ok: true, json: async () => ({ answers: { sail_north: { noul: 0.9 }, sail_south: { noul: 0.2 } } }) }))
        const pilot = new PirateAutopilot(game as unknown as PirateGame, 'http://127.0.0.1:8000', () => {})
        pilot.start()
        tick(100)
        await settle()
        tick(100)
        await settle()
        tick(100)
        expect(game.autopilotSail).toHaveBeenCalled()
        const [, y] = game.autopilotSail.mock.calls.at(-1)!
        expect(y).toBeLessThan(base.y)
        pilot.stop()
    })

    it('does nothing without Laya', async () => {
        const { game, tick } = fakeGame(base)
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
        const pilot = new PirateAutopilot(game as unknown as PirateGame, 'http://127.0.0.1:8000', () => {})
        pilot.start()
        for (let i = 0; i < 5; i++) {
            tick(100)
            await settle()
        }
        expect(game.autopilotSail).not.toHaveBeenCalled()
        expect(game.autopilotAttack).not.toHaveBeenCalled()
        expect(game.autopilotCastAbility).not.toHaveBeenCalled()
        pilot.stop()
    })
})
