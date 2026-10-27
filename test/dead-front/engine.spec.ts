import { describe, expect, it } from 'vitest'
import { DF_COSTS, DF_MAX_PERKS } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { DF_PERKS } from '#shared/utils/dead-front/perks'
import type { DfPlayerSnap, DfSnapshot, DfWorldSnap, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import { DF_WEAPONS, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { DfWeaponStats } from '#shared/utils/dead-front/weapons'
import { DfGunState, dfConeDir, dfShotInterval, dfSpread } from '../../app/utils/dead-front/engine/gun'
import { DfSnapBuffer, dfInterpPlayer, dfInterpZombies, dfLerpAngle, dfNewInterpPlayer, DF_MAX_EXTRAPOLATE } from '../../app/utils/dead-front/engine/interp'
import { dfClampToScreen, dfObjectiveTarget, dfObjectiveText } from '../../app/utils/dead-front/engine/objective'
import { dfPickInteractable, dfPromptFor, dfRevivePrompt, dfWallAmmoCost } from '../../app/utils/dead-front/engine/prompt'
import { dfAdaptivePixelRatio, dfPixelRatioBounds } from '../../app/utils/dead-front/engine/resolution'
import { dfSanitizeSettings, dfVerticalFov } from '../../app/utils/dead-front/engine/settings'

// ---------------------------------------------------------------- fixtures

function player(over: Partial<DfPlayerSnap> = {}): DfPlayerSnap {
    return {
        pid: 0, userId: 'u', name: 'Tommy', pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, flags: 0,
        life: 'alive', health: 150, maxHealth: 150, points: 500, kills: 0, headshots: 0, downs: 0, revives: 0,
        perks: [], weapons: [{ id: 'm1911', pap: 0, mag: 8, reserve: 40, attachments: {} }], slot: 0,
        grenades: 2, bleedout: 0, reviveProgress: 0, selfRevives: 0, connected: true, ...over
    }
}

function world(over: Partial<DfWorldSnap> = {}): DfWorldSnap {
    return {
        doors: [], planks: {}, power: false,
        box: { spot: 0, state: 'idle', timer: 0 },
        pap: { state: 'idle', timer: 0 },
        egg: { step: 'power', fusesFound: [], charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 },
        double: 0, insta: 0, ...over
    }
}

const spot = (id: string, x: number, z: number) => ({ id, pos: { x, y: 0, z }, yaw: 0, zone: 'yard' })

const MAP = {
    id: 't', name: 'T', bounds: { min: { x: -10, y: -1, z: -10 }, max: { x: 10, y: 5, z: 10 } }, startZone: 'yard',
    playerSpawns: [{ x: 0, y: 0, z: 0 }], solids: [], zones: [{ id: 'yard', name: 'Yard' }],
    doors: [{ id: 'door-a', label: 'Chapel Nave', cost: 1000, zones: ['yard', 'nave'], pos: { x: 1, y: 0, z: 0 } }],
    barricades: [{ id: 'win-1', zone: 'yard', pos: { x: 2, y: 0, z: 0 }, inward: { x: 1, y: 0, z: 0 }, outside: { x: 3, y: 0, z: 0 }, width: 1 }],
    wallBuys: [{ id: 'wall-kar', weapon: 'kar98k', pos: { x: 0, y: 1.4, z: 2 }, normal: { x: 0, y: 0, z: -1 }, zone: 'yard' }],
    perks: [{ id: 'perk-iron', perk: 'ironhide', pos: { x: -1, y: 0, z: 0 }, yaw: 0, zone: 'yard' }, { id: 'perk-sw', perk: 'secondwind', pos: { x: -2, y: 0, z: 0 }, yaw: 0, zone: 'yard' }],
    boxSpots: [spot('box-a', 4, 4), spot('box-b', -4, 4)],
    pap: spot('pap', -4, -4),
    power: spot('power', 0, 6),
    egg: { fuses: [spot('fuse-1', 8, 0), spot('fuse-2', -8, 0), spot('fuse-3', 0, -8)], generator: spot('generator', 6, -6), pedestal: spot('pedestal', -6, -6), chargeRadius: 8 },
    riserSpawns: [], nav: { nodes: [], links: [] }, lights: []
} as unknown as DfMapDef

function it_(kind: string, id: string, ref?: string) {
    return { id, kind: kind as never, pos: { x: 0, y: 0, z: 0 }, zone: 'yard', ref }
}

function snap(time: number, zombies: DfZombieSnap[], players: DfPlayerSnap[] = []): DfSnapshot {
    return {
        tick: Math.round(time * 20), time, round: 1, phase: 'active', phaseTimer: 0, zombiesLeft: 5,
        players, zombies, projectiles: [], powerups: [], world: world(), events: [], ack: 0
    }
}

const zombie = (id: number, x: number, yaw = 0): DfZombieSnap => ({ id, type: 'shambler', pos: { x, y: 0, z: 0 }, yaw, hp: 1, anim: 'walk' })

// ---------------------------------------------------------------- interpolation

describe('dfLerpAngle', () => {
    it('takes the shortest arc across the wrap', () => {
        const a = Math.PI - 0.1
        const b = -Math.PI + 0.1
        const mid = dfLerpAngle(a, b, 0.5)
        expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9)
        expect(dfLerpAngle(0, 1, 0.25)).toBeCloseTo(0.25)
    })
})

describe('DfSnapBuffer', () => {
    it('brackets the render time and interpolates zombies', () => {
        const buf = new DfSnapBuffer()
        buf.push(snap(1, [zombie(1, 0)]), 1000)
        buf.push(snap(1.05, [zombie(1, 1), zombie(2, 5)]), 1050)
        const t = buf.renderTime(1050, 25) // 25 ms behind the newest
        expect(t).toBeCloseTo(1.025, 3)
        const s = buf.at(t)!
        expect(s.alpha).toBeCloseTo(0.5, 3)
        const out: DfZombieSnap[] = []
        dfInterpZombies(s, [], out)
        expect(out).toHaveLength(2)
        expect(out[0]!.pos.x).toBeCloseTo(0.5, 3)
        // a zombie that only exists in the newer snapshot appears at its spot
        expect(out[1]!.pos.x).toBe(5)
    })

    it('extrapolates a little past the newest snapshot, then holds', () => {
        const buf = new DfSnapBuffer()
        buf.push(snap(1, [zombie(1, 0)]), 1000)
        buf.push(snap(1.05, [zombie(1, 1)]), 1050)
        const s = buf.at(1.1)!
        expect(s.alpha).toBeCloseTo(2, 3)
        const far = buf.at(5)!
        expect(far.alpha).toBeCloseTo(1 + DF_MAX_EXTRAPOLATE / 0.05, 3)
    })

    it('holds a zombie that stopped in the newest snapshot instead of carrying it on', () => {
        const buf = new DfSnapBuffer()
        buf.push(snap(1, [{ ...zombie(1, 0), vel: { x: 1.5, y: 0, z: 0 } }]), 1000)
        // moved 7.5 cm, then stood still (no velocity sent)
        buf.push(snap(1.05, [zombie(1, 0.075)]), 1050)
        const out: DfZombieSnap[] = []
        dfInterpZombies(buf.at(1.45)!, [], out)
        expect(out[0]!.pos.x).toBeCloseTo(0.075, 3)
    })

    it('rejects stale snapshots and reuses pooled objects', () => {
        const buf = new DfSnapBuffer()
        expect(buf.push(snap(2, [zombie(1, 0)]), 0)).toBe(true)
        expect(buf.push(snap(1.9, [zombie(1, 0)]), 10)).toBe(false)
        buf.push(snap(2.05, [zombie(1, 2)]), 60)
        const pool: DfZombieSnap[] = []
        const out: DfZombieSnap[] = []
        dfInterpZombies(buf.at(2.025)!, pool, out)
        const first = out[0]
        dfInterpZombies(buf.at(2.04)!, pool, out)
        expect(out[0]).toBe(first)
    })

    it('snaps instead of sliding across a teleport', () => {
        const buf = new DfSnapBuffer()
        buf.push(snap(1, [zombie(1, 0)]), 0)
        buf.push(snap(1.05, [zombie(1, 20)]), 50)
        const out: DfZombieSnap[] = []
        dfInterpZombies(buf.at(1.025)!, [], out)
        expect(out[0]!.pos.x).toBe(20)
    })

    it('interpolates players with a velocity estimate and shortest-arc yaw', () => {
        const buf = new DfSnapBuffer()
        buf.push(snap(1, [], [player({ pid: 1, pos: { x: 0, y: 0, z: 0 }, yaw: 3 })]), 0)
        buf.push(snap(1.05, [], [player({ pid: 1, pos: { x: 0.2, y: 0, z: 0 }, yaw: -3 })]), 50)
        const ip = dfNewInterpPlayer()
        expect(dfInterpPlayer(buf.at(1.025)!, 1, ip)).toBe(true)
        expect(ip.pos.x).toBeCloseTo(0.1, 5)
        expect(ip.vx).toBeCloseTo(4, 5)
        expect(Math.abs(ip.yaw)).toBeGreaterThan(3)
        expect(dfInterpPlayer(buf.at(1.025)!, 9, ip)).toBe(false)
    })
})

// ---------------------------------------------------------------- prompts

describe('dfPromptFor', () => {
    const ctx = (over: { world?: Partial<DfWorldSnap>, me?: Partial<DfPlayerSnap>, solo?: boolean } = {}) => ({
        map: MAP, world: world(over.world), me: player(over.me), solo: over.solo ?? false
    })

    it('doors show the debris prompt with the cost, and vanish once bought', () => {
        const p = dfPromptFor(it_('door', 'door-a', 'door-a'), ctx())!
        expect(p.text).toBe('Hold F to clear the debris')
        expect(p.cost).toBe(1000)
        // 500 points: the plate says how many more it takes
        expect(p.sub).toBe('Chapel Nave · Need 500 more points')
        expect(p.ok).toBe(false)
        const rich = dfPromptFor(it_('door', 'door-a', 'door-a'), ctx({ me: { points: 1500 } }))!
        expect(rich.ok).toBe(true)
        expect(rich.sub).toBe('Chapel Nave')
        expect(dfPromptFor(it_('door', 'door-a', 'door-a'), ctx({ world: { doors: ['door-a'] } }))).toBeNull()
    })

    it('wall-buys sell the weapon, then ammo; Pack-a-Punched ammo costs more', () => {
        const buy = dfPromptFor(it_('wallbuy', 'wall-kar', 'kar98k'), ctx())!
        expect(buy.text).toContain(DF_WEAPONS.kar98k.name)
        expect(buy.cost).toBe(DF_WEAPONS.kar98k.wallCost ?? 1000)
        const owned = dfPromptFor(it_('wallbuy', 'wall-kar', 'kar98k'), ctx({ me: { weapons: [{ id: 'kar98k', pap: 0, mag: 0, reserve: 0, attachments: {} }] } }))!
        expect(owned.text).toBe('Hold F for ammo')
        expect(owned.cost).toBe(dfWallAmmoCost('kar98k', 0))
        expect(dfWallAmmoCost('kar98k', 1)).toBeGreaterThan(dfWallAmmoCost('kar98k', 0))
    })

    it('perks need power (except Second Wind solo), respect the cap and ownership', () => {
        const off = dfPromptFor(it_('perk', 'perk-iron', 'ironhide'), ctx())!
        expect(off.text).toBe('Requires power')
        expect(off.action).toBe('none')
        const on = dfPromptFor(it_('perk', 'perk-iron', 'ironhide'), ctx({ world: { power: true } }))!
        expect(on.cost).toBe(DF_PERKS.ironhide.cost)
        const owned = dfPromptFor(it_('perk', 'perk-iron', 'ironhide'), ctx({ world: { power: true }, me: { perks: ['ironhide'] } }))!
        expect(owned.action).toBe('none')
        const full = dfPromptFor(it_('perk', 'perk-iron', 'ironhide'), ctx({ world: { power: true }, me: { perks: ['quickhand', 'twinfire', 'fleetfoot', 'steadyeye'].slice(0, DF_MAX_PERKS) as never } }))!
        expect(full.text).toBe('Perk limit reached')
        const solo = dfPromptFor(it_('perk', 'perk-sw', 'secondwind'), ctx({ solo: true }))!
        expect(solo.cost).toBe(DF_COSTS.secondwindSolo)
    })

    it('the box offers a roll at its current spot and the take to its owner', () => {
        expect(dfPromptFor(it_('box', 'box-b'), ctx())).toBeNull()
        const roll = dfPromptFor(it_('box', 'box-a'), ctx({ me: { points: 2000 } }))!
        expect(roll.cost).toBe(DF_COSTS.box)
        expect(roll.ok).toBe(true)
        const ready = { spot: 0, state: 'ready' as const, weapon: 'thompson' as const, owner: 0, timer: 5 }
        expect(dfPromptFor(it_('box', 'box-a'), ctx({ world: { box: ready } }))!.text).toContain(DF_WEAPONS.thompson.name)
        const other = dfPromptFor(it_('box', 'box-a'), ctx({ world: { box: { ...ready, owner: 3 } } }))!
        expect(other.text).toBe('In use')
        expect(other.action).toBe('none')
    })

    it('Pack-a-Punch prices tiers and caps at the maximum', () => {
        expect(dfPromptFor(it_('pap', 'pap'), ctx())!.text).toBe('Requires power')
        expect(dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true } }))!.cost).toBe(DF_COSTS.pap[0])
        const tier1 = { weapons: [{ id: 'm1911' as const, pap: 1, mag: 8, reserve: 40, attachments: {} }] }
        expect(dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true }, me: tier1 }))!.cost).toBe(DF_COSTS.pap[1])
        const max = { weapons: [{ id: 'm1911' as const, pap: 3, mag: 8, reserve: 40, attachments: {} }] }
        expect(dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true }, me: max }))!.text).toBe('Maximum upgrade')
        const tier2 = { weapons: [{ id: 'm1911' as const, pap: 2, mag: 8, reserve: 40, attachments: {} }] }
        expect(dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true }, me: tier2 }))!.cost).toBe(DF_COSTS.pap[2])
    })

    it('a weapon in the Pack-a-Punch is not in hand and cannot be bought twice', () => {
        const away = { slot: 0, weapons: [{ id: 'mp18' as const, pap: 0, mag: 0, reserve: 0, attachments: {}, away: true }] }
        // nothing in hand: nothing to pack
        expect(dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true }, me: { ...away, points: 99999 } }))).toBeNull()
        const wall = dfPromptFor(it_('wallbuy', 'wall-mp18', 'mp18'), ctx({ me: { ...away, points: 99999 } }))!
        expect(wall.text).toBe('In the Pack-a-Punch')
        expect(wall.action).toBe('none')
    })

    it('easter egg parts only prompt on their step', () => {
        expect(dfPromptFor(it_('fuse', 'fuse-1', 'fuse-1'), ctx())!.action).toBe('none') // dead until the power is on
        expect(dfPromptFor(it_('fuse', 'fuse-1', 'fuse-1'), ctx({ world: { egg: { step: 'fuses', fusesFound: [], charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 } } }))).not.toBeNull()
        expect(dfPromptFor(it_('fuse', 'fuse-1', 'fuse-1'), ctx({ world: { egg: { step: 'fuses', fusesFound: ['fuse-1'], charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 } } }))).toBeNull()
        const install = dfPromptFor(it_('generator', 'generator'), ctx({ world: { egg: { step: 'install', fusesFound: ['fuse-1', 'fuse-2', 'fuse-3'], charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 } } }))!
        expect(install.text).toBe('Hold F to install the Tesla fuses')
        expect(install.action).toBe('use')
        expect(dfPromptFor(it_('pedestal', 'pedestal'), ctx({ world: { egg: { step: 'claim', fusesFound: [], charge: 15, chargeNeeded: 15, rodsOn: [], rodTimer: 0 } } }))!.text).toBe('Hold F to claim the wonder weapon')
        expect(dfPromptFor(it_('power', 'power'), ctx({ world: { power: true } }))).toBeNull()
    })

    it('explains every egg and machine state instead of going quiet', () => {
        const egg = (step: DfWorldSnap['egg']['step'], charge = 0) => ({ egg: { step, fusesFound: [], charge, chargeNeeded: 15, rodsOn: [], rodTimer: 0 } })
        expect(dfPromptFor(it_('generator', 'generator'), ctx({ world: egg('power') }))!.text).toBe('The Arc Generator lies dead')
        const charging = dfPromptFor(it_('generator', 'generator'), ctx({ world: egg('charge', 4) }))!
        expect(charging.text).toBe('Charge 4/15')
        expect(charging.action).toBe('none')
        expect(dfPromptFor(it_('pedestal', 'pedestal'), ctx({ world: egg('charge') }))!.action).toBe('none')
        expect(dfPromptFor(it_('pedestal', 'pedestal'), ctx({ world: egg('done') }))).toBeNull()
        expect(dfPromptFor(it_('box', 'box-a'), ctx({ world: { box: { spot: 0, state: 'moving', timer: 3 } } }))!.text).toBe('The box is moving')
        expect(dfPromptFor(it_('box', 'box-a'), ctx({ world: { box: { spot: 0, state: 'rolling', owner: 0, timer: 3 } } }))).toBeNull()
        const papBusy = dfPromptFor(it_('pap', 'pap'), ctx({ world: { power: true, pap: { state: 'working', owner: 2, weapon: 'mp18', tier: 1, timer: 2 } } }))!
        expect(papBusy.text).toBe('In use')
    })

    it('wall ammo is full at the perk-boosted cap; solo Second Wind sells out', () => {
        const kar = { id: 'kar98k' as const, pap: 0, mag: 5, attachments: {} }
        const base = dfWeaponStats('kar98k', 0).reserve
        // with a reserve perk the server's cap is higher: not full yet
        const boosted = dfPromptFor(it_('wallbuy', 'wall-kar', 'kar98k'), ctx({ me: { weapons: [{ ...kar, reserve: base, maxReserve: Math.round(base * 1.3) }] } }))!
        expect(boosted.text).toBe('Hold F for ammo')
        const full = dfPromptFor(it_('wallbuy', 'wall-kar', 'kar98k'), ctx({ me: { weapons: [{ ...kar, reserve: Math.round(base * 1.3), maxReserve: Math.round(base * 1.3) }] } }))!
        expect(full.text).toBe('Ammo full')
        const soldOut = dfPromptFor(it_('perk', 'perk-sw', 'secondwind'), ctx({ solo: true, me: { windBuys: 3 } }))!
        expect(soldOut.text).toBe('Sold out')
        expect(soldOut.action).toBe('none')
    })

    it('barricades prompt (and repeat) only when boards are missing', () => {
        expect(dfPromptFor(it_('barricade', 'win-1', 'win-1'), ctx({ world: { planks: { 'win-1': 6 } } }))).toBeNull()
        const p = dfPromptFor(it_('barricade', 'win-1', 'win-1'), ctx({ world: { planks: { 'win-1': 2 } } }))!
        expect(p.repeat).toBe(true)
        expect(p.text).toBe('Hold F to rebuild the barrier')
    })

    it('revive prompts target downed teammates only', () => {
        const me = player({ pid: 0 })
        expect(dfRevivePrompt(player({ pid: 1, life: 'down', name: 'Alfie' }), me)!.text).toBe('Hold F to revive Alfie')
        expect(dfRevivePrompt(player({ pid: 1, life: 'alive' }), me)).toBeNull()
        expect(dfRevivePrompt(player({ pid: 1, life: 'down' }), player({ life: 'down' }))).toBeNull()
    })

    it('picks the closest interactable in front of the camera', () => {
        const list = [{ pos: { x: 0, y: 0, z: -1.5 } }, { pos: { x: 0, y: 0, z: 1 } }, { pos: { x: 0.2, y: 0, z: -1 } }]
        expect(dfPickInteractable(list, { x: 0, y: 1.6, z: 0 }, 0, -1, 2.2)).toBe(2)
        expect(dfPickInteractable(list, { x: 0, y: 1.6, z: 0 }, 0, -1, 2.2, i => i === 2)).toBe(0)
        expect(dfPickInteractable(list, { x: 0, y: 1.6, z: 5 }, 0, -1, 2.2)).toBe(-1)
    })
})

// ---------------------------------------------------------------- objective

describe('objective guide', () => {
    const egg = (step: 'power' | 'fuses' | 'install' | 'charge' | 'claim' | 'done', fusesFound: string[] = []) => ({ step, fusesFound, charge: 0, chargeNeeded: 15, rodsOn: [], rodTimer: 0 })

    it('walks power -> nearest fuse -> generator -> pedestal', () => {
        expect(dfObjectiveTarget(egg('power'), false, MAP, { x: 0, y: 0, z: 0 })!.pos).toEqual(MAP.power.pos)
        expect(dfObjectiveTarget(egg('fuses'), true, MAP, { x: 7, y: 0, z: 0 })!.pos).toEqual(MAP.egg.fuses[0]!.pos)
        expect(dfObjectiveTarget(egg('fuses', ['fuse-1']), true, MAP, { x: 7, y: 0, z: 0 })!.pos).toEqual(MAP.egg.fuses[2]!.pos)
        expect(dfObjectiveTarget(egg('install'), true, MAP, { x: 0, y: 0, z: 0 })!.pos).toEqual(MAP.egg.generator.pos)
        expect(dfObjectiveTarget(egg('charge'), true, MAP, { x: 0, y: 0, z: 0 })!.pos).toEqual(MAP.egg.generator.pos)
        expect(dfObjectiveTarget(egg('claim'), true, MAP, { x: 0, y: 0, z: 0 })!.pos).toEqual(MAP.egg.pedestal.pos)
        expect(dfObjectiveTarget(egg('done'), true, MAP, { x: 0, y: 0, z: 0 })).toBeNull()
        expect(dfObjectiveText('fuses')).toBe('Recover the Tesla fuses')
    })

    it('clamps off-screen and behind-camera targets to the edge', () => {
        const out = { x: 0, y: 0, onScreen: false, angle: 0 }
        dfClampToScreen(0, 0, -10, 1, 1.7, 1000, 600, 40, out)
        expect(out.onScreen).toBe(true)
        expect(out.x).toBeCloseTo(500)
        expect(out.y).toBeCloseTo(300)
        dfClampToScreen(100, 0, -10, 1, 1.7, 1000, 600, 40, out)
        expect(out.onScreen).toBe(false)
        expect(out.x).toBeCloseTo(960)
        dfClampToScreen(-1, 0, 5, 1, 1.7, 1000, 600, 40, out)
        expect(out.onScreen).toBe(false)
        expect(out.x).toBeCloseTo(40)
    })
})

// ---------------------------------------------------------------- gun

function stats(over: Partial<DfWeaponStats> = {}): DfWeaponStats {
    return {
        name: 'Test', fireMode: 'auto', shot: 'hitscan', damage: 40, headMult: 3, limbMult: 0.8, rpm: 600, pellets: 1,
        magSize: 30, reserve: 120, reloadTime: 2, reloadEmptyTime: 2.5, perRoundReload: 0, range: 20, maxRange: 60,
        minDamageMult: 0.5, penetration: 0, hipSpread: 0.05, adsSpread: 0.01, adsTime: 0.2, adsZoom: 1.3, moveMult: 1,
        recoil: 0.02, splashRadius: 0, splashDamage: 0, projectileSpeed: 0, chains: 0, ...over
    }
}

describe('DfGunState', () => {
    it('fires automatic weapons on cadence while held', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {} }, stats(), 0, 0)
        expect(dfShotInterval(600, 1)).toBeCloseTo(0.1)
        let shots = 0
        for (let t = 0; t <= 1.0001; t += 1 / 60) {
            while (g.canFire(t, true)) {
                g.fired(t, 1)
                shots++
            }
        }
        expect(shots).toBeGreaterThanOrEqual(10)
        expect(shots).toBeLessThanOrEqual(11)
        expect(g.mag).toBe(30 - shots)
        expect(g.canFire(2, false)).toBe(false)
    })

    it('fire rate perks shorten the interval', () => {
        expect(dfShotInterval(600, 1.25)).toBeCloseTo(0.08)
    })

    it('semi weapons fire once per press with a short buffer', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'm1911', pap: 0, mag: 8, reserve: 40, attachments: {} }, stats({ fireMode: 'semi', rpm: 300 }), 0, 0)
        g.press(0)
        expect(g.canFire(0, true)).toBe(true)
        g.fired(0, 1)
        expect(g.canFire(0.05, true)).toBe(false) // held, no new press
        g.press(0.1) // pressed early: buffered until the 0.2 s interval passes
        expect(g.canFire(0.15, true)).toBe(false)
        expect(g.canFire(0.21, true)).toBe(true)
        expect(g.canFire(0.5, true)).toBe(false) // the buffer expired
    })

    it('bolt actions wait for the chamber', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'kar98k', pap: 0, mag: 5, reserve: 30, attachments: {} }, stats({ fireMode: 'bolt', rpm: 50 }), 0, 0)
        g.press(0)
        g.fired(0, 1)
        g.press(0.8)
        expect(g.canFire(0.8, true)).toBe(false)
        g.press(1.15)
        expect(g.canFire(1.21, true)).toBe(true)
    })

    it('magazine reloads take the empty time and move ammo from reserve', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'thompson', pap: 0, mag: 0, reserve: 50, attachments: {} }, stats(), 0, 0)
        const t = g.startReload(0, 1)
        expect(t).toBeCloseTo(2.5)
        expect(g.update(2.4, 0.016, 1)).toBe('none')
        expect(g.update(2.5, 0.016, 1)).toBe('done')
        expect(g.mag).toBe(30)
        expect(g.reserve).toBe(20)
        expect(g.canReload()).toBe(false)
    })

    it('per-shell reloads load one at a time and can be interrupted by firing', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'm1897', pap: 0, mag: 3, reserve: 20, attachments: {} }, stats({ fireMode: 'pump', rpm: 70, magSize: 6, perRoundReload: 0.5 }), 0, 0)
        const first = g.startReload(0, 1)
        expect(first).toBeCloseTo(0.65)
        expect(g.update(0.66, 0.016, 1)).toBe('shell')
        expect(g.mag).toBe(4)
        expect(g.canFire(0.7, true)).toBe(false) // a pump needs a press
        g.press(0.7)
        expect(g.canFire(0.7, true)).toBe(true)
        g.fired(0.7, 1)
        expect(g.reloading).toBe(false)
        expect(g.mag).toBe(3)
    })

    it('reconciles to the server only when no local action is in flight', () => {
        const g = new DfGunState()
        g.setWeapon({ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {} }, stats(), 0, 0)
        g.press(0)
        g.fired(0, 1)
        g.reconcile({ id: 'thompson', pap: 0, mag: 30, reserve: 120, attachments: {} }, 0.1, 0.4)
        expect(g.mag).toBe(29)
        g.reconcile({ id: 'thompson', pap: 0, mag: 28, reserve: 120, attachments: {} }, 1, 0.4)
        expect(g.mag).toBe(28)
    })
})

describe('spread', () => {
    const base = { hipSpread: 0.06, adsSpread: 0.01, adsBlend: 0, spreadMult: 1, move: 0, airborne: false, crouched: false, bloom: 0 }

    it('tightens when aiming and with perks, widens moving, in the air and while firing', () => {
        const hip = dfSpread(base)
        expect(hip).toBeCloseTo(0.06)
        // a rested aimed shot is near pinpoint; recent fire brings the aimed cone back
        expect(dfSpread({ ...base, adsBlend: 1 })).toBeCloseTo(0.001)
        expect(dfSpread({ ...base, adsBlend: 1, bloom: 0.06 })).toBeGreaterThan(0.01)
        expect(dfSpread({ ...base, spreadMult: 0.5 })).toBeCloseTo(0.03)
        expect(dfSpread({ ...base, move: 1 })).toBeGreaterThan(hip)
        expect(dfSpread({ ...base, airborne: true })).toBeGreaterThan(hip)
        expect(dfSpread({ ...base, bloom: 1 })).toBeGreaterThan(hip)
        expect(dfSpread({ ...base, crouched: true })).toBeLessThan(hip)
    })

    it('cone directions stay unit length and inside the cone', () => {
        const d = { x: 0, y: 0, z: -1 }
        const out = { x: 0, y: 0, z: 0 }
        for (const [u, v] of [[0, 0], [0.999, 0.25], [0.5, 0.9], [1, 0.5]] as const) {
            dfConeDir(d, 0.1, u, v, out)
            expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6)
            const ang = Math.acos(Math.min(1, -out.z))
            expect(ang).toBeLessThanOrEqual(0.1 + 1e-6)
        }
        dfConeDir({ x: 0, y: 1, z: 0 }, 0.05, 0.7, 0.3, out)
        expect(out.y).toBeGreaterThan(0.99)
    })
})

// ---------------------------------------------------------------- resolution + settings

describe('pixel ratio policy', () => {
    it('never renders below native on standard screens and supersamples when affordable', () => {
        const b = dfPixelRatioBounds(1, 1920, 1080, 'high')
        expect(b.min).toBe(1)
        expect(b.max).toBeCloseTo(1.5)
        expect(dfPixelRatioBounds(1, 1920, 1080, 'low').max).toBe(1)
        // a big standard-density screen is capped by the pixel budget but stays native
        const big = dfPixelRatioBounds(1, 3840, 2160, 'high')
        expect(big.min).toBe(1)
        expect(big.max).toBeGreaterThanOrEqual(1)
        expect(big.max).toBeLessThan(1.5)
    })

    it('lets high-density screens back off but not past the floor', () => {
        const b = dfPixelRatioBounds(2, 1440, 900, 'high')
        expect(b.min).toBeCloseTo(1.2)
        expect(b.max).toBe(2)
        let pr = 2
        for (let i = 0; i < 20; i++) pr = dfAdaptivePixelRatio(pr, 30, b, 0, false)
        expect(pr).toBeCloseTo(b.min)
        pr = dfAdaptivePixelRatio(pr, 15, b, 5, false)
        expect(pr).toBeGreaterThan(b.min)
        expect(dfAdaptivePixelRatio(1.5, 15, b, 5, true)).toBe(1.5)
    })
})

describe('settings', () => {
    it('clamps and defaults', () => {
        expect(dfSanitizeSettings({ fov: 200, sensitivity: -1, volume: 2 })).toEqual({ fov: 100, sensitivity: 0.2, volume: 1, sfxVolume: 1, quality: 'auto', invertY: false })
        expect(dfSanitizeSettings({ sfxVolume: -3, quality: 'ultra' as never })).toMatchObject({ sfxVolume: 0, quality: 'auto' })
        expect(dfSanitizeSettings({ quality: 'low' }).quality).toBe('low')
        expect(dfSanitizeSettings(null).fov).toBe(85)
        expect(dfVerticalFov(90, 16 / 9)).toBeCloseTo(58.7, 1)
    })
})
