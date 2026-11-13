import { describe, expect, it } from 'vitest'
import { adDeck, AD_LOOKS, TRACK_ADS } from '../../app/utils/nitro-rush/ads'
import { ORBIT_RADIUS } from '../../app/utils/nitro-rush/camera'
import { CLEAR_HEIGHT, DECK_DEPTH } from '../../app/utils/nitro-rush/road-geometry'
import {
    BILLBOARD_BOTTOM, BILLBOARD_HEIGHT, BILLBOARD_WIDTH, CHEVRON_HEIGHT, CHEVRON_LIFT, FLAG_POLE, HOARDING_HEIGHT, tracksideLayout, type Fixture
} from '../../app/utils/nitro-rush/trackside-spots'
import { NAV_CATALOG } from '#shared/utils/nav-catalog'
import { buildTrack, corner, start, straight, type TrackLayout } from '#shared/utils/nitro-rush/layout'
import { Track, WALL_HEIGHT, wallFoot } from '#shared/utils/nitro-rush/track'
import { TRACKS } from '#shared/utils/nitro-rush/tracks'

const courses = TRACKS.map(def => new Track(def))
const base = { group: 'circuits' as const, halfWidth: 9, wallOffset: 10.6, origin: { x: 0, z: 0, heading: 0 } }
const loop = (id: string, radius: number) => new Track(buildTrack({ ...base, id, name: id, pieces: [start, straight(140), corner('right', radius, 180), straight(160), corner('right', radius, 180)] } as TrackLayout))

/** Every piece of a course's signage as a column: where it stands, its foot and its top. */
function columns(track: Track) {
    const { billboards, chevrons, hoardings, flags, overheads } = tracksideLayout(track)
    // A wall fixture's own road is the surface under the wall it stands on.
    const on = (f: Fixture, h: number) => ({ x: f.x, z: f.z, foot: f.y, top: f.y + f.up[1] * h, road: f.y - f.up[1] * WALL_HEIGHT, own: f })
    return [
        ...billboards.map(b => ({ x: b.x, z: b.z, foot: Math.min(0, b.base), top: b.base + BILLBOARD_BOTTOM + BILLBOARD_HEIGHT, road: b.base, own: null })),
        ...chevrons.map(c => on(c, CHEVRON_LIFT + CHEVRON_HEIGHT)),
        ...hoardings.flat().map(h => on(h, HOARDING_HEIGHT)),
        ...flags.flat().map(f => on(f, FLAG_POLE)),
        ...overheads.map(o => ({ x: o.x, z: o.z, foot: o.y, top: o.y + CLEAR_HEIGHT, road: o.y, own: o as Fixture }))
    ]
}

/** The lines' points whose deck covers (x, z) on the plan, leaving out the stretch a fixture stands on. */
function roadPointsOver(track: Track, x: number, z: number, own: Fixture | null) {
    const out: number[] = []
    for (const line of track.branches) {
        for (let k = 0; k < line.n; k++) {
            if (own && line.branch === own.branch) {
                const d = Math.abs(line.cum[k]! - own.s)
                if ((line.closed ? Math.min(d, line.length - d) : d) < 40) continue
            }
            if (Math.hypot(line.xs[k]! - x, line.zs[k]! - z) < wallFoot(line.walls[k]!)) out.push(line.ys[k]!)
        }
    }
    return out
}

describe('Nitro Rush trackside signage', () => {
    it('keeps every sign within its own road\'s clearance', () => {
        for (const track of courses) {
            for (const c of columns(track)) expect(c.top - c.road, track.def.id).toBeLessThanOrEqual(CLEAR_HEIGHT + 1e-6)
        }
    })

    it('never stands a sign where another road passes through it, over it or under it', () => {
        for (const track of courses) {
            for (const c of columns(track)) {
                // Any road whose deck covers the sign's spot lies wholly above its top or below its foot, clearance and all.
                for (const y of roadPointsOver(track, c.x, c.z, c.own)) {
                    const above = y - DECK_DEPTH >= c.top - 1e-6
                    const below = y + CLEAR_HEIGHT <= c.foot + 1e-6
                    expect(above || below, `${track.def.id} at (${c.x.toFixed(0)}, ${c.z.toFixed(0)})`).toBe(true)
                }
            }
        }
    })

    it('keeps billboards out of the menu camera\'s orbit round a car on the road', () => {
        for (const track of courses) {
            for (const b of tracksideLayout(track).billboards) {
                for (const line of track.branches) {
                    const p = line.project(b.x, b.z)
                    if (p.s <= 0 || p.s >= line.length || Math.abs(line.pointAt(p.s).y - b.base) > 1) continue
                    expect(Math.abs(p.lateral) - BILLBOARD_WIDTH / 2, track.def.id).toBeGreaterThan(line.halfWidthAt(p.s) + ORBIT_RADIUS)
                }
            }
        }
    })

    it('stands a billboard beside a raised road on legs from its deck\'s height', () => {
        const raised = courses.flatMap(t => tracksideLayout(t).billboards).filter(b => b.base > 1)
        expect(raised.length).toBeGreaterThan(0)
        for (const b of raised) expect(b.base + BILLBOARD_BOTTOM).toBeGreaterThan(b.base)
    })

    it('puts chevrons on the outside wall of the bends only, redder the tighter the bend', () => {
        for (const [radius, grade] of [[30, 3], [45, 2], [75, 1]] as const) {
            const track = loop(`r${radius}`, radius)
            const { chevrons } = tracksideLayout(track)
            expect(chevrons.length, `radius ${radius}`).toBeGreaterThan(4)
            for (const c of chevrons) {
                expect(c.grade, `radius ${radius}`).toBe(grade)
                // Both bends turn right, so their outside is the left wall.
                expect(c.side).toBe(-1)
                const p = track.project(c.x, c.z)
                expect(track.curvature[track.segmentAt(p.s)]! + track.curvature[track.segmentAt(track.wrapS(p.s + 8))]!).toBeGreaterThan(0)
            }
        }
        expect(tracksideLayout(loop('wide', 160)).chevrons).toHaveLength(0)
    })

    it('never puts the same ad format twice running along a road', () => {
        for (const track of courses) {
            const { billboards, hoardings, flags } = tracksideLayout(track)
            // The flags lining the start and finish are their own thing, not a slot's ad.
            const ends = track.lapLines.filter(l => l.kind !== 'checkpoint')
            const gap = (branch: number, a: number, b: number) => {
                const line = track.branches[branch]!
                const d = Math.abs(a - b)
                return line.closed ? Math.min(d, line.length - d) : d
            }
            const slotFlags = flags.filter(c => !ends.some(l => l.branch === c[0]!.branch && gap(l.branch, l.s, c[0]!.s) <= 32))
            expect(slotFlags.length, track.def.id).toBeLessThan(flags.length)
            const ads = [
                ...billboards.map(b => ({ branch: b.branch, s: b.s, format: 'billboard' })),
                ...hoardings.map(bay => ({ branch: bay[0]!.branch, s: bay[0]!.s, format: 'hoarding' })),
                ...slotFlags.map(c => ({ branch: c[0]!.branch, s: c[0]!.s, format: 'flags' }))
            ]
            for (const line of track.branches) {
                const run = ads.filter(a => a.branch === line.branch).sort((a, b) => a.s - b.s).map(a => a.format)
                for (let i = 1; i < run.length; i++) expect(run[i], `${track.def.id} line ${line.branch}: ${run.join(' ')}`).not.toBe(run[i - 1])
            }
        }
    })

    it('fills the straights with hoardings and banners, clear of the bends', () => {
        const track = loop('hoardings', 40)
        const { hoardings, overheads } = tracksideLayout(track)
        expect(hoardings.length).toBeGreaterThan(0)
        expect(overheads.length).toBeGreaterThan(0)
        for (const h of [...hoardings.flat(), ...overheads]) expect(track.curvature[track.segmentAt(track.project(h.x, h.z).s)]!).toBeLessThan(0.004)
    })
})

describe('Nitro Rush ads', () => {
    const routes = NAV_CATALOG.filter(s => !s.adminOnly).flatMap(s => s.items.map(i => i.to))

    it('advertises only pages that still exist', () => {
        for (const to of Object.keys(AD_LOOKS)) expect(routes, to).toContain(to)
    })

    it('gives every game an ad, a new one included, but not the race itself', () => {
        const titles = TRACK_ADS.map(a => a.title)
        expect(titles).toContain('DEAD FRONT')
        expect(titles).toContain('POLYNUX BANK')
        expect(titles).not.toContain('NITRO RUSH')
        expect(new Set(titles).size).toBe(titles.length)
    })

    it('deals a dozen ads in turn', () => {
        const deal = adDeck()
        const first = Array.from({ length: 12 }, deal)
        expect(new Set(first).size).toBe(12)
        expect(Array.from({ length: 12 }, deal)).toEqual(first)
    })
})
