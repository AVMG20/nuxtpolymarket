// Void Runner — extraction beacons. A sector's two beacons start in raider
// hands: clear the guards, hold through the waves and the beacon is yours, with
// a friendly picket and richer rock around it. The server remembers who holds
// what; after 32 hours raiders may come back for one.

import * as THREE from 'three'
import { randomFloat, randomInt } from '#shared/utils/random'
import { VOID_BEACON_ORE_BONUS, VOID_BEACON_ZONE_RADIUS, type VoidBeaconState } from '#shared/utils/gamelogic/void'
import { ENEMIES, type EnemyKind } from './data'
import { spawnEnemy } from './enemies'
import { mulberry32 } from './models'
import { buildBeacon } from './structures'
import type { Asteroid } from './asteroids'
import { disposeTree, type Structure, type VoidEngine } from './engine'

export type BeaconSiteState = 'hostile' | 'contested' | 'owned' | 'attacked'

export interface BeaconSite {
    slot: number
    structure: Structure
    state: BeaconSiteState
    wave: number
    waves: number
    /** Seconds until the next wave warps in. */
    timer: number
    /** Seconds the pilot has been away from a contested beacon. */
    away: number
    inside: boolean
}

const COLORS: Record<BeaconSiteState, number> = { hostile: 0xff5a36, contested: 0xffb02e, owned: 0x3dffb0, attacked: 0xffb02e }
const ALLY_GLOW = 0x3dffb0
const DOCK_RADIUS = 40
/** What a wave may spend on each hull. Mites come three at a time. */
const COST: Partial<Record<EnemyKind, number>> = { mite: 1.05, raider: 1, lancer: 1.6, leech: 1.5, blinker: 2, minelayer: 2, bulwark: 2.5, ravager: 4, mauler: 6 }

const _c = new THREE.Color()

function randDir(flatten = 0.3) {
    return new THREE.Vector3(randomFloat() - 0.5, (randomFloat() - 0.5) * flatten, randomFloat() - 0.5).normalize()
}

/** Where a sector's beacons sit: the same two spots on every visit, so a captured beacon is a place. */
export function beaconPositions(tier: number) {
    const rng = mulberry32(tier * 7919 + 17)
    const out: THREE.Vector3[] = []
    for (let tries = 0; out.length < 2 && tries < 60; tries++) {
        const dir = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.25, rng() - 0.5).normalize()
        if (out.some(o => o.clone().normalize().dot(dir) > 0.2)) continue
        out.push(dir.multiplyScalar(1300 + rng() * 350))
    }
    return out
}

/** Fills a budget with hulls the sector fields, heavies first. */
function composeWave(tier: number, budget: number, heavy: EnemyKind[]): EnemyKind[] {
    const out: EnemyKind[] = []
    for (const kind of heavy) {
        out.push(kind)
        budget -= COST[kind] ?? 1
    }
    const pool = (Object.keys(COST) as EnemyKind[]).filter(k => ENEMIES[k].weights[tier - 1]! > 0)
    while (budget >= 1 && out.length < 14) {
        const fits = pool.filter(k => COST[k]! <= budget)
        if (!fits.length) break
        const total = fits.reduce((s, k) => s + ENEMIES[k].weights[tier - 1]!, 0)
        let roll = randomFloat() * total
        let kind = fits[0]!
        for (const k of fits) {
            roll -= ENEMIES[k].weights[tier - 1]!
            if (roll < 0) {
                kind = k
                break
            }
        }
        budget -= COST[kind]!
        if (kind === 'mite') out.push('mite', 'mite', 'mite')
        else out.push(kind)
    }
    return out
}

export class BeaconControl {
    sites: BeaconSite[] = []
    captured: number[] = []
    defended: number[] = []
    private alerted = false

    constructor(private engine: VoidEngine) {}

    /** True while a capture or a defence is being fought, so the director holds its wings back. */
    get fighting() {
        return this.sites.some(s => s.state === 'contested')
    }

    /** Builds the sector's two beacons in the state the server reports. Returns their bearings. */
    setup(states: VoidBeaconState[]) {
        const e = this.engine
        const tier = e.config!.sector.tier
        const dirs: THREE.Vector3[] = []
        beaconPositions(tier).forEach((pos, slot) => {
            const state: BeaconSiteState = states[slot] ?? 'hostile'
            dirs.push(pos.clone().normalize())
            const model = buildBeacon(COLORS[state])
            model.group.position.copy(pos)
            model.group.scale.setScalar(2.2)
            e.scene.add(model.group)
            const structure: Structure = { kind: 'beacon', group: model.group, pos, radius: 16, dockRadius: state === 'owned' ? DOCK_RADIUS : 0, spin: [model.ringA, model.ringB] }
            e.structures.push(structure)
            const site: BeaconSite = { slot, structure, state, wave: 0, waves: 0, timer: 0, away: 0, inside: false }
            this.sites.push(site)
            // Keep the fight clear of big rock.
            const doomed: Asteroid[] = []
            e.asteroids?.query(pos, 70, rock => doomed.push(rock))
            for (const rock of doomed) e.asteroids!.remove(rock)
            if (state === 'owned') this.spawnAllies(site)
            else if (state === 'attacked') this.spawnAttack(site)
            else this.spawnGuards(site)
        })
        return dirs
    }

    clear() {
        this.sites = []
    }

    oreMult(pos: THREE.Vector3) {
        const r2 = VOID_BEACON_ZONE_RADIUS * VOID_BEACON_ZONE_RADIUS
        return this.sites.some(s => s.state === 'owned' && s.structure.pos.distanceToSquared(pos) < r2) ? 1 + VOID_BEACON_ORE_BONUS : 1
    }

    label(site: BeaconSite) {
        if (site.state === 'owned') return 'BEACON'
        if (site.state === 'attacked') return 'BEACON UNDER ATTACK'
        if (site.state === 'contested') return site.wave ? `BEACON · WAVE ${site.wave}/${site.waves}` : 'BEACON · CONTESTED'
        return 'HOSTILE BEACON'
    }

    /** CSS colour for the HUD; an attacked beacon pulses between green and red. */
    color(site: BeaconSite) {
        if (site.state === 'owned') return '#3dffb0'
        if (site.state === 'hostile') return '#ff7a5e'
        if (site.state === 'contested') return '#ffb02e'
        return Math.sin(this.engine.time * 3) > 0 ? '#ff4a55' : '#3dffb0'
    }

    private alive(site: BeaconSite) {
        let n = 0
        for (const en of this.engine.enemies) if (en.alive && en.data.site === site.slot + 1) n++
        return n
    }

    private spawnGroup(site: BeaconSite, kinds: EnemyKind[], near: number, far: number, aggro: boolean, elite = -1) {
        const e = this.engine
        const group = 9000 + e.nextId()
        const centre = site.structure.pos.clone().addScaledVector(randDir(0.3), aggro ? (near + far) / 2 : 0)
        kinds.forEach((kind, i) => {
            const big = kind === 'ravager' || kind === 'mauler'
            const offset = aggro ? randDir(0.5).multiplyScalar(20 + randomFloat() * 50 + (big ? 40 : 0)) : randDir(0.4).multiplyScalar(near + randomFloat() * (far - near))
            const en = spawnEnemy(e, kind, centre.clone().add(offset), { aggro, group, warpIn: aggro, elite: i === elite })
            en.data.site = site.slot + 1
        })
    }

    private spawnGuards(site: BeaconSite) {
        const tier = this.engine.config!.sector.tier
        this.spawnGroup(site, composeWave(tier, 3 + tier * 1.5, tier >= 3 ? ['ravager'] : []), 70, 160, false)
        for (let i = 0; i < (tier >= 4 ? 2 : tier >= 2 ? 1 : 0); i++) {
            const en = spawnEnemy(this.engine, 'sentinel', site.structure.pos.clone().addScaledVector(randDir(0.3), 90), { aggro: false })
            en.data.site = site.slot + 1
        }
    }

    /** One heavy wave sitting on a beacon the pilot already holds. No picket: the pilot fights it alone. */
    private spawnAttack(site: BeaconSite) {
        const tier = this.engine.config!.sector.tier
        const kinds = composeWave(tier, 9 + tier * 3.5, tier >= 2 ? ['mauler', 'ravager'] : ['ravager', 'ravager'])
        this.spawnGroup(site, kinds, 80, 200, false, kinds.length > 2 ? 2 : -1)
    }

    private spawnWave(site: BeaconSite) {
        const tier = this.engine.config!.sector.tier
        const last = site.wave === site.waves
        const heavy: EnemyKind[] = !last ? (site.wave > 1 && tier >= 3 ? ['ravager'] : []) : tier >= 4 ? ['mauler'] : ['ravager']
        this.spawnGroup(site, composeWave(tier, 4 + tier * 2 + (site.wave - 1) * 2, heavy), 210, 280, true)
    }

    private spawnAllies(site: BeaconSite) {
        const e = this.engine
        const tier = e.config!.sector.tier
        const count = 2 + Math.floor(tier / 2)
        for (let i = 0; i < count; i++) {
            const kind: EnemyKind = i === 0 ? 'ravager' : i % 2 ? 'raider' : 'lancer'
            const ally = spawnEnemy(e, kind, site.structure.pos.clone().addScaledVector(randDir(0.3), 70 + randomFloat() * 120), { aggro: false, group: 9500 + site.slot, glow: ALLY_GLOW })
            ally.hostile = false
            ally.data.coalition = 1
            ally.data.ally = 1
            ally.name = i === 0 ? 'Beacon Warden' : 'Beacon Guard'
            ally.anchor.copy(site.structure.pos)
            ally.cooldown = 1 + randomFloat()
        }
    }

    private recolor(site: BeaconSite) {
        const e = this.engine
        const old = site.structure.group
        const model = buildBeacon(COLORS[site.state])
        model.group.position.copy(old.position)
        model.group.scale.copy(old.scale)
        e.scene.remove(old)
        disposeTree(old)
        e.scene.add(model.group)
        site.structure.group = model.group
        site.structure.spin = [model.ringA, model.ringB]
    }

    private secure(site: BeaconSite, defended: boolean) {
        const e = this.engine
        const pos = site.structure.pos
        site.state = 'owned'
        site.structure.dockRadius = DOCK_RADIUS
        this.recolor(site)
        this.spawnAllies(site)
        ;(defended ? this.defended : this.captured).push(site.slot)
        e.events.banner(defended ? 'Beacon held' : 'Beacon captured', `Extraction point online · +${Math.round(VOID_BEACON_ORE_BONUS * 100)}% ore from rocks in its zone`, 'good')
        e.audio.play('levelUp')
        e.rings.spawn(pos, VOID_BEACON_ZONE_RADIUS, ALLY_GLOW, 1.6, 2)
        e.rings.spawn(pos, 120, 0xffffff, 1, 1.5, undefined, 0.04)
        e.flashes.flash(pos, ALLY_GLOW, 200, 400, 1)
        e.dropLoot('alloy', 6, 10, pos)
        e.dropLoot('scrap', 15, 25, pos)
        if (randomFloat() < 0.35) e.dropFuel(pos)
    }

    update(dt: number) {
        const e = this.engine
        const p = e.player
        if (!p?.alive || e.phase !== 'flying') return
        if (!this.alerted && e.elapsed >= 20) {
            this.alerted = true
            if (this.sites.some(s => s.state === 'attacked')) {
                e.events.banner('Beacon under attack', 'Raiders are on one of your beacons. The picket is gone: beat them off alone.', 'bad')
                e.audio.play('wardenAlert')
            }
        }
        for (const site of this.sites) {
            const dist = site.structure.pos.distanceTo(p.pos)
            const left = this.alive(site)
            if (site.state === 'hostile') {
                if (left === 0 && dist < 700) {
                    const tier = e.config!.sector.tier
                    site.state = 'contested'
                    site.waves = randomInt(tier >= 4 ? 2 : 1, Math.min(4, tier + 1))
                    site.wave = 0
                    site.timer = 4
                    site.away = 0
                    this.recolor(site)
                    e.events.banner('Beacon contested', `${site.waves} ${site.waves === 1 ? 'wave' : 'waves'} inbound. Hold the beacon.`, 'info')
                    e.audio.play('warning')
                }
            } else if (site.state === 'contested') {
                site.away = dist > 1100 ? site.away + dt : 0
                if (site.away > 20) {
                    // Whoever is left digs in as the new garrison.
                    site.state = 'hostile'
                    this.recolor(site)
                    for (const en of e.enemies) {
                        if (!en.alive || en.data.site !== site.slot + 1) continue
                        en.aggro = false
                        en.anchor.copy(site.structure.pos).addScaledVector(randDir(0.4), 60 + randomFloat() * 90)
                    }
                    e.events.toast('Beacon capture abandoned', 'warn')
                } else if (left === 0) {
                    if (site.wave >= site.waves) {
                        this.secure(site, false)
                    } else if ((site.timer -= dt) <= 0) {
                        site.wave++
                        site.timer = 4
                        this.spawnWave(site)
                        e.events.toast(`Beacon wave ${site.wave}/${site.waves}`, 'warn')
                        e.audio.play('blink')
                    }
                }
            } else if (site.state === 'attacked') {
                if (left === 0) this.secure(site, true)
            } else {
                const inside = dist < VOID_BEACON_ZONE_RADIUS
                if (inside && !site.inside) e.events.toast(`Friendly beacon zone · +${Math.round(VOID_BEACON_ORE_BONUS * 100)}% ore`, 'good')
                site.inside = inside
            }
            this.drawZone(site, dist)
        }
    }

    /** A faint ring in space at the edge of a held beacon's zone. */
    private drawZone(site: BeaconSite, dist: number) {
        if (site.state !== 'owned' && site.state !== 'attacked') return
        if (dist > VOID_BEACON_ZONE_RADIUS + 700) return
        const e = this.engine
        const pos = site.structure.pos
        const r = VOID_BEACON_ZONE_RADIUS
        const red = site.state === 'attacked' ? 0.5 + Math.sin(e.time * 3) * 0.5 : 0
        _c.set(ALLY_GLOW).lerp(new THREE.Color(0xff4a55), red).multiplyScalar(1.4)
        const n = 96
        for (let i = 0; i < n; i++) {
            if (i % 3 === 2) continue
            const a0 = (i / n) * Math.PI * 2 - e.time * 0.03
            const a1 = ((i + 1) / n) * Math.PI * 2 - e.time * 0.03
            e.lines.push(pos.x + Math.cos(a0) * r, pos.y, pos.z + Math.sin(a0) * r, pos.x + Math.cos(a1) * r, pos.y, pos.z + Math.sin(a1) * r, _c, 0.35, 0.8)
        }
    }
}
