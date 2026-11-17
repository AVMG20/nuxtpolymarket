import { describe, expect, it } from 'vitest'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { tracksideLayout } from '../../app/utils/nitro-rush/trackside-spots'
import { createCar, slipAngle, stepCar, type CarInput } from '../../app/utils/nitro-rush/physics'
import { drive, driveFlatOut } from './bot-lap'
import { compileCustomTrack, exportCustomTrack, importCustomTrack, roadKey, sanitizeCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { insertSection, moveSection, removeBranch, removeSection, walkCustomLines } from '#shared/utils/nitro-rush/custom-forks'
import { obstacleFault, obstacleMarks, obstacleSpotAt } from '#shared/utils/nitro-rush/custom-obstacles'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { OBSTACLE_KINDS, type Obstacle } from '#shared/utils/nitro-rush/obstacles'
import { Track, wrapAngle } from '#shared/utils/nitro-rush/track'

const DT = 1 / PHYSICS_HZ
const COAST: CarInput = { throttle: 0, brake: 0, steer: 0, drift: false }
const SPRINT: SectionId[] = ['straight-20', 'start', 'straight-200', 'straight-200', 'finish', 'straight-200']

const course = (obstacles?: Obstacle[], sections = SPRINT): CustomTrack => ({ id: 'custom-obstacles', name: 'Obstacles', closed: false, sections, ...obstacles ? { obstacles } : {} })
const on = (kind: Obstacle['kind'], along: number, lateral = 0, extra: Partial<Obstacle> = {}): Obstacle => ({ kind, line: 0, at: 2, along, lateral, ...extra })

function trackWith(...obstacles: Obstacle[]) {
    const { def, error } = compileCustomTrack(course(obstacles))
    if (!def) throw new Error(error ?? 'no track')
    return new Track(def)
}

describe('stored obstacles', () => {
    it('keeps a course without obstacles on the road key it always had', () => {
        const t = course()
        expect(roadKey(t)).toBe(JSON.stringify([false, SPRINT, []]))
        expect(roadKey({ ...t, obstacles: [] })).toBe(roadKey(t))
    })

    it('puts obstacles in the road key, whatever order they come in', () => {
        const a = on('barrel', 40)
        const b = on('block', 120, 3, { rot: 90 })
        expect(roadKey(course([a]))).not.toBe(roadKey(course()))
        expect(roadKey(course([a, b]))).toBe(roadKey(course([b, a])))
        expect(roadKey(course([{ ...a, lateral: 1 }]))).not.toBe(roadKey(course([a])))
    })

    it('drops junk and obstacles on sections that are not there', () => {
        const t = sanitizeCustomTrack({
            ...course(),
            obstacles: [on('barrel', 40), { ...on('barrel', 40), at: 99 }, { ...on('barrel', 40), kind: 'piano' }, { ...on('oil', 50), along: Number.NaN }, { ...on('barrel', 60), rot: 90 }, 'x']
        })
        expect(t?.obstacles).toEqual([on('barrel', 40), on('barrel', 60)])
        expect(sanitizeCustomTrack({ ...course(), obstacles: 'nope' })).toBeNull()
        expect(sanitizeCustomTrack({ ...course(), obstacles: [] })?.obstacles).toBeUndefined()
    })

    it('exports and imports them', () => {
        const t = course([on('tyres', 80, -4), on('block', 20, 2, { rot: 90 }), on('cones', 40, 2)])
        const back = importCustomTrack(exportCustomTrack(t), 'custom-back')
        expect(back.track?.obstacles).toEqual(t.obstacles)
        expect(exportCustomTrack(course())).not.toContain('obstacles')
    })
})

describe('section edits', () => {
    const t = course([on('barrel', 40), { ...on('barrel', 10), at: 3 }])

    it('moves obstacles on with their section when one goes in before it', () => {
        expect(insertSection(t, 0, 2, 'straight-60').obstacles!.map(o => o.at)).toEqual([3, 4])
        expect(insertSection(t, 0, 4, 'straight-60').obstacles!.map(o => o.at)).toEqual([2, 3])
    })

    it('drops the obstacles of a section taken off, and moves the rest back', () => {
        expect(removeSection(t, 0, 2).obstacles).toEqual([{ ...on('barrel', 10), at: 2 }])
        expect(removeSection(removeSection(t, 0, 2), 0, 2).obstacles).toBeUndefined()
    })

    it('keeps obstacles on their section when it moves', () => {
        expect(moveSection(t, 0, 2, 3).obstacles!.map(o => o.at)).toEqual([3, 2])
    })

    it('drops the obstacles of a branch taken away', () => {
        const forked: CustomTrack = {
            id: 'custom-fork', name: 'Fork', closed: false,
            sections: ['straight-20', 'start', 'split-right', 'straight-200', 'finish', 'straight-200'],
            branches: [{ sections: ['straight-100'], from: { branch: 0, at: 2 }, to: null }],
            obstacles: [on('barrel', 50, 0, { at: 3 }), { ...on('barrel', 50), line: 1, at: 0 }]
        }
        expect(removeBranch(forked, 1).obstacles).toEqual([on('barrel', 50, 0, { at: 2 })])
    })
})

describe('where an obstacle may stand', () => {
    const fault = (...obstacles: Obstacle[]) => compileCustomTrack(course(obstacles)).error

    it('takes obstacles on plain road', () => {
        expect(fault(on('barrel', 60), on('block', 100), on('oil', 140, 4), on('tyres', 180, -6), on('bumper', 60, 6), on('cones', 120, -5))).toBeNull()
    })

    it('refuses one on a line, near one, or on the grid', () => {
        expect(fault({ ...on('barrel', 10), at: 1 })).toMatch(/plain road/)
        expect(fault(on('block', 0, 0, { rot: 90 }))).toMatch(/too close to the start line/)
        expect(fault(on('block', 199.5, 0, { at: 3, rot: 90 }))).toMatch(/too close to the finish line/)
        expect(fault(on('barrel', 0))).toBeNull()
    })

    it('refuses one sticking into the wall', () => {
        expect(fault(on('block', 100, 9))).toMatch(/wall/)
        expect(fault(on('block', 100, 9, { rot: 90 }))).toBeNull()
    })

    it('refuses solid obstacles that close the road off, but not ones you can smash through', () => {
        expect(fault(on('block', 100, -5), on('block', 102, 5))).toMatch(/gap/)
        expect(fault(on('block', 100, -5), on('block', 120, 5))).toBeNull()
        expect(fault(on('barrel', 100, -2), on('barrel', 100, 0), on('barrel', 100, 2), on('block', 100, -6), on('block', 100, 6))).toBeNull()
    })

    it('refuses one on a jump ramp or past its section', () => {
        const jump: SectionId[] = ['straight-20', 'start', 'straight-100', 'jump-ramp', 'empty-20', 'landing-ramp', 'straight-100', 'finish', 'straight-200']
        expect(compileCustomTrack(course([{ ...on('barrel', 2), at: 3 }], jump)).error).toMatch(/jump ramp/)
        expect(fault(on('barrel', 230))).toMatch(/past the end/)
    })

    it('tells the builder the same', () => {
        expect(obstacleFault(course(), on('barrel', 60))).toBeNull()
        expect(obstacleFault(course(), on('block', 0, 0, { rot: 90 }))).toMatch(/start line/)
        expect(obstacleFault(course([on('block', 100, -5)]), on('block', 102, 5))).toMatch(/gap/)
        // An unfinished course still says when it won't fit its section.
        expect(obstacleFault(course(undefined, ['straight-20', 'start', 'straight-200']), on('barrel', 300))).toMatch(/past the end/)
    })

    it('snaps a click on the map to a spot on a section', () => {
        const walks = walkCustomLines(course())
        const [x, z] = walks[0]!.pts[walks[0]!.pieceStarts[2]! + 20]!
        const spot = obstacleSpotAt(walks, 0, x + 3.3, z)
        expect(spot).toMatchObject({ line: 0, at: 2 })
        expect(spot!.along % 2).toBe(0)
        expect(Math.abs(spot!.lateral)).toBe(3)
        expect(obstacleSpotAt(walks, 0, x + 40, z)).toBeNull()
        const mark = obstacleMarks(walks, [{ kind: 'barrel', line: 0, ...spot! }])[0]!
        expect(Math.hypot(mark.x - x - 3.3, mark.z - z)).toBeLessThan(2)
    })
})

describe('obstacles in the physics', () => {
    const S = 140

    /** A car `before` metres short of the obstacle at `along`, doing `speed` down the road at `lateral`. */
    function run(track: Track, before: number, speed: number, lateral = 0) {
        const car = createCar(track, track.startS + 10 + S - before, lateral)
        car.speed = speed
        return car
    }

    it('knocks a barrel away for a share of the speed, once', () => {
        const track = trackWith(on('barrel', S))
        const car = run(track, 10, 40)
        const knocked: number[] = []
        for (let i = 0; i < PHYSICS_HZ; i++) {
            const before = car.speed
            const ev = stepCar(car, COAST, track, DT)
            if (ev.knocked.length) {
                knocked.push(...ev.knocked)
                expect(car.speed / before).toBeCloseTo(1 - OBSTACLE_KINDS.barrel.slow, 2)
            }
        }
        expect(knocked).toEqual([0])
        expect(car.knocked.has(0)).toBe(true)
        expect(car.proj.s).toBeGreaterThan(track.startS + 10 + S)
    })

    it('blows an explosive barrel up under the car', () => {
        const track = trackWith(on('explosive', S))
        const car = run(track, 10, 40)
        let blasted = false
        let rose = 0
        for (let i = 0; i < PHYSICS_HZ; i++) {
            const ev = stepCar(car, COAST, track, DT)
            blasted ||= ev.blasted
            rose = Math.max(rose, car.y - car.proj.y)
        }
        expect(blasted).toBe(true)
        expect(rose).toBeGreaterThan(0.3)
        expect(car.speed).toBeLessThan(40 * (1 - OBSTACLE_KINDS.explosive.slow) + 1)
    })

    it('stops the car at a block like a wall', () => {
        const track = trackWith(on('block', S))
        const car = run(track, 10, 30)
        let impact = 0
        for (let i = 0; i < PHYSICS_HZ; i++) impact = Math.max(impact, stepCar(car, COAST, track, DT).wallImpact)
        expect(impact).toBeGreaterThan(20)
        expect(car.proj.s).toBeLessThan(track.startS + 10 + S - 1)
        expect(car.speed).toBeLessThan(2)
    })

    it('bounces it softer off tyres, and off a bumper at the speed it came in', () => {
        const tyres = trackWith(on('tyres', S))
        const soft = run(tyres, 10, 30)
        for (let i = 0; i < PHYSICS_HZ / 2; i++) stepCar(soft, COAST, tyres, DT)
        expect(soft.speed).toBeLessThan(-5)
        const bumper = trackWith(on('bumper', S))
        const pinball = run(bumper, 10, 30)
        let hit = false
        for (let i = 0; i < PHYSICS_HZ / 2 && !hit; i++) hit = stepCar(pinball, COAST, bumper, DT).obstacleHit === 'bumper'
        expect(hit).toBe(true)
        expect(Math.abs(pinball.speed)).toBeGreaterThan(25)
    })

    it('lets a car in the air over a block clear it', () => {
        const track = trackWith(on('block', S))
        const car = run(track, 10, 30)
        car.airborne = true
        car.y += 3
        car.vy = 4
        let impact = 0
        for (let i = 0; i < PHYSICS_HZ / 2; i++) impact = Math.max(impact, stepCar(car, COAST, track, DT).wallImpact)
        expect(impact).toBe(0)
        expect(car.proj.s).toBeGreaterThan(track.startS + 10 + S)
    })

    it('cuts the grip on oil', () => {
        const slide = (track: Track) => {
            const car = run(track, 2, 30)
            const travel = car.travel
            let slip = 0
            for (let i = 0; i < PHYSICS_HZ / 2; i++) {
                stepCar(car, { ...COAST, steer: 1 }, track, DT)
                slip = Math.max(slip, Math.abs(slipAngle(car)))
            }
            return { slip, turned: Math.abs(wrapAngle(car.travel - travel)), car }
        }
        const dry = slide(trackWith())
        const oily = slide(trackWith(on('oil', S)))
        expect(oily.car.oilTime).toBeGreaterThan(0)
        // The path barely bends while the nose swings round: the car slides.
        expect(oily.turned).toBeLessThan(dry.turned * 0.5)
        expect(oily.slip).toBeGreaterThan(dry.slip)
    })
})

describe('ghosts and obstacles', () => {
    it('fails a ghost that drives through a block, and passes the bot steering round it', () => {
        const plain = trackWith()
        const straight = driveFlatOut(plain, 60)
        expect(ghostDrivesTrack(plain, straight)).toBe(true)
        expect(ghostDrivesTrack(trackWith(on('block', 100)), straight)).toBe(false)
        expect(ghostDrivesTrack(trackWith(on('block', 100, 6)), straight)).toBe(true)
        // Barrels and oil don't stop a car, so driving through them is fine.
        expect(ghostDrivesTrack(trackWith(on('barrel', 100), on('oil', 160)), straight)).toBe(true)
        const blocked = trackWith(on('block', 100, -4), on('tyres', 190, 5))
        expect(ghostDrivesTrack(blocked, drive(blocked))).toBe(true)
    })
})

describe('danger boards', () => {
    it('warns on both walls before each bunch of obstacles, once per bunch', () => {
        const track = trackWith(on('barrel', 100), on('cones', 110, 3), on('block', 20, 0, { at: 3 }))
        const line = track.branches[0]!
        const firsts = [line.obstacles[0]!.s, line.obstacles[2]!.s]
        const boards = tracksideLayout(track).hazardSigns
        for (const first of firsts) {
            const before = boards.filter(f => f.s < first && f.s > first - 50)
            expect(new Set(before.map(f => f.side)).size).toBe(2)
        }
        // The barrel and the cone ten metres on share one warning.
        expect(boards.filter(f => f.s > line.obstacles[0]!.s && f.s < line.obstacles[1]!.s)).toHaveLength(0)
        expect(tracksideLayout(trackWith()).hazardSigns).toHaveLength(0)
    })
})
