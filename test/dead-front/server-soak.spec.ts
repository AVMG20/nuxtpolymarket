import { describe, expect, it } from 'vitest'
import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import { dfZombieHitTest } from '#shared/utils/dead-front/enemies'
import { DF_MAP, DF_UPPER_Y } from '#shared/utils/dead-front/map'
import { dfLineOfSight } from '#shared/utils/dead-front/physics'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import { DfMatchSim } from '#server/utils/dead-front/sim'

// Plays the real map with two turret bots that shoot whatever they can see,
// to catch exceptions and AI dead ends (zombies that never reach the players).

describe('DfMatchSim soak on Sainte-Croix', () => {
    it('runs several rounds with bots without errors', () => {
        let sim: DfMatchSim | null = null
        sim = new DfMatchSim([0, 1].map(i => ({ userId: `bot${i}`, name: `Bot ${i}`, startWeapon: 'm1911' as const, attachments: {}, perkMods: {} })), {
            now: () => sim?.time ?? 0,
            startDelay: 1
        })
        const s = sim
        const counts = new Map<string, number>()
        const ticks = 20 * 240
        for (let t = 0; t < ticks && !s.over && s.round < 3; t++) {
            for (const p of s.players) {
                if (p.life === 'dead') continue
                const w = p.weapons[p.slot]
                if (!w) continue
                p.points = Math.max(p.points, 0)
                if (w.mag === 0) {
                    if (w.reserve === 0) w.reserve = 80
                    s.reload(p.pid)
                    continue
                }
                const eye = { x: p.pos.x, y: p.pos.y + DF_PLAYER.eyeHeight, z: p.pos.z }
                for (const z of s.zombies) {
                    const aim = { x: z.pos.x, y: z.pos.y + z.def.height * 0.6, z: z.pos.z }
                    const d = { x: aim.x - eye.x, y: aim.y - eye.y, z: aim.z - eye.z }
                    const l = Math.hypot(d.x, d.y, d.z)
                    if (l > 25 || !dfLineOfSight(s.world, eye, aim)) continue
                    const dir = { x: d.x / l, y: d.y / l, z: d.z / l }
                    const hit = dfZombieHitTest({ type: z.type, pos: z.pos, yaw: z.yaw, anim: z.anim }, eye, dir, 60)
                    s.fire(p.pid, { origin: eye, dirs: [dir], hits: hit ? [{ z: z.id, zone: hit.zone, dist: hit.dist }] : [] })
                    break
                }
            }
            s.step(0.05)
            const snap = s.snapshot()
            for (const e of snap.events as DfEvent[]) counts.set(e.k, (counts.get(e.k) ?? 0) + 1)
            JSON.stringify(snap)
        }
        expect(s.round).toBeGreaterThanOrEqual(2)
        expect(counts.get('kill') ?? 0).toBeGreaterThan(10)
        expect(counts.get('plank') ?? 0).toBeGreaterThan(0)
    })

    it('brings zombies to a player on every level and in every zone', () => {
        let sim: DfMatchSim | null = null
        sim = new DfMatchSim([{ userId: 'bot', name: 'Bot', startWeapon: 'm1911', attachments: {}, perkMods: {} }], {
            now: () => sim?.time ?? 0,
            startDelay: 1
        })
        const s = sim
        const p = s.players[0]!
        s.dev(p.pid, { k: 'points', amount: 50000 })
        // Open every door, from the start zone outwards (positions come from the map, which changes).
        for (let pass = 0; pass < DF_MAP.doors.length; pass++) {
            for (const d of DF_MAP.doors) {
                if (s.doors.has(d.id) || !d.zones.some(z => s.activeZones.has(z))) continue
                s.dev(p.pid, { k: 'tp', pos: d.pos })
                s.use(p.pid, d.id)
            }
        }
        expect(s.snapshot().world.doors.length).toBe(DF_MAP.doors.length)
        for (let t = 0; t < 40 && s.phase !== 'active'; t++) s.step(0.05)
        s.dev(p.pid, { k: 'round', round: 6 })
        // One spot per zone (the inside nav node closest to the zone's middle) and the highest walkable node.
        const inside = DF_MAP.nav.nodes.filter(n => !n.outside)
        const spots = DF_MAP.zones.map((zone) => {
            const nodes = inside.filter(n => n.zone === zone.id && n.pos.y < DF_UPPER_Y - 0.5)
            const cx = nodes.reduce((a, n) => a + n.pos.x, 0) / Math.max(1, nodes.length)
            const cz = nodes.reduce((a, n) => a + n.pos.z, 0) / Math.max(1, nodes.length)
            const mid = nodes.reduce((b, n) => (Math.hypot(n.pos.x - cx, n.pos.z - cz) < Math.hypot(b.pos.x - cx, b.pos.z - cz) ? n : b), nodes[0]!)
            return { name: zone.name, pos: mid.pos }
        })
        const top = inside.reduce((b, n) => (n.pos.y > b.pos.y ? n : b), inside[0]!)
        spots.push({ name: `upper level (${top.zone})`, pos: top.pos })
        for (const spot of spots) {
            s.dev(p.pid, { k: 'clear' })
            s.dev(p.pid, { k: 'tp', pos: spot.pos })
            let reached = false
            for (let t = 0; t < 20 * 120 && !reached; t++) {
                p.pos = { ...spot.pos }
                p.health = p.effects.maxHealth
                if (s.phase !== 'active') s.dev(p.pid, { k: 'round', round: 6 })
                s.step(0.05)
                for (const e of s.snapshot().events as DfEvent[]) if (e.k === 'zhit' && e.p === p.pid) reached = true
            }
            expect(reached, spot.name).toBe(true)
        }
    })
})
