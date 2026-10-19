import * as THREE from 'three'
import { randomFloat, seededRng, withSeed } from '../rng'
import type { DemoScript } from '../../hackerz-demo-scripts'
import {
    HACKERZ_DEPLOYABLE_MAX, hackerzDeployable, hackerzEnemy, type HackerzDeployableId, type HackerzEnemyId,
    type HackerzLoadout
} from '#shared/utils/gamelogic/hackerz'
import { FIELD_DEPTH, RAIL_U } from '../constants'
import { buildNetwork } from '../data-lines'
import { modelClock } from '../models'
import { fieldToWorld } from '../scene'
import type { EnemyEntity } from '../types'
import { _v, PING_COOLDOWN_MS } from './tuning'
import { placeEnemy } from './bodies'
import type { HackerzGame } from '../hackerz-game'
import { centroid } from '../math'

/** Where a demo board's camera sits relative to what it is looking at: well in from the game's own. */
const DEMO_CAMERA_OFFSET = new THREE.Vector3(0, 13, 16)

/** A demo board's fixed step, and the seed every loop of it starts from. */
const DEMO_STEP_MS = 1000 / 60
const DEMO_SEED = 0x5eed

/**
 * A Database demo board: a quiet board a script drives, replaying the
 * same seeded scene on a loop.
 */
export class DemoDirector {
    constructor(private readonly game: HackerzGame) {}

    private demoFocus: { u: number, d: number } | null = null

    private demoSnap = true

    /** The demo's script, its seeded rolls, its clock, the next step due, and where its lines go. */
    demoScript: DemoScript | null = null

    private demoRng: (() => number) | null = null

    private demoTime = 0

    private demoNext = 0

    private demoAccumMs = 0

    private demoSay: ((line: string) => void) | null = null

    /** How far the demo camera is pulled back, and what the script has the rail firing at. */
    private demoZoom = 1

    private demoFiring: 'lead' | 'node' | null = null

    /**
     * Plays a script on the demo board, from the top and on a loop. `say`
     * hears each line it prints. Every loop is identical: the board, the
     * rolls and the clock all start over from the same seed.
     */
    demoPlay(script: DemoScript, loadout: HackerzLoadout, say: (line: string) => void) {
        if (!this.game.demo) return
        this.demoScript = script
        this.demoSay = say
        this.game.loadout = loadout
        this.demoReset()
    }

    /**
     * Fires the rail for the script: locked on the hostile nearest the fence
     * (and the next one when it falls), at the hacked node furthest out, or —
     * with null — not at all.
     */
    demoFire(at: 'lead' | 'node' | null) {
        if (!this.game.demo) return
        this.demoFiring = at
        this.game.rail.holding = at !== null
        if (!at) this.game.rail.target = null
    }

    /** Sets off one of the rail's abilities for the script, charged or not. */
    demoAbility(id: 'pulse' | 'overclock' | 'ping') {
        const loadout = this.game.loadout
        if (!this.game.demo || !loadout) return
        if (id === 'pulse') {
            this.game.abilities.pulseCharge = loadout.pulseCooldownMs
            this.game.abilities.firePulse()
        } else if (id === 'overclock') {
            this.game.abilities.overclockLeft = 0
            this.game.abilities.overclockCharge = loadout.overclockCooldownMs
            this.game.abilities.fireOverclock()
        } else {
            this.game.abilities.firePing(true)
        }
    }

    /**
     * Puts a hostile on the demo board that thinks for itself, as in a wave —
     * a hacker that goes for the nodes, a daemon that takes up a node's
     * guard. The board's seeded rolls keep what it decides the same every loop.
     */
    demoSpawnFree(id: HackerzEnemyId, u: number, d: number) {
        if (!this.game.demo) return
        const enemy = this.game.debugSpawn(id, u, d)
        if (enemy) this.demoSettle(enemy)
    }

    /** Keeps the rail's lock for the script: on the next hostile when its mark falls, or on the outermost hacked node. */
    private demoAim() {
        if (this.demoFiring === 'lead') {
            if (this.game.rail.target && this.game.rail.target.hp > 0 && this.game.enemies.includes(this.game.rail.target)) return
            this.game.rail.target = this.game.enemies
                .filter(e => e.hp > 0 && !e.turned && !this.game.combat.untargetable(e))
                .sort((a, b) => a.d - b.d)[0] ?? null
        } else if (this.demoFiring === 'node') {
            const chip = this.game.pathChips?.ordered.find(c => c.state === 'hacked')
            this.game.rail.target = null
            if (chip) {
                this.game.rail.aimU = chip.u
                this.game.rail.aimD = chip.d
            }
        }
    }

    /** Puts the demo board back to a fresh, empty wave over the same seeded board: the script's loop point. */
    demoReset() {
        const loadout = this.game.loadout
        if (!this.game.demo || !loadout) return
        this.demoRng = seededRng(DEMO_SEED)
        withSeed(this.demoRng, () => {
            this.game.clearField()
            this.game.pathChips?.reset()
            this.game.movement.network = buildNetwork(this.game.pathChips?.ordered ?? [])
            this.game.view?.setNetwork(this.game.movement.network)
            this.game.territory.islands = []
            this.game.elapsedTotal = 0
            this.game.visualTime = 0
            this.game.startWave(1, loadout)
            this.game.spawner.schedule = []
            this.game.waveMs = Infinity
            // A wave carries the wall's damage over; a demo loop starts whole,
            // and so do the guns on it: no reload or aim left from the last loop.
            this.game.bastion.wallHp = this.game.bastion.wallMaxHp
            this.game.bastion.shield = this.game.bastion.shieldMax
            // The rail, the barrier's regen clock and the kill chain start fresh too.
            this.game.rail.railHeading = Math.PI
            this.game.rail.railU = RAIL_U
            this.game.rail.railKick = 0
            this.game.bastion.msSinceWallHit = 99_999
            this.game.bastion.shieldHit = 0
            this.game.scoring.chain = 0
            this.game.scoring.totalKills = 0
            this.game.abilities.pingCharge = PING_COOLDOWN_MS
            // Dark zones fade in and out: one lit in the last scene must not still be fading here.
            for (const zone of this.game.territory.darkZones) Object.assign(zone, { u: 0, d: 0, r: 0, strength: 0, on: false })
            this.game.territory.darkness = 0
            // Their ground pours rather than jumps, so it is poured back out to the portal: no red left over.
            this.game.view?.redLine.fill(FIELD_DEPTH)
            this.game.view?.orangeLine.fill(FIELD_DEPTH)
            // Reused or freshly built, every mount starts as a new one stands: facing home, ready to fire.
            for (const mount of this.game.battery.turrets) {
                mount.cooldown = 0
                mount.kick = 0
                mount.heading = Math.PI
                mount.frozenMs = 0
            }
        })
        this.game.overlay.clear()
        this.demoTime = 0
        this.demoNext = 0
        this.demoAccumMs = 0
        this.demoFocus = null
        this.demoZoom = 1
        this.demoSnap = true
        this.demoFire(null)
        this.demoSay?.('')
    }

    /**
     * A demo board steps at a fixed rate, whatever the display does, and its
     * script fires on that clock — so a slow frame never changes what happens.
     */
    demoFrame(rawMs: number) {
        // The models' clock is shared with the game that may be running
        // underneath: the demo drives it on its own time while it steps (its
        // poses are part of what it replays), then hands the game's back.
        const gameClock = modelClock.value
        try {
            this.demoSteps(rawMs)
        } finally {
            modelClock.value = gameClock
        }
    }

    private demoSteps(rawMs: number) {
        this.demoAccumMs = Math.min(this.demoAccumMs + rawMs, DEMO_STEP_MS * 4)
        while (this.demoAccumMs >= DEMO_STEP_MS) {
            this.demoAccumMs -= DEMO_STEP_MS
            const script = this.demoScript
            if (script && this.demoTime >= script.length) this.demoReset()
            const rng = this.demoRng
            if (!rng) return
            withSeed(rng, () => {
                this.demoTime += DEMO_STEP_MS
                const steps = this.demoScript?.steps ?? []
                while (this.demoNext < steps.length && steps[this.demoNext]!.at <= this.demoTime) {
                    const step = steps[this.demoNext++]!
                    if (step.say !== undefined) this.demoSay?.(step.say)
                    step.run?.(this.game)
                }
                this.demoAim()
                this.game.tick(DEMO_STEP_MS)
            })
        }
    }

    /**
     * Points the demo camera at a spot on the board, or back to following the
     * hostiles with null. `zoom` above 1 pulls it back to take in more: the
     * fence and the guns on it, or a run of nodes.
     */
    demoLook(at: { u: number, d: number } | null, zoom = 1) {
        this.demoFocus = at
        this.demoZoom = zoom
    }

    /**
     * The demo's camera: in close behind whatever the script is showing — a
     * spot it named, or else the middle of the hostiles on the board — and
     * easing after it as they move.
     */
    demoCamera(dt: number) {
        const view = this.game.view
        if (!view) return
        const live = this.game.enemies.filter(e => e.hp > 0)
        const { u, d } = this.demoFocus ?? (live.length ? centroid(live) : { u: 0, d: FIELD_DEPTH * 0.5 })
        const aim = fieldToWorld(u, d, 0, _v)
        view.cameraTarget.lerp(aim, this.demoSnap ? 1 : 1 - Math.exp(-dt * 2.2))
        view.cameraHome.copy(view.cameraTarget).addScaledVector(DEMO_CAMERA_OFFSET, this.demoZoom)
        this.demoSnap = false
    }

    /**
     * Puts a hostile on the demo board at the first waypoint of `path`; it
     * walks the rest in order, off the network and out of its own judgement.
     */
    demoSpawn(id: HackerzEnemyId, path: { u: number, d: number }[]) {
        const start = path[0]
        if (!this.game.demo || !start) return
        // Set down where it stands, as a hatching spiderling is: it resolves out
        // of the dark on the spot, and the portal shows nothing of it.
        const enemy = this.game.spawner.spawn(hackerzEnemy(id), false, 1, start)
        if (!enemy) return
        enemy.route = null
        enemy.demoPath = path.slice(1).map(point => ({ ...point }))
        this.demoSettle(enemy)
        placeEnemy(enemy)
    }

    /**
     * A spawn starts its walk cycle and a flyer its bob at a cosmetic random
     * phase; on a demo board those come from the seeded roll too — a flyer's
     * bob is where shots aim — so the replay matches.
     */
    private demoSettle(enemy: EnemyEntity) {
        enemy.stride = randomFloat() * Math.PI * 2
        enemy.hover = randomFloat() * Math.PI * 2
    }

    /** Hands the `count` outermost nodes to the intrusion. */
    demoHack(count: number) {
        const chips = this.game.pathChips
        if (!this.game.demo || !chips) return
        const taken = chips.ordered.slice(0, count)
        for (const chip of taken) chips.landPulse(chip, 1)
        if (taken.length) {
            this.demoLook({
                ...centroid(taken)
            })
        }
    }

    /**
     * Uses a deployable on the demo board as a player would: placed at (u, d),
     * fired on the spot when it has nothing to aim, or — a White Hat — put on
     * the hostile nearest (u, d). The demo's stock never runs out.
     */
    demoDeploy(id: HackerzDeployableId, u: number, d: number) {
        if (!this.game.demo) return
        this.game.deployer.stock[id] = HACKERZ_DEPLOYABLE_MAX
        if (hackerzDeployable(id).instant) {
            this.game.deployer.useInstant(id)
            return
        }
        if (id === 'whitehat') {
            const pick = this.game.enemies
                .filter(e => this.game.whiteHats.turnable(e))
                .sort((a, b) => Math.hypot(a.u - u, a.d - d) - Math.hypot(b.u - u, b.d - d))[0]
            this.game.deployer.useWhiteHat(pick ?? null)
            return
        }
        // Exactly where the script says: no snapping to a line or a node.
        this.game.deployer.drop(id, u, d, null)
    }
}
