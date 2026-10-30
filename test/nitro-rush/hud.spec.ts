import { describe, expect, it } from 'vitest'
import { buildTrack, finish, jump, start, straight } from '#shared/utils/nitro-rush/layout'
import { headingOf, Track } from '#shared/utils/nitro-rush/track'
import { findTrack, TRACKS } from '#shared/utils/nitro-rush/tracks'
import { ENGINE_TOP_SPEED, KMH_PER_SPEED, NITRO_TOP_SPEED_MULT } from '../../app/utils/nitro-rush/config'
import { fitPlan, markerRotation, MINIMAP_VIEW, minimapPlan, toMap } from '../../app/utils/nitro-rush/minimap'
import { DIAL_MAX_KMH, DIAL_NITRO_KMH, dialAngle, dialArc, dialLabels, dialTicks, needleRotation } from '../../app/utils/nitro-rush/speed-dial'

const base = { group: 'sprints' as const, halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 } }

/** Every coordinate in an SVG path, as [x, y] pairs. */
const pathPoints = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])])

describe('minimap', () => {
    it('fits a plan inside the view box with its aspect kept, centred', () => {
        const fit = fitPlan([0, 200], [0, 100])
        expect(toMap(fit, 0, 50)[0]).toBeCloseTo(8)
        expect(toMap(fit, 200, 50)[0]).toBeCloseTo(MINIMAP_VIEW - 8)
        expect(toMap(fit, 100, 50)).toEqual([MINIMAP_VIEW / 2, MINIMAP_VIEW / 2])
        // The short side keeps the same scale, so it sits in the middle.
        expect(toMap(fit, 100, 0)[1]).toBeCloseTo(MINIMAP_VIEW / 2 - 21)
    })

    it('keeps every course inside the view box', () => {
        for (const def of TRACKS) {
            const points = pathPoints(minimapPlan(new Track(def)).road)
            expect(points.length).toBeGreaterThan(2)
            for (const [x, y] of points) {
                expect(x).toBeGreaterThanOrEqual(0)
                expect(x).toBeLessThanOrEqual(MINIMAP_VIEW)
                expect(y).toBeGreaterThanOrEqual(0)
                expect(y).toBeLessThanOrEqual(MINIMAP_VIEW)
            }
        }
    })

    it('closes a loop and marks only its start line', () => {
        const plan = minimapPlan(new Track(findTrack('polytown-oval')!))
        expect(plan.road.endsWith('Z')).toBe(true)
        expect(plan.finish).toBeNull()
    })

    it('marks a sprint\'s start and finish apart, and breaks its road over a jump', () => {
        const track = new Track(buildTrack({ ...base, id: 'hop', name: 'Hop', closed: false, pieces: [straight(30), start, straight(200), jump(4, 30), straight(200), finish, straight(60)] }))
        const plan = minimapPlan(track)
        expect(plan.road.match(/M/g)).toHaveLength(2)
        expect(plan.road.endsWith('Z')).toBe(false)
        expect(plan.finish).not.toBeNull()
        const mid = (l: { x1: number, y1: number, x2: number, y2: number }) => [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2]
        const [sx, sy] = mid(plan.start)
        const [fx, fy] = mid(plan.finish!)
        expect(Math.hypot(fx! - sx!, fy! - sy!)).toBeGreaterThan(20)
    })

    it('turns the car marker to face the way it drives', () => {
        // The marker is drawn nose up (-y); SVG's rotate(θ) takes that to (sin θ, -cos θ).
        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 1]] as const) {
            const theta = markerRotation(headingOf(dx, dz)) * Math.PI / 180
            const len = Math.hypot(dx, dz)
            expect(Math.sin(theta)).toBeCloseTo(dx / len)
            expect(-Math.cos(theta)).toBeCloseTo(dz / len)
        }
    })
})

describe('speed dial', () => {
    it('reaches past nitro\'s top speed, with the nitro zone from the engine\'s', () => {
        expect(DIAL_MAX_KMH).toBeGreaterThanOrEqual(ENGINE_TOP_SPEED * NITRO_TOP_SPEED_MULT * KMH_PER_SPEED)
        expect(DIAL_NITRO_KMH).toBeLessThan(DIAL_MAX_KMH)
    })

    it('sweeps clockwise from low left over the top to low right, and clamps', () => {
        const at = (kmh: number) => [Math.cos(dialAngle(kmh)), Math.sin(dialAngle(kmh))]
        expect(at(0)[0]).toBeLessThan(0)
        expect(at(0)[1]).toBeGreaterThan(0)
        expect(at(DIAL_MAX_KMH / 2)[1]).toBeCloseTo(-1)
        expect(at(DIAL_MAX_KMH)[0]).toBeGreaterThan(0)
        expect(at(DIAL_MAX_KMH)[1]).toBeGreaterThan(0)
        expect(dialAngle(-20)).toBe(dialAngle(0))
        expect(dialAngle(DIAL_MAX_KMH * 2)).toBe(dialAngle(DIAL_MAX_KMH))
        expect(needleRotation(DIAL_MAX_KMH / 2)).toBeCloseTo(270)
    })

    it('draws no arc at a standstill and takes the long way past half the dial', () => {
        expect(dialArc(0, 0, 40)).toBe('')
        expect(dialArc(0, DIAL_MAX_KMH * 0.2, 40)).toContain(' 0 0 1 ')
        expect(dialArc(0, DIAL_MAX_KMH * 0.9, 40)).toContain(' 0 1 1 ')
    })

    it('ticks every 20 km/h and labels the hundreds', () => {
        const ticks = dialTicks(40)
        expect(ticks).toHaveLength(DIAL_MAX_KMH / 20 + 1)
        expect(ticks.filter(t => t.major)).toHaveLength(DIAL_MAX_KMH / 100 + 1)
        expect(dialLabels(30).map(l => l.text)).toEqual(Array.from({ length: DIAL_MAX_KMH / 100 + 1 }, (_, i) => String(i * 100)))
    })
})
