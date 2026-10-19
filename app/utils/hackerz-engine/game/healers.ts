import * as THREE from 'three'
import { HACKERZ_HEAL_TICK_MS } from '#shared/utils/gamelogic/hackerz'
import type { EnemyEntity } from '../types'
import { PER_WORLD } from './tuning'
import { enemyCentreY, enemyWorld, placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'

/**
 * Healers: the beam's colour; how close (field units) a healer must be to mend;
 * where it hovers, behind its patient; how far to the side it shadows the front
 * when nobody is hurt; and how strongly a unit others already mend draws it in.
 */
const HEAL_HEX = 0x4ade80
const HEAL_REACH = 70
const HEAL_HOVER_D = 30
const HEAL_ESCORT_U = 40
const HEAL_CONVERGE = 0.35

/** How often a healer with a patient looks again for one hurt worse. */
const HEAL_RETARGET_MS = 500

/**
 * Healers fly their own rounds: to the worst-hurt hostile, converging on
 * one others already mend, and shadowing the front when nobody is hurt.
 */
export class Healers {
    constructor(private readonly game: HackerzGame) {}

    /**
     * A healer's move: to the worst-hurt hostile, preferring one other healers
     * already work on (so they converge, and heal it faster together), and a
     * heal every tick once in reach. With nobody hurt it shadows the front of
     * the push. Null once only healers are left: then it goes kamikaze, diving
     * the fence like any flyer, to go off there.
     *
     * A healer sticks with its patient until it is mended or gone, and only
     * now and then looks for one hurt worse, so the field is not searched
     * every frame.
     */
    healerStep(enemy: EnemyEntity, dt: number, dtMs: number) {
        enemy.healRetargetMs -= dtMs
        let patient = enemy.healing && this.needsHealing(enemy.healing) ? enemy.healing : null
        if (enemy.healRetargetMs <= 0 || (enemy.healing && !patient)) {
            enemy.healRetargetMs = HEAL_RETARGET_MS
            patient = this.pickPatient(enemy)
        }
        let lead = patient
        if (!lead) {
            for (const e of this.game.enemies) {
                if (e.def.heal || e.turned) continue
                if (!lead || e.d < lead.d) lead = e
            }
        }
        if (!lead) {
            enemy.kamikaze = true
            enemy.healing = null
            return null
        }
        enemy.healing = patient
        const goalU = lead.u + (patient ? 0 : HEAL_ESCORT_U * Math.sign(enemy.u - lead.u || 1))
        const goalD = lead.d + HEAL_HOVER_D
        const du = goalU - enemy.u
        const dd = goalD - enemy.d
        const dist = Math.hypot(du, dd)
        const moved = Math.min(dist, enemy.speed * this.game.pushSpeed * dt)
        if (dist > 0.001) {
            enemy.u += du / dist * moved
            enemy.d += dd / dist * moved
        }
        if (patient && Math.hypot(patient.u - enemy.u, patient.d - enemy.d) < HEAL_REACH) {
            enemy.attackTimer -= dtMs
            if (enemy.attackTimer <= 0) {
                enemy.attackTimer = HACKERZ_HEAL_TICK_MS
                // 1 a tick at the unit's own strength: a heavy mends as fast, proportionally, as a light.
                patient.hp = Math.min(patient.maxHp, patient.hp + enemy.def.heal! * patient.maxHp / patient.def.hp)
                this.healBeam(enemy, patient)
            }
        }
        return { moved, arrived: false }
    }

    /** Whether a hostile is one a healer can work on: hurt, above ground, and still on its side. */
    private needsHealing(e: EnemyEntity) {
        return !e.def.heal && !e.turned && e.hp < e.maxHp && e.burrowMs <= 0
    }

    /**
     * The worst-hurt hostile, weighted toward one other healers already work
     * on (so they converge) and toward the one this healer has, and against
     * distance.
     */
    private pickPatient(enemy: EnemyEntity) {
        const crews = new Map<EnemyEntity, number>()
        for (const h of this.game.enemies) {
            if (h !== enemy && h.healing) crews.set(h.healing, (crews.get(h.healing) ?? 0) + 1)
        }
        let patient: EnemyEntity | null = null
        let best = -Infinity
        for (const e of this.game.enemies) {
            if (!this.needsHealing(e)) continue
            const score = (1 - e.hp / e.maxHp) + (crews.get(e) ?? 0) * HEAL_CONVERGE + (e === enemy.healing ? 0.15 : 0)
                - Math.hypot(e.u - enemy.u, e.d - enemy.d) / 3000
            if (score > best) {
                best = score
                patient = e
            }
        }
        return patient
    }

    private healBeam(healer: EnemyEntity, patient: EnemyEntity) {
        placeEnemy(healer)
        const from = enemyWorld(healer, healer.rig.height * PER_WORLD * 0.3, new THREE.Vector3())
        const to = enemyWorld(patient, enemyCentreY(patient) - patient.altitude, new THREE.Vector3())
        this.game.transient?.beam(from, to, HEAL_HEX, 0.18)
        this.game.particles.burst(to, HEAL_HEX, 3, 3, { size: 0.18, life: 0.35, gravity: -6 })
    }
}
