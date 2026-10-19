import * as THREE from 'three'
import { randomFloat, seededRng, withSeed } from './rng'
import type { DemoScript } from '../hackerz-demo-scripts'
import type { HackerzAutopilotView } from '#shared/utils/gamelogic/hackerz-autopilot'
import {
    HACKERZ_BONUS_MS, HACKERZ_BONUS_MULTIPLIER, HACKERZ_DEPLOYABLE_MAX, HACKERZ_BONUS_PASS_INTEGRITY, HACKERZ_HACKER_ID,
    HACKERZ_MAX_WAVE, HACKERZ_PURGE_BOUNTY, HACKERZ_WAVE_MS, hackerzClearBonus, hackerzDeployable, hackerzEnemy,
    hackerzIsAirborne, hackerzIsBossWave, hackerzNetworkEvent, type HackerzDeployableId, type HackerzEnemyId,
    type HackerzEventId, type HackerzLoadout, type HackerzWeaponRuntime
} from '#shared/utils/gamelogic/hackerz'
import {
    FIELD_DEPTH, FIELD_HALF_WIDTH, FIELD_SCALE, MAX_SHAKE, PURGE_MS, PURGE_REACH, RAIL_U, SHAKE_DECAY, GUN_Z,
    WALL_HEIGHT
} from './constants'
import { clamp, randRange } from './math'
import { PathChips } from './path-chips'
import { Guardrail } from './guardrail'
import { Deployables } from './deployables'
import { HackTerminals } from './hack-terminal'
import { LinePulses } from './line-pulses'
import { SysLog } from './sys-log'
import { Shrapnel } from './shrapnel'
import { GlitchClouds } from './glitch-cloud'
import { buildNetwork } from './data-lines'
import { buildRig, disposeRig, hdr, loadModels, modelClock, shroud } from './models'
import { ENEMY_PACE } from './rig-motion'
import { CYAN, HackerzScene, LIME, RED, fieldToWorld } from './scene'
import { AmmoRack } from './ammo-rack'
import { LaneProps } from './lane-props'
import { Overlay, ParticleSystem, TransientFx, hexCss, type HealthTag } from './fx'
import type { EnemyEntity, HackerzCallbacks, HackerzStartConfig } from './types'
import {
    PER_WORLD, _v, _w, BLACKOUT_LIGHT_D, LONGBORE_FLARE, RAIL_TRACK, PING_COOLDOWN_MS, FINAL_PUSH_MS, PING_REVEAL_MS
} from './game/tuning'
import { Healers } from './game/healers'
import { Leaks } from './game/leaks'
import { Scoring } from './game/scoring'
import { Bastion } from './game/bastion'
import { PacketLoss } from './game/packet-loss'
import { Territory } from './game/territory'
import { enemyCentreY, placeEnemy } from './game/bodies'
import { Crowd } from './game/crowd'
import { Combat } from './game/combat'
import { WhiteHats } from './game/white-hats'
import { Assault } from './game/assault'
import { Rootkit } from './game/rootkit'
import { BlackIce } from './game/black-ice'
import { ZeroDay } from './game/zero-day'
import { Turrets } from './game/turrets'
import { Projectiles } from './game/projectiles'
import { Rail } from './game/rail'
import { Abilities } from './game/abilities'
import { Deployer } from './game/deployer'
import { Hacking } from './game/hacking'
import { Movement } from './game/movement'
import { Squads } from './game/squads'
import { Spawner } from './game/spawner'
import { EnemyAi } from './game/enemy-ai'
import { Input } from './game/input'

const FINAL_PUSH_SPEED = 1.35

/** Where a demo board's camera sits relative to what it is looking at: well in from the game's own. */
const DEMO_CAMERA_OFFSET = new THREE.Vector3(0, 13, 16)

/** A demo board's fixed step, and the seed every loop of it starts from. */
const DEMO_STEP_MS = 1000 / 60
const DEMO_SEED = 0x5eed

/** Auto-play offers Laya this many hostiles to choose between, and counts this close to the wall as near. */
const AUTOPILOT_CONTACTS = 5
const AUTOPILOT_NEAR = 250

/** Hostiles this close together count as one pack, for where auto-play puts a deployable. */
const AUTOPILOT_PACK_RADIUS = 140

/** How far ahead of a pack (toward the wall) auto-play puts each deployable that waits for it. */
const AUTOPILOT_DEPLOY_AHEAD: Partial<Record<HackerzDeployableId, number>> = { honeypot: 120, proxy: 90, bomb: 60, surge: 0 }

/** How fast a health bar's trail drains after a hit, in bar-lengths a second. */
const HP_TRAIL_DRAIN = 0.9

export class HackerzGame {
    view: HackerzScene | null = null
    callbacks: HackerzCallbacks
    particles = new ParticleSystem(5000)
    transient: TransientFx | null = null
    overlay = new Overlay()
    fieldRoot = new THREE.Group()
    private laneProps: LaneProps | null = null
    pathChips: PathChips | null = null
    terminals: HackTerminals | null = null
    private guardrail: Guardrail | null = null
    private resizeObserver: ResizeObserver | null = null
    private raf = 0
    private lastTime = 0

    // ── Lifecycle ──
    private destroyed = false
    private mounted = false
    /** A wave is live: enemies spawn, the clock runs, input fires. */
    running = false
    paused = false
    /** The end-of-wave sweep is playing; input is dead but the field still ticks. */
    purging = false
    gameOver = false

    // ── Run state ──
    loadout: HackerzLoadout | null = null
    slots = 2
    wave = 0
    waveElapsed = 0
    /** The wave's closing stretch is on: everything but the hackers charges. */
    finalPush = false

    // ── Bonus round ──
    /** The network event this round is, or null for an ordinary wave. */
    bonus: HackerzEventId | null = null
    /** Length of the round in flight: a wave, or the shorter bonus sprint. */
    waveMs = HACKERZ_WAVE_MS
    /** The run's node states, set aside while a bonus round plays on a fresh board. */
    private bonusChips: ReturnType<PathChips['snapshot']> | null = null

    // ── Deployables ──
    deployables: Deployables | null = null
    linePulses: LinePulses | null = null
    shrapnel: Shrapnel | null = null
    /** Warhead blasts: clouds of corrupted data scrambling the splash area. */
    glitchClouds: GlitchClouds | null = null
    /** The firewall's syslog, for the terminal beside the board. */
    sysLog = new SysLog(line => this.callbacks.onLog?.(line))

    // ── Entities ──
    enemies: EnemyEntity[] = []

    // ── Camera ──
    private shake = 0
    elapsedTotal = 0
    /** The picture's clock: drives every shader animation, and stands still during a packet-loss spike. */
    private visualTime = 0

    /** A Database demo board (see `mountDemo`), the spot its camera is held on, and whether it cuts there. */
    demo = false
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

    // ── Systems: each owns its part of the game (see ./game) ──
    readonly healers = new Healers(this)
    readonly memory = new Leaks(this)
    readonly scoring = new Scoring(this)
    readonly bastion = new Bastion(this)
    readonly lag = new PacketLoss(this)
    readonly territory = new Territory(this)
    readonly crowd = new Crowd(this)
    readonly combat = new Combat(this)
    readonly whiteHats = new WhiteHats(this)
    readonly assault = new Assault(this)
    readonly rootkit = new Rootkit(this)
    readonly blackIce = new BlackIce(this)
    readonly zeroDay = new ZeroDay(this)
    readonly battery = new Turrets(this)
    readonly projectiles = new Projectiles(this)
    readonly rail = new Rail(this)
    readonly abilities = new Abilities(this)
    readonly deployer = new Deployer(this)
    readonly hacking = new Hacking(this)
    readonly movement = new Movement(this)
    readonly squads = new Squads(this)
    readonly spawner = new Spawner(this)
    readonly enemyAi = new EnemyAi(this)
    readonly input = new Input(this)

    constructor(callbacks: HackerzCallbacks) {
        this.callbacks = callbacks
    }

    // ─── Mount / teardown ────────────────────────────────────────────────────

    async mount(host: HTMLDivElement) {
        // The engine outlives the page component, so a remount re-parents the
        // existing canvas rather than building a second renderer and loop.
        if (this.view) {
            host.appendChild(this.view.renderer.domElement)
            host.appendChild(this.view.overlay)
            this.view.resize()
            return
        }

        await loadModels()
        if (this.destroyed) return

        const view = new HackerzScene(host)
        this.view = view
        this.transient = new TransientFx(view.scene)
        view.scene.add(this.fieldRoot, this.particles.points)
        this.particles.setViewportHeight(view.height * view.renderer.getPixelRatio())

        this.rail.railRig = buildRig('turret-rail', CYAN, 1.8)
        this.rail.railRig.root.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z)
        view.scene.add(this.rail.railRig.root)

        // The magazine sits on the deck right behind the rail, cabled into it.
        this.rail.ammoRack = new AmmoRack(new THREE.Vector3(RAIL_U * FIELD_SCALE, WALL_HEIGHT + 0.25, GUN_Z + 0.7), CYAN)
        this.rail.ammoRack.group.position.set(RAIL_U * FIELD_SCALE, WALL_HEIGHT, GUN_Z + 3.3)
        // Big enough to read every capacitor and its trace from the camera.
        this.rail.ammoRack.group.scale.setScalar(1.3)
        this.rail.ammoRack.group.updateMatrixWorld(true)
        view.scene.add(this.rail.ammoRack.group)

        // The Longbore's track: a glowing rail across the deck it glides along, shown only while it is on.
        const trackLength = RAIL_TRACK * 2 * FIELD_SCALE + 1.6
        const track = new THREE.Group()
        const bar = new THREE.Mesh(
            new THREE.BoxGeometry(trackLength, 0.12, 0.3),
            new THREE.MeshBasicMaterial({ color: hdr(0x1a1030, 1), toneMapped: false })
        )
        track.add(bar)
        for (const side of [-1, 1]) {
            const lip = new THREE.Mesh(
                new THREE.BoxGeometry(trackLength, 0.05, 0.05),
                new THREE.MeshBasicMaterial({ color: hdr(LONGBORE_FLARE, 1.8), toneMapped: false })
            )
            lip.position.set(0, 0.07, side * 0.16)
            track.add(lip)
        }
        track.position.set(0, WALL_HEIGHT + 0.06, GUN_Z)
        track.visible = false
        this.rail.railTrack = track
        view.scene.add(track)

        // Chips and capacitors either side of the lane, marked by whoever holds their ground.
        this.laneProps = new LaneProps((intensity, packets) => view.territoryMaterial(intensity, packets))
        view.scene.add(this.laneProps.group)
        // The side hardware is fenced off; the nodes worth fighting over are on the path.
        this.guardrail = new Guardrail((intensity, packets) => view.territoryMaterial(intensity, packets))
        view.scene.add(this.guardrail.group)
        this.pathChips = new PathChips()
        this.pathChips.reset()
        this.movement.network = buildNetwork(this.pathChips.ordered)
        view.setNetwork(this.movement.network)
        view.scene.add(this.pathChips.group)
        this.linePulses = new LinePulses(this.particles)
        this.shrapnel = new Shrapnel(this.fieldRoot)
        this.glitchClouds = new GlitchClouds(this.fieldRoot)
        view.scene.add(this.linePulses.group)
        this.deployables = new Deployables()
        view.scene.add(this.deployables.group)
        this.terminals = new HackTerminals()
        view.scene.add(this.terminals.group)
        view.setMountsUsed(this.slots, [])

        this.resizeObserver = new ResizeObserver(() => {
            view.resize()
            this.particles.setViewportHeight(view.height * view.renderer.getPixelRatio())
        })
        this.resizeObserver.observe(host)

        if (!this.demo) this.input.attachInput()
        this.lastTime = performance.now()
        this.raf = requestAnimationFrame(this.loop)
        this.mounted = true
    }

    destroy() {
        this.destroyed = true
        this.running = false
        cancelAnimationFrame(this.raf)
        this.input.detachInput()
        this.resizeObserver?.disconnect()
        this.clearField()
        for (const mount of this.battery.turrets) disposeRig(mount.rig)
        this.battery.turrets = []
        if (this.rail.railRig) disposeRig(this.rail.railRig)
        this.transient?.clear()
        this.view?.dispose()
        this.view = null
    }

    /** Drops one enemy of a type onto the field: for tests, the demo boards and the debug menu. */
    debugSpawn(id: HackerzEnemyId, u?: number, d?: number) {
        this.spawner.spawn(hackerzEnemy(id))
        const enemy = this.enemies[this.enemies.length - 1]
        if (!enemy) return
        if (u !== undefined) enemy.u = u
        if (d !== undefined) enemy.d = d
        if (this.movement.ridesNetwork(enemy)) this.movement.attachToNetwork(enemy)
        enemy.age = 1
        placeEnemy(enemy)
    }

    // ─── Auto-play ───────────────────────────────────────────────────────────

    /**
     * The board as auto-play tells it to Laya (see `hackerz-autopilot`), with
     * the hostiles it may pick keyed `e0`, `e1`… in `contacts`: hackers at
     * work first, then whatever is closest to the wall. Nothing that cannot be
     * locked on is offered.
     */
    autopilotView(): { view: HackerzAutopilotView, contacts: Map<string, EnemyEntity> } {
        const loadout = this.loadout
        const chips = this.pathChips?.chips ?? []
        const live = this.enemies.filter(e => e.hp > 0 && !e.turned && !e.decoy && !this.combat.untargetable(e))
        live.sort((a, b) => Number(b.hacking) - Number(a.hacking) || Number(!!b.def.boss) - Number(!!a.def.boss) || a.d - b.d)
        const picked = live.slice(0, AUTOPILOT_CONTACTS)
        const contacts = new Map(picked.map((enemy, i) => [`e${i}`, enemy]))
        const hostile = this.enemies.filter(e => e.hp > 0 && !e.turned)
        return {
            contacts,
            view: {
                wave: this.wave,
                wall: this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 0,
                held: chips.filter(chip => chip.state === 'hacked').length,
                nodes: chips.length,
                contacts: picked.map((enemy, i) => ({
                    key: `e${i}`,
                    name: enemy.def.name,
                    boss: !!enemy.def.boss,
                    hacking: enemy.hacking,
                    hacker: enemy.def.id === HACKERZ_HACKER_ID,
                    d: enemy.d,
                    health: enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0,
                    plated: !!enemy.def.armored
                })),
                near: hostile.filter(e => e.d < AUTOPILOT_NEAR).length,
                hidden: hostile.filter(e => this.combat.inTheDark(e) || (!!e.def.cloaked && !e.decloaked && e.revealMs <= 0)).length,
                total: hostile.length,
                pulseReady: !!loadout?.pulseUnlocked && this.abilities.pulseCharge >= loadout.pulseCooldownMs,
                pingReady: this.abilities.pingCharge >= PING_COOLDOWN_MS,
                overclockReady: !!loadout?.overclockUnlocked && this.abilities.overclockLeft <= 0 && this.abilities.overclockCharge >= loadout.overclockCooldownMs
            }
        }
    }

    /** Auto-play locks the rail on `target` and holds the trigger, or lets go with none. */
    autopilotAim(target: EnemyEntity | null) {
        const live = !!target && target.hp > 0 && this.enemies.includes(target)
        this.rail.target = live ? target : null
        this.rail.lockSpot = null
        this.rail.holding = live
    }

    /**
     * The densest pack of ground hostiles: its centre, its size, the one in it
     * closest to the wall, and the one a White Hat would best turn. Null with
     * nothing on the ground.
     */
    private autopilotPack() {
        const best = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !hackerzIsAirborne(e.def) && !this.combat.untouchable(e)))
        if (!best.length) return null
        const u = best.reduce((sum, e) => sum + e.u, 0) / best.length
        const d = best.reduce((sum, e) => sum + e.d, 0) / best.length
        const lead = best.reduce((top, e) => e.d < top.d ? e : top)
        const convert = best.filter(e => this.whiteHats.turnable(e)).sort((a, b) => b.maxHp - a.maxHp)[0] ?? null
        return { u, d, size: best.length, lead, convert }
    }

    /** Auto-play's deployable stock and the pack it would be used on. */
    autopilotStock() {
        const pack = this.autopilotPack()
        return {
            stock: { ...this.deployer.stock },
            pack: pack ? { size: pack.size, d: pack.d } : null,
            held: (this.pathChips?.chips ?? []).filter(chip => chip.state === 'hacked').length
        }
    }

    /**
     * Auto-play uses a deployable where it does the most: a Power Surge on the
     * densest pack, a Honeypot, Proxy Wall or Logic Bomb just ahead of it on
     * its way to the wall, a White Hat on the toughest hostile in it that can
     * be turned; Portscan and Cosmic Blip simply go off. True when one was spent.
     */
    autopilotDeploy(id: HackerzDeployableId) {
        if (!this.running || this.purging || this.paused || this.deployer.stock[id] <= 0) return false
        const before = this.deployer.stock[id]
        if (hackerzDeployable(id).instant) {
            this.deployer.useInstant(id)
            return this.deployer.stock[id] < before
        }
        const pack = this.autopilotPack()
        if (!pack) return false
        if (id === 'whitehat') {
            if (pack.convert) this.deployer.useWhiteHat(pack.convert)
            return this.deployer.stock[id] < before
        }
        this.rail.aimU = pack.u
        this.rail.aimD = pack.d - (AUTOPILOT_DEPLOY_AHEAD[id] ?? 0)
        const spot = this.deployer.deploySpot(id)
        this.deployer.drop(id, spot.u, spot.d, spot.chip)
        return true
    }

    /**
     * Auto-play fires blind: with nothing to lock on but hostiles hidden in
     * the dark, the rail holds its trigger on the middle of the densest of
     * them — where a player would spray. A cloaked unit is not aimed at: a
     * round passes through it. True when it is firing.
     */
    autopilotBlindFire() {
        const pack = densestGroup(this.enemies.filter(e => e.hp > 0 && !e.turned && !this.combat.untouchable(e) && this.combat.inTheDark(e)))
        if (!pack.length) return false
        const n = pack.length
        this.rail.target = null
        this.rail.lockSpot = {
            u: pack.reduce((sum, e) => sum + e.u, 0) / n,
            d: pack.reduce((sum, e) => sum + e.d, 0) / n,
            y: pack.reduce((sum, e) => sum + enemyCentreY(e), 0) / n
        }
        this.rail.holding = true
        return true
    }

    /** Auto-play fires an ability; each does nothing when it is not ready. */
    autopilotAbility(id: 'pulse' | 'ping' | 'overclock') {
        if (id === 'pulse') this.abilities.firePulse()
        else if (id === 'ping') this.abilities.firePing()
        else this.abilities.fireOverclock()
    }

    /** Advances the simulation by hand, in frames of `frameMs`. For a test harness only. */
    debugStep(ms: number, frameMs = 16.7) {
        for (let t = 0; t < ms; t += frameMs) this.tick(frameMs)
    }

    // ─── Database demo ───────────────────────────────────────────────────────

    /**
     * Mounts this engine as a Database demo: a quiet board that a script
     * drives. Nothing spawns on its own, the wave never ends, the wall never
     * falls, and no key or click reaches it — the real game may be running
     * underneath.
     */
    async mountDemo(host: HTMLDivElement, loadout: HackerzLoadout) {
        this.demo = true
        await this.mount(host)
        if (!this.mounted) return false
        this.startRun({ loadout })
        this.demoReset()
        return true
    }

    /**
     * Plays a script on the demo board, from the top and on a loop. `say`
     * hears each line it prints. Every loop is identical: the board, the
     * rolls and the clock all start over from the same seed.
     */
    demoPlay(script: DemoScript, loadout: HackerzLoadout, say: (line: string) => void) {
        if (!this.demo) return
        this.demoScript = script
        this.demoSay = say
        this.loadout = loadout
        this.demoReset()
    }

    /**
     * Fires the rail for the script: locked on the hostile nearest the fence
     * (and the next one when it falls), at the hacked node furthest out, or —
     * with null — not at all.
     */
    demoFire(at: 'lead' | 'node' | null) {
        if (!this.demo) return
        this.demoFiring = at
        this.rail.holding = at !== null
        if (!at) this.rail.target = null
    }

    /** Sets off one of the rail's abilities for the script, charged or not. */
    demoAbility(id: 'pulse' | 'overclock' | 'ping') {
        const loadout = this.loadout
        if (!this.demo || !loadout) return
        if (id === 'pulse') {
            this.abilities.pulseCharge = loadout.pulseCooldownMs
            this.abilities.firePulse()
        } else if (id === 'overclock') {
            this.abilities.overclockLeft = 0
            this.abilities.overclockCharge = loadout.overclockCooldownMs
            this.abilities.fireOverclock()
        } else {
            this.abilities.firePing(true)
        }
    }

    /**
     * Puts a hostile on the demo board that thinks for itself, as in a wave —
     * a hacker that goes for the nodes, a daemon that takes up a node's
     * guard. The board's seeded rolls keep what it decides the same every loop.
     */
    demoSpawnFree(id: HackerzEnemyId, u: number, d: number) {
        if (!this.demo) return
        this.debugSpawn(id, u, d)
        const enemy = this.enemies[this.enemies.length - 1]
        if (enemy) this.demoSettle(enemy)
    }

    /** Keeps the rail's lock for the script: on the next hostile when its mark falls, or on the outermost hacked node. */
    private demoAim() {
        if (this.demoFiring === 'lead') {
            if (this.rail.target && this.rail.target.hp > 0 && this.enemies.includes(this.rail.target)) return
            this.rail.target = this.enemies
                .filter(e => e.hp > 0 && !e.turned && !this.combat.untargetable(e))
                .sort((a, b) => a.d - b.d)[0] ?? null
        } else if (this.demoFiring === 'node') {
            const chip = this.pathChips?.ordered.find(c => c.state === 'hacked')
            this.rail.target = null
            if (chip) {
                this.rail.aimU = chip.u
                this.rail.aimD = chip.d
            }
        }
    }

    /** Puts the demo board back to a fresh, empty wave over the same seeded board: the script's loop point. */
    demoReset() {
        const loadout = this.loadout
        if (!this.demo || !loadout) return
        this.demoRng = seededRng(DEMO_SEED)
        withSeed(this.demoRng, () => {
            this.clearField()
            this.pathChips?.reset()
            this.movement.network = buildNetwork(this.pathChips?.ordered ?? [])
            this.view?.setNetwork(this.movement.network)
            this.territory.islands = []
            this.elapsedTotal = 0
            this.visualTime = 0
            this.startWave(1, loadout)
            this.spawner.schedule = []
            this.waveMs = Infinity
            // A wave carries the wall's damage over; a demo loop starts whole,
            // and so do the guns on it: no reload or aim left from the last loop.
            this.bastion.wallHp = this.bastion.wallMaxHp
            this.bastion.shield = this.bastion.shieldMax
            // The rail, the barrier's regen clock and the kill chain start fresh too.
            this.rail.railHeading = Math.PI
            this.rail.railU = RAIL_U
            this.rail.railKick = 0
            this.bastion.msSinceWallHit = 99_999
            this.bastion.shieldHit = 0
            this.scoring.chain = 0
            this.scoring.totalKills = 0
            this.abilities.pingCharge = PING_COOLDOWN_MS
            // Dark zones fade in and out: one lit in the last scene must not still be fading here.
            for (const zone of this.territory.darkZones) Object.assign(zone, { u: 0, d: 0, r: 0, strength: 0, on: false })
            this.territory.darkness = 0
            // Their ground pours rather than jumps, so it is poured back out to the portal: no red left over.
            this.view?.redLine.fill(FIELD_DEPTH)
            this.view?.orangeLine.fill(FIELD_DEPTH)
            // Reused or freshly built, every mount starts as a new one stands: facing home, ready to fire.
            for (const mount of this.battery.turrets) {
                mount.cooldown = 0
                mount.kick = 0
                mount.heading = Math.PI
                mount.frozenMs = 0
            }
        })
        this.overlay.clear()
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
    private demoFrame(rawMs: number) {
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
                    step.run?.(this)
                }
                this.demoAim()
                this.tick(DEMO_STEP_MS)
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
    private demoCamera(dt: number) {
        const view = this.view
        if (!view) return
        let u = 0
        let d = FIELD_DEPTH * 0.5
        const live = this.enemies.filter(e => e.hp > 0)
        if (this.demoFocus) {
            u = this.demoFocus.u
            d = this.demoFocus.d
        } else if (live.length) {
            u = live.reduce((sum, e) => sum + e.u, 0) / live.length
            d = live.reduce((sum, e) => sum + e.d, 0) / live.length
        }
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
        if (!this.demo || !start) return
        // Set down where it stands, as a hatching spiderling is: it resolves out
        // of the dark on the spot, and the portal shows nothing of it.
        this.spawner.spawn(hackerzEnemy(id), false, 1, start)
        const enemy = this.enemies[this.enemies.length - 1]
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
        const chips = this.pathChips
        if (!this.demo || !chips) return
        const taken = chips.ordered.slice(0, count)
        for (const chip of taken) chips.landPulse(chip, 1)
        if (taken.length) {
            this.demoLook({
                u: taken.reduce((sum, chip) => sum + chip.u, 0) / taken.length,
                d: taken.reduce((sum, chip) => sum + chip.d, 0) / taken.length
            })
        }
    }

    /**
     * Uses a deployable on the demo board as a player would: placed at (u, d),
     * fired on the spot when it has nothing to aim, or — a White Hat — put on
     * the hostile nearest (u, d). The demo's stock never runs out.
     */
    demoDeploy(id: HackerzDeployableId, u: number, d: number) {
        if (!this.demo) return
        this.deployer.stock[id] = HACKERZ_DEPLOYABLE_MAX
        if (hackerzDeployable(id).instant) {
            this.deployer.useInstant(id)
            return
        }
        if (id === 'whitehat') {
            const pick = this.enemies
                .filter(e => this.whiteHats.turnable(e))
                .sort((a, b) => Math.hypot(a.u - u, a.d - d) - Math.hypot(b.u - u, b.d - d))[0]
            this.deployer.useWhiteHat(pick ?? null)
            return
        }
        // Exactly where the script says: no snapping to a line or a node.
        this.deployer.drop(id, u, d, null)
    }

    private loop = (now: number) => {
        if (this.destroyed) return
        this.raf = requestAnimationFrame(this.loop)
        const rawMs = now - this.lastTime
        this.lastTime = now
        if (this.demo) this.demoFrame(rawMs)
        else this.tick(rawMs)
    }

    // ─── Run control ─────────────────────────────────────────────────────────

    /**
     * Wipes the field and the bastion back to the start of a run. `wallHp` and
     * `kills` are how a saved run comes back: the save is only written between
     * waves, so restoring one is restoring the bastion and the armoury.
     */
    startRun(config: HackerzStartConfig) {
        if (!this.mounted) return false
        const { loadout } = config
        this.clearField()
        this.sysLog.reset()
        this.loadout = loadout
        this.rail.weapon = loadout.weapon
        this.rail.ammoRack?.setColour(loadout.weapon.hex)
        this.wave = 0
        this.waveElapsed = 0
        this.scoring.totalKills = config.kills ?? 0
        this.scoring.chain = 0
        this.scoring.emitChain()
        // A fresh board each run: nodes first, then the lines laid around them.
        this.pathChips?.reset()
        this.movement.network = buildNetwork(this.pathChips?.ordered ?? [])
        this.view?.setNetwork(this.movement.network)
        this.territory.islands = []
        this.gameOver = false
        this.purging = false
        this.running = false
        this.bastion.wallMaxHp = loadout.wallMaxHp
        this.bastion.wallHp = clamp(config.wallHp ?? loadout.wallMaxHp, 1, loadout.wallMaxHp)
        this.bastion.shieldMax = loadout.shieldMax
        this.bastion.shield = loadout.shieldMax
        this.abilities.pulseCharge = loadout.pulseCooldownMs
        this.abilities.overclockCharge = loadout.overclockCooldownMs
        this.abilities.overclockLeft = 0
        this.rail.magSize = Math.round(loadout.weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = 0
        this.rail.tarpitDrain = 0
        this.slots = loadout.slots
        this.battery.syncTurrets()
        this.bastion.emitWall()
        this.rail.emitAmmo()
        return true
    }

    /**
     * Applies the uplink's new loadout and releases the next wave. Max-health
     * upgrades are handed out as healing rather than headroom — buying Integrity
     * mid-run should feel like reinforcing the wall.
     */
    startWave(wave: number, loadout: HackerzLoadout, event: HackerzEventId | null = null) {
        if (!this.mounted || this.gameOver) return false
        // A bonus round is a sandbox for the board too: it is fought over fresh
        // nodes, and the run's own territory comes back untouched afterwards.
        if (event && !this.bonus) {
            this.bonusChips = this.pathChips?.snapshot() ?? null
            this.pathChips?.restore(null)
            // Every bonus round comes in over a board that is already theirs,
            // and locked: a 30-second round has no time for a fight over the
            // nodes, only for holding the wall. (A locked board puts no lights
            // out either — only the Blackout itself is dark.)
            if (this.pathChips) {
                this.pathChips.takeAll()
                this.pathChips.locked = true
            }
        }
        this.bonus = event
        if (event) this.spawner.sight(event)
        this.finalPush = false
        this.spawner.hackerTimer = 0
        this.spawner.hackerField = 0
        this.spawner.decoysLogged = false
        this.sysLog.clock = 0
        this.sysLog.waveStart(wave, event)
        this.waveMs = event ? HACKERZ_BONUS_MS : HACKERZ_WAVE_MS
        this.bastion.bonusFailed = false
        this.deployer.stock = { ...loadout.deployables }
        this.deployables?.clear()
        this.linePulses?.clear()
        this.deployer.arm(null)
        const previousMax = this.bastion.wallMaxHp
        this.loadout = loadout
        this.rail.weapon = loadout.weapon
        this.rail.ammoRack?.setColour(loadout.weapon.hex)
        this.bastion.wallMaxHp = loadout.wallMaxHp
        if (loadout.wallMaxHp > previousMax) this.bastion.wallHp += loadout.wallMaxHp - previousMax
        this.bastion.wallHp = clamp(this.bastion.wallHp, 1, this.bastion.wallMaxHp)
        this.bastion.shieldMax = loadout.shieldMax
        this.bastion.shield = loadout.shieldMax
        this.rail.magSize = Math.round(loadout.weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = 0
        this.rail.tarpitDrain = 0
        this.rail.fireTimer = 0
        this.abilities.pulseCharge = loadout.pulseCooldownMs
        this.abilities.overclockCharge = loadout.overclockCooldownMs
        this.abilities.overclockLeft = 0
        this.slots = loadout.slots
        this.battery.syncTurrets()
        for (const mount of this.battery.turrets) if (mount.frozenMs > 0) this.battery.thaw(mount)

        this.wave = wave
        this.waveElapsed = 0
        this.scoring.waveKills = 0
        this.scoring.waveCredits = 0
        this.scoring.waveCoins = 0
        this.spawner.scheduleIndex = 0
        this.spawner.schedule = this.spawner.buildSchedule(wave)
        this.running = true
        this.purging = false
        this.paused = false
        this.rail.target = null
        // A bonus round is a sandbox: whatever it does to the wall is undone.
        this.bastion.bonusStartHp = this.bastion.wallHp
        this.bastion.bonusStartShield = this.bastion.shield

        if (event) {
            const def = hackerzNetworkEvent(event)
            this.overlay.banner(`BONUS · ${def.name}`, def.hex,
                `hold above ${Math.round(HACKERZ_BONUS_PASS_INTEGRITY * 100)}% for ×${HACKERZ_BONUS_MULTIPLIER} credits`)
        } else {
            const final = wave >= HACKERZ_MAX_WAVE
            this.overlay.banner(
                final ? 'FINAL WAVE' : `WAVE ${wave}`,
                final || hackerzIsBossWave(wave) ? RED : CYAN,
                `${this.spawner.schedule.length} hostiles queued`
            )
        }
        this.bastion.emitWall()
        this.rail.emitAmmo()
        this.abilities.emitPulse()
        this.abilities.emitOverclock()
        this.callbacks.onSound?.('wave-start')
        return true
    }

    /**
     * Hot-swaps the active weapon mid-wave. The magazine comes back full but the
     * swap costs a short reload, so switching is a decision rather than free.
     */
    swapWeapon(weapon: HackerzWeaponRuntime) {
        if (!this.loadout) return
        this.loadout = { ...this.loadout, weapon }
        this.rail.weapon = weapon
        this.rail.ammoRack?.setColour(weapon.hex)
        this.rail.magSize = Math.round(weapon.magazine)
        this.rail.mag = this.rail.magSize
        this.rail.reloadTimer = this.running ? Math.min(600, weapon.reloadMs) : 0
        this.rail.fireTimer = 0
        this.callbacks.onWeapon(weapon.id)
        this.rail.emitAmmo()
        this.callbacks.onSound?.('weapon-swap')
    }

    // ─── Deployables ─────────────────────────────────────────────────────────

    /** See `Deployer.arm`. */
    arm(id: HackerzDeployableId | null) {
        return this.deployer.arm(id)
    }

    // ─── Consumables: Portscan, Cosmic Blip, White Hat, Power Surge ──────────

    /** Uplink purchase — patches the wall back to full between waves. */
    repairWall() {
        this.bastion.wallHp = this.bastion.wallMaxHp
        this.bastion.emitWall()
    }

    pause() {
        this.paused = true
        this.rail.holding = false
    }

    resume() {
        this.paused = false
    }

    get isRunning() {
        return this.running
    }

    /** Current wall health, for a save written from the uplink. */
    get currentWallHp() {
        return Math.round(this.bastion.wallHp)
    }

    // ─── Main loop ───────────────────────────────────────────────────────────

    private tick(rawMs: number) {
        const view = this.view
        if (this.destroyed || !view) return
        // A backgrounded tab hands back one enormous frame on return; stepping
        // physics by it teleports every enemy through the wall.
        const dtMs = Math.min(rawMs, 50)
        const dt = dtMs / 1000
        this.elapsedTotal += dtMs

        const live = !this.paused && !this.gameOver
        // PACKET LOSS: during a lag spike the whole picture holds — every
        // animation, every shader clock — while the game itself runs on.
        if (live) this.lag.updateBoardLag(dtMs)
        const frozen = live && this.lag.boardLagMs > 0
        this.lag.muteFx(frozen)
        const seen = frozen ? 0 : dt
        if (!frozen) this.visualTime += dtMs
        // The model clock is shared; a demo board hands it back after its own steps (see `demoFrame`).
        modelClock.value = this.visualTime / 1000
        if (live) {
            if (this.running && !this.purging) {
                // A lag spike stops the clock too, but not the hostiles: they
                // gain ground on the wave timer while the picture holds.
                if (!frozen) this.waveElapsed += dtMs
                this.sysLog.tick(this.waveElapsed, this.enemies.length)
                this.spawner.releaseScheduled()
                // A demo board brings on only what its script spawns.
                if (!this.demo) {
                    this.spawner.maintainHackers(dtMs)
                    this.spawner.maintainDistraction(dtMs)
                    this.squads.maintainBearers(dtMs)
                    this.squads.maintainEscorts(dtMs)
                }
                this.squads.maintainDefenders()
                this.rootkit.hatchInfected(dtMs)
                this.rail.updateWeapon(dtMs)
                this.abilities.updateAbilities(dtMs)
                if (!this.finalPush && this.waveElapsed >= this.waveMs - FINAL_PUSH_MS) this.beginFinalPush()
                if (this.waveElapsed >= this.waveMs) this.beginPurge()
            }
            this.deployer.updateDeployables(dt)
            this.enemyAi.updateEnemies(dt, dtMs)
            this.projectiles.updateBullets(dt)
            this.projectiles.updateSpits(dt)
            this.blackIce.updateIce(dt)
            if (this.running && !this.purging) this.deployer.updateSurges(dtMs)
            this.battery.updateTurrets(dtMs, frozen)
            this.scoring.updateCoins(frozen ? 0 : dtMs)
            this.bastion.updateBastion(dt, dtMs)
            this.memory.updateLeaks(dt, frozen ? 0 : dtMs)
            this.hacking.updateHackPulses(dt)
            this.pathChips?.update(seen)
            this.linePulses?.update(seen, (u, d) => this.hacking.pulseFade(u, d))
            this.shrapnel?.update(seen)
            this.glitchClouds?.update(seen)
            this.particles.update(seen)
            this.transient?.update(seen)
        }
        this.guardrail?.update(live ? seen : 0)
        this.terminals?.update(live ? seen : 0, view.camera)
        this.rail.updateRail(frozen ? 0 : dt)
        this.updateCamera(dt)
        this.territory.updateTerritory(live ? seen : 0)
        const reload = this.rail.reloadTimer > 0 && this.rail.weapon ? 1 - this.rail.reloadTimer / this.rail.weapon.reloadMs : 1
        this.rail.ammoRack?.update(live ? seen : 0, this.rail.mag, this.rail.magSize, reload)
        this.laneProps?.update(live ? seen : 0, view.redLine, view.orangeLine)
        this.combat.updateDying(live ? seen : 0)
        view.ageSurges(live ? seen : 0)

        // The grid goes dark while the gun reloads: it has no power then.
        view.trapMaterial.uniforms.uLevel!.value = (this.loadout?.spikeDps ?? 0) > 0 && this.rail.tarpitPowered ? 1 : 0
        view.shieldMaterial.uniforms.uStrength!.value = this.bastion.shieldMax > 0 ? this.bastion.shield / this.bastion.shieldMax : 0
        view.shieldMaterial.uniforms.uHit!.value = this.bastion.shieldHit
        // With every node theirs the ground right up to the deck and the barrier
        // lattice turn disputed orange, and the fence's own glow dims.
        this.territory.overrun += ((this.movement.allNodesTaken ? 1 : 0) - this.territory.overrun) * Math.min(1, dt * 1.5)
        view.gate.value = this.territory.overrun
        view.setWallState(this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 1, this.bastion.wallFlash, this.territory.overrun)

        // BLACKOUT: the lights go down and the fog closes in, eased both ways.
        const dark = this.bonus === 'blackout' && this.running ? 1 : 0
        this.territory.darkness += (dark - this.territory.darkness) * Math.min(1, dt * 1.2)
        view.renderer.toneMappingExposure = 1.05 - 0.5 * this.territory.darkness
        // The hostiles' shroud follows the same dark: the zones, and the Blackout.
        shroud.dark.value = view.darkZones
        shroud.blackout.value.set(this.territory.darkness, -BLACKOUT_LIGHT_D * FIELD_SCALE)
        const fog = view.scene.fog as THREE.Fog | null
        if (fog) {
            fog.near = 45 - 27 * this.territory.darkness
            fog.far = 120 - 58 * this.territory.darkness
        }

        if (this.demo) this.demoCamera(dt)
        view.render(frozen ? 0 : dt, this.shake)
        this.drawOverlay(frozen ? 0 : dt)

        if (this.running && live) {
            this.callbacks.onWaveTime(Math.max(0, this.waveMs - this.waveElapsed), this.enemies.length)
        }
    }

    private updateCamera(dt: number) {
        this.shake = this.shake > 0.005 ? Math.max(0, this.shake - this.shake * SHAKE_DECAY * dt) : 0
    }

    // ─── Shield bearers ──────────────────────────────────────────────────────

    addShake(amount: number) {
        // The old engine shook in pixels; this one shakes in world units. A lag
        // spike shows nothing landing, so nothing shakes.
        if (this.lag.boardLagMs > 0) return
        this.shake = Math.min(MAX_SHAKE, this.shake + amount * 0.05)
    }

    private drawOverlay(dt: number) {
        const view = this.view
        if (!view) return
        const tags: HealthTag[] = []
        for (const enemy of this.enemies) {
            // The bar's trail holds where the health stood, then drains down to it.
            const fraction = enemy.hp / enemy.maxHp
            const trail = enemy.hpTrail ?? 1
            enemy.hpTrail = trail <= fraction ? fraction : Math.max(fraction, trail - dt * HP_TRAIL_DRAIN)
            // Only wounded enemies get a bar; a pip over every crawler is noise.
            // Nor does anything mostly lost in the dark: the bar would give it away.
            if (enemy.hp >= enemy.maxHp || !enemy.rig.root.visible || this.territory.shroudOf(enemy) > 0.6) continue
            tags.push({
                // Overlays follow the picture, so a lag spike does not give a position away.
                pos: this.lag.seenWorld(enemy, enemy.rig.height * PER_WORLD + 12, new THREE.Vector3()),
                fraction,
                trail,
                color: hexCss(enemy.def.hex),
                armored: enemy.armored,
                width: enemy.def.boss ? 90 : clamp(enemy.def.height * 0.6, 22, 50)
            })
        }
        let reticle = null
        if (this.rail.target) {
            const height = this.rail.target.rig.height * PER_WORLD
            const pos = this.lag.seenWorld(this.rail.target, height * 0.5, new THREE.Vector3())
            const top = view.project(this.lag.seenWorld(this.rail.target, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 6, 12, 70) : 16
            reticle = { pos, size, color: '#22d3ee' }
        }
        // Radar contacts: a bracket on everything the ping lit, fading with it.
        const markers = []
        for (const enemy of this.enemies) {
            if (enemy.revealMs <= 0) continue
            const height = enemy.rig.height * PER_WORLD
            const pos = this.lag.seenWorld(enemy, height * 0.5, new THREE.Vector3())
            const top = view.project(this.lag.seenWorld(enemy, height, _w), { x: 0, y: 0 })
            const mid = view.project(pos, { x: 0, y: 0 })
            const size = top && mid ? clamp(Math.abs(top.y - mid.y) + 8, 12, 80) : 16
            markers.push({ pos, size, alpha: enemy.revealMs / PING_REVEAL_MS, cloaked: !!enemy.def.cloaked })
        }
        this.overlay.draw(
            view.overlayCtx, view.width, view.height, this.paused ? 0 : dt,
            (p, out) => view.project(p, out), tags, reticle, this.visualTime / 1000, markers
        )
    }

    // ─── Wave end ────────────────────────────────────────────────────────────

    /**
     * The wall flushes the field: a wall of light sweeps out from the wall and
     * takes everything it passes. Survivors still pay out, at a fraction — enough
     * that a wave you barely held is not also a wave you earned nothing from.
     */
    beginPurge() {
        if (this.purging) return
        this.sysLog.purge(this.enemies.length)
        // The sweep is a full garbage collection: every leaked block goes with it.
        this.memory.clearLeaks(true)
        // And the black ice melts.
        for (const wall of this.blackIce.iceWalls) wall.wall.thaw()
        this.purging = true
        this.rail.holding = false
        this.rail.target = null
        this.callbacks.onWaveTime(0, this.enemies.length)

        this.view?.flash(0xffffff, 0.25)
        this.addShake(6)
        const width = FIELD_HALF_WIDTH * 2 * FIELD_SCALE + 6
        this.transient?.sweep(width, 9, 0, -PURGE_REACH * FIELD_SCALE, PURGE_MS,
            (z) => {
                const front = -z * PER_WORLD
                for (let i = this.enemies.length - 1; i >= 0; i--) {
                    if ((this.enemies[i] as EnemyEntity).d > front) continue
                    this.combat.killEnemy(i, HACKERZ_PURGE_BOUNTY)
                }
            },
            () => this.finishWave()
        )
    }

    /**
     * The closing stretch of a wave: every hostile on the field charges the
     * fence faster, while the hackers keep working the nodes. This is where a
     * wave is meant to peak.
     */
    private beginFinalPush() {
        this.finalPush = true
        this.sysLog.finalPush()
        this.overlay.banner('FINAL PUSH', RED, 'they are going all in')
        this.view?.flash(RED, 0.16)
        this.addShake(6)
        this.callbacks.onSound?.('boss-spawn')
    }

    /** The field's pace: everything moves at `ENEMY_PACE`, and faster again in the final push. */
    get pushSpeed() {
        return ENEMY_PACE * (this.finalPush ? FINAL_PUSH_SPEED : 1)
    }

    private finishWave() {
        // A wall that fell during the sweep has already ended the run; do not
        // hand the uplink a wave it can deploy out of.
        if (this.gameOver) return
        this.running = false
        this.purging = false
        this.finalPush = false
        this.abilities.overclockLeft = 0
        this.deployer.arm(null)
        // Unspent hardware does not carry over: it was placed for this fight.
        this.deployables?.clear()
        this.linePulses?.clear()

        // Anything left (a boss knocked past the sweep's reach, say) goes too.
        while (this.enemies.length) this.combat.killEnemy(this.enemies.length - 1, HACKERZ_PURGE_BOUNTY)
        for (const spit of this.projectiles.spits) spit.mesh.removeFromParent()
        this.projectiles.spits = []
        this.memory.clearLeaks(false)
        this.rootkit.infected.clear()
        this.blackIce.clearIce()
        this.deployer.surges = []
        this.abilities.portscanLeft = 0
        // Coins still mid-flight belong to the wave that dropped them.
        this.scoring.flushCoins()

        const event = this.bonus
        let passed = false
        if (event) {
            // The sandbox: the wall goes back to how the round found it.
            this.bastion.wallHp = this.bastion.bonusStartHp
            this.bastion.shield = this.bastion.bonusStartShield
            this.bastion.emitWall()
            passed = !this.bastion.bonusFailed
            if (passed && this.scoring.waveCredits > 0) {
                const extra = this.scoring.waveCredits * (HACKERZ_BONUS_MULTIPLIER - 1)
                this.scoring.waveCredits += extra
                this.callbacks.onCredits(extra, 'clear')
                this.overlay.banner(`BONUS ×${HACKERZ_BONUS_MULTIPLIER}`, LIME, `+${extra} credits`)
                this.view?.flash(0xa3e635, 0.3)
                if (this.rail.railRig) this.particles.burst(this.rail.railRig.root.position, LIME, 120, 16, { size: 0.36, life: 1 })
            }
            this.bonus = null
            if (this.pathChips) this.pathChips.locked = false
            this.pathChips?.restore(this.bonusChips)
            this.bonusChips = null
            this.territory.islands = []
        } else {
            const integrity = this.bastion.wallMaxHp > 0 ? this.bastion.wallHp / this.bastion.wallMaxHp : 0
            const clear = hackerzClearBonus(this.wave, integrity)
            this.scoring.waveCredits += clear
            this.callbacks.onCredits(clear, 'clear')
        }

        const victory = !event && this.wave >= HACKERZ_MAX_WAVE
        if (victory) {
            this.gameOver = true
            this.overlay.banner('INTRUSION REPELLED', LIME, `${HACKERZ_MAX_WAVE} waves held`)
            this.view?.flash(0xffffff, 0.4)
        }

        this.sysLog.waveEnd(this.wave, this.scoring.waveKills)
        this.callbacks.onWaveEnd({
            wave: this.wave,
            kills: this.scoring.waveKills,
            credits: this.scoring.waveCredits,
            coins: this.scoring.waveCoins,
            wallHp: Math.round(this.bastion.wallHp),
            wallMaxHp: this.bastion.wallMaxHp,
            victory,
            bonus: event,
            passed
        })
        this.callbacks.onSound?.('wave-win')
    }

    endRun() {
        if (this.gameOver) return
        this.gameOver = true
        this.running = false
        this.purging = false
        this.rail.holding = false
        this.rail.target = null
        this.callbacks.onSound?.('game-over')
        // Coins in the air when the wall fell were still earned.
        this.scoring.flushCoins()

        this.view?.flash(RED, 0.6)
        this.overlay.banner('BREACHED', RED, `wave ${this.wave}`)
        this.addShake(22)
        for (let i = 0; i < 6; i++) {
            this.transient?.ring(fieldToWorld(randRange(-400, 400), randRange(0, 60), 1, _v), RED, 8, 0.8)
        }
        this.callbacks.onGameOver({ wave: this.wave, kills: this.scoring.totalKills })
    }

    // ─── Housekeeping ────────────────────────────────────────────────────────

    private clearField() {
        while (this.enemies.length) this.combat.removeEnemy(this.enemies.length - 1)
        for (const bullet of this.projectiles.bullets) bullet.mesh.removeFromParent()
        this.projectiles.bullets = []
        for (const spit of this.projectiles.spits) spit.mesh.removeFromParent()
        this.projectiles.spits = []
        this.memory.clearLeaks(false)
        this.rootkit.infected.clear()
        this.blackIce.clearIce()
        this.deployer.surges = []
        this.abilities.portscanLeft = 0
        // Dropped without banking: a cleared field is a run that is restarting.
        for (const coin of this.scoring.coins) coin.mesh.removeFromParent()
        this.scoring.coins = []
        this.particles.clear()
        for (const corpse of this.combat.dying) disposeRig(corpse.rig)
        this.combat.dying = []
        this.view?.clearSurges()
        this.transient?.clear()
        this.overlay.clear()
        this.deployables?.clear()
        this.linePulses?.clear()
        this.shrapnel?.clear()
        this.glitchClouds?.clear()
        this.hacking.clearHacking()
        this.deployer.armed = null
        this.bonus = null
        this.bonusChips = null
        if (this.pathChips) this.pathChips.locked = false
        this.rail.target = null
        this.rail.holding = false
        this.shake = 0
        this.bastion.wallFlash = 0
    }
}

/**
 * The units within `AUTOPILOT_PACK_RADIUS` of whichever of them has the most
 * neighbours: the densest pack. Empty when there are none.
 */
function densestGroup(units: EnemyEntity[]) {
    let centre: EnemyEntity | null = null
    let most = 0
    for (const unit of units) {
        let count = 0
        for (const other of units) {
            if (Math.hypot(other.u - unit.u, other.d - unit.d) <= AUTOPILOT_PACK_RADIUS) count++
        }
        if (count > most) {
            most = count
            centre = unit
        }
    }
    if (!centre) return []
    const at = centre
    return units.filter(o => Math.hypot(o.u - at.u, o.d - at.d) <= AUTOPILOT_PACK_RADIUS)
}
