import { describe, expect, it } from 'vitest'
import { DF_BARRICADE_PLANKS, DF_MAP, DF_UPPER_Y, dfInteractables } from '../../shared/utils/dead-front/map'
import type { DfNavNode, DfSolid } from '../../shared/utils/dead-front/map'
import { dfBodyFits, dfBuildCollision, dfGroundHeight, dfMoveBody, dfRaycast } from '../../shared/utils/dead-front/physics'
import { DF_PERK_IDS } from '../../shared/utils/dead-front/perks'
import { DF_PLAYER } from '../../shared/utils/dead-front/constants'
import type { Vec3 } from '../../shared/utils/dead-front/types'

const map = DF_MAP
const allOpen = new Set(map.doors.map(d => d.id))
const openWorld = dfBuildCollision(map, allOpen)
const closedWorld = dfBuildCollision(map, new Set())
const zoneIds = new Set(map.zones.map(z => z.id))
const nodes = map.nav.nodes

function reachable(from: number, opts: { doors: boolean, windows: boolean }): Set<number> {
    const adj = new Map<number, number[]>()
    for (const l of map.nav.links) {
        if (l.door && !opts.doors) continue
        if (l.barricade && !opts.windows) continue
        if (!adj.has(l.a)) adj.set(l.a, [])
        if (!adj.has(l.b)) adj.set(l.b, [])
        adj.get(l.a)!.push(l.b)
        adj.get(l.b)!.push(l.a)
    }
    const seen = new Set([from])
    const queue = [from]
    while (queue.length) {
        const c = queue.shift()!
        for (const n of adj.get(c) ?? []) {
            if (!seen.has(n)) {
                seen.add(n)
                queue.push(n)
            }
        }
    }
    return seen
}

function nearestNode(p: Vec3, filter: (n: DfNavNode) => boolean = () => true): DfNavNode {
    let best = nodes[0]!
    let bd = Infinity
    for (const n of nodes) {
        if (!filter(n)) continue
        const d = Math.hypot(n.pos.x - p.x, (n.pos.y - p.y) * 2, n.pos.z - p.z)
        if (d < bd) {
            bd = d
            best = n
        }
    }
    return best
}

const startNode = nearestNode(map.playerSpawns[0]!, n => !n.outside)

describe('Sainte-Croix layout', () => {
    it('has well-formed solids inside the bounds', () => {
        for (const s of map.solids) {
            expect(s.min.x).toBeLessThan(s.max.x)
            expect(s.min.y).toBeLessThan(s.max.y)
            expect(s.min.z).toBeLessThan(s.max.z)
            expect(s.min.x).toBeGreaterThanOrEqual(map.bounds.min.x - 1.01)
            expect(s.max.x).toBeLessThanOrEqual(map.bounds.max.x + 1.01)
            expect(s.min.z).toBeGreaterThanOrEqual(map.bounds.min.z - 1.01)
            expect(s.max.z).toBeLessThanOrEqual(map.bounds.max.z + 1.01)
            expect(s.max.y).toBeLessThanOrEqual(map.bounds.max.y + 0.01)
        }
    })

    it('has unique ids and known zones everywhere', () => {
        const ids = dfInteractables(map).map(i => i.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const i of dfInteractables(map)) expect(zoneIds.has(i.zone)).toBe(true)
        for (const n of nodes) expect(zoneIds.has(n.zone)).toBe(true)
        for (const s of map.riserSpawns) expect(zoneIds.has(s.zone)).toBe(true)
        expect(zoneIds.has(map.startZone)).toBe(true)
    })

    it('has 3-4 buyable doors with collision that opens', () => {
        expect(map.doors.length).toBeGreaterThanOrEqual(3)
        expect(map.doors.length).toBeLessThanOrEqual(4)
        for (const d of map.doors) {
            expect([750, 1000, 1250, 1500]).toContain(d.cost)
            expect(d.zones[0]).not.toBe(d.zones[1])
            for (const z of d.zones) expect(zoneIds.has(z)).toBe(true)
            const own = map.solids.filter(s => s.door === d.id)
            expect(own.length).toBeGreaterThan(0)
            const lo = { x: Math.min(...own.map(s => s.min.x)), y: Math.min(...own.map(s => s.min.y)), z: Math.min(...own.map(s => s.min.z)) }
            const hi = { x: Math.max(...own.map(s => s.max.x)), y: Math.max(...own.map(s => s.max.y)), z: Math.max(...own.map(s => s.max.z)) }
            expect(d.pos.x).toBeGreaterThanOrEqual(lo.x)
            expect(d.pos.x).toBeLessThanOrEqual(hi.x)
            expect(d.pos.z).toBeGreaterThanOrEqual(lo.z)
            expect(d.pos.z).toBeLessThanOrEqual(hi.z)
            expect(Math.abs(d.pos.y - lo.y)).toBeLessThan(0.05)
            expect(openWorld.solids.some(s => s.door === d.id)).toBe(false)
            expect(map.nav.links.some(l => l.door === d.id)).toBe(true)
        }
    })

    it('has 10-12 boarded windows with an unreachable approach outside', () => {
        expect(map.barricades.length).toBeGreaterThanOrEqual(10)
        expect(map.barricades.length).toBeLessThanOrEqual(12)
        expect(DF_BARRICADE_PLANKS).toBe(6)
        const inside = reachable(startNode.id, { doors: true, windows: false })
        const zonesWithWindows = new Set(map.barricades.map(b => b.zone))
        for (const z of zoneIds) expect(zonesWithWindows.has(z)).toBe(true)
        for (const b of map.barricades) {
            expect(Math.hypot(b.inward.x, b.inward.y, b.inward.z)).toBeCloseTo(1, 6)
            expect(b.pos.y).toBe(0)
            const back = (b.outside.x - b.pos.x) * b.inward.x + (b.outside.z - b.pos.z) * b.inward.z
            expect(back).toBeLessThan(-0.8)
            // Players are stopped by the window, zombies are not.
            const frame = map.solids.filter(s => s.barricade === b.id)
            expect(frame.length).toBeGreaterThan(0)
            for (const s of frame) expect(s.playerOnly).toBe(true)
            const out = { ...b.outside }
            expect(dfBodyFits(closedWorld, out, { radius: 0.35, height: 1.8, zombie: true })).toBe(true)
            // A nav link crosses the window from an outside node.
            const links = map.nav.links.filter(l => l.barricade === b.id)
            expect(links.length).toBeGreaterThan(0)
            for (const l of links) expect(!!nodes[l.a]!.outside !== !!nodes[l.b]!.outside).toBe(true)
            const outsideNode = nearestNode(b.outside)
            expect(outsideNode.outside).toBe(true)
            expect(inside.has(outsideNode.id)).toBe(false)
            // With the window passable it leads in.
            expect(reachable(outsideNode.id, { doors: true, windows: true }).has(startNode.id)).toBe(true)
        }
    })

    it('has one machine per perk', () => {
        expect(map.perks.map(p => p.perk).sort()).toEqual([...DF_PERK_IDS].sort())
        expect(new Set(map.perks.map(p => p.zone)).size).toBeGreaterThanOrEqual(4)
        for (const p of map.perks) {
            // The machine stands behind the interaction point.
            const behind = { x: p.pos.x - Math.sin(p.yaw) * 0.95, y: p.pos.y + 1, z: p.pos.z - Math.cos(p.yaw) * 0.95 }
            const machine = map.solids.find(s => s.prop === 'perk' && behind.x > s.min.x && behind.x < s.max.x && behind.z > s.min.z && behind.z < s.max.z)
            expect(machine).toBeDefined()
            expect(dfGroundHeight(closedWorld, p.pos.x, p.pos.z, p.pos.y + 0.1)).toBeCloseTo(p.pos.y, 2)
        }
    })

    it('has the four wall-buys on wall surfaces', () => {
        expect(map.wallBuys.map(w => w.weapon).sort()).toEqual(['kar98k', 'm1897', 'mp18', 'thompson'])
        for (const w of map.wallBuys) {
            const inStart = w.zone === map.startZone
            expect(inStart).toBe(w.weapon === 'kar98k' || w.weapon === 'mp18')
            expect(Math.hypot(w.normal.x, w.normal.y, w.normal.z)).toBeCloseTo(1, 6)
            const from = { x: w.pos.x + w.normal.x * 0.5, y: w.pos.y, z: w.pos.z + w.normal.z * 0.5 }
            const hit = dfRaycast(closedWorld, from, { x: -w.normal.x, y: 0, z: -w.normal.z }, 1)
            expect(hit).not.toBeNull()
            expect(hit!.dist).toBeGreaterThan(0.45)
            expect(hit!.dist).toBeLessThan(0.55)
        }
    })

    it('places the box, PaP, power and egg parts on solid ground', () => {
        expect(map.boxSpots.length).toBeGreaterThanOrEqual(4)
        expect(map.boxSpots.some(s => s.zone === map.startZone)).toBe(true)
        // The box never starts in the start zone: at least three spots elsewhere, in different zones.
        const away = map.boxSpots.filter(s => s.zone !== map.startZone)
        expect(away.length).toBeGreaterThanOrEqual(3)
        expect(new Set(away.map(s => s.zone)).size).toBe(away.length)
        const floorSpots = [...map.boxSpots, map.pap, map.power, map.egg.generator, map.egg.pedestal]
        for (const s of floorSpots) {
            expect(dfGroundHeight(closedWorld, s.pos.x + Math.sin(s.yaw) * 0.9, s.pos.z + Math.cos(s.yaw) * 0.9, s.pos.y + 0.1)).toBeCloseTo(s.pos.y, 2)
        }
        expect(map.egg.fuses.length).toBe(3)
        expect(new Set(map.egg.fuses.map(f => f.zone)).size).toBe(3)
        expect(map.egg.fuses.some(f => f.pos.y >= DF_UPPER_Y - 0.01)).toBe(true)
        for (const f of map.egg.fuses) {
            // Lies on something, not floating.
            expect(dfGroundHeight(closedWorld, f.pos.x, f.pos.z, f.pos.y + 0.05)).toBeCloseTo(f.pos.y, 2)
        }
        // Lightning rods: three, in different zones, one up on the raised level, standing on solid ground.
        expect(map.egg.rods.map(r => r.id)).toEqual(['rod-0', 'rod-1', 'rod-2'])
        expect(new Set(map.egg.rods.map(r => r.zone)).size).toBe(3)
        expect(map.egg.rods.some(r => r.pos.y >= DF_UPPER_Y - 0.01)).toBe(true)
        for (const r of map.egg.rods) {
            expect(dfGroundHeight(closedWorld, r.pos.x + Math.sin(r.yaw) * 0.9, r.pos.z + Math.cos(r.yaw) * 0.9, r.pos.y + 0.1), r.id).toBeCloseTo(r.pos.y, 2)
            expect(dfInteractables(map).find(i => i.id === r.id)).toMatchObject({ kind: 'rod', ref: r.id })
        }
        expect(map.egg.chargeRadius).toBeGreaterThanOrEqual(8)
        expect(map.egg.chargeRadius).toBeLessThanOrEqual(10)
        // The generator sits in the open: most of the charge circle is walkable.
        let free = 0
        let total = 0
        const g = map.egg.generator.pos
        for (let a = 0; a < 24; a++) {
            for (const r of [3, 5, 7]) {
                total++
                const p = { x: g.x + Math.cos(a / 24 * Math.PI * 2) * r, y: 0, z: g.z + Math.sin(a / 24 * Math.PI * 2) * r }
                if (nearestNode(p, n => n.zone === g.zone || n.zone === map.egg.generator.zone) && Math.hypot(nearestNode(p).pos.x - p.x, nearestNode(p).pos.z - p.z) < 1.6) free++
            }
        }
        expect(free / total).toBeGreaterThan(0.5)
    })

    it('spawns players in the start zone and risers in every zone', () => {
        expect(map.playerSpawns.length).toBe(4)
        for (const p of map.playerSpawns) {
            expect(dfBodyFits(closedWorld, p, { radius: DF_PLAYER.radius, height: DF_PLAYER.height })).toBe(true)
            expect(dfGroundHeight(closedWorld, p.x, p.z, p.y + 0.1)).toBeCloseTo(p.y, 3)
            expect(nearestNode(p, n => !n.outside).zone).toBe(map.startZone)
        }
        for (const z of zoneIds) expect(map.riserSpawns.some(s => s.zone === z)).toBe(true)
        for (const s of map.riserSpawns) {
            expect(dfBodyFits(closedWorld, s.pos, { radius: 0.55, height: 2.3, zombie: true })).toBe(true)
            expect(dfGroundHeight(closedWorld, s.pos.x, s.pos.z, s.pos.y + 0.1)).toBeCloseTo(s.pos.y, 3)
            expect(nearestNode(s.pos, n => !n.outside).zone).toBe(s.zone)
        }
    })

    it('keeps lights out of walls', () => {
        for (const l of map.lights) {
            const inside = map.solids.some((s: DfSolid) => !s.hidden && l.pos.x > s.min.x && l.pos.x < s.max.x && l.pos.y > s.min.y && l.pos.y < s.max.y && l.pos.z > s.min.z && l.pos.z < s.max.z)
            expect(inside).toBe(false)
        }
        expect(map.lights.some(l => l.power)).toBe(true)
        expect(map.lights.some(l => l.flicker)).toBe(true)
    })
})

describe('Sainte-Croix nav graph', () => {
    it('puts every node on walkable ground with room for a zombie', () => {
        for (const n of nodes) {
            expect(dfGroundHeight(openWorld, n.pos.x, n.pos.z, n.pos.y + 0.3, true)).toBeCloseTo(n.pos.y, 2)
            expect(dfBodyFits(openWorld, { x: n.pos.x, y: n.pos.y + DF_PLAYER.stepHeight + 0.01, z: n.pos.z }, { radius: 0.35, height: 1.2, zombie: true })).toBe(true)
        }
        for (const l of map.nav.links) {
            expect(nodes[l.a]).toBeDefined()
            expect(nodes[l.b]).toBeDefined()
            expect(l.a).not.toBe(l.b)
        }
    })

    it('reaches every zone and both levels from the start once the doors are open', () => {
        const seen = reachable(startNode.id, { doors: true, windows: false })
        const missing = nodes.filter(n => !n.outside && !seen.has(n.id))
        expect(missing.map(n => n.id)).toEqual([])
        for (const z of zoneIds) expect(nodes.some(n => n.zone === z && seen.has(n.id))).toBe(true)
        expect(nodes.some(n => n.pos.y > DF_UPPER_Y - 0.01 && seen.has(n.id))).toBe(true)
    })

    it('reaches every lightning rod from the start once the doors are open', () => {
        const seen = reachable(startNode.id, { doors: true, windows: false })
        for (const r of map.egg.rods) {
            const near = nodes.filter(n => seen.has(n.id) && Math.hypot(n.pos.x - r.pos.x, n.pos.z - r.pos.z) <= DF_PLAYER.useRange && Math.abs(n.pos.y - r.pos.y) < 0.5)
            expect(near.length, r.id).toBeGreaterThan(0)
        }
    })

    it('keeps the start zone sealed while the doors are closed', () => {
        const seen = reachable(startNode.id, { doors: false, windows: false })
        for (const id of seen) expect(nodes[id]!.zone).toBe(map.startZone)
    })

    it('puts every interactable within reach of a nav node', () => {
        for (const it of dfInteractables(map)) {
            const candidates = nodes.filter((n) => {
                if (n.outside) return false
                const h = Math.hypot(n.pos.x - it.pos.x, n.pos.z - it.pos.z)
                const eye = n.pos.y + DF_PLAYER.eyeHeight
                return h <= DF_PLAYER.useRange && it.pos.y > n.pos.y - 0.5 && it.pos.y < eye + 0.3
            })
            expect(candidates.length, it.id).toBeGreaterThan(0)
            // Nothing solid between that node's eye and the thing (except the thing itself).
            const visible = candidates.some((n) => {
                const eye = { x: n.pos.x, y: n.pos.y + DF_PLAYER.eyeHeight, z: n.pos.z }
                const target = { x: it.pos.x, y: Math.max(it.pos.y, n.pos.y) + 0.5, z: it.pos.z }
                const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z)
                const hit = dfRaycast(closedWorld, eye, { x: (target.x - eye.x) / d, y: (target.y - eye.y) / d, z: (target.z - eye.z) / d }, d)
                return !hit || hit.dist > d - 1.0
            })
            expect(visible, it.id).toBe(true)
        }
        // Doors can be bought from both sides.
        for (const d of map.doors) {
            for (const z of d.zones) {
                expect(nodes.some(n => n.zone === z && Math.hypot(n.pos.x - d.pos.x, n.pos.z - d.pos.z) < 2.6 && Math.abs(n.pos.y - d.pos.y) < 0.5), `${d.id} ${z}`).toBe(true)
            }
        }
    })
})

describe('Sainte-Croix traversal', () => {
    function walk(from: Vec3, to: Vec3, seconds: number): Vec3 {
        let pos = { ...from }
        let vel = { x: 0, y: 0, z: 0 }
        const dt = 1 / 30
        for (let t = 0; t < seconds; t += dt) {
            const dx = to.x - pos.x
            const dz = to.z - pos.z
            const d = Math.hypot(dx, dz)
            const speed = Math.min(DF_PLAYER.walkSpeed, d / dt)
            vel = { x: d > 1e-3 ? dx / d * speed : 0, y: vel.y - DF_PLAYER.gravity * dt, z: d > 1e-3 ? dz / d * speed : 0 }
            const r = dfMoveBody(openWorld, pos, vel, dt, { radius: DF_PLAYER.radius, height: DF_PLAYER.height, stepHeight: DF_PLAYER.stepHeight })
            pos = r.pos
            vel = r.vel
        }
        return pos
    }

    it('walks up and down every staircase', () => {
        const stairs: [Vec3, Vec3][] = [
            [{ x: 27.5, y: 0, z: 2 }, { x: 37, y: DF_UPPER_Y, z: 2 }],
            [{ x: 27.5, y: 0, z: 26 }, { x: 37, y: DF_UPPER_Y, z: 26 }]
        ]
        for (const [bottom, top] of stairs) {
            const up = walk(bottom, top, 4)
            expect(up.y).toBeCloseTo(DF_UPPER_Y, 2)
            expect(Math.hypot(up.x - top.x, up.z - top.z)).toBeLessThan(0.2)
            const down = walk(top, bottom, 4)
            expect(down.y).toBeCloseTo(0, 2)
            expect(Math.hypot(down.x - bottom.x, down.z - bottom.z)).toBeLessThan(0.2)
        }
    })

    it('runs the length of the rampart walk', () => {
        const end = walk({ x: 37.5, y: DF_UPPER_Y, z: -2 }, { x: 37.5, y: DF_UPPER_Y, z: 28 }, 10)
        expect(end.y).toBeCloseTo(DF_UPPER_Y, 2)
        expect(end.z).toBeCloseTo(28, 1)
    })

    it('is big and open: long clear sightlines in the start zone', () => {
        const xs = map.solids.flatMap(s => (s.hidden ? [] : [s.min.x, s.max.x]))
        const zs = map.solids.flatMap(s => (s.hidden ? [] : [s.min.z, s.max.z]))
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThanOrEqual(80)
        expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThanOrEqual(80)
        const eye = { x: map.playerSpawns[0]!.x, y: DF_PLAYER.eyeHeight, z: map.playerSpawns[0]!.z }
        let far = 0
        for (let a = 0; a < 16; a++) {
            const dir = { x: Math.sin(a / 16 * Math.PI * 2), y: 0, z: Math.cos(a / 16 * Math.PI * 2) }
            const hit = dfRaycast(closedWorld, eye, dir, 80)
            if (!hit || hit.dist > 18) far++
        }
        expect(far).toBeGreaterThanOrEqual(6)
    })

    it('stops players at boarded windows', () => {
        for (const b of map.barricades) {
            const inside = { x: b.pos.x + b.inward.x * 1.2, y: 0, z: b.pos.z + b.inward.z * 1.2 }
            const end = walk(inside, b.outside, 3)
            const past = (end.x - b.pos.x) * b.inward.x + (end.z - b.pos.z) * b.inward.z
            expect(past, b.id).toBeGreaterThan(0)
        }
    })
})
