import type { DfPowerupKind } from '#shared/utils/dead-front/constants'
import type { DfMapDef } from '#shared/utils/dead-front/map'
import { dfGroundHeight } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { DfDevOp, DfEvent, DfTrapSnap, DfWorldSnap, DfZombieSnap } from '#shared/utils/dead-front/protocol'
import {
    DF_GAS, DF_TRAP, dfCrawlChance, dfCrawlSpeed, dfGasFirstRound, dfGasRoundCount, dfGasSchedule, dfInTrap,
    dfNewStreak, dfStreakKill, dfTrapBlocked, dfTrapPlayerDamage, dfTrapStart, dfTrapTick
} from '#shared/utils/dead-front/specials'
import type { DfGasPocketDef, DfStreakState, DfTrap, DfTrapRun } from '#shared/utils/dead-front/specials'
import type { DfEnemyType, DfHitZone, Vec3 } from '#shared/utils/dead-front/types'
import { randomChance, randomFloat } from '#shared/utils/random'
import type { SimPlayer, SimZombie } from './sim-types'

// Special rounds and set pieces on top of the match simulation: gas rounds,
// the electric traps, crawlers and kill streaks. The simulation owns the
// state of the world; this module keeps its own little state and is driven
// through a handful of hooks (round start/end, spawn, wound, kill, step, use,
// snapshot). Rules live in shared/utils/dead-front/specials.ts.

/** The simulation, as this module sees it (DfMatchSim fits structurally). */
export interface DfSpecialsHost {
    readonly map: DfMapDef
    readonly time: number
    readonly round: number
    readonly power: boolean
    readonly players: SimPlayer[]
    readonly zombies: SimZombie[]
    readonly world: DfCollisionWorld
    readonly activeZones: Set<string>
    emit(ev: DfEvent): void
    dropPowerup(kind: DfPowerupKind, pos: Vec3): void
    debugSpawn(type: DfEnemyType, pos: Vec3, hp?: number): SimZombie
}

/** The simulation's private moves this module may make. */
export interface DfSpecialsHooks {
    /** Kills a zombie for the trap (no player credited: the buyer is paid separately). */
    killByTrap(z: SimZombie): void
    /** Pays points (multipliers apply). */
    points(p: SimPlayer, amount: number): void
    /** Light damage from the world (not a zombie): the trap's sting. */
    hurt(p: SimPlayer, dmg: number): void
    /** Takes points if the player can afford it. */
    spend(p: SimPlayer, cost: number): boolean
    /** Zombies still to kill this round (alive + to spawn). */
    left(): number
}

/**
 * Hits can turn zombies into crawlers (the zombie view poses them prone over
 * the low hitboxes). A kill switch: false keeps every zombie on its feet.
 */
export const DF_CRAWLERS_LIVE = true

interface TrapRuntime {
    def: DfTrap
    run: DfTrapRun
    pulseAt: number
}

export class DfSpecials {
    /** The current round is a gas round. */
    gas = false
    private nextGas: number
    private forceGas = false
    private pockets: DfGasPocketDef[] = []
    private gasDropped = false
    private readonly traps: TrapRuntime[]
    private readonly streaks = new Map<number, DfStreakState>()

    constructor(private readonly host: DfSpecialsHost, private readonly hooks: DfSpecialsHooks) {
        this.nextGas = dfGasFirstRound(randomFloat())
        this.traps = (host.map.traps ?? []).map(def => ({ def, run: { state: 'idle', timer: 0, owner: -1 }, pulseAt: 0 }))
    }

    /** The round the next gas attack is due (tests, debugging). */
    get nextGasRound(): number {
        return this.nextGas
    }

    // ------------------------------------------------------------ rounds

    /** A round starts; returns how many zombies it holds (`normal` unless the gas rolls in). */
    roundStart(round: number, normal: number): number {
        const sched = dfGasSchedule(round, this.nextGas, randomFloat)
        this.nextGas = sched.next
        this.gas = sched.gas || this.forceGas
        this.forceGas = false
        this.gasDropped = false
        if (!this.gas) {
            this.pockets = []
            return normal
        }
        this.pockets = this.pickPockets()
        return dfGasRoundCount(normal)
    }

    roundEnd(): void {
        this.gas = false
        this.pockets = []
    }

    /** Seconds between spawns this round. */
    spawnInterval(base: number): number {
        return this.gas ? base * DF_GAS.spawnMult : base
    }

    /** Gas rounds: every spawn is a gas-masked ghoul sprinting out of the fog. */
    onSpawn(z: SimZombie): void {
        if (!this.gas) return
        z.masked = true
        z.gait = 'sprint'
        z.speed *= DF_GAS.speedMult
    }

    /** The thickest gas hangs over the risers of the zones in play, where the ghouls climb out. */
    private pickPockets(): DfGasPocketDef[] {
        const risers = this.host.map.riserSpawns.filter(r => this.host.activeZones.has(r.zone))
        const pool = [...risers]
        const out: DfGasPocketDef[] = []
        while (pool.length && out.length < DF_GAS.pockets) {
            const r = pool.splice(Math.floor(randomFloat() * pool.length), 1)[0]!
            out.push({
                x: Math.round((r.pos.x + (randomFloat() - 0.5) * 2) * 10) / 10,
                y: r.pos.y,
                z: Math.round((r.pos.z + (randomFloat() - 0.5) * 2) * 10) / 10,
                r: DF_GAS.pocketRadius
            })
        }
        return out
    }

    // ------------------------------------------------------------ zombies

    /** A non-lethal hit landed: a blast or a heavy leg hit may take the legs off. */
    onWound(z: SimZombie, dmg: number, zone: DfHitZone, explosive: boolean): void {
        if (!DF_CRAWLERS_LIVE || z.crawl || !z.inside || z.hp <= 0) return
        if (z.state !== 'hunt' && z.state !== 'attack' && z.state !== 'stagger') return
        const chance = dfCrawlChance(z.type, zone, dmg, z.maxHp, explosive)
        if (chance > 0 && randomChance(chance)) this.makeCrawler(z)
    }

    private makeCrawler(z: SimZombie): void {
        z.crawl = true
        z.speed = dfCrawlSpeed(z.type)
        z.gait = 'walk'
        z.dash = null
        z.flank = 0
        z.flankGoal = null
        // it goes down hard, then starts dragging itself along
        z.state = 'stagger'
        z.resume = 'hunt'
        z.anim = 'stagger'
        z.timer = 0.75
    }

    /** After every kill: streaks for the killer, and the gas round's last kill drops a Max Ammo. */
    onKill(z: SimZombie, p: SimPlayer | null, weapon: string, zone: DfHitZone, opts: { noPoints?: boolean, noDrop?: boolean }): void {
        if (p && !opts.noPoints && weapon !== 'trap') {
            let st = this.streaks.get(p.pid)
            if (!st) this.streaks.set(p.pid, st = dfNewStreak())
            for (const hit of dfStreakKill(st, this.host.time, zone === 'head')) {
                this.host.emit({ k: 'streak', p: p.pid, kind: hit.kind, n: hit.n, bonus: hit.bonus })
                this.hooks.points(p, hit.bonus)
            }
        }
        // a dev wipe (no player, no drops) is not the squad's last kill
        if (this.gas && !this.gasDropped && (p !== null || !opts.noDrop) && this.hooks.left() <= 0) {
            this.gasDropped = true
            const g = dfGroundHeight(this.host.world, z.pos.x, z.pos.z, z.pos.y + 0.5)
            const y = Number.isFinite(g) && Math.abs(g - z.pos.y) < 1 ? g : z.pos.y
            this.host.dropPowerup('maxammo', { x: z.pos.x, y, z: z.pos.z })
        }
    }

    /** Snapshot extras for one zombie: crawl and gas-mask flags, the crawl anim. */
    decorate(z: SimZombie, snap: DfZombieSnap): void {
        if (z.crawl) {
            snap.crawl = true
            if (snap.anim === 'walk' || snap.anim === 'run' || snap.anim === 'sprint') snap.anim = 'crawl'
        }
        if (z.masked) snap.masked = true
    }

    // ------------------------------------------------------------ traps

    /** Pull a trap's lever: needs the power, 1000 points and the trap off its cooldown. */
    useTrap(p: SimPlayer, id: string): boolean {
        const t = this.traps.find(x => x.def.id === id)
        if (!t || dfTrapBlocked(t.run, this.host.power, p.points)) return false
        if (!this.hooks.spend(p, DF_TRAP.cost)) return false
        dfTrapStart(t.run, p.pid)
        t.pulseAt = this.host.time
        this.host.emit({ k: 'buy', p: p.pid, what: `trap:${id}` })
        return true
    }

    step(dt: number): void {
        for (const t of this.traps) {
            dfTrapTick(t.run, dt)
            if (t.run.state !== 'active') continue
            const owner = this.host.players.find(p => p.pid === t.run.owner) ?? null
            for (const z of [...this.host.zombies]) {
                if (z.hp <= 0 || !dfInTrap(t.def.area, z.pos)) continue
                this.hooks.killByTrap(z)
                if (owner) {
                    owner.kills++
                    this.hooks.points(owner, DF_TRAP.killPoints)
                }
            }
            if (this.host.time >= t.pulseAt) {
                t.pulseAt = this.host.time + DF_TRAP.pulse
                for (const p of this.host.players) {
                    if (p.life !== 'alive' || !dfInTrap(t.def.area, p.pos)) continue
                    const dmg = dfTrapPlayerDamage(p.health)
                    if (dmg > 0) this.hooks.hurt(p, dmg)
                }
            }
        }
    }

    /** The specials' part of the world snapshot. */
    worldSnap(): Pick<DfWorldSnap, 'special' | 'traps'> {
        const traps: DfTrapSnap[] = this.traps.map(t => ({ id: t.def.id, state: t.run.state, timer: Math.ceil(Math.max(0, t.run.timer) * 10) / 10 }))
        if (!this.gas) return { traps }
        return { traps, special: { kind: 'gas', pockets: this.pockets.map(g => ({ ...g })) } }
    }

    // ------------------------------------------------------------ dev

    dev(p: SimPlayer, op: Extract<DfDevOp, { k: 'special' }>): void {
        switch (op.what) {
            case 'gas':
                this.forceGas = true
                return
            case 'crawl':
                for (const z of this.host.zombies) {
                    if (!z.crawl && z.inside && (z.type === 'shambler' || z.type === 'ghoul') && z.state !== 'rise' && z.state !== 'climb') this.makeCrawler(z)
                }
                return
            case 'traps':
                for (const t of this.traps) {
                    t.run.state = 'idle'
                    t.run.timer = 0
                    t.run.owner = -1
                }
                return
            case 'spawn': {
                const type: DfEnemyType = op.type === 'ghoul' || op.type === 'brute' || op.type === 'bloater' ? op.type : 'shambler'
                const pos = { x: p.pos.x + Math.sin(p.yaw) * -4, y: p.pos.y, z: p.pos.z + Math.cos(p.yaw) * -4 }
                const g = dfGroundHeight(this.host.world, pos.x, pos.z, pos.y + 1)
                if (Number.isFinite(g) && Math.abs(g - pos.y) < 1.2) pos.y = g
                this.host.debugSpawn(type, pos)
            }
        }
    }
}
