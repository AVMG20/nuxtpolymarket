import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { poseCar } from '../../app/utils/nitro-rush/car-pose'
import { PHYSICS_HZ } from '../../app/utils/nitro-rush/config'
import { botInput, createCar, stepCar } from '../../app/utils/nitro-rush/physics'
import { compileCustomTrack, rideTag, sectionFault, walkCustomTrack, type CustomTrack, type SectionId } from '#shared/utils/nitro-rush/custom'
import { ghostDrivesTrack } from '#shared/utils/nitro-rush/drive-check'
import { Track, wallFoot } from '#shared/utils/nitro-rush/track'
import { drive, trackOf } from './bot-lap'

const LEFT: SectionId[] = ['bank-left', 'corkscrew-left', 'bank-flat']
const RIGHT: SectionId[] = ['bank-right', 'corkscrew-right', 'bank-flat']
const sprint = (sections: SectionId[]): SectionId[] => ['straight-20', 'start', 'straight-60', ...sections, 'straight-60', 'finish', 'straight-200']
const course = (sections: SectionId[]): CustomTrack => ({ id: 'custom-t', name: 'T', closed: false, sections: sprint(sections) })

/** The height of the road's lower edge at point `i`, measured out to the walls' outer foot. */
const lowEdge = (t: Track, i: number, foot = wallFoot(t.walls[i]!)) => t.ys[i]! - foot * Math.abs(t.right[i * 3 + 1]!)

describe('corkscrew placement', () => {
    it('only goes on a bank leaning its way', () => {
        expect(sectionFault('corkscrew-right', { bank: 25, grade: 0 })).toBeNull()
        expect(sectionFault('corkscrew-left', { bank: -25, grade: 0 })).toBeNull()
        expect(sectionFault('corkscrew-right', { bank: 0, grade: 0 })).toMatch(/starts and ends on a right bank: bank the road right first/)
        expect(sectionFault('corkscrew-right', { bank: -25, grade: 0 })).toMatch(/bank the road right first/)
        expect(sectionFault('corkscrew-left', { bank: 25, grade: 0 })).toMatch(/bank the road left first/)
        expect(sectionFault('corkscrew-left', { bank: -25, grade: 0.1 })).toMatch(/level the slope first/)
    })

    it('doesn\'t tag its row as banked, since it always is', () => {
        expect(rideTag('corkscrew-left', { bank: -25, grade: 0, halfWidth: 9 })).toBe('')
        expect(rideTag('straight-20', { bank: -25, grade: 0, halfWidth: 9 })).toBe('BANKED')
    })

    it('holds a finished course to the same rule', () => {
        expect(compileCustomTrack(course(['corkscrew-left'])).error).toMatch(/bank the road left first/)
        expect(compileCustomTrack(course(['bank-right', 'corkscrew-left', 'bank-flat'])).error).toMatch(/bank the road left first/)
        for (const sections of [LEFT, RIGHT]) expect(compileCustomTrack(course(sections)).error).toBeNull()
    })

    it('asks a jump for flat, unbanked road, naming what to level', () => {
        expect(sectionFault('jump', { bank: 0, grade: 0 })).toBeNull()
        expect(sectionFault('big-jump', { bank: 25, grade: 0 })).toBe('a jump needs flat, unbanked road: level the bank first')
        expect(sectionFault('jump', { bank: 0, grade: 0.1 })).toBe('a jump needs flat, unbanked road: level the slope first')
        expect(sectionFault('jump', { bank: -25, grade: 0.2 })).toBe('a jump needs flat, unbanked road: level the bank and the slope first')
    })
})

describe('corkscrew road', () => {
    it('keeps the whole road above the ground as it rolls', () => {
        for (const sections of [LEFT, RIGHT]) {
            const t = trackOf(false, sprint(sections))
            for (let i = 0; i < t.n; i++) expect(lowEdge(t, i), `${sections[1]} point ${i}`).toBeGreaterThanOrEqual(-0.01)
        }
    })

    it('leaves on the bank it came in on, at the height it found the road, with the course still on the ground', () => {
        for (const sections of [LEFT, RIGHT]) {
            const walk = walkCustomTrack(course(sections))
            expect(walk.rise).toBe(0)
            const i = sprint(sections).indexOf(sections[1]!)
            expect(walk.states[i + 1]!.bank).toBeCloseTo(walk.states[i]!.bank)
            const [from, to] = walk.rails[0]!
            expect(walk.ys[from]).toBeCloseTo(walk.ys[from - 1]!, 1)
            expect(walk.ys[to]).toBeCloseTo(walk.ys[from]!)
            for (const c of [0, 1, 2]) {
                expect(walk.ups[from]![c]).toBeCloseTo(walk.ups[from - 1]![c]!, 1)
                expect(walk.ups[to]![c]).toBeCloseTo(walk.ups[from]![c]!)
            }
        }
    })

    it('climbs without a kink at either end or anywhere along the way', () => {
        const { ys, rails } = walkCustomTrack(course(LEFT))
        const [from, to] = rails[0]!
        let sharpest = 0
        for (let i = from - 1; i < to; i++) sharpest = Math.max(sharpest, Math.abs(ys[i + 2]! - 2 * ys[i + 1]! + ys[i]!))
        // The tube's own curve at speed; a kink on a kicker's grade would read double this.
        expect(sharpest).toBeLessThan(0.2)
    })

    it('runs from a banked curve through the corkscrew into another, and that drives', () => {
        const sections = sprint(['bank-right', 'right-wide', 'corkscrew-right', 'right-wide', 'bank-flat'])
        const t = trackOf(false, sections)
        expect(t.rails).toHaveLength(1)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('runs one corkscrew straight into another on the same bank', () => {
        const t = trackOf(false, sprint(['bank-left', 'corkscrew-left', 'corkscrew-left', 'bank-flat']))
        expect(t.rails).toHaveLength(2)
        expect(ghostDrivesTrack(t, drive(t))).toBe(true)
    })

    it('carries the car on and off the rails without a jump, even out by the wall', () => {
        const t = trackOf(false, sprint(RIGHT))
        const [entry, exit] = t.rails[0]!
        for (const lateral of [-7, 0, 7]) {
            const car = createCar(t, entry - 30, lateral)
            car.speed = 40
            const here = new THREE.Vector3()
            const was = new THREE.Vector3()
            const quat = new THREE.Quaternion()
            const pose = (to: THREE.Vector3) => poseCar(t, {
                x: car.x, z: car.z, y: car.y, along: car.proj.s, lateral: car.proj.lateral, heading: car.heading,
                rel: car.rel, vy: car.vy, speed: car.speed, onRail: car.onRail, airborne: car.airborne
            }, to, quat)
            pose(was)
            const handoffs: number[] = []
            let onRail = false
            const dt = 1 / PHYSICS_HZ
            for (let i = 0; i < PHYSICS_HZ * 20 && car.proj.s < exit + 30; i++) {
                stepCar(car, car.onRail ? { throttle: 1, brake: 0, steer: 0, drift: false } : { ...botInput(car, t), steer: 0 }, t, dt)
                pose(here)
                if (car.onRail !== onRail) handoffs.push(here.distanceTo(was) / (car.speed * dt))
                onRail = car.onRail
                was.copy(here)
            }
            expect(handoffs, `lateral ${lateral}`).toHaveLength(2)
            expect(car.proj.s, `lateral ${lateral}`).toBeGreaterThan(exit)
            // The step across each end moves the car about as far as any other step.
            for (const moved of handoffs) expect(moved, `lateral ${lateral}`).toBeLessThan(1.15)
        }
    })
})
