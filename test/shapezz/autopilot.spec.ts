import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    SHAPEZZ_ARENA,
    shapezzLayaBias,
    shapezzLayaCalibrationQuestions,
    shapezzLayaCheckpointQuestions,
    shapezzLayaDecision,
    shapezzLayaQuestions,
    shapezzLayaUpgrade,
    type ShapezzAutopilotEnemy,
    type ShapezzAutopilotView
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
    platforms: [{ x: 510, y: 445, width: 260 }],
    upgrades: {}
}

let nextId = 1
function enemy(type: ShapezzAutopilotEnemy['type'], x: number, y: number, extra: Partial<ShapezzAutopilotEnemy> = {}): ShapezzAutopilotEnemy {
    return { id: nextId++, type, x, y, vx: 0, vy: 0, radius: 20, hp: 1, damage: 15, speed: 150, ...extra }
}

describe('shapezz laya questions', () => {
    it('asks about every move open to the cube, each with its own facts', () => {
        const questions = shapezzLayaQuestions({ ...base, enemies: [enemy('melee', 720, floor)] })
        expect(Object.keys(questions)).toEqual(['move_left', 'move_right', 'move_hold', 'move_jump'])
        expect(questions.move_right!.state).toBe('Running right takes you toward one rammer, the nearest very close. Hull: pristine.')
        expect(questions.move_left!.state).toBe('Running left takes you away from every rammer, including the nearest, very close. Hull: pristine.')
        expect(questions.move_hold!.state).toBe('Standing still lets one rammer reach you and no shot is coming at you. Hull: pristine.')
    })

    it('says how built up the cube is without listing mutations', () => {
        const questions = shapezzLayaQuestions({ ...base, upgrades: { orbitals: 2, twinFang: 1 } })
        expect(questions.move_hold!.state).toContain('Hull: pristine; three mutations add damage and survivability.')
    })

    it('offers a drop only on a platform and no jump in mid-air', () => {
        const onPlatform = { ...base, player: { ...base.player, y: 445 - 18 } }
        expect(shapezzLayaQuestions(onPlatform).move_drop).toBeDefined()
        expect(shapezzLayaQuestions(base).move_drop).toBeUndefined()
        expect(shapezzLayaQuestions({ ...base, player: { ...base.player, onGround: false } }).move_jump).toBeUndefined()
    })

    it('says so when a move runs into the wall or jumps a low shot', () => {
        const cornered = shapezzLayaQuestions({
            ...base,
            player: { ...base.player, x: 60 },
            bullets: [{ x: 400, y: floor, vx: -500, vy: 0, radius: 6, damage: 10 }]
        })
        expect(cornered.move_left!.state).toContain('slams you into the wall')
        expect(cornered.move_jump!.state).toContain('lifts you over one low shot')
    })

    it('asks which enemy to shoot only when there is a choice', () => {
        expect(shapezzLayaQuestions({ ...base, enemies: [enemy('melee', 900, 300)] }).target).toBeUndefined()
        const gunner = enemy('shooter', 1100, 250)
        const dasher = enemy('dasher', 760, floor)
        const questions = shapezzLayaQuestions({ ...base, enemies: [gunner, dasher, enemy('melee', -40, 300)] })
        // Nearest first; the one still off-screen can't be shot and isn't offered.
        expect(Object.keys(questions.target!.criteria!)).toEqual([`e${dasher.id}`, `e${gunner.id}`])
        expect(questions.target!.criteria![`e${gunner.id}`]).toBe('a gunner that shoots from range, far away to the right')
    })
})

describe('shapezz laya decisions', () => {
    it('takes the move Laya rated highest and the enemy it chose', () => {
        const a = enemy('melee', 700, floor)
        const b = enemy('shooter', 200, 200)
        const view = { ...base, enemies: [a, b] }
        const decision = shapezzLayaDecision(view, {
            move_left: { noul: 0.4 },
            move_right: { noul: 0.2 },
            move_jump: { noul: 0.9 },
            target: { choice: `e${b.id}` }
        })
        expect(decision).toEqual({ action: 'jump', actions: { left: 0.4, right: 0.2, jump: 0.9 }, targetId: b.id })
    })

    it('shoots the only enemy, and nothing it didn\'t offer', () => {
        const only = enemy('tank', 900, 600)
        expect(shapezzLayaDecision({ ...base, enemies: [only] }, {}).targetId).toBe(only.id)
        expect(shapezzLayaDecision({ ...base, enemies: [only, enemy('melee', 300, 300)] }, { target: { choice: 'e999' } }).targetId).toBeNull()
        expect(shapezzLayaDecision(base, {}).action).toBeNull()
    })

    it('takes Laya\'s left/right bias out before comparing', () => {
        expect(Object.keys(shapezzLayaCalibrationQuestions())).toEqual(['move_left', 'move_right'])
        const bias = shapezzLayaBias({ move_left: { noul: 0.95 }, move_right: { noul: 0.85 } })!
        expect(bias).toEqual({ move_left: expect.closeTo(0.05), move_right: expect.closeTo(-0.05) })
        expect(shapezzLayaDecision(base, { move_left: { noul: 0.9 }, move_right: { noul: 0.86 } }, bias).action).toBe('right')
    })

    it('picks a mutation only from Laya', () => {
        const ctx = { offers: ['orbitals', 'afterimage', 'hyperVelocity'] as const, upgrades: {}, weapon: 'blaster' as const, hull: 0.9, damageTaken: 0.1 }
        const questions = shapezzLayaCheckpointQuestions({ ...ctx, offers: [...ctx.offers], upgrades: { orbitals: 1 } })
        expect(Object.keys(questions)).toEqual(['upgrade'])
        expect(questions.upgrade!.criteria!.orbitals).toContain('You already have 1.')
        expect(shapezzLayaUpgrade([...ctx.offers], { upgrade: { choice: 'afterimage' } })).toBe('afterimage')
        expect(shapezzLayaUpgrade([...ctx.offers], { upgrade: { choice: 'deathNova' } })).toBeNull()
        expect(shapezzLayaUpgrade([...ctx.offers], {})).toBeNull()
    })
})

describe('shapezz autopilot', () => {
    let view: ShapezzAutopilotView
    let input: ShapezzAutopilotInput | null
    let hook: ((dt: number) => void) | null
    const engine = {
        autopilotView: () => view,
        setFrameHook: (h: typeof hook) => { hook = h },
        setAutopilotInput: (i: typeof input) => { input = i }
    } as unknown as ShapezzEngine

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** Run a tick, let Laya's answer land, then run the next tick. */
    async function play(state: ShapezzAutopilotView) {
        view = state
        const pilot = new ShapezzAutopilot(engine, 'http://127.0.0.1:8000', () => {})
        pilot.start()
        // Calibration, then the first real question, then act on its answer.
        // The pilot asks at most every 100 ms of real time.
        for (let i = 0; i < 3; i++) {
            hook!(0.11)
            await new Promise(resolve => setTimeout(resolve, 110))
        }
        hook!(0.06)
        const taken = { ...input! }
        pilot.stop()
        return taken
    }

    it('carries out Laya\'s decision', async () => {
        const target = enemy('shooter', 640, 200, { vx: 100 })
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ answers: { move_left: { noul: 0.9 }, move_right: { noul: 0.9 } } }) })
            .mockResolvedValue({
                ok: true,
                json: async () => ({ answers: { move_left: { noul: 0.8 }, move_right: { noul: 0.3 }, move_hold: { noul: 0.1 }, move_jump: { noul: 0.2 } } })
            }))
        const taken = await play({ ...base, enemies: [target] })
        expect(taken.move).toBe(-1)
        expect(taken.fire).toBe(true)
        // Aimed at Laya's target, led by the shot's travel time.
        expect(taken.aimX).toBeGreaterThan(640)
    })

    it('stands still and holds fire without Laya', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
        const taken = await play({ ...base, enemies: [enemy('melee', 700, floor)] })
        expect(taken).toMatchObject({ move: 0, jump: false, drop: false, fire: false })
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
