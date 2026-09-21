import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    SHAPEZZ_ARENA,
    shapezzCheckpointDecision,
    shapezzIncomingShots,
    shapezzLayaCheckpointQuestions,
    shapezzLayaCombatAdvice,
    shapezzLayaCombatQuestions,
    shapezzUpgradeValue,
    type ShapezzAutopilotEnemy,
    type ShapezzAutopilotView,
    type ShapezzCheckpointContext
} from '../../shared/utils/gamelogic/shapezz-autopilot'
import { ShapezzAutopilot } from '../../app/utils/shapezz-autopilot'
import type { ShapezzAutopilotInput, ShapezzEngine } from '../../app/utils/shapezz-engine'

const floor = SHAPEZZ_ARENA.floorY - 18

const base: ShapezzAutopilotView = {
    elapsedMs: 60_000,
    checkpoint: 1,
    player: { x: 640, y: floor, vx: 0, vy: 0, size: 36, onGround: true },
    hp: 150,
    maxHp: 150,
    shield: 0,
    moveSpeed: 330,
    jumpSpeed: 930,
    weapon: { type: 'blaster', bulletSpeed: 780, chainRange: 0, explosionRadius: 0 },
    bulletTime: 0,
    enemies: [],
    bullets: [],
    pickups: [],
    platforms: [],
    upgrades: {}
}

let nextId = 1
function enemy(type: ShapezzAutopilotEnemy['type'], x: number, y: number, extra: Partial<ShapezzAutopilotEnemy> = {}): ShapezzAutopilotEnemy {
    return { id: nextId++, type, x, y, vx: 0, vy: 0, radius: 20, hp: 1, damage: 15, speed: 150, ...extra }
}

const checkpoint: ShapezzCheckpointContext = {
    offers: ['orbitals', 'afterimage', 'hyperVelocity'],
    upgrades: {},
    weapon: 'blaster',
    hull: 0.9,
    damageTaken: 0.1
}

describe('shapezz autopilot combat questions', () => {
    it('describes danger in words, each question with its own short state', () => {
        const questions = shapezzLayaCombatQuestions({
            ...base,
            hp: 40,
            enemies: [enemy('melee', 680, floor), enemy('shooter', 1100, 300)],
            bullets: [{ x: 560, y: floor, vx: 300, vy: 0, radius: 6, damage: 10 }]
        })
        expect(questions.danger!.state).toBe('Hull: badly damaged, under a third left. One enemy is close enough to ram you. One enemy shot will hit you within half a second.')
        expect(questions.zone_right!.state).toBe('The right of the arena: one gunner; no enemy shots.')
        expect(questions.focus!.type).toBe('choice')
        expect(Object.keys(questions.focus!.criteria!)).toEqual(['rammers', 'gunners'])
        for (const question of Object.values(questions)) expect(question.state.length).toBeLessThan(300)
    })

    it('asks about health only when an orb is down and the hull needs it', () => {
        const orb = { x: 200, y: floor, kind: 'health' as const, value: 18 }
        expect(shapezzLayaCombatQuestions({ ...base, pickups: [orb] }).grab_health).toBeUndefined()
        expect(shapezzLayaCombatQuestions({ ...base, hp: 60, pickups: [orb] }).grab_health!.state).toContain('health orb')
    })

    it('skips the focus question with only one kind of enemy', () => {
        expect(shapezzLayaCombatQuestions({ ...base, enemies: [enemy('melee', 100, 300), enemy('dasher', 200, 300)] }).focus).toBeUndefined()
    })

    it('reads answers', () => {
        const advice = shapezzLayaCombatAdvice({
            danger: { noul: 1.3 },
            zone_left: { noul: 0.7 },
            zone_centre: { noul: 0.1 },
            focus: { choice: 'gunners', probabilities: { gunners: 0.6, rammers: 0.4 } }
        })
        expect(advice).toEqual({ danger: 1, zones: { left: 0.7, centre: 0.1, right: 0 }, grabHealth: 0, focus: 'gunners', focusConfidence: 0.6 })
        expect(shapezzLayaCombatAdvice({ focus: { choice: 'everyone' } }).focus).toBeNull()
    })

    it('spots shots on a collision course', () => {
        const view = {
            ...base,
            bullets: [
                { x: 400, y: floor, vx: 600, vy: 0, radius: 6, damage: 10 },
                { x: 400, y: 100, vx: 600, vy: 0, radius: 6, damage: 10 }
            ]
        }
        expect(shapezzIncomingShots(view)).toHaveLength(1)
    })
})

describe('shapezz autopilot checkpoint', () => {
    it('asks only which mutation to take, never whether to cash out', () => {
        const questions = shapezzLayaCheckpointQuestions({ ...checkpoint, upgrades: { orbitals: 1 } })
        expect(Object.keys(questions)).toEqual(['upgrade'])
        expect(Object.keys(questions.upgrade!.criteria!)).toEqual(checkpoint.offers)
        expect(questions.upgrade!.criteria!.orbitals).toContain('You already have 1.')
    })

    it('values mutations for the build', () => {
        expect(shapezzUpgradeValue('blackHole', { ...checkpoint, weapon: 'arcCoil' })).toBeLessThan(0.1)
        const hurt = { ...checkpoint, hull: 0.2, damageTaken: 0.8 }
        expect(shapezzUpgradeValue('aegisPlating', hurt)).toBeGreaterThan(shapezzUpgradeValue('aegisPlating', checkpoint))
        expect(shapezzUpgradeValue('orbitals', { ...checkpoint, upgrades: { orbitals: 3 } })).toBeLessThan(shapezzUpgradeValue('orbitals', checkpoint))
    })

    it('blends Laya with the build values', () => {
        // Laya prefers a dud; the build value still wins.
        const decision = shapezzCheckpointDecision(
            { ...checkpoint, weapon: 'arcCoil', offers: ['blackHole', 'chainLightning', 'giantRounds'] },
            { upgrade: { probabilities: { blackHole: 0.5, chainLightning: 0.3, giantRounds: 0.2 } } }
        )
        expect(decision).toEqual({ upgrade: 'chainLightning', laya: true })
        // Badly hurt, with Laya down: sustain beats more damage.
        const hurt = { ...checkpoint, hull: 0.2, damageTaken: 0.9, offers: ['aegisPlating', 'hyperVelocity', 'overkillDividend'] as ShapezzCheckpointContext['offers'] }
        expect(shapezzCheckpointDecision(hurt, null)).toEqual({ upgrade: 'aegisPlating', laya: false })
    })
})

describe('shapezz autopilot helm', () => {
    let view: ShapezzAutopilotView
    let input: ShapezzAutopilotInput | null
    let hook: ((dt: number) => void) | null
    const engine = {
        autopilotView: () => view,
        setFrameHook: (h: typeof hook) => { hook = h },
        setAutopilotInput: (i: typeof input) => { input = i }
    } as unknown as ShapezzEngine

    beforeEach(() => {
        // Laya isn't running in tests; the helm must steer on its own read.
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function run(state: ShapezzAutopilotView) {
        view = state
        const pilot = new ShapezzAutopilot(engine, 'http://127.0.0.1:8000', () => {})
        pilot.start()
        hook!(0.016)
        const taken = { ...input! }
        pilot.stop()
        return taken
    }

    it('runs away from a rammer and shoots it', () => {
        const rammer = enemy('melee', 760, floor)
        const taken = run({ ...base, enemies: [rammer] })
        expect(taken.move).toBe(-1)
        expect(taken.fire).toBe(true)
        expect(taken.aimX).toBeCloseTo(760)
    })

    it('jumps a shot skimming the floor', () => {
        const taken = run({ ...base, bullets: [{ x: 460, y: floor, vx: 900, vy: 0, radius: 6, damage: 30 }] })
        expect(taken.jump).toBe(true)
    })

    it('leads a moving target', () => {
        const taken = run({ ...base, enemies: [enemy('shooter', 640, 200, { vx: 100 })] })
        expect(taken.aimX).toBeGreaterThan(640)
    })

    it('holds fire with nothing to shoot', () => {
        expect(run(base).fire).toBe(false)
    })

    it('hands the controls back when stopped', () => {
        view = base
        const pilot = new ShapezzAutopilot(engine, 'http://127.0.0.1:8000', () => {})
        pilot.start()
        pilot.stop()
        expect(input).toBeNull()
        expect(hook).toBeNull()
    })
})
