import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { AdaptiveResolution } from '../../app/utils/nitro-rush/resolution'
import { cardExtent, cardWalk, fitView, PAINT_BUDGET_MS, PAINT_REST_MS, VIEW_DIR } from '../../app/utils/nitro-rush/section-thumbs'
import { draftTrackDef, sectionWalk, SECTIONS, type SectionId } from '#shared/utils/nitro-rush/custom'
import { Track } from '#shared/utils/nitro-rush/track'

const ASPECT = 1.6

/** Where a point lands in the window: within ±1 on both axes is on the card. */
function onCard(p: THREE.Vector3, { centre, halfWidth, halfHeight }: ReturnType<typeof fitView>) {
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), VIEW_DIR).normalize()
    const up = new THREE.Vector3().crossVectors(VIEW_DIR, right).normalize()
    const rel = p.clone().sub(centre)
    return [rel.dot(right) / halfWidth, rel.dot(up) / halfHeight]
}

describe('section thumbnail framing', () => {
    const shapes = {
        'long and flat': [new THREE.Vector3(-100, 0, 0), new THREE.Vector3(100, 0, 0)],
        'tall': [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 44, 0)],
        'off to one side': [new THREE.Vector3(500, 10, -300), new THREE.Vector3(540, 12, -280), new THREE.Vector3(520, 0, -320)]
    }

    for (const [name, points] of Object.entries(shapes)) {
        it(`keeps a shape that is ${name} on the card, in the card's shape`, () => {
            const view = fitView(points, VIEW_DIR, ASPECT)
            expect(view.halfWidth / view.halfHeight).toBeCloseTo(ASPECT)
            for (const p of points) {
                for (const c of onCard(p, view)) expect(Math.abs(c)).toBeLessThan(1)
            }
        })
    }

    it('fills the card along the shape\'s longer way, leaving only the margin', () => {
        const points = shapes['long and flat']
        const view = fitView(points, VIEW_DIR, ASPECT, 0.1)
        const reach = Math.max(...points.flatMap(p => onCard(p, view)).map(Math.abs))
        expect(reach).toBeCloseTo(1 / 1.1)
    })

    it('frames every section with its road and end marker on the card', () => {
        for (const id of Object.keys(SECTIONS) as SectionId[]) {
            const walk = cardWalk(id)
            const track = new Track(draftTrackDef(walk, false)!)
            const view = fitView(cardExtent(track, walk.end), VIEW_DIR, ASPECT)
            expect(view.halfHeight, id).toBeGreaterThan(0)
            const marker = new THREE.Vector3(walk.end.x, walk.end.y, walk.end.z)
            for (const c of onCard(marker, view)) expect(Math.abs(c), id).toBeLessThan(1)
            for (let i = 0; i < track.n; i++) {
                for (const c of onCard(new THREE.Vector3(track.xs[i], track.ys[i], track.zs[i]), view)) expect(Math.abs(c), id).toBeLessThan(1)
            }
        }
    })

    it('stretches heights so a climb reads, but leaves a looping round', () => {
        expect(cardWalk('ramp-down').ys[0]!).toBeGreaterThan(sectionWalk('ramp-down').ys[0]!)
        expect(cardWalk('ramp-down').end.y).toBeCloseTo(0)
        expect(cardWalk('looping-left').ys).toEqual(sectionWalk('looping-left').ys)
        expect(cardWalk('corkscrew-right').ys).toEqual(sectionWalk('corkscrew-right').ys)
    })
})

describe('section thumbnail pacing', () => {
    it('never makes the race back off its resolution, even when a card takes well over the budget', () => {
        const frame = 1 / 60
        const framesPerRest = Math.round(PAINT_REST_MS / 1000 / frame)
        const slowPaint = (PAINT_BUDGET_MS + 36) / 1000
        const r = new AdaptiveResolution(2)
        const before = r.ratio
        let t = 0
        // Far more painting than the 39 cards ever need.
        for (let i = 0; i < 2000; i++) {
            const dt = i % framesPerRest === 0 ? slowPaint : frame
            t += dt
            r.sample(dt, t)
        }
        expect(r.ratio).toBe(before)
    })
})
