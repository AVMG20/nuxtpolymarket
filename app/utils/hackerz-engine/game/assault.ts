import * as THREE from 'three'
import { randomChance } from '../rng'
import { HACKERZ_SPIDER_MAX_DRAIN } from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH, FIELD_SCALE, SPIT_GRAVITY, SPIT_SPEED, FENCE_HEIGHT } from '../constants'
import { randRange } from '../math'
import type { Hold } from '../deployables'
import { CRYSTAL_RIBBON_IDS, CrystalRibbon } from '../crystal-ribbon'
import { BLOCK_STORM_IDS, BlockStorm } from '../block-storm'
import { DrainWound } from '../drain-wound'
import { drainGrowth, fangTips, muzzleOf, weaponTip } from '../rig-motion'
import { fieldToWorld } from '../scene'
import { makeSpit } from '../fx'
import type { EnemyEntity } from '../types'
import { PER_WORLD, _v, _w, WALL_HIT_Y } from './tuning'
import { enemyWorld, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** The colour of an electric prod's discharge. */
const PROD_HEX = 0xbfe9ff

/**
 * What a hostile does once it reaches its stop: shoots, rams, prods,
 * drains or blows itself up on the fence, or on whatever stands in its way.
 */
export class Assault {
    constructor(private readonly game: HackerzGame) {}

    /**
     * A held unit beats on the honeypot or proxy wall in its way instead of the
     * fence. A sapper spends itself on it. True when the unit is gone.
     */
    strikeDeployable(enemy: EnemyEntity, hold: Hold) {
        const damage = enemy.damage * this.game.chipBuff(enemy)
        const at = fieldToWorld(enemy.u, hold.target.d, 1.2, new THREE.Vector3())
        this.game.particles.burst(at, hold.target.hex, 5, 7, { size: 0.2, life: 0.3 })
        if (enemy.def.kind === 'bomber') {
            this.game.deployables?.strike(hold.target, damage * 2)
            this.game.transient?.ring(at, enemy.def.hex, 7, 0.4)
            this.game.particles.burst(at, enemy.def.hex, 26, 14, { size: 0.32, life: 0.6 })
            this.game.addShake(6)
            const index = this.game.enemies.indexOf(enemy)
            if (index >= 0) this.game.combat.removeEnemy(index)
            return true
        }
        if (enemy.def.cloaked && !enemy.decloaked) enemy.decloaked = true
        // A spiderling sinks its fangs into a proxy wall and drains it like the fence.
        if (enemy.def.drain && hold.target.kind === 'proxy') {
            this.drainFence(enemy, damage, hold.target)
            return false
        }
        this.game.deployables?.strike(hold.target, damage)
        return false
    }

    /** What an enemy does when it reaches its stopping distance. */
    enemyStrike(enemy: EnemyEntity) {
        const damage = enemy.damage * this.game.chipBuff(enemy)
        // The last healers of a wave go off on the fence like a weak Sapper.
        switch (enemy.kamikaze ? 'bomber' : enemy.def.kind) {
            case 'ranged': {
                const heavy = enemy.def.id === 'artillery'
                // The shot leaves from the muzzle itself (shared with the
                // database turntable), not from somewhere inside the body.
                placeEnemy(enemy)
                // Twin guns (a Gunship's) take turns down the volley.
                const muzzle = muzzleOf(enemy.rig, new THREE.Vector3(), enemy.burstLeft)
                const from = { u: muzzle.x / FIELD_SCALE, d: -muzzle.z / FIELD_SCALE, y: muzzle.y / FIELD_SCALE }
                const speed = heavy ? SPIT_SPEED * 1.5 : SPIT_SPEED
                const flightTime = Math.max(0.35, from.d / speed)
                const mesh = makeSpit(enemy.def.hex, heavy)
                this.game.fieldRoot.add(mesh)
                this.game.spits.push({
                    mesh,
                    u: from.u,
                    d: from.d,
                    y: from.y,
                    vd: -from.d / flightTime,
                    vy: (WALL_HIT_Y - from.y) / flightTime + 0.5 * SPIT_GRAVITY * flightTime,
                    damage,
                    hex: enemy.def.hex,
                    heavy
                })
                this.game.transient?.flash(muzzle, enemy.def.hex, heavy ? 0.9 : 0.5)
                enemy.recoil = 1
                break
            }
            case 'bomber': {
                this.game.bastion.damageWall(damage, enemy.u)
                // It goes up: the spikes are blown off the cage in every direction.
                placeEnemy(enemy)
                this.game.shrapnel?.burst(enemy.rig, enemy.def.hex)
                const at = enemyWorld(enemy, 10, _v)
                this.game.transient?.flash(at, enemy.def.hex, 2.6, 0.25)
                this.game.transient?.ring(at, enemy.def.hex, 9, 0.45)
                this.game.particles.burst(at, enemy.def.hex, 30, 16, { size: 0.35, life: 0.7 })
                this.game.addShake(14)
                this.game.callbacks.onNotice(`A ${enemy.def.name} reached the wall.`, 'bad')
                this.game.sysLog.sapperHit(Math.floor((enemy.u + FIELD_HALF_WIDTH) / 100) + 1, this.game.bastion.integrityPercent())
                const index = this.game.enemies.indexOf(enemy)
                if (index >= 0) this.game.combat.removeEnemy(index)
                break
            }
            default: {
                // A spiderling latches on and drains instead of striking.
                if (enemy.def.drain) {
                    this.drainFence(enemy, damage)
                    break
                }
                // A cloaked unit has to drop its cloak to strike.
                if (enemy.def.cloaked && !enemy.decloaked) {
                    enemy.decloaked = true
                    this.game.particles.burst(enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.5, _v), enemy.def.hex, 14, 6, { size: 0.24, life: 0.4 })
                }
                this.game.bastion.damageWall(damage, enemy.u)
                this.game.particles.burst(fieldToWorld(enemy.u, 4, FENCE_HEIGHT * 0.5, _v), enemy.def.hex, 5, 8, { size: 0.2, life: 0.3 })
                // A unit with a melee weapon (the Warden's prod) jabs it home.
                enemy.strike = 1
                // A Phantom's strikes are a crystal ribbon: each keeps it fed until the next.
                if (CRYSTAL_RIBBON_IDS.includes(enemy.def.id)) enemy.ribbonMs = enemy.def.attackMs * 1.3
                // ZERO DAY's are its own body: it comes apart at the wall and regrows from its gem.
                if (BLOCK_STORM_IDS.includes(enemy.def.id)) this.blockStorm(enemy)
                // A leaking unit (the Daemon) heaves a leaked block onto the pile;
                // it only starts draining once it lands there.
                if (enemy.def.leak && enemy.heave <= 0 && enemy.rig.lifts.length) {
                    enemy.heave = 1
                    enemy.heaveDrain = damage * enemy.def.leak
                }
                break
            }
        }
    }

    /** A Phantom's ribbon: crystals out of its chest, round its crossing orbits, and off the front at the fence. */
    feedRibbon(enemy: EnemyEntity, dt: number, dtMs: number) {
        enemy.ribbonMs = Math.max(0, enemy.ribbonMs - dtMs)
        const height = enemy.rig.height
        enemy.ribbon ??= new CrystalRibbon(this.game.fieldRoot, enemy.def.hex, height, at => {
            if (randomChance(0.35)) this.game.particles.burst(at, enemy.def.hex, 3, 5, { size: 0.16, life: 0.25 })
        })
        const chest = enemyWorld(enemy, height * PER_WORLD * 0.6, new THREE.Vector3())
        const target = fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.55, new THREE.Vector3())
        const forward = target.clone().sub(chest).normalize()
        enemy.ribbon.update(dt, enemy.ribbonMs > 0, chest, forward, target)
    }

    /** ZERO DAY's blow: its blocks burst off, sweep past its gem and pelt the fence; it regrows after. */
    private blockStorm(enemy: EnemyEntity) {
        placeEnemy(enemy)
        enemy.storm ??= new BlockStorm(enemy.rig, this.game.fieldRoot, enemy.def.hex, at => {
            this.game.particles.burst(at, enemy.def.hex, 4, 6, { size: 0.22, life: 0.3 })
        })
        enemy.storm.start(fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.5, new THREE.Vector3()))
    }

    /** The ram slamming home: sparks and grit off the plate, a shock along the fence, a jolt. */
    ramImpact(enemy: EnemyEntity) {
        placeEnemy(enemy)
        const face = weaponTip(enemy.rig, new THREE.Vector3())
        if (!face) return
        this.game.particles.burst(face, 0xffd08a, 26, 9, { size: 0.24, life: 0.4, gravity: 12 })
        this.game.particles.burst(face, enemy.def.hex, 12, 5, { size: 0.32, life: 0.5 })
        this.game.transient?.ring(fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.3, _v), enemy.def.hex, 3.2, 0.35)
        this.game.addShake(7)
    }

    /** The prod's discharge: arcs from its tip into the fence, and a spit of sparks. */
    prodZap(enemy: EnemyEntity) {
        placeEnemy(enemy)
        const tip = weaponTip(enemy.rig, new THREE.Vector3())
        if (!tip) return
        const fence = fieldToWorld(enemy.u, 0, FENCE_HEIGHT * 0.45, new THREE.Vector3())
        this.game.transient?.bolt(tip, fence, PROD_HEX)
        this.game.transient?.bolt(tip, fence.clone().add(_w.set(randRange(-0.6, 0.6), randRange(-0.4, 0.4), 0)), PROD_HEX)
        this.game.particles.burst(tip, PROD_HEX, 10, 6, { size: 0.18, life: 0.25 })
    }

    /**
     * A spiderling drains the fence (the ICE Barrier first): quietly, like a
     * leak, and harder every time. What it drains feeds it: it grows, its
     * health with it, and it heals by what it took.
     */
    private drainFence(enemy: EnemyEntity, damage: number, proxy: Hold['target'] | null = null) {
        const dealt = damage * enemy.drainPower
        // The fence (its ICE Barrier first), or the proxy wall standing in the way.
        if (proxy) this.game.deployables?.strike(proxy, dealt)
        else this.game.bastion.damageWall(dealt, enemy.u, true)
        const before = drainGrowth(enemy.drainPower)
        enemy.drainPower = Math.min(HACKERZ_SPIDER_MAX_DRAIN, enemy.drainPower * (1 + enemy.def.drain!))
        enemy.maxHp *= drainGrowth(enemy.drainPower) / before
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + dealt)
        // The bite: its fangs drive in, a red stain spills out round them, and
        // the draw pulses in from the stain's edge, up the fangs, into it.
        enemy.inject = 1
        placeEnemy(enemy)
        const tips = fangTips(enemy.rig)
        const bite = tips.length ? tips.reduce((sum, t) => sum.add(t), new THREE.Vector3()).divideScalar(tips.length) : enemyWorld(enemy, 6, new THREE.Vector3())
        const surfaceD = proxy ? proxy.d + 4 : 1
        const at = fieldToWorld(enemy.u, surfaceD, bite.y * PER_WORLD, new THREE.Vector3())
        enemy.wound ??= new DrainWound(this.game.fieldRoot, enemy.def.hex)
        // The surface faces the field: back toward the spiderling.
        enemy.wound.place(at, _w.set(0, 0, -1), enemy.rig.height * drainGrowth(enemy.drainPower) * 0.9)
        enemy.wound.draw(enemyWorld(enemy, enemy.rig.height * PER_WORLD * 0.45, new THREE.Vector3()))
    }
}
