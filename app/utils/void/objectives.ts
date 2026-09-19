// Void Runner — mission objectives. A first flight walks new pilots through
// the basics one step at a time; later tier-1 runs teach the other verbs one
// at a time through the pilot guide. Past sector 1 the panel goes quiet until
// something is close enough to act on. It never shows more than three lines.

import * as THREE from 'three'
import type { VoidEngine } from './engine'
import { spawnEnemy } from './enemies'
import type { Enemy } from './types'
import { randomFloat } from '#shared/utils/random'
import { voidResource, type VoidResourceId } from '#shared/utils/gamelogic/void'
import { VOID_BOUNTY_XP } from '#shared/utils/gamelogic/void-pilot'
import { VOID_SKILLS } from '#shared/utils/gamelogic/void-skills'
import { VOID_DEVICES, voidItemType } from '#shared/utils/gamelogic/void-items'

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

interface Lesson {
    id: string
    text: string
    hint: string
    applies: () => boolean
}

type BountyKind = 'kills' | 'elites' | 'ore' | 'crates' | 'signals' | 'jump' | 'reactor'

interface Bounty {
    kind: BountyKind
    text: string
    target: number
    count: number
    paid: boolean
    paidAt: number
}

/** Most lines the objectives panel shows at once. */
const MAX_LINES = 3
/** How long a finished line lingers, ticked off, before the next one takes its place. */
const DONE_LINGER = 2.5
/** How close something has to be before a seasoned pilot hears about it. */
const BEACON_NEAR = 900
const EVENT_NEAR = 1200
const TRADER_NEAR = 450
const LAIR_NEAR = 1000

export class ObjectiveTracker {
    tutorial: boolean
    private step = 0
    private travelled = 0
    private lastPos = new THREE.Vector3()
    private boostTime = 0
    private rocksBroken = 0
    private abilityUsed = false
    private trainees: Enemy[] = []
    private traineeKills = 0
    private startedAt = -1
    private steps: TutorialStep[] = []
    private stepDoneAt = -99
    private practiceRocks = new THREE.Vector3()
    marker: { pos: THREE.Vector3, label: string } | null = null
    bounties: Bounty[] = []
    private lastOre = 0
    private checkBounties = false
    private lessons: Lesson[] = []
    private learned: Set<string> | null
    private lessonDone: { text: string, at: number } | null = null

    constructor(private engine: VoidEngine, tutorial: boolean) {
        this.tutorial = tutorial
        const known = engine.config?.guideLearned
        this.learned = known ? new Set(known) : null
        this.buildLessons()
        if (tutorial) this.buildTutorial()
        else this.rollBounties()
    }

    get tutorialRunning() {
        return this.tutorial && this.step < this.steps.length
    }

    /** Hostile waves hold off until the pilot has learned to fight. */
    get suppressWaves() {
        return this.tutorialRunning && this.step < this.steps.length - 1
    }

    private buildTutorial() {
        const e = this.engine
        const ability = () => e.skills?.name ?? ''
        this.steps = [
            {
                text: 'Hold W to fly forward',
                hint: 'Move the mouse to steer. A and D strafe, Space and C rise and sink.',
                progress: () => `${Math.min(150, Math.round(this.travelled))} / 150 m`,
                done: () => this.travelled >= 150
            },
            {
                text: 'Hold Shift to boost',
                hint: 'Boosting drains the energy arc left of your crosshair. It refills when you let go.',
                progress: () => `${Math.min(100, Math.round(this.boostTime / 1.2 * 100))}%`,
                done: () => this.boostTime >= 1.2
            },
            {
                text: 'Shoot an ore asteroid',
                hint: 'Rocks with glowing crystals hold ore. Aim at one and hold left mouse.',
                start: () => this.spawnPracticeRocks(),
                marker: () => ({ pos: this.practiceRocks, label: 'ORE' }),
                progress: () => `${Math.min(1, this.rocksBroken)} / 1`,
                done: () => this.rocksBroken >= 1
            },
            {
                text: 'Collect 40 ore',
                hint: 'Fly close to the shards and your tractor pulls them in.',
                marker: () => ({ pos: this.practiceRocks, label: 'ORE' }),
                progress: () => `${Math.min(40, this.oreHeld())} / 40`,
                done: () => this.oreHeld() >= 40
            },
            {
                text: 'Destroy the scavengers',
                hint: 'Your turrets fire on their own. Keep the red brackets in front of you and keep moving.',
                start: () => this.spawnTrainees(),
                marker: () => {
                    const alive = this.trainees.find(t => t.alive)
                    return alive ? { pos: alive.pos, label: 'HOSTILE' } : null
                },
                progress: () => `${this.traineeKills} / ${this.trainees.length || 3}`,
                done: () => this.trainees.length > 0 && this.traineeKills >= this.trainees.length
            },
            {
                text: 'Fire your pilot skill with Q',
                hint: 'Q or right mouse. The arc right of your crosshair shows the recharge.',
                progress: () => ability(),
                done: () => this.abilityUsed
            },
            {
                text: 'Fly home and hold F to dock',
                hint: 'Docking banks your hold. If your ship is destroyed, the hold is lost.',
                marker: () => ({ pos: e.structures.find(s => s.kind === 'station')?.pos ?? new THREE.Vector3(), label: 'DOCK' }),
                done: () => false
            }
        ]
    }

    /**
     * The pilot guide: one new verb at a time for tier-1 pilots, after the
     * first flight covered the basics. Lessons tick off whenever the pilot
     * does the thing, shown or not.
     */
    private buildLessons() {
        const e = this.engine
        const device = e.config?.device
        const deviceName = device ? (voidItemType(device.type)?.name ?? 'device') : 'device'
        const deviceEffect = device ? (VOID_DEVICES[device.type]?.effect ?? '') : ''
        const skillName = e.config?.skill ? (VOID_SKILLS.find(k => k.id === e.config!.skill.id)?.name ?? 'Your skill') : 'Your skill'
        this.lessons = [
            { id: 'skill', text: 'Press Q to fire your pilot skill', hint: `${skillName} recharges on its own, so use it the moment a fight turns. Right-click fires it too.`, applies: () => !!e.config?.skill },
            { id: 'secondary', text: 'Hold E on a hostile, release to fire missiles', hint: 'Keep the target under your crosshair until it says LOCKED, then let go. Missiles hit hard and refill every launch.', applies: () => !!e.config?.secondary },
            { id: 'scan', text: 'Press T to scan for hidden loot', hint: 'A scan reveals hidden caches (extra materials, sometimes jump fuel) and data logs nearby. Fly to the CACHE or DATA LOG markers it leaves.', applies: () => true },
            { id: 'device', text: `Press G to use your ${deviceName}`, hint: `${deviceEffect} It costs energy and recharges, so save it for a tight spot.`, applies: () => !!device },
            { id: 'map', text: 'Hold Tab to open the sector map', hint: 'The map shows the station, beacons, the jump gate and the warden lair.', applies: () => true },
            { id: 'jump', text: 'Fly into the jump gate', hint: 'Needs a fuel cell. The next zone is tougher and richer; extract at any beacon.', applies: () => e.fuel > 0 }
        ]
    }

    private learn(id: string) {
        if (!this.learned || this.learned.has(id)) return
        const shown = this.currentLesson()
        this.learned.add(id)
        this.engine.events.guide?.(id)
        if (shown?.id === id) {
            this.lessonDone = { text: shown.text, at: this.engine.elapsed }
            this.engine.audio.play('uiConfirm')
        }
    }

    private currentLesson() {
        if (!this.learned || this.tutorialRunning || this.engine.elapsed < 6) return null
        return this.lessons.find(l => !this.learned!.has(l.id) && l.applies()) ?? null
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
        this.progress('kills', 1)
        if (enemy.elite) this.progress('elites', 1)
        if (enemy.kind === 'reactor') this.progress('reactor', 1)
    }

    onCrate(cache: boolean) {
        this.progress('crates', 1)
        if (cache) this.progress('signals', 1)
    }

    onLog() {
        this.progress('signals', 1)
    }

    onJump() {
        // A jump leaves the practice area behind: the first flight is over.
        if (this.tutorialRunning) {
            this.step = this.steps.length
            if (!this.bounties.length) this.rollBounties()
        }
        this.marker = null
        this.progress('jump', 1)
        this.learn('jump')
        // The new zone may not have a carrier; swap the bounty once it is built.
        this.checkBounties = true
    }

    private bountyPool(): Omit<Bounty, 'count' | 'paid' | 'paidAt'>[] {
        const e = this.engine
        const tier = e.config!.sector.tier
        const ore = (Object.entries(e.config!.sector.ores).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? 'ferrite') as VoidResourceId
        const pool: Omit<Bounty, 'count' | 'paid' | 'paidAt'>[] = [
            { kind: 'kills', text: 'Destroy hostiles', target: 12 + tier * 3 },
            { kind: 'elites', text: 'Destroy elite ships', target: 2 },
            { kind: 'ore', text: `Mine ${voidResource(ore).name.toLowerCase()} and other ore`, target: 300 + tier * 60 },
            { kind: 'crates', text: 'Crack salvage crates', target: 4 },
            { kind: 'signals', text: 'Scan and recover a hidden signal', target: 1 },
            { kind: 'jump', text: 'Jump through a gate', target: 1 },
            { kind: 'reactor', text: 'Destroy a carrier shield reactor', target: 1 }
        ]
        return pool.filter(b => b.kind !== 'reactor' || e.enemies.some(x => x.alive && x.kind === 'mothership'))
    }

    /**
     * Two small goals per run with a loot burst for each. They give every
     * run a reason to try something different: hunt elites, push a jump,
     * poke a carrier.
     */
    private rollBounties() {
        const pool = this.bountyPool()
        while (this.bounties.length < 2 && pool.length) {
            const pick = pool.splice(Math.floor(randomFloat() * pool.length), 1)[0]!
            this.bounties.push({ ...pick, count: 0, paid: false, paidAt: 0 })
        }
    }

    /**
     * A finished bounty is replaced by a fresh one, each a little bigger than
     * the last, so there is always something to chase.
     */
    private refillBounties() {
        const taken = new Set(this.bounties.filter(b => !b.paid).map(b => b.kind))
        const pool = this.bountyPool().filter(b => !taken.has(b.kind))
        const done = this.bounties.filter(b => b.paid).length
        while (this.bounties.filter(b => !b.paid).length < 2 && pool.length) {
            const pick = pool.splice(Math.floor(randomFloat() * pool.length), 1)[0]!
            this.bounties.push({ ...pick, target: Math.ceil(pick.target * (1 + done * 0.35)), count: 0, paid: false, paidAt: 0 })
        }
    }

    /** A reactor bounty with no carrier left in the zone becomes something doable. */
    private replaceStaleBounties() {
        const e = this.engine
        if (e.enemies.some(x => x.alive && x.kind === 'mothership')) return
        const pool = this.bountyPool().filter(b => !this.bounties.some(x => x.kind === b.kind))
        this.bounties = this.bounties.map((b) => {
            if (b.paid || b.kind !== 'reactor' || !pool.length) return b
            const pick = pool.splice(Math.floor(randomFloat() * pool.length), 1)[0]!
            return { ...pick, count: 0, paid: false, paidAt: 0 }
        })
    }

    private progress(kind: BountyKind, amount: number) {
        const e = this.engine
        const p = e.player
        if (!p) return
        for (const b of this.bounties) {
            if (b.kind !== kind || b.paid) continue
            b.count = Math.min(b.target, b.count + amount)
            if (b.count < b.target) continue
            b.paid = true
            b.paidAt = e.elapsed
            // Reward: a salvage burst right on the ship, with a shot at fuel or salvaged gear.
            e.dropLoot('scrap', 12, 20, p.pos)
            e.dropLoot('alloy', 3, 6, p.pos)
            if (randomFloat() < 0.45) e.dropFuel(p.pos)
            if (randomFloat() < 0.12) e.dropGear(p.pos, true)
            e.pilotBonusXp += VOID_BOUNTY_XP
            e.events.banner('Bounty complete', `${b.text} · +${VOID_BOUNTY_XP} pilot XP`, 'good')
            e.audio.play('bounty')
            this.refillBounties()
        }
    }

    onAbility() {
        this.abilityUsed = true
        this.learn('skill')
    }

    onSecondary() {
        this.learn('secondary')
    }

    onDevice() {
        this.learn('device')
    }

    onScan() {
        this.learn('scan')
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
        // Ore bounty tracks ore units that land in the hold.
        const ore = this.oreHeld()
        if (ore > this.lastOre) this.progress('ore', ore - this.lastOre)
        this.lastOre = ore
        if (e.mapOpen) this.learn('map')
        if (this.checkBounties) {
            this.checkBounties = false
            this.replaceStaleBounties()
        }

        if (this.tutorialRunning) {
            const current = this.steps[this.step]!
            if (current.done()) {
                this.step++
                this.stepDoneAt = e.elapsed
                e.audio.play('uiConfirm')
                this.steps[this.step]?.start?.()
            }
            this.marker = this.steps[this.step]?.marker?.() ?? null
        } else {
            this.marker = null
        }
    }

    /** Beacon fights, sector events and the trader, each only once the pilot is close enough to care. */
    private nearby(): ObjectiveView['steps'] {
        const e = this.engine
        const p = e.player!
        const lines: ObjectiveView['steps'] = []
        for (const site of e.beacons?.sites ?? []) {
            const dist = site.structure.pos.distanceTo(p.pos)
            if (site.state === 'contested') {
                lines.push({ text: 'Hold the beacon', done: false, active: true, progress: site.wave ? `wave ${site.wave} / ${site.waves}` : 'incoming' })
            } else if (site.state === 'attacked' && dist < BEACON_NEAR) {
                lines.push({ text: 'Drive the raiders off your beacon', done: false, active: true, progress: `${e.beacons!.alive(site)} left` })
            } else if (site.state === 'hostile' && dist < BEACON_NEAR) {
                lines.push({ text: 'Clear the beacon guards to capture it', done: false, active: true, progress: `${e.beacons!.alive(site)} left` })
            }
        }
        const event = e.sectorEvents?.view()
        const eventAt = e.sectorEvents?.marker?.pos
        if (event && (this.learned || !eventAt || eventAt.distanceTo(p.pos) < EVENT_NEAR)) {
            lines.push({ text: event.text, done: false, active: true, progress: event.progress })
        }
        if (e.trader?.alive && !e.traderInReach() && e.trader.pos.distanceTo(p.pos) < TRADER_NEAR) {
            lines.push({ text: 'Free Trader nearby: fly alongside to trade', done: false, active: true })
        }
        return lines.slice(0, 2)
    }

    view(): ObjectiveView {
        const e = this.engine
        if (this.tutorialRunning) {
            // The step just finished stays ticked off for a moment, then only the current and next.
            const from = e.elapsed - this.stepDoneAt < DONE_LINGER ? this.step - 1 : this.step
            return {
                title: `First flight · ${this.step + 1} / ${this.steps.length}`,
                steps: this.steps.map((s, i) => ({
                    text: s.text,
                    done: i < this.step,
                    active: i === this.step,
                    progress: i === this.step ? s.progress?.() : undefined
                })).slice(Math.max(0, from), this.step + 2).slice(0, MAX_LINES),
                hint: this.steps[this.step]?.hint ?? null
            }
        }
        const cfg = e.config!
        const units = Object.values(e.cargo).reduce((a, b) => a + (b ?? 0), 0)
        const lines: ObjectiveView['steps'] = []
        let hint: string | null = null

        const lesson = this.currentLesson()
        if (this.lessonDone && e.elapsed - this.lessonDone.at < DONE_LINGER) {
            lines.push({ text: this.lessonDone.text, done: true, active: false })
        } else if (lesson) {
            lines.push({ text: lesson.text, done: false, active: true })
            hint = lesson.hint
        }

        // Things happening around the pilot come first: they are why the panel is worth a glance.
        lines.push(...this.nearby())

        // Rookies get the whole run spelled out. Past sector 1 a pilot knows the loop,
        // so the panel only speaks up when there is something to act on.
        const rookie = !!this.learned
        const p = e.player!
        if (units >= cfg.stats.cargo || e.wardenKilled) {
            lines.push({ text: 'Dock to bank the haul', done: false, active: true })
        } else if (e.warden?.alive) {
            lines.push({ text: `Destroy ${cfg.sector.warden}`, done: false, active: true, progress: `${Math.ceil((e.warden.hp / e.warden.maxHp) * 100)}%` })
        } else if (rookie) {
            lines.push({ text: 'Fill the hold', done: false, active: true, progress: `${units} / ${cfg.stats.cargo}` })
            lines.push({ text: `Destroy ${cfg.sector.warden}`, done: false, active: false, progress: 'red skull' })
        } else if (!e.wardenSpawned && p.pos.distanceTo(e.lair) < LAIR_NEAR) {
            lines.push({ text: `${cfg.sector.warden} lair ahead`, done: false, active: true, progress: `${Math.round(p.pos.distanceTo(e.lair))} m` })
        }

        const recent = this.bounties.find(b => b.paid && e.elapsed - b.paidAt < DONE_LINGER)
        const open = this.bounties.find(b => !b.paid)
        if (recent) lines.push({ text: `Bounty: ${recent.text}`, done: true, active: false })
        else if (open) lines.push({ text: `Bounty: ${open.text}`, done: false, active: true, progress: `${Math.floor(open.count)} / ${open.target}` })

        return { title: cfg.sector.name, steps: lines.slice(0, MAX_LINES), hint }
    }
}
