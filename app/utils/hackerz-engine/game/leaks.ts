import * as THREE from 'three'
import { HACKERZ_LEAK_MERGE } from '#shared/utils/gamelogic/hackerz'
import { FIELD_HALF_WIDTH, WALL_HALF_LENGTH } from '../constants'
import { clamp } from '../math'
import { LeakCarry, LeakStack } from '../memory-leak'
import { easeHeave, heaveCarry, heaveReleases } from '../rig-motion'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { LEAK_D, _v, _w } from './tuning'
import type { HackerzGame } from '../hackerz-game'

const LEAK_SCALE = 2

/** A shot aimed this close to a pile (field units) is fired at it, and how often a pile drains the fence. */
const LEAK_AIM_U = 36
const LEAK_AIM_D = 45
const LEAK_TICK_MS = 1000

/** A pile of leaked allocations at the foot of the fence, and what each of its blocks drains a second. */
interface LeakPile {
    u: number
    stack: LeakStack
    drains: number[]
    tickMs: number
    /** Blocks shot off it so far, for the log line when it is gone. */
    freed: number
}

/**
 * Memory leaks: the blocks a Daemon heaves onto piles at the foot of the
 * fence, each draining it until it is shot off or swept up.
 */
export class Leaks {
    constructor(private readonly game: HackerzGame) {}

    private leaks: LeakPile[] = []

    /**
     * The heave: arms back to the disc, a leaked block out of it, overhead, and
     * let go onto the pile in front.
     */
    heaveLeak(enemy: EnemyEntity, dt: number) {
        const before = enemy.heave
        enemy.heave = easeHeave(enemy.rig, enemy.heave, dt)
        const at = _w
        const grown = heaveCarry(enemy.rig, enemy.heave, at)
        if (grown > 0) {
            enemy.carry ??= new LeakCarry(this.game.fieldRoot, enemy.def.hex, LEAK_SCALE)
            enemy.carry.show(at, grown)
        } else enemy.carry?.hide()
        if (heaveReleases(before, enemy.heave)) this.leakMemory(enemy, enemy.heaveDrain, enemy.carry?.mesh.position ?? at)
    }

    /**
     * A Daemon's hit leaves an allocation behind: a block thrown from `from`
     * onto the pile at that stretch of fence (a new pile if there is none near),
     * draining `drain` a second until it is shot or collected.
     */
    private leakMemory(enemy: EnemyEntity, drain: number, from: THREE.Vector3) {
        // Once the sweep has started, the heap is being collected: nothing new lands.
        if (this.game.purging || !this.game.running) {
            enemy.carry?.hide()
            return
        }
        let pile = this.leaks.find(p => Math.abs(p.u - enemy.u) < HACKERZ_LEAK_MERGE)
        if (!pile) {
            const u = clamp(enemy.u, -WALL_HALF_LENGTH + 20, WALL_HALF_LENGTH - 20)
            const stack = new LeakStack(this.game.fieldRoot, fieldToWorld(u, LEAK_D, 0, new THREE.Vector3()), enemy.def.hex, LEAK_SCALE)
            pile = { u, stack, drains: [], tickMs: 0, freed: 0 }
            this.leaks.push(pile)
            this.game.sysLog.memoryLeak(Math.floor((u + FIELD_HALF_WIDTH) / 100) + 1)
        }
        enemy.carry?.hide()
        if (pile.stack.spill(from)) pile.drains.push(drain)
    }

    /** Each pile drains the fence once a second, by what its blocks leak; quietly, as a leak does. */
    updateLeaks(dt: number, dtMs: number) {
        for (const pile of this.leaks) {
            pile.stack.update(dt)
            if (!this.game.running || this.game.purging || !pile.drains.length) continue
            pile.tickMs += dtMs
            if (pile.tickMs < LEAK_TICK_MS) continue
            pile.tickMs -= LEAK_TICK_MS
            pile.stack.drained()
            const top = pile.stack.top(new THREE.Vector3())
            this.game.particles.emit(top, _w.set(0, 1.2, 1.4), pile.stack.hex, { size: 0.2, life: 0.4, gravity: 0 })
            this.game.bastion.damageWall(pile.drains.reduce((sum, d) => sum + d, 0), pile.u, true)
        }
    }

    /** The pile a shot at (u, d) is aimed at: one right by the fence, under the cursor. */
    leakPileAt(u: number, d: number) {
        if (d > LEAK_D + LEAK_AIM_D) return null
        let best: LeakPile | null = null
        for (const pile of this.leaks) {
            if (Math.abs(pile.u - u) < LEAK_AIM_U && (!best || Math.abs(pile.u - u) < Math.abs(best.u - u))) best = pile
        }
        return best
    }

    /** A round fired at a pile reaches it: one block freed, in a burst. */
    shootLeak(u: number) {
        const pile = this.leaks.find(p => p.u === u)
        if (!pile) return
        const at = pile.stack.pop(new THREE.Vector3())
        if (!at) return
        pile.drains.pop()
        this.game.particles.burst(at, pile.stack.hex, 12, 7, { size: 0.24, life: 0.4 })
        this.game.particles.burst(at, 0xffffff, 4, 4, { size: 0.16, life: 0.2 })
        this.game.callbacks.onSound?.('hit-enemy')
        if (pile.stack.count) {
            pile.freed++
            return
        }
        this.game.transient?.ring(fieldToWorld(pile.u, LEAK_D, 0.1, _v), pile.stack.hex, 2.4, 0.4)
        this.game.sysLog.heapFreed(pile.freed + 1, false)
        pile.stack.dispose()
        this.leaks.splice(this.leaks.indexOf(pile), 1)
    }

    /** Collects every pile: the purge's sweep logs it as a GC run; a reset just drops them. */
    clearLeaks(swept: boolean) {
        let blocks = 0
        for (const pile of this.leaks) {
            blocks += pile.stack.count
            if (swept) this.game.particles.burst(pile.stack.top(new THREE.Vector3()), pile.stack.hex, 18, 8, { size: 0.26, life: 0.5 })
            pile.stack.dispose()
        }
        this.leaks = []
        if (swept && blocks) this.game.sysLog.heapFreed(blocks, true)
    }
}
