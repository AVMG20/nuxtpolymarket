import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { DF_COSTS, DF_MACHINE_TIMES } from '#shared/utils/dead-front/constants'
import { dfBulletDamage } from '#shared/utils/dead-front/combat'
import { DF_LAUNCHER, DF_STRIKE } from '#shared/utils/dead-front/support'
import { dfInteractables } from '#shared/utils/dead-front/map'
import type { DfEvent } from '#shared/utils/dead-front/protocol'
import { DF_WEAPON_IDS, DF_WEAPONS, dfBoxPool, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfMatchSim } from '#server/utils/dead-front/sim'
import type { DfPlayerSetup } from '#server/utils/dead-front/sim-types'
import { dfBenchItem } from '../../app/utils/dead-front/engine/arsenal-prompt'
import { dfPromptFor } from '../../app/utils/dead-front/engine/prompt'
import { dfBuildGunRig } from '../../app/utils/dead-front/weapons/models'

const setup = (userId: string): DfPlayerSetup => ({ userId, name: userId, startWeapon: 'm1911', attachments: {}, perkMods: {} })

function makeSim(players = 1) {
    let clock = 1000
    const sim = new DfMatchSim(Array.from({ length: players }, (_, i) => setup(`u${i}`)), { now: () => clock, startDelay: 1000 })
    return { sim, advance: (s: number) => { clock += s } }
}

function run(sim: DfMatchSim, seconds: number, dt = 0.05): DfEvent[] {
    const out: DfEvent[] = []
    for (let t = 0; t < seconds; t += dt) {
        sim.step(dt)
        out.push(...sim.snapshot().events)
    }
    return out
}

describe('the bomber run', () => {
    it('kills every zombie in its circle, brutes and cover too, nothing outside, never a player', () => {
        const { sim } = makeSim(2)
        const [p, mate] = sim.players
        sim.dev(0, { k: 'hold', on: true })
        // no power-up drops: a Nuke from a carpeted brute would take the zombie outside too
        ;(sim as unknown as { powerupsThisRound: number }).powerupsThisRound = Infinity
        sim.arsenal.debugSupport(p!, 'bomber')
        const at = { x: p!.pos.x, y: 0, z: p!.pos.z - 14 }
        mate!.pos = { ...at }
        mate!.invulnUntil = 1e9
        const inside = [
            sim.debugSpawn('brute', { x: at.x + 3, y: 0, z: at.z }, 1e6),
            sim.debugSpawn('shambler', { x: at.x - 6, y: 0, z: at.z + 4 }, 1e6),
            sim.debugSpawn('ghoul', { x: at.x, y: 0, z: at.z - 9 }, 1e6)
        ]
        // well clear of the carpet (and of the outer bombs' blasts), and held where it is
        const outside = sim.debugSpawn('shambler', { x: at.x + DF_STRIKE.bomber.radius + DF_STRIKE.bomber.bombRadius + 3, y: 0, z: at.z }, 1e6)
        outside.state = 'stagger'
        outside.timer = 1e6
        const kills = p!.kills
        const pts = p!.points
        expect(sim.arsenal.handle(p!, { k: 'callin', at, dir: { x: 0, y: 0, z: -1 } })).toBe(true)
        const events = run(sim, 8)
        const strike = events.find(e => e.k === 'strike')
        expect(strike?.k === 'strike' && strike.reward).toBe('bomber')
        expect(events.filter(e => e.k === 'explode').length).toBeGreaterThan(8)
        for (const z of inside) expect(sim.zombies.includes(z)).toBe(false)
        expect(sim.zombies.includes(outside)).toBe(true)
        expect(mate!.health).toBe(mate!.effects.maxHealth)
        expect(p!.kills - kills).toBe(3)
        expect(p!.points).toBeGreaterThan(pts)
    })
})

describe('the grenade launcher', () => {
    function withLauncher() {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'hold', on: true })
        // a Pack-a-Punched, Epic Thompson with a silencer in the second slot, in hand
        p.weapons.push({ ...p.weapons[0]!, id: 'thompson', pap: 1, rarity: 2, mag: 17, reserve: 99, attachments: { muzzle: 'thompson-maxim' }, stats: dfWeaponStats('thompson', 1, { muzzle: 'thompson-maxim' }, 2) })
        p.slot = 1
        const original = p.weapons[1]!
        const snapshotOf = { ...original }
        sim.arsenal.debugSupport(p, 'launcher')
        expect(sim.arsenal.handle(p, { k: 'callin', at: { ...p.pos }, dir: { x: 0, y: 0, z: -1 } })).toBe(true)
        return { sim, advance, p, original, snapshotOf }
    }

    it('stands in for the weapon in hand and gives it back exactly as it was when its time is up', () => {
        const { sim, p, original, snapshotOf } = withLauncher()
        expect(p.slot).toBe(1)
        expect(p.weapons[1]!.id).toBe(DF_LAUNCHER.weapon)
        expect(p.weapons[0]!.id).toBe('m1911')
        expect(sim.snapshot().world.arsenal!.players[0]!.launcher).toBeGreaterThan(40)
        // no second one while it's out (the reward isn't spent)
        sim.arsenal.debugSupport(p, 'launcher')
        expect(sim.arsenal.handle(p, { k: 'callin', at: { ...p.pos }, dir: { x: 0, y: 0, z: -1 } })).toBe(false)
        expect(sim.arsenal.gearOf(p).support).toEqual(['launcher'])
        run(sim, DF_LAUNCHER.seconds + 0.2, 0.25)
        expect(p.weapons[1]).toBe(original)
        expect({ ...p.weapons[1]! }).toEqual(snapshotOf)
        expect(p.slot).toBe(1)
    })

    it('fires heavy shells that burst wide, with no self-damage and no weapon XP; going dry gives it back', () => {
        const { sim, advance, p, original } = withLauncher()
        const w = p.weapons[1]!
        p.swapUntil = 0
        const horde = [0, 1, 2, 3].map(i => sim.debugSpawn('brute', { x: p.pos.x + (i - 1.5) * 2.5, y: 0, z: p.pos.z - 12 }, 2000))
        const hp = p.health
        let fired = 0
        for (let i = 0; i < 20 && w.mag + w.reserve > 0; i++) {
            if (w.mag <= 0) {
                w.mag = Math.min(w.stats.magSize, w.reserve)
                w.reserve -= w.mag
            }
            if (sim.fire(0, { origin: { x: p.pos.x, y: 1.5, z: p.pos.z }, dirs: [{ x: 0, y: -0.05, z: -1 }], hits: [] })) fired++
            expect(sim.projectiles.some(pr => pr.kind === 'mortar') || fired === 0).toBe(true)
            run(sim, 0.9)
            advance(0.9)
        }
        expect(fired).toBe(12)
        expect(horde.filter(z => sim.zombies.includes(z))).toHaveLength(0)
        expect(p.health).toBe(hp)
        expect(p.weaponKills[DF_LAUNCHER.weapon]).toBeUndefined()
        run(sim, 1.5)
        expect(p.weapons[1]).toBe(original)
    })

    it('going down, a wall-buy or the box give it back; it never goes in the Pack-a-Punch, the box pool or the armory', () => {
        expect(DF_WEAPON_IDS).not.toContain(DF_LAUNCHER.weapon)
        expect(dfBoxPool()).not.toContain(DF_LAUNCHER.weapon)
        expect(DF_WEAPONS.granatwerfer.temporary).toBe(true)
        {
            const { sim, p, original } = withLauncher()
            sim.dev(0, { k: 'down' })
            expect(p.life).toBe('down')
            // last stand holds the pistol; the Thompson waits, not the launcher
            expect([...p.weapons, ...(p.savedWeapons ?? [])].some(w => w.id === DF_LAUNCHER.weapon)).toBe(false)
            expect([...p.weapons, ...(p.savedWeapons ?? [])]).toContain(original)
        }
        {
            const { sim, p, original } = withLauncher()
            sim.power = true
            p.points = 100000
            p.pos = { ...sim.map.pap.pos }
            p.useCooldown.clear()
            sim.use(0, sim.map.pap.id)
            expect(sim.pap.state).toBe('idle')
            expect(p.points).toBe(100000)
            // the wall-buy: the launcher goes back first, then the trade takes the Thompson's slot as usual
            const wall = dfInteractables(sim.map).find(i => i.kind === 'wallbuy' && i.ref === 'mp18')!
            p.pos = { ...wall.pos }
            p.useCooldown.clear()
            sim.use(0, wall.id)
            expect(p.weapons.some(w => w.id === DF_LAUNCHER.weapon)).toBe(false)
            expect(p.weapons.map(w => w.id)).toContain('mp18')
            expect(original.id).toBe('thompson')
        }
    })

    it('has a chunky viewmodel with a drum that comes out on the reload', () => {
        const rig = dfBuildGunRig('granatwerfer', 0)
        const box = new THREE.Box3().setFromObject(rig.root)
        expect(box.max.z - box.min.z).toBeGreaterThan(0.85)
        expect(rig.mag).not.toBeNull()
        expect(dfWeaponStats('granatwerfer', 0).shot).toBe('grenade')
    })

    it('can\'t be upgraded or take a kit; the bench says why', () => {
        const { sim, p } = withLauncher()
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        p.pos = { ...bench.pos }
        sim.arsenal.gearOf(p).pool.scrap = 99
        sim.arsenal.gearOf(p).pool.parts = 9
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 1, from: 0 })).toBe(false)
        expect(p.weapons[1]!.rarity).toBeUndefined()
        const kit = sim.arsenal.debugKit(3, { ...p.pos })
        expect(sim.arsenal.handle(p, { k: 'kit', id: kit })).toBe(false)
        const me = sim.snapshot().players[0]!
        const item = dfBenchItem('upgrade', { world: sim.snapshot().world, me }, true)
        expect(item.ok).toBe(false)
        expect(item.why).toContain('borrowed')
    })
})

describe('the grenade launcher: review regressions', () => {
    function launcherOverThompson() {
        const { sim, advance } = makeSim()
        const p = sim.player(0)!
        sim.dev(0, { k: 'hold', on: true })
        p.weapons.push({ ...p.weapons[0]!, id: 'thompson', pap: 0, mag: 20, reserve: 60, attachments: {}, stats: dfWeaponStats('thompson', 0, {}) })
        p.slot = 1
        const thompson = p.weapons[1]!
        sim.arsenal.debugSupport(p, 'launcher')
        sim.arsenal.handle(p, { k: 'callin', at: { ...p.pos }, dir: { x: 0, y: 0, z: -1 } })
        p.swapUntil = 0
        return { sim, advance, p, thompson, launcher: p.weapons[1]! }
    }
    const origin = (p: { pos: { x: number, z: number } }) => ({ x: p.pos.x, y: 1.5, z: p.pos.z })

    it('a shot or a reload reported for the other weapon (in flight across the swap) is dropped', () => {
        const { sim, advance, p, thompson, launcher } = launcherOverThompson()
        // the client still holds the Thompson as the launcher comes out
        expect(sim.fire(0, { origin: origin(p), dirs: [{ x: 0, y: 0, z: -1 }], hits: [], mag: 19, weapon: 'thompson' })).toBe(false)
        sim.reload(0, 30, 'thompson')
        expect(launcher.mag).toBe(launcher.stats.magSize)
        expect(launcher.reserve).toBe(8)
        // time runs out with a launcher shot and reload still on the way
        run(sim, DF_LAUNCHER.seconds + 0.2, 0.25)
        advance(DF_LAUNCHER.seconds)
        expect(p.weapons[1]).toBe(thompson)
        expect(sim.fire(0, { origin: origin(p), dirs: [{ x: 0, y: 0, z: -1 }], hits: [], mag: 2, weapon: DF_LAUNCHER.weapon })).toBe(false)
        sim.reload(0, 3, DF_LAUNCHER.weapon)
        expect(thompson.mag).toBe(20)
        expect(thompson.reserve).toBe(60)
        // an old client that doesn't say which weapon still fires
        expect(sim.fire(0, { origin: origin(p), dirs: [{ x: 0, y: 0, z: -1 }], hits: [], mag: 19 })).toBe(true)
        expect(thompson.mag).toBe(19)
    })

    it('a refused wall-buy or a box roll leaves the launcher out; the stashed weapon is still owned', () => {
        const { sim, p, thompson, launcher } = launcherOverThompson()
        const wall = (w: string) => dfInteractables(sim.map).find(i => i.kind === 'wallbuy' && i.ref === w)!
        // can't afford the MP18: refused, the launcher stays
        p.points = 0
        p.pos = { ...wall('mp18').pos }
        sim.use(0, wall('mp18').id)
        expect(p.weapons[1]).toBe(launcher)
        // the Thompson wall: full ammo on the stashed Thompson is refused, nothing bought
        p.points = 100000
        thompson.reserve = Math.round(thompson.stats.reserve * p.effects.reserveAmmoMult)
        thompson.mag = thompson.stats.magSize
        p.pos = { ...wall('thompson').pos }
        p.useCooldown.clear()
        sim.use(0, wall('thompson').id)
        expect(p.points).toBe(100000)
        expect(p.weapons[1]).toBe(launcher)
        // the client sees it as owned too: ammo, not a second copy at full price
        const snap = sim.snapshot()
        const me = snap.players[0]!
        expect(dfPromptFor(wall('thompson'), { map: sim.map, world: snap.world, me, solo: true })!.text).toBe('Ammo full')
        thompson.reserve = 10
        const prompt = dfPromptFor(wall('thompson'), { map: sim.map, world: sim.snapshot().world, me, solo: true })!
        expect(prompt.text).toBe('Hold F for ammo')
        p.useCooldown.clear()
        sim.use(0, wall('thompson').id)
        expect(p.points).toBe(100000 - prompt.cost!)
        expect(thompson.reserve).toBe(Math.round(thompson.stats.reserve * p.effects.reserveAmmoMult))
        expect(p.weapons[1]).toBe(launcher)
        // a box roll (paid, maybe moving) doesn't end it, and never offers the stashed Thompson
        const box = sim.map.boxSpots[sim.box.spot]!
        p.pos = { ...box.pos }
        p.useCooldown.clear()
        sim.use(0, box.id)
        expect(sim.box.state).toBe('rolling')
        expect(sim['boxInternal'].final).not.toBe('thompson')
        expect(p.weapons[1]).toBe(launcher)
        // a wall-buy of a new weapon that goes through: the launcher goes back first
        p.pos = { ...wall('mp18').pos }
        p.useCooldown.clear()
        sim.use(0, wall('mp18').id)
        expect(p.weapons.some(w => w.id === DF_LAUNCHER.weapon)).toBe(false)
        expect(p.weapons.map(w => w.id)).toContain('mp18')
    })

    it('launcher kills never hand out support', () => {
        const { sim, advance, p } = launcherOverThompson()
        const horde = [0, 1, 2].map(i => sim.debugSpawn('shambler', { x: p.pos.x + (i - 1) * 1.2, y: 0, z: p.pos.z - 10 }, 50))
        sim.fire(0, { origin: origin(p), dirs: [{ x: 0, y: -0.05, z: -1 }], hits: [], weapon: DF_LAUNCHER.weapon })
        run(sim, 1.5)
        advance(1.5)
        expect(horde.filter(z => sim.zombies.includes(z))).toHaveLength(0)
        expect(sim.arsenal.gearOf(p).support).toEqual([])
    })

    it('Max Ammo and the ammo-on-kill perk never refill the launcher; Max Ammo tops up the stashed weapon', () => {
        const { sim, advance, p, thompson, launcher } = launcherOverThompson()
        thompson.reserve = 3
        launcher.reserve = 0
        p.effects.ammoOnKillChance = 1
        sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z - 10 }, 50)
        sim.fire(0, { origin: origin(p), dirs: [{ x: 0, y: -0.05, z: -1 }], hits: [], weapon: DF_LAUNCHER.weapon })
        const magAfter = launcher.mag
        run(sim, 1.5)
        advance(1.5)
        expect(launcher.mag).toBe(magAfter)
        sim.dropPowerup('maxammo', { ...p.pos })
        run(sim, 0.2)
        expect(launcher.reserve).toBe(0)
        expect(thompson.reserve).toBe(Math.round(thompson.stats.reserve * p.effects.reserveAmmoMult))
    })
})

describe('rarity end to end', () => {
    it('the server deals the client\'s predicted damage for an upgraded weapon', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        p.pos = { ...bench.pos }
        sim.arsenal.gearOf(p).pool.scrap = 99
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 0, from: 0, weapon: 'm1911' })).toBe(true)
        // the snapshot carries the tier; the client derives stats from it like this
        const held = sim.snapshot().players[0]!.weapons[0]!
        expect(held.rarity).toBe(1)
        const predicted = dfBulletDamage(dfWeaponStats(held.id, held.pap, held.attachments, held.rarity), p.effects, 'body', 5, false)
        const z = sim.debugSpawn('shambler', { x: p.pos.x, y: 0, z: p.pos.z + 5 }, 100000)
        sim.fire(0, { origin: { x: p.pos.x, y: 1.5, z: p.pos.z }, dirs: [{ x: 0, y: 0, z: 1 }], hits: [{ z: z.id, zone: 'body', dist: 5 }] })
        expect(100000 - z.hp).toBeCloseTo(predicted, 5)
        expect(predicted).toBeCloseTo(dfBulletDamage(dfWeaponStats('m1911', 0, {}), p.effects, 'body', 5, false) * 1.25, 5)
        // the wrong weapon (a swap in flight) is refused
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 0, from: 1, weapon: 'thompson' })).toBe(false)
    })

    it('rarity rides through swaps and the Pack-a-Punch, even when the machine hands it back itself; a weapon in the machine can\'t be upgraded', () => {
        const { sim } = makeSim()
        const p = sim.player(0)!
        p.points = 100000
        p.weapons.push({ ...p.weapons[0]!, id: 'thompson', pap: 0, rarity: 3, stats: dfWeaponStats('thompson', 0, {}, 3) })
        sim.swap(0, 1)
        expect(p.slot).toBe(1)
        sim.swap(0, 0)
        expect(p.weapons[1]!.rarity).toBe(3)
        p.slot = 1
        p.swapUntil = 0
        sim.power = true
        p.pos = { ...sim.map.pap.pos }
        sim.use(0, sim.map.pap.id)
        expect(sim.pap.state).toBe('working')
        expect(p.weapons[1]!.away).toBe(true)
        // at the bench meanwhile: the weapon in the machine is refused, the client says why
        const bench = dfInteractables(sim.map).find(i => i.kind === 'bench')!
        p.pos = { ...bench.pos }
        sim.arsenal.gearOf(p).pool.scrap = 99
        expect(sim.arsenal.handle(p, { k: 'upgrade', bench: bench.id, slot: 1, from: 3 })).toBe(false)
        const me = { ...sim.snapshot().players[0]!, slot: 1 }
        expect(dfBenchItem('upgrade', { world: sim.snapshot().world, me }, true).why).toContain('Pack-a-Punch')
        // the offer runs out: the machine hands it back, packed and still Legendary
        run(sim, DF_MACHINE_TIMES.papWork + DF_MACHINE_TIMES.papOffer + 1, 0.25)
        const back = p.weapons.find(w => w.id === 'thompson')!
        expect(back.away).toBeFalsy()
        expect(back.pap).toBe(1)
        expect(back.rarity).toBe(3)
        expect(back.stats.damage).toBeCloseTo(dfWeaponStats('thompson', 1, {}, 3).damage, 5)
        expect(p.points).toBe(100000 - DF_COSTS.pap[0]!)
    })
})
