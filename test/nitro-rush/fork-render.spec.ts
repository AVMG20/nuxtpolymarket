import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { minimapPlan } from '../../app/utils/nitro-rush/minimap'
import { ribbon, roadClearance, roadLeft, roadRight, sweep } from '../../app/utils/nitro-rush/road-geometry'
import { bridgeSprintDef, forkLoopDef, forkSprintDef, Path } from './fork-courses'
import { trackClearanceFault } from '#shared/utils/nitro-rush/road-checks'
import { Track, TrackLine, type TrackDef } from '#shared/utils/nitro-rush/track'

const loop = new Track(forkLoopDef())
const sprint = new Track(forkSprintDef())
const main = sprint.branches[0]!
const branch = sprint.branches[1]!
/** The sprint's shared deck, on the main line's left and the branch's right. */
const deck = main.open[0]!

/** Each triangle's centroid, as distance along `line`. */
function triangleSs(geo: THREE.BufferGeometry, line: Track['branches'][number]) {
    const pos = geo.getAttribute('position')
    const index = geo.getIndex()!
    const out: number[] = []
    for (let t = 0; t < index.count; t += 3) {
        let x = 0
        let z = 0
        for (let k = 0; k < 3; k++) {
            x += pos.getX(index.getX(t + k)) / 3
            z += pos.getZ(index.getX(t + k)) / 3
        }
        out.push(line.project(x, z).s)
    }
    return out
}

describe('Nitro Rush shared decks', () => {
    it('runs the seam from the fork point out to the nose, where it meets the wall', () => {
        expect(deck.side).toBe(-1)
        expect(main.deckEdge(deck.from, -1)).toBeCloseTo(0, 1)
        expect(main.deckEdge(deck.to - 1e-3, -1)).toBeCloseTo(main.wallAt(deck.to), 1)
        let last = -Infinity
        for (let s = deck.from; s < deck.to; s += 2) {
            const edge = main.deckEdge(s, -1)
            expect(edge).toBeGreaterThanOrEqual(last - 1e-6)
            last = edge
        }
        expect(main.deckEdge(deck.to + 1, -1)).toBe(Infinity)
        expect(main.deckEdge(deck.from + 10, 1)).toBe(Infinity)
    })

    it('puts the seam in the same place seen from either road', () => {
        for (const s of [deck.from + 15, deck.from + 35, deck.from + 55]) {
            const p = main.pointAt(s)
            const lat = -main.deckEdge(s, -1)
            const x = p.x - p.tz * lat
            const z = p.z + p.tx * lat
            const q = branch.project(x, z)
            expect(q.lateral).toBeCloseTo(branch.deckEdge(q.s, 1), 1)
        }
    })

    it('stops the roads at the seam so they never overlap', () => {
        const road = ribbon(main, 0, main.length, roadLeft, roadRight, 0, 10)
        const pos = road.getAttribute('position')
        for (let i = 0; i < pos.count; i++) {
            const p = main.project(pos.getX(i), pos.getZ(i))
            if (p.s > deck.from + 0.5 && p.s < deck.to - 0.5) expect(-p.lateral).toBeLessThanOrEqual(main.deckEdge(p.s, -1) + 0.05)
        }
    })

    it('cuts a clipped road\'s texture off at the seam instead of squeezing it', () => {
        const road = ribbon(main, deck.from + 20, deck.from + 22, roadLeft, roadRight, 0, 10)
        const uv = road.getAttribute('uv')
        const lefts = Array.from({ length: uv.count / 2 }, (_, k) => uv.getX(k * 2))
        // The left edge sits at the seam, short of the road's own left side; the right edge is the full road.
        for (const u of lefts) expect(u).toBeGreaterThan(0.3)
        expect(uv.getX(1)).toBe(1)
    })

    it('leaves the walls out over the shared deck, and only on its side', () => {
        const left = triangleSs(sweep(main, -1, 0, [[0, 0], [0, 1]]), main)
        const right = triangleSs(sweep(main, 1, 0, [[0, 0], [0, 1]]), main)
        expect(left.some(s => s > deck.from + 0.5 && s < deck.to - 0.5)).toBe(false)
        expect(left.some(s => s > deck.to + 1 && s < deck.to + 5)).toBe(true)
        expect(right.some(s => s > deck.from + 0.5 && s < deck.to - 0.5)).toBe(true)
    })

    it('points each cushion from its nose or tail back between the walls', () => {
        const [nose] = sprint.cushions
        const p = main.pointAt(deck.to + 5)
        expect(nose!.tx * p.tx + nose!.tz * p.tz).toBeGreaterThan(0.9)
        // The fork loop's branch 1 rejoins the main line: its tail's walls lie upstream.
        const join = loop.branches[1]!.open.find(o => o.partner === 0 && o.from > 100)!
        const tail = loop.cushions.find(c => Math.hypot(c.x - loop.branches[1]!.pointAt(join.from).x, c.z - loop.branches[1]!.pointAt(join.from).z) < 15)!
        const q = loop.branches[1]!.pointAt(join.from)
        expect(tail.tx * q.tx + tail.tz * q.tz).toBeLessThan(-0.9)
    })
})

describe('Nitro Rush scenery round a line\'s ends', () => {
    it('measures from an open line\'s end, not from its last stretch run on', () => {
        const line = new TrackLine({ points: [[0, 0], [0, -50], [0, -100]], halfWidth: 9, wallOffset: 10.6, closed: false, runUp: 0, runOff: 0 })
        expect(roadClearance([line], 0, -160)).toBeCloseTo(60 - 10.6)
        expect(roadClearance([line], 30, -50)).toBeCloseTo(30 - 10.6)
    })
})

describe('Nitro Rush minimap on a forked course', () => {
    it('draws every line and every finish', () => {
        const plan = minimapPlan(sprint)
        expect(plan.road.match(/M/g)).toHaveLength(2)
        expect(plan.finishes).toHaveLength(2)
        expect(minimapPlan(loop).road.match(/M/g)).toHaveLength(4)
        expect(minimapPlan(loop).finishes).toHaveLength(0)
    })
})

describe('Nitro Rush clearance across branches', () => {
    /** The fork sprint with its branch moved `shift` metres across, and laid at `heights`. */
    const sideBySide = (shift: number): TrackDef => {
        const b = new Path(0, -100).straight(2).shift(-1, shift)
        b.straight(560)
        return { ...forkSprintDef(), branches: [{ points: b.pts, from: { branch: 0, at: 100 }, to: 'finish', runOff: 150 }] }
    }

    it('allows the shared deck and the walls running together past each nose and tail', () => {
        expect(trackClearanceFault(loop)).toBeNull()
        expect(trackClearanceFault(sprint)).toBeNull()
        expect(trackClearanceFault(new Track(bridgeSprintDef()))).toBeNull()
    })

    it('catches a branch that never parts from the road it left', () => {
        expect(trackClearanceFault(new Track(sideBySide(15)))).toMatch(/passes 0.0 m from another stretch/)
        expect(trackClearanceFault(new Track(sideBySide(30)))).toBeNull()
    })

    it('catches a branch that crosses another road on the level', () => {
        const flat = bridgeSprintDef()
        delete flat.branches![0]!.heights
        expect(trackClearanceFault(new Track(flat))).toMatch(/passes 0.0 m from another stretch/)
    })
})
