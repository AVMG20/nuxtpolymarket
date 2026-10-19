import { randomChance } from '../rng'
import { HACKERZ_HACKER_ID, hackerzIsAirborne } from '#shared/utils/gamelogic/hackerz'
import { DESPAWN_DEPTH, FIELD_SCALE, SPIKE_BAND } from '../constants'
import { randRange } from '../math'
import type { PathChip } from '../path-chips'
import type { Hold } from '../deployables'
import { segmentDirection } from '../data-lines'
import { poseRig } from '../models'
import {
    MOTION,
    easeRecoil,
    easeSheen,
    hitFlash,
    drainGrowth,
    gatherLegs,
    easeInject,
    easeStrike,
    injectLands,
    rollSpeedFor,
    strideFor,
    strikeLands
} from '../rig-motion'
import { AMBER, CYAN } from '../scene'
import type { EnemyEntity, RouteGoal } from '../types'
import { PER_WORLD, _v, _w, ZONE_TICK_MS, GLITCH_FADE_MS, HACK_TEAM, HACK_REACH, PING_REVEAL_MS } from './tuning'
import { burrowing, enemyWorld, glitchOf, placeEnemy, underground, unitSize } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/** With a node's team full (`HACK_TEAM`), how much further out the next hacker waits for a free terminal. */
const HACK_QUEUE_GAP = 70

/** Each bite of held ground: this share of a unit's max health (far less for a boss), plus a flat bite. */
const ZONE_TICK_SHARE = 0.025
const ZONE_TICK_BOSS_SHARE = 0.006

/**
 * Every hostile's turn, each frame: where it goes, what it does when it
 * gets there, and how the board treats it on the way.
 */
export class EnemyAi {
    constructor(private readonly game: HackerzGame) {}

    updateEnemies(dt: number, dtMs: number) {
        // The Tarpit Grid runs off the gun's magazine: dead while it reloads.
        const spikeDps = this.game.rail.tarpitPowered ? this.game.loadout?.spikeDps ?? 0 : 0
        let spiking = false

        for (let i = this.game.enemies.length - 1; i >= 0; i--) {
            const enemy = this.game.enemies[i] as EnemyEntity
            // Felled in a brawl or by a Power Surge since its last turn: a hostile
            // pays out as any kill; a turned unit that falls pays nothing.
            if (enemy.hp <= 0) {
                this.game.combat.killEnemy(i, enemy.turned ? 0 : 1)
                continue
            }
            // Waiting inside the portal for its socket to clear: it steps out
            // (and resolves in) only once nothing is standing there.
            if (enemy.gateHold) {
                if (this.game.crowd.crowdedAt(enemy)) continue
                enemy.gateHold = false
                enemy.age = 0
                enemy.rig.root.visible = true
            }
            enemy.age += dt
            // Where it stood before this tick's move, for the collision check below.
            const fromU = enemy.u
            const fromD = enemy.d
            const fromSeg = enemy.routeSeg
            const fromYaw = enemy.yaw
            if (enemy.def.boss) this.updateBoss(enemy, dt, dtMs)
            // A shield bearer whose node was taken back disintegrates on the spot.
            if (enemy.bearer && this.game.running && !this.game.purging && this.game.squads.keepBearerPost(enemy, i)) continue
            const riding = this.game.movement.ridesNetwork(enemy)
            // A honeypot or proxy wall in the way is where this unit stops instead.
            let hold: Hold | null = enemy.burrowMs > 0 || enemy.def.boss
                ? null
                : this.game.deployables?.holdFor(enemy.u, enemy.d, enemy.standoff, hackerzIsAirborne(enemy.def)) ?? null
            // A spiderling is not fooled by a honeypot: it only stops for what it can drain.
            if (hold?.target.kind === 'honeypot' && enemy.def.drain) hold = null
            // A honeypot only draws a rider whose line runs past it.
            if (hold?.target.kind === 'honeypot' && riding
                && !this.game.movement.routeAheadPasses(enemy, hold.target.u, hold.target.d, 90)) hold = null
            // Hackers go for the next path node still ahead on their lines — and
            // when none is left ahead, they double back for one that is still open.
            let node = !hold && !enemy.turned && this.game.hacking.canHack(enemy) ? this.game.hacking.hackTarget(enemy) : null
            if (!node && !hold && riding && this.game.hacking.canHack(enemy)) {
                const open = this.game.pathChips?.ordered.filter(chip => chip.state !== 'hacked') ?? []
                const nearest = open.reduce<PathChip | null>((best, chip) =>
                    !best || Math.hypot(chip.u - enemy.u, chip.d - enemy.d) < Math.hypot(best.u - enemy.u, best.d - enemy.d) ? chip : best, null)
                if (nearest && this.game.movement.planDetour(enemy, nearest)) node = this.game.hacking.hackTarget(enemy)
            }
            if (enemy.def.id === HACKERZ_HACKER_ID && riding) this.game.hacking.dodge(enemy, dtMs)
            if (!node && enemy.hacking) this.game.hacking.stopHacking(enemy)

            // Only so many can work one node at once; the rest close in and wait
            // a step further out, ready to take the next free terminal.
            const queued = !!node && !enemy.hacking
                && this.game.enemies.filter(e => e.hacking && e.targetChip === node).length >= HACK_TEAM
            const reach = HACK_REACH * (0.55 + 0.45 * enemy.hackReach) + (queued ? HACK_QUEUE_GAP : 0)
            const pot = hold?.target.kind === 'honeypot' ? hold.target : null
            const goal: RouteGoal = node
                ? { stopD: enemy.standoff, near: (u, d) => Math.hypot(u - node.u, d - node.d) <= reach }
                : pot
                    ? { stopD: hold!.stopD, near: (u, d) => Math.hypot(u - pot.u, d - pot.d) <= 80 }
                    : { stopD: hold ? hold.stopD : enemy.standoff }

            // Tactics: a wounded weakling falls back toward red or holds there to
            // heal, and healthier units in front of a retreating one hold the
            // line to cover it. Everyone else gets on with the attack.
            const tactic = riding || enemy.bearer || enemy.defending || enemy.escorting ? this.game.squads.tactics(enemy, dtMs) : 'advance'
            if (enemy.parked && (tactic !== 'advance' || node || hold)) enemy.parked = null
            const parked = enemy.parked
            const live = this.game.running && !this.game.purging
            // A turned unit hunts hostiles; a hostile with one in its face fights
            // it; a healer flies its own rounds; everyone else gets on with it.
            const mending = enemy.turned
                ? (live ? this.game.whiteHats.turnedStep(enemy, dt, dtMs) : { moved: 0, arrived: false })
                : (live ? this.game.whiteHats.brawlStep(enemy, dtMs) : null)
                    ?? (enemy.def.heal && !enemy.kamikaze && live ? this.game.healers.healerStep(enemy, dt, dtMs) : null)
            const step = mending ?? (enemy.demoPath
                ? this.game.movement.puppetStep(enemy, goal, hold, dt)
                : parked
                ? this.game.squads.walkToPark(enemy, parked, dt)
                : tactic === 'advance'
                    ? (node && !queued && riding ? this.game.hacking.parkStep(enemy, node, dt) : null)
                    ?? (riding ? this.game.movement.ride(enemy, goal, dt) : this.game.movement.fly(enemy, goal, dt))
                    : { moved: this.game.squads.holdBack(enemy, tactic, dt), arrived: false })
            if (!node || queued || tactic !== 'advance') enemy.hackSlot = null
            // Stride is driven by distance, not time, so a knocked-back or
            // crowded enemy never moon-walks.
            enemy.stride += strideFor(step.moved, unitSize(enemy.def))
            let rollSpeed = rollSpeedFor(step.moved, enemy.rig.height, dt, FIELD_SCALE)

            if (tactic !== 'advance') {
                if (enemy.hacking) this.game.hacking.stopHacking(enemy)
            } else if (!step.arrived) {
                if (enemy.hacking) this.game.hacking.stopHacking(enemy)
            } else if (node && queued) {
                // Waiting its turn at the node: idling on the spot.
                rollSpeed = 0
            } else if (node) {
                rollSpeed = 0
                this.game.hacking.hackAt(enemy, node, dtMs)
            } else if (!hold && this.game.squads.parkAside(enemy)) {
                // A gun that set up beside a node would read as its guard: it
                // steps aside first, and opens fire from there.
            } else {
                rollSpeed = 0
                enemy.attackTimer -= dtMs
                if (enemy.attackTimer <= 0) {
                    // Burst types fire a short volley, then take the full gap.
                    if (enemy.burstLeft <= 0) enemy.burstLeft = enemy.def.burst ?? 1
                    enemy.burstLeft--
                    enemy.attackTimer = enemy.burstLeft > 0 ? MOTION.burstGapMs : enemy.def.attackMs
                    if (hold) {
                        if (this.game.assault.strikeDeployable(enemy, hold)) continue
                    } else {
                        this.game.assault.enemyStrike(enemy)
                        if (enemy.def.kind === 'bomber' || enemy.kamikaze) continue
                    }
                }
            }

            // Knockback decays rather than stopping dead, so a pulse reads as a
            // shove rather than a teleport. A rider is shoved back up its own
            // line, never off it: not past the corner it came round, and not at
            // all while it is running across.
            let ceiling = Infinity
            if (riding && enemy.route) {
                const a = enemy.route[enemy.routeSeg]
                const b = enemy.route[enemy.routeSeg + 1]
                if (!a || !b || segmentDirection(a, b) !== 'down') enemy.pushVd = 0
                else ceiling = a.d
            }
            if (enemy.pushVd !== 0) {
                enemy.d = Math.min(ceiling, enemy.d + enemy.pushVd * dt)
                enemy.pushVd *= Math.max(0, 1 - dt * 4)
                if (Math.abs(enemy.pushVd) < 4) enemy.pushVd = 0
                if (enemy.d > DESPAWN_DEPTH) {
                    this.game.combat.removeEnemy(i)
                    continue
                }
            }

            // Bodies are solid: a move that would carry this one into another
            // stops at the point of contact.
            this.game.crowd.collide(enemy, fromU, fromD, fromSeg, fromYaw, dtMs)

            // Grid trap: ground units only, and only inside the band.
            if (spikeDps > 0 && !enemy.turned && !hackerzIsAirborne(enemy.def) && enemy.d < SPIKE_BAND) {
                spiking = true
                this.game.combat.damageEnemy(enemy, spikeDps * dt, 'kinetic', false, false, false, false)
                if (enemy.hp <= 0) {
                    this.game.combat.killEnemy(i, 1)
                    continue
                }
                if (randomChance(dt * 4)) {
                    this.game.particles.burst(enemyWorld(enemy, 4, _v), AMBER, 4, 6, { size: 0.18, life: 0.25 })
                }
            }

            // Held ground bites: anything that has pushed down into the blue
            // takes a steady tick of damage for as long as it stays there.
            // Behind a shield wall the ground's bite does not reach.
            // A unit still carrying its shield (a Warden) shrugs the ground off.
            // A demo unit does too, unless its scene is about the ground itself.
            if (this.game.running && !this.game.purging && !enemy.turned && (!enemy.demoPath || this.game.demoDirector.script?.ground) && this.game.territory.inHeldGround(enemy) && !this.game.squads.isSheltered(enemy) && enemy.guard <= 0) {
                enemy.zoneTick += dtMs
                // Sappers are built to run the gauntlet: they only feel every second tick.
                if (enemy.zoneTick >= ZONE_TICK_MS && enemy.def.kind === 'bomber' && ++enemy.zoneTicks % 2 === 1) {
                    enemy.zoneTick -= ZONE_TICK_MS
                } else if (enemy.zoneTick >= ZONE_TICK_MS) {
                    enemy.zoneTick -= ZONE_TICK_MS
                    const share = enemy.def.boss ? ZONE_TICK_BOSS_SHARE : ZONE_TICK_SHARE
                    const bite = enemy.maxHp * share + 2 + this.game.wave * 0.6
                    // A tick is the ground biting, not a hit: it never pops a shield.
                    this.game.combat.damageEnemy(enemy, bite, 'energy', false, !this.game.combat.untouchable(enemy), false, false)
                    this.game.particles.burst(enemyWorld(enemy, 3, _v), CYAN, 4, 5, { size: 0.18, life: 0.3 })
                    if (enemy.hp <= 0) {
                        this.game.combat.killEnemy(i, 1)
                        continue
                    }
                }
            } else {
                enemy.zoneTick = 0
            }
            this.game.territory.redGround(enemy, dtMs)

            if (hackerzIsAirborne(enemy.def)) enemy.hover += dt * MOTION.hoverRate
            if (enemy.flashMs > 0) enemy.flashMs = Math.max(0, enemy.flashMs - dtMs)

            // Radar: the ping's wavefront lights a contact when it arrives.
            if (enemy.pingDelay >= 0) {
                enemy.pingDelay -= dtMs
                if (enemy.pingDelay < 0) enemy.revealMs = PING_REVEAL_MS
            }
            if (enemy.revealMs > 0) enemy.revealMs = Math.max(0, enemy.revealMs - dtMs)

            // PACKET LOSS: the picture lags. During a lag spike the whole board
            // holds where it was last seen — pose, turn, flash, sheen, all of it —
            // while everything carries on moving, and the rounds go where they
            // really are, not where they look.
            if (this.game.lag.boardLagMs > 0) continue

            easeSheen(enemy.rig, enemy.redShield, dt)
            // Riders snap round corners like a light cycle (turned in `ride`); flyers face the fence.
            enemy.rig.root.rotation.y = enemy.yaw
            // A turned unit glows faintly white: it is ours now.
            enemy.rig.body.uniforms.uFlash!.value = Math.max(hitFlash(enemy.flashMs), enemy.turned ? 0.3 : 0)
            // A blast's corruption tears the body's polygons into slipping bands, easing out.
            if (enemy.glitchMs) enemy.glitchMs = Math.max(0, enemy.glitchMs - dtMs)
            if (enemy.phaseMs) enemy.phaseMs = Math.max(0, enemy.phaseMs - dtMs)
            // Passing through another body tears it too (`phaseMs`), without the skips.
            enemy.rig.body.uniforms.uGlitch!.value = Math.max(glitchOf(enemy), Math.min(1, (enemy.phaseMs ?? 0) / GLITCH_FADE_MS))
            // The dark hides a unit gradually, in its own shader (see `shroud` in
            // models): only a burrowed or cloaked one drops out of the picture
            // outright. A ping lifts the shroud off it, eased in and out.
            const cloakedAway = !!enemy.def.cloaked && !enemy.decloaked && enemy.revealMs <= 0
            // A burrowing ROOTKIT stays in sight while it melts into the floor.
            enemy.rig.root.visible = !underground(enemy) && !cloakedAway
            if (enemy.litMs) enemy.litMs = Math.max(0, enemy.litMs - dtMs)
            enemy.rig.reveal.value += ((enemy.revealMs > 0 || enemy.litMs ? 1 : 0) - enemy.rig.reveal.value) * Math.min(1, dt * 5)
            // Into the dark the lock slips: the rail keeps firing where it last saw its target.
            if (this.game.rail.target === enemy && this.game.combat.inTheDark(enemy)) this.game.rail.slip()
            // A cloaked unit still disturbs the grid: a faint shimmer where it walks.
            if (cloakedAway && Math.random() < dt * 5) {
                this.game.particles.emit(enemyWorld(enemy, randRange(5, enemy.rig.height * PER_WORLD), _v), _w.set(0, 1.2, 0), enemy.def.hex,
                    { size: 0.16, life: 0.4, gravity: 0, intensity: 1.2 })
            }
            // Rez in: the unit is drawn up out of the grid over its first beat.
            const rez = Math.min(1, enemy.age / MOTION.rezIn)
            // A spiderling swells on what it drains.
            const grown = drainGrowth(enemy.drainPower)
            enemy.rig.root.scale.set(grown, rez * grown, grown)
            poseRig(enemy.rig, enemy.stride, dt, rollSpeed)
            // A gun that just fired kicks back along its barrel and eases home.
            if (enemy.rig.barrel) enemy.recoil = easeRecoil(enemy.rig, enemy.recoil, dt)
            // A melee blow; at full reach a prod discharges, a ram slams home.
            if (enemy.rig.weapon) {
                const before = enemy.strike
                enemy.strike = easeStrike(enemy.rig, enemy.strike, dt)
                if (strikeLands(before, enemy.strike)) {
                    if (enemy.rig.weaponKind === 'ram') this.game.assault.ramImpact(enemy)
                    else this.game.assault.prodZap(enemy)
                }
            }
            placeEnemy(enemy)
            // ROOTKIT's dive: legs drawn into a point, the whole body drilling round.
            if (enemy.burrowMs > 0 || enemy.riseMs > 0) {
                const dive = burrowing(enemy)
                gatherLegs(enemy.rig, dive.gather)
                enemy.rig.root.rotation.y = enemy.yaw + dive.spin
            }
            if (enemy.heave > 0) this.game.memory.heaveLeak(enemy, dt)
            enemy.hexShield?.update(dt)
            if (enemy.inject > 0) {
                const before = enemy.inject
                enemy.inject = easeInject(enemy.rig, enemy.inject, dt)
                // ROOTKIT's stab puts its brood in; a spiderling's is its bite (see `drainFence`).
                if (injectLands(before, enemy.inject) && enemy.def.id === 'titan') this.game.rootkit.injectBrood(enemy)
            }
            if (enemy.ribbonMs > 0 || enemy.ribbon?.busy) this.game.assault.feedRibbon(enemy, dt, dtMs)
            enemy.storm?.update(dt)
            enemy.wound?.update(dt)
        }

        if (spiking) this.game.rail.drainTarpit(dt)
        this.game.crowd.separate()
    }

    private updateBoss(enemy: EnemyEntity, dt: number, dtMs: number) {
        if (enemy.decoy) return
        switch (enemy.def.id) {
            case 'titan':
                this.game.rootkit.updateRootkit(enemy, dt, dtMs)
                break
            case 'leviathan':
                this.game.blackIce.updateBlackIce(enemy, dtMs)
                break
            case 'zeroday':
                this.game.zeroDay.updateZeroDay(enemy, dt)
                break
        }
    }
}
