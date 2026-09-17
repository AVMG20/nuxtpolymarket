// Void Runner — mission objectives. A first flight walks new pilots through
// every verb the game has; every other run keeps a short list of goals on
// screen so there is always a clear next thing to do.

import * as THREE from 'three'
import type { VoidEngine } from './engine'
import { spawnEnemy } from './enemies'
import type { Enemy } from './types'

export interface ObjectiveView {
    title: string
    steps: { text: string, done: boolean, progress?: string, active: boolean }[]
    hint: string | null
}

interface TutorialStep {
    text: string
    hint: string
    progress?: () => string
    start?: () => void
    done: () => boolean
    /** Where the overlay should point while this step is active. */
    marker?: () => { pos: THREE.Vector3, label: string } | null
}

export class ObjectiveTracker {
    tutorial: boolean
    private step = 0
    private travelled = 0
    private lastPos = new THREE.Vector3()
    private boostTime = 0
    private rocksBroken = 0
    private abilityUsed = false
    private secondaryUsed = false
    private deviceUsed = false
    private scanUsed = false
    private trainees: Enemy[] = []
    private traineeKills = 0
    private startedAt = -1
    private steps: TutorialStep[] = []
    private completeFlash = 0
    private practiceRocks = new THREE.Vector3()
    marker: { pos: THREE.Vector3, label: string } | null = null

    constructor(private engine: VoidEngine, tutorial: boolean) {
        this.tutorial = tutorial
        if (tutorial) this.buildTutorial()
    }

    get tutorialRunning() {
        return this.tutorial && this.step < this.steps.length
    }

    /** Hostile waves hold off until the pilot has learned to fight. */
    get suppressWaves() {
        return this.tutorial && this.step < this.steps.length - 1
    }

    private buildTutorial() {
        const e = this.engine
        const ability = () => e.skills?.name ?? ''
        this.steps = [
            {
                text: 'Steer with the mouse and thrust with W',
                hint: 'Move the mouse to aim, hold W to fly forward. A and D strafe, Space and C rise and sink.',
                progress: () => `${Math.min(150, Math.round(this.travelled))} / 150 m`,
                done: () => this.travelled >= 150
            },
            {
                text: 'Hold Shift to boost',
                hint: 'Boosting drains the energy arc on the left of your crosshair. It refills when you ease off.',
                progress: () => `${Math.min(100, Math.round(this.boostTime / 1.2 * 100))}%`,
                done: () => this.boostTime >= 1.2
            },
            {
                text: 'Crack an ore asteroid',
                hint: 'Rocks with glowing crystals hold ore. Put your crosshair on one and hold left mouse; your turret joins in.',
                start: () => this.spawnPracticeRocks(),
                marker: () => ({ pos: this.practiceRocks, label: 'ORE' }),
                progress: () => `${Math.min(1, this.rocksBroken)} / 1`,
                done: () => this.rocksBroken >= 1
            },
            {
                text: 'Collect 40 units of ore',
                hint: 'Fly close to the shards and your tractor pulls them in. Keep breaking rocks.',
                marker: () => ({ pos: this.practiceRocks, label: 'ORE' }),
                progress: () => `${Math.min(40, this.oreHeld())} / 40`,
                done: () => this.oreHeld() >= 40
            },
            {
                text: 'Destroy the scavenger wing',
                hint: 'Turrets fire on their own at anything in range. Keep the red brackets in front of you and keep moving.',
                start: () => this.spawnTrainees(),
                marker: () => {
                    const alive = this.trainees.find(t => t.alive)
                    return alive ? { pos: alive.pos, label: 'HOSTILE' } : null
                },
                progress: () => `${this.traineeKills} / ${this.trainees.length || 3}`,
                done: () => this.trainees.length > 0 && this.traineeKills >= this.trainees.length
            },
            {
                text: 'Fire a missile volley with E',
                hint: 'Hold E with a hostile under your crosshair until it says LOCKED, then let go. Without a lock the missiles fly straight. Ammo refills every launch.',
                done: () => this.secondaryUsed || !e.config?.secondary
            },
            {
                text: 'Fire your pilot skill',
                hint: 'Press Q or right mouse. The arc on the right of your crosshair shows the recharge. Unlock and shape skills in the hangar.',
                progress: () => ability(),
                done: () => this.abilityUsed
            },
            {
                text: 'Trigger your device with G',
                hint: 'Your Shield Booster refills the shield fast. Devices cost energy and recharge. Craft decoys, sentries and cloaks later.',
                done: () => this.deviceUsed || !e.config?.device
            },
            {
                text: 'Pulse the scanner with T',
                hint: 'Scanning marks hidden caches and data logs nearby. Caches can hold fuel for the jump gate; logs fill your Codex.',
                done: () => this.scanUsed
            },
            {
                text: 'Fly home and hold F to dock',
                hint: 'Everything in your hold is lost if you die. Docking at the station or a beacon banks it.',
                marker: () => ({ pos: e.structures.find(s => s.kind === 'station')?.pos ?? new THREE.Vector3(), label: 'DOCK' }),
                done: () => false
            }
        ]
    }

    private oreHeld() {
        const c = this.engine.cargo
        return (c.ferrite ?? 0) + (c.cobalt ?? 0) + (c.iridium ?? 0) + (c.xenite ?? 0)
    }

    private spawnPracticeRocks() {
        const e = this.engine
        const p = e.player!
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(p.quat)
        fwd.y = 0
        if (fwd.lengthSq() < 0.01) fwd.set(0, 0, 1)
        fwd.normalize()
        const center = p.pos.clone().addScaledVector(fwd, 170)
        this.practiceRocks.copy(center)
        const field = e.asteroids!
        const ore = 'ferrite' as const
        for (let i = 0; i < 9; i++) {
            const at = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 90))
            let clear = true
            field.query(at, 12, () => {
                clear = false
            })
            if (clear) field.add(at, 4 + Math.random() * 4, i % 4 === 3 ? 'cobalt' : ore, 0.8)
        }
    }

    private spawnTrainees() {
        const e = this.engine
        const p = e.player!
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(p.quat)
        const center = p.pos.clone().addScaledVector(side, 180).add(new THREE.Vector3(0, 20, 0))
        this.trainees = []
        for (let i = 0; i < 3; i++) {
            const t = spawnEnemy(e, 'raider', center.clone().add(new THREE.Vector3(i * 12, 0, i * 6)), { aggro: true, warpIn: true })
            // Training targets: soft and slow on the trigger.
            t.hp = t.maxHp = t.maxHp * 0.7
            t.damageMult *= 0.5
            this.trainees.push(t)
        }
        e.events.toast('Scavengers inbound', 'warn')
        e.audio.play('warning')
    }

    onRockBroken() {
        this.rocksBroken++
    }

    onKill(enemy: Enemy) {
        if (this.trainees.includes(enemy)) this.traineeKills++
    }

    onAbility() {
        this.abilityUsed = true
    }

    onSecondary() {
        this.secondaryUsed = true
    }

    onDevice() {
        this.deviceUsed = true
    }

    onScan() {
        this.scanUsed = true
    }

    update(dt: number) {
        const e = this.engine
        const p = e.player
        if (!p) return
        if (this.startedAt < 0) {
            this.startedAt = e.elapsed
            this.lastPos.copy(p.pos)
        }
        this.travelled += Math.min(20, p.pos.distanceTo(this.lastPos))
        this.lastPos.copy(p.pos)
        if (p.boosting) this.boostTime += dt
        this.completeFlash = Math.max(0, this.completeFlash - dt)

        if (this.tutorialRunning) {
            const current = this.steps[this.step]!
            if (current.done()) {
                this.step++
                e.audio.play('levelUp')
                this.completeFlash = 1
                this.steps[this.step]?.start?.()
            }
            this.marker = this.steps[this.step]?.marker?.() ?? null
        } else {
            this.marker = null
        }
    }

    view(): ObjectiveView {
        const e = this.engine
        if (this.tutorialRunning) {
            return {
                title: 'First flight',
                steps: this.steps.map((s, i) => ({
                    text: s.text,
                    done: i < this.step,
                    active: i === this.step,
                    progress: i === this.step ? s.progress?.() : undefined
                })).filter((s, i) => i >= this.step - 2 && i <= this.step + 1),
                hint: this.steps[this.step]?.hint ?? null
            }
        }
        const cfg = e.config!
        const units = Object.values(e.cargo).reduce((a, b) => a + (b ?? 0), 0)
        const event = e.sectorEvents?.view()
        return {
            title: cfg.sector.name,
            steps: [
                ...(event ? [{ text: event.text, done: false, active: true, progress: event.progress }] : []),
                { text: 'Fill the hold', done: units >= cfg.stats.cargo, progress: `${units} / ${cfg.stats.cargo}`, active: units < cfg.stats.cargo },
                { text: `Destroy ${cfg.sector.warden}`, done: e.wardenKilled, active: !e.wardenKilled, progress: e.warden?.alive ? `${Math.ceil((e.warden.hp / e.warden.maxHp) * 100)}%` : undefined },
                { text: 'Dock to bank the haul', done: false, active: units > 0 || e.wardenKilled }
            ],
            hint: null
        }
    }
}
