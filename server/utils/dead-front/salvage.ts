import { DF_PLAYER } from '#shared/utils/dead-front/constants'
import {
    DF_KILLSTREAK, DF_LAUNCHER, DF_REWARDS, dfKillstreakDown, dfKillstreakKill, dfNewKillstreak, dfPlanStrike, dfStrikeDamage
} from '#shared/utils/dead-front/killstreaks'
import type { DfKillstreakState, DfRewardId, DfStrikeId } from '#shared/utils/dead-front/killstreaks'
import type { DfInteractable, DfMapDef } from '#shared/utils/dead-front/map'
import { dfBodyFits, dfGroundHeight, dfLineOfSight } from '#shared/utils/dead-front/physics'
import type { DfCollisionWorld } from '#shared/utils/dead-front/physics'
import type { DfDevOp, DfEvent } from '#shared/utils/dead-front/protocol'
import {
    DF_CHALLENGE_REWARD, DF_CHALLENGES, DF_DECOY, DF_RECIPES, DF_SALVAGE, DF_SENTRY,
    dfChallengeCounts, dfChallengeGoal, dfChallengePool, dfCraftBlocked, dfCraftSpend, dfDecoyDamage,
    dfSalvageBonus, dfSalvageRoll, dfSentryDamage, dfSentryPick, dfTurnToward, dfYawGap
} from '#shared/utils/dead-front/salvage'
import type {
    DfArsenalEvent, DfArsenalMine, DfArsenalOp, DfArsenalPlayerSnap, DfArsenalSnap, DfChallengeId, DfCraftId, DfKitState, DfSalvageKind, DfSalvagePool, DfStrikeHit
} from '#shared/utils/dead-front/salvage'
import type { DfHitZone, DfWeaponId, Vec3 } from '#shared/utils/dead-front/types'
import { randomFloat, randomPick } from '#shared/utils/random'
import type { DfNav } from './nav'
import { DF_KIT, dfClampRarity, dfKitFits, dfRarityApplies, dfRarityUpgradeCost } from '#shared/utils/dead-front/rarity'
import type { DfRarity } from '#shared/utils/dead-front/rarity'
import { DF_WEAPONS, dfWeaponStats } from '#shared/utils/dead-front/weapons'
import type { SimPlayer, SimWeapon, SimZombie } from './sim-types'

// Salvage, the workbench and killstreak support on top of the match
// simulation. The simulation owns the world; this module keeps its own state
// (every player's salvage, gear, streak and lent grenade launcher, drops,
// sentries, decoys, strikes, kits, the round challenge) and is driven through
// a handful of hooks: kill, down, round start/end, step, the zombie AI's lure check,
// client requests and the snapshot. Rules live in shared/utils/dead-front/
// salvage.ts and killstreaks.ts.
//
// Every grant is claim-then-reward: a drop is taken off the list before it
// pays, a craft takes its cost off the pool (and fails if it can't) before the
// gear is handed over, a reward is popped off the player's list before it
// fires. The second of two identical messages always finds nothing to take.

/** The simulation, as this module sees it (DfMatchSim fits structurally). */
export interface DfArsenalHost {
    readonly map: DfMapDef
    readonly time: number
    readonly round: number
    readonly players: SimPlayer[]
    readonly zombies: SimZombie[]
    readonly world: DfCollisionWorld
    readonly nav: DfNav
    readonly interactables: Map<string, DfInteractable>
    emit(ev: DfEvent): void
}

/** The simulation's private moves this module may make. */
export interface DfArsenalHooks {
    /**
     * Damages a zombie; true when it killed. `p` null pays nobody (sentries,
     * strikes: their owner is paid per kill separately).
     */
    damage(z: SimZombie, p: SimPlayer | null, dmg: number, zone: DfHitZone, explosive: boolean): boolean
    /** Pays points (multipliers apply). */
    points(p: SimPlayer, amount: number): void
    /** Walks a zombie toward a point this tick (the hunt's steering). */
    steer(z: SimZombie, goal: Vec3, speed: number, dt: number): void
    /** Can a zombie body walk the straight line a-b? */
    walkable(a: Vec3, b: Vec3): boolean
    /** A fresh weapon for a player (their attachments, full ammo). */
    makeWeapon(p: SimPlayer, id: DfWeaponId): SimWeapon
}

interface Gear {
    /** This player's own salvage (drops are per player: only the killer sees and takes them). */
    pool: DfSalvagePool
    equip: 'sentry' | 'decoy' | null
    kit: boolean
    streak: DfKillstreakState
    /** The grenade launcher out in place of `saved` (given back exactly as it was), until `until`. */
    launcher: { weapon: SimWeapon, saved: SimWeapon, until: number, emptyAt: number } | null
}

interface SimDrop {
    id: number
    /** Whose it is: only they see it and can take it. */
    owner: number
    kind: DfSalvageKind
    n: number
    pos: Vec3
    expiresAt: number
}

interface SimSentry {
    id: number
    owner: number
    pos: Vec3
    yaw: number
    ammo: number
    until: number
    hp: number
    shots: number
    nextShot: number
    target: number
    retargetAt: number
}

interface SimDecoy {
    id: number
    owner: number
    pos: Vec3
    yaw: number
    blowAt: number
}

interface SimStrike {
    id: number
    owner: number
    reward: DfRewardId
    at: number
    hits: (DfStrikeHit & { done?: boolean })[]
}

interface SimKit {
    id: number
    tier: DfRarity
    pos: Vec3
    yaw: number
    expiresAt: number
}

interface SimChallenge {
    id: DfChallengeId
    goal: number
    n: number
    done: boolean
}

interface LureGoal {
    decoy: number
    goal: Vec3
    until: number
}

const USE_TOLERANCE = 0.9
const SELF_REVIVE_DELAY = 3

export class DfArsenal {
    readonly drops: SimDrop[] = []
    readonly sentries: SimSentry[] = []
    readonly decoys: SimDecoy[] = []
    readonly strikes: SimStrike[] = []
    readonly kits: SimKit[] = []
    challenge: SimChallenge | null = null
    private readonly gear = new Map<number, Gear>()
    private readonly lures = new Map<number, LureGoal>()
    /** Events only one player may see (their salvage pickups), drained by `mine`. */
    private readonly privateEvents = new Map<number, DfArsenalEvent[]>()
    private nextId = 1
    /** Set while this module's own gear is doing the damage (sentries, strikes, decoys). */
    private gearHit = false
    /** Whose gear is doing it (their kills drop their salvage). */
    private gearOwner: SimPlayer | null = null

    constructor(private readonly host: DfArsenalHost, private readonly hooks: DfArsenalHooks) {}

    /** One player's gear (created on first use). */
    gearOf(p: SimPlayer): Gear {
        let g = this.gear.get(p.pid)
        if (!g) this.gear.set(p.pid, g = { pool: { scrap: 0, parts: 0 }, equip: null, kit: false, streak: dfNewKillstreak(), launcher: null })
        return g
    }

    private kitState(p: SimPlayer): DfKitState {
        const g = this.gearOf(p)
        return { equip: g.equip, kit: g.kit, rewards: g.streak.rewards.length, rewardsMax: DF_KILLSTREAK.maxHeld }
    }

    // ------------------------------------------------------------ client requests

    /** A `{ t: 'arsenal', op }` message. Returns whether it did anything. */
    handle(p: SimPlayer, op: DfArsenalOp): boolean {
        if (!op || typeof op !== 'object' || p.life !== 'alive') return false
        switch (op.k) {
            case 'craft': return typeof op.bench === 'string' && typeof op.item === 'string' && this.craft(p, op.bench, op.item)
            case 'deploy': return this.deploy(p, op.pos, op.yaw)
            case 'callin': return this.callIn(p, op.at, op.dir)
            case 'upgrade': return typeof op.bench === 'string' && this.upgrade(p, op.bench, op.slot, op.from, typeof op.weapon === 'string' ? op.weapon : undefined)
            case 'kit': return this.takeKit(p, op.id)
        }
        return false
    }

    private atBench(p: SimPlayer, benchId: string): boolean {
        const it = this.host.interactables.get(benchId)
        if (!it || it.kind !== 'bench') return false
        return hdist(p.pos, it.pos) <= DF_PLAYER.useRange + USE_TOLERANCE && Math.abs(p.pos.y - it.pos.y) <= 2.2
    }

    /** The weapon in hand (not one in the Pack-a-Punch). */
    private held(p: SimPlayer): SimWeapon | null {
        const w = p.weapons[p.slot]
        return w && !w.away ? w : null
    }

    /** Sets a weapon's rarity tier and its stats with it (magazine and reserve as they are). */
    private setRarity(w: SimWeapon, r: DfRarity): void {
        if (r > 0) w.rarity = r
        else delete w.rarity
        w.stats = dfWeaponStats(w.id, w.pap, w.attachments, r)
    }

    /**
     * Raises the weapon in `slot` one tier at a bench. `from` must match its
     * tier now (an integer compare-and-swap: a repeated or parallel request
     * finds it already raised), and the salvage comes off first.
     */
    upgrade(p: SimPlayer, benchId: string, slot: number, from: number, weapon?: string): boolean {
        if (!this.atBench(p, benchId) || !Number.isInteger(slot) || !Number.isInteger(from)) return false
        const w = p.weapons[slot]
        // the weapon the client meant (a swap in flight can't upgrade the other one), never one lent or in the machine
        if (!w || w.away || !dfRarityApplies(w.id) || (weapon !== undefined && w.id !== weapon)) return false
        const now = dfClampRarity(w.rarity)
        if (now !== from) return false
        const cost = dfRarityUpgradeCost(now)
        if (!cost) return false
        const pool = this.gearOf(p).pool
        if (pool.scrap < cost.scrap || pool.parts < cost.parts) return false
        pool.scrap -= cost.scrap
        pool.parts -= cost.parts
        this.setRarity(w, (now + 1) as DfRarity)
        this.host.emit({ k: 'craft', p: p.pid, item: 'upgrade', bench: benchId })
        this.host.emit({ k: 'rarity', p: p.pid, weapon: w.id, rarity: now + 1, how: 'bench' })
        return true
    }

    /**
     * A kit taken from the box (already claimed off it): onto the held weapon
     * if it raises it, otherwise set down in front of the player for later or
     * for a teammate.
     */
    claimKit(p: SimPlayer, tier: number): void {
        const kit = dfClampRarity(tier)
        if (kit <= 0) return
        const w = this.held(p)
        if (w && dfKitFits(kit, w.id, w.rarity) === 'apply') {
            this.setRarity(w, kit)
            this.host.emit({ k: 'rarity', p: p.pid, weapon: w.id, rarity: kit, how: 'kit' })
            return
        }
        const fx = -Math.sin(p.yaw)
        const fz = -Math.cos(p.yaw)
        const pos = this.placeAt(p, { x: p.pos.x + fx * 1.1, y: p.pos.y, z: p.pos.z + fz * 1.1 }, 2) ?? { ...p.pos }
        const id = this.nextId++
        this.kits.push({ id, tier: kit, pos, yaw: p.yaw, expiresAt: this.host.time + DF_KIT.life })
        this.host.emit({ k: 'kitDrop', p: p.pid, id, tier: kit, pos: rv(pos) })
    }

    /** Claim-then-apply: the kit leaves the ground only if it raises the held weapon; a repeat finds it gone. */
    takeKit(p: SimPlayer, id: number): boolean {
        const i = this.kits.findIndex(k => k.id === id)
        const k = this.kits[i]
        if (!k || hdist(p.pos, k.pos) > DF_KIT.reach + USE_TOLERANCE || Math.abs(p.pos.y - k.pos.y) > 2) return false
        const w = this.held(p)
        if (!w || dfKitFits(k.tier, w.id, w.rarity) !== 'apply') return false
        this.kits.splice(i, 1)
        this.setRarity(w, k.tier)
        this.host.emit({ k: 'rarity', p: p.pid, weapon: w.id, rarity: k.tier, how: 'kit' })
        return true
    }

    /** Puts a kit on the ground (tests, dev). */
    debugKit(tier: DfRarity, pos: Vec3): number {
        const id = this.nextId++
        this.kits.push({ id, tier, pos: { ...pos }, yaw: 0, expiresAt: this.host.time + DF_KIT.life })
        return id
    }

    /** Crafts at a bench: the cost comes off the player's salvage first, then the gear is handed over. */
    craft(p: SimPlayer, benchId: string, item: DfCraftId): boolean {
        if (!this.atBench(p, benchId)) return false
        const r = Object.prototype.hasOwnProperty.call(DF_RECIPES, item) ? DF_RECIPES[item] : undefined
        if (!r) return false
        const g = this.gearOf(p)
        if (dfCraftBlocked(r, g.pool, this.kitState(p))) return false
        if (!dfCraftSpend(g.pool, r)) return false
        switch (r.id) {
            case 'sentry':
            case 'decoy':
                g.equip = r.id
                break
            case 'bomber':
            case 'launcher':
                // support: held for X like a killstreak reward
                g.streak.rewards.push(r.id)
                break
            case 'kit':
                g.kit = true
                break
        }
        this.host.emit({ k: 'craft', p: p.pid, item: r.id, bench: benchId })
        return true
    }

    /** Places the deployable in hand near `pos` (the client's pick, checked and corrected here). */
    deploy(p: SimPlayer, rawPos: Vec3, rawYaw: number): boolean {
        const g = this.gearOf(p)
        const item = g.equip
        if (!item) return false
        const range = item === 'sentry' ? DF_SENTRY.placeRange : DF_DECOY.placeRange
        const pos = this.placeAt(p, finiteVec(rawPos), range)
        if (!pos) return false
        // claim the item before it goes down
        g.equip = null
        const yaw = Number.isFinite(rawYaw) ? rawYaw : p.yaw
        const id = this.nextId++
        if (item === 'sentry') {
            // one per player: a new one retires the old
            for (const s of this.sentries.filter(x => x.owner === p.pid)) this.retireSentry(s, 'spent')
            this.sentries.push({
                id, owner: p.pid, pos, yaw, ammo: DF_SENTRY.ammo, until: this.host.time + DF_SENTRY.life, hp: DF_SENTRY.hp,
                shots: 0, nextShot: this.host.time + 0.6, target: -1, retargetAt: 0
            })
        } else {
            this.decoys.push({ id, owner: p.pid, pos, yaw, blowAt: this.host.time + DF_DECOY.fuse })
        }
        this.host.emit({ k: 'deploy', p: p.pid, item, id, pos: rv(pos) })
        return true
    }

    /**
     * A floor point for gear: the requested one when it is in reach, in sight,
     * on a floor near its height and has room; otherwise just in front of the
     * player, or at their feet. Null only when nothing fits at all.
     */
    private placeAt(p: SimPlayer, want: Vec3 | null, range: number): Vec3 | null {
        const w = this.host.world
        const eye = { x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }
        const ok = (q: Vec3): Vec3 | null => {
            const g = dfGroundHeight(w, q.x, q.z, q.y + 0.6)
            if (Math.abs(g - q.y) > 1.2) return null
            const at = { x: q.x, y: g, z: q.z }
            if (!dfBodyFits(w, { x: at.x, y: at.y + 0.05, z: at.z }, { radius: 0.3, height: 0.9 })) return null
            if (!dfLineOfSight(w, eye, { x: at.x, y: at.y + 0.5, z: at.z })) return null
            return at
        }
        if (want && hdist(want, p.pos) <= range + 1 && Math.abs(want.y - p.pos.y) < 3) {
            const at = ok(want)
            if (at) return at
        }
        const fx = -Math.sin(p.yaw)
        const fz = -Math.cos(p.yaw)
        for (const d of [1.2, 0.8]) {
            const at = ok({ x: p.pos.x + fx * d, y: p.pos.y, z: p.pos.z + fz * d })
            if (at) return at
        }
        return { x: p.pos.x, y: p.pos.y, z: p.pos.z }
    }

    /**
     * Calls in the newest reward: a strike on `at` (in range, its floor found
     * here), or the grenade launcher into your hands (`at` unused).
     */
    callIn(p: SimPlayer, rawAt: Vec3, rawDir: Vec3): boolean {
        const g = this.gearOf(p)
        const newest = g.streak.rewards[g.streak.rewards.length - 1]
        if (!newest) return false
        if (newest === 'launcher') {
            if (!this.canLaunch(p)) return false
            // claim the reward before the launcher comes out
            g.streak.rewards.pop()
            return this.giveLauncher(p)
        }
        const at = finiteVec(rawAt)
        if (!at || hdist(at, p.pos) > DF_KILLSTREAK.range) return false
        const dir = finiteVec(rawDir) ?? { x: -Math.sin(p.yaw), y: 0, z: -Math.cos(p.yaw) }
        // claim the reward before it fires
        const reward = g.streak.rewards.pop() as DfStrikeId
        const plan = dfPlanStrike(reward, at, dir, randomFloat)
        const w = this.host.world
        const hits = plan.hits.map(h => ({ ...h, y: r2(dfGroundHeight(w, h.x, h.z, at.y + 1.5)) }))
        const id = this.nextId++
        this.strikes.push({ id, owner: p.pid, reward, at: this.host.time, hits })
        this.host.emit({ k: 'strike', p: p.pid, reward, id, at: rv(at), dir: rv({ x: dir.x, y: 0, z: dir.z }), hits: hits.map(h => ({ ...h })) })
        return true
    }

    // ------------------------------------------------------------ simulation hooks

    /** Round start: deals the round's challenge. */
    roundStart(round: number, opts: { gas: boolean, brutes: number }): void {
        const pool = dfChallengePool(round, opts)
        if (!pool.length) {
            this.challenge = null
            return
        }
        const id = randomPick(pool)
        const goal = dfChallengeGoal(id, round, this.host.players.length)
        this.challenge = { id, goal, n: 0, done: false }
        this.host.emit({ k: 'challenge', what: 'new', id, text: DF_CHALLENGES[id].text, goal })
    }

    roundEnd(): void {
        const c = this.challenge
        if (c && !c.done) this.host.emit({ k: 'challenge', what: 'failed', id: c.id, text: DF_CHALLENGES[c.id].text, goal: c.goal })
        this.challenge = null
    }

    /** After every kill: salvage drops, the killer's streak and the round challenge. */
    onKill(z: SimZombie, p: SimPlayer | null, weapon: string, zone: DfHitZone, opts: { explosive?: boolean, noPoints?: boolean, noDrop?: boolean, credit?: DfWeaponId | null }): void {
        const gear = this.gearHit
        if (!opts.noDrop && z.inside && z.state !== 'rise') this.dropSalvage(z, p ?? this.gearOwner, p && opts.credit ? this.silencerBonus(p, opts.credit) : 1)
        // the streak: the killer's own kills while standing (traps, gear, support and the lent launcher don't chain it)
        const lent = DF_WEAPONS[weapon as DfWeaponId]?.temporary === true || (opts.credit ? DF_WEAPONS[opts.credit]?.temporary === true : false)
        if (p && p.life === 'alive' && !opts.noPoints && !gear && !lent && weapon !== 'trap' && weapon !== 'sentry') {
            const g = this.gearOf(p)
            const earned = dfKillstreakKill(g.streak)
            if (earned) this.host.emit({ k: 'reward', p: p.pid, reward: earned, n: DF_REWARDS[earned].kills })
        }
        const c = this.challenge
        // a nuke or a dev wipe (no points) isn't the squad's work
        if (c && !c.done && (gear || (p !== null && !opts.noPoints))) {
            if (dfChallengeCounts(c.id, { type: z.type, zone, weapon, explosive: opts.explosive === true, gear })) {
                c.n++
                if (c.n >= c.goal) this.completeChallenge(c)
            }
        }
    }

    private completeChallenge(c: SimChallenge): void {
        c.done = true
        // everyone gets the reward in their own pack
        for (const q of this.host.players) {
            this.grant(q, 'scrap', DF_CHALLENGE_REWARD.scrap)
            this.grant(q, 'part', DF_CHALLENGE_REWARD.parts)
            if (q.life !== 'dead') this.hooks.points(q, DF_CHALLENGE_REWARD.points)
        }
        this.host.emit({ k: 'challenge', what: 'done', id: c.id, text: DF_CHALLENGES[c.id].text, goal: c.goal })
    }

    /** A silencer on the weapon that made the kill turns up more salvage. */
    private silencerBonus(p: SimPlayer, id: DfWeaponId): number {
        const w = p.weapons.find(x => x.id === id) ?? p.savedWeapons?.find(x => x.id === id)
        return w ? dfSalvageBonus(id, w.attachments) : 1
    }

    /** Adds to a player's own pool (capped). */
    private grant(p: SimPlayer, kind: DfSalvageKind, n: number): void {
        const pool = this.gearOf(p).pool
        if (kind === 'scrap') pool.scrap = Math.min(DF_SALVAGE.maxScrap, pool.scrap + n)
        else pool.parts = Math.min(DF_SALVAGE.maxParts, pool.parts + n)
    }

    /** A kill's salvage drops for `owner` (the killer; for a trap or a wipe, the nearest soldier standing). */
    private dropSalvage(z: SimZombie, owner: SimPlayer | null, bonus: number): void {
        const to = owner ?? this.nearestStanding(z.pos)
        if (!to) return
        const roll = dfSalvageRoll(z.type, this.host.round, this.host.players.length, randomFloat, bonus)
        if (roll.scrap > 0) this.addDrop(to.pid, 'scrap', roll.scrap, z.pos, 0)
        if (roll.parts > 0) this.addDrop(to.pid, 'part', roll.parts, z.pos, roll.scrap > 0 ? 0.5 : 0)
    }

    private nearestStanding(at: Vec3): SimPlayer | null {
        let best: SimPlayer | null = null
        let bd = Infinity
        for (const p of this.host.players) {
            if (p.life !== 'alive') continue
            const d = hdist(p.pos, at)
            if (d < bd) {
                bd = d
                best = p
            }
        }
        return best
    }

    private addDrop(owner: number, kind: DfSalvageKind, n: number, at: Vec3, offset: number): void {
        const a = randomFloat() * Math.PI * 2
        const x = at.x + Math.cos(a) * offset
        const z = at.z + Math.sin(a) * offset
        const g = dfGroundHeight(this.host.world, x, z, at.y + 0.5)
        const y = Math.abs(g - at.y) < 1 ? g : at.y
        // each player's oldest drop rusts away first once they have too many lying about
        const theirs = this.drops.filter(d => d.owner === owner)
        if (theirs.length >= DF_SALVAGE.maxOnGround) this.drops.splice(this.drops.indexOf(theirs[0]!), 1)
        this.drops.push({ id: this.nextId++, owner, kind, n, pos: { x, y, z }, expiresAt: this.host.time + DF_SALVAGE.life })
    }

    /** Puts a drop on the ground (tests, dev). */
    debugDrop(owner: number, kind: DfSalvageKind, n: number, pos: Vec3): number {
        this.drops.push({ id: this.nextId, owner, kind, n, pos: { ...pos }, expiresAt: this.host.time + DF_SALVAGE.life })
        return this.nextId++
    }

    /** Hands a player a reward (tests, dev). */
    debugReward(p: SimPlayer, reward: DfRewardId): void {
        this.gearOf(p).streak.rewards.push(reward)
    }

    // ------------------------------------------------------------ the grenade launcher

    /** The weapon slot the launcher would stand in for (the one in hand, else any real one), or -1. */
    private launchSlot(p: SimPlayer): number {
        const ok = (w: SimWeapon | undefined) => !!w && !w.away && w.id !== 'wunder' && !DF_WEAPONS[w.id]?.temporary
        if (ok(p.weapons[p.slot])) return p.slot
        return p.weapons.findIndex(w => ok(w))
    }

    /** The weapon a lent launcher stands in for (set aside, untouched), or null. */
    stashed(p: SimPlayer): SimWeapon | null {
        return this.gear.get(p.pid)?.launcher?.saved ?? null
    }

    private canLaunch(p: SimPlayer): boolean {
        return p.life === 'alive' && !this.gearOf(p).launcher && this.launchSlot(p) >= 0
    }

    /** The launcher goes into the hand, the weapon it replaces set aside untouched. */
    private giveLauncher(p: SimPlayer): boolean {
        const slot = this.launchSlot(p)
        if (slot < 0) return false
        const g = this.gearOf(p)
        const saved = p.weapons[slot]!
        const weapon = this.hooks.makeWeapon(p, DF_LAUNCHER.weapon)
        p.weapons[slot] = weapon
        p.slot = slot
        p.reload = null
        p.swapUntil = this.host.time + 0.6
        g.launcher = { weapon, saved, until: this.host.time + DF_LAUNCHER.seconds, emptyAt: 0 }
        this.host.emit({ k: 'launcher', p: p.pid, on: true })
        return true
    }

    /**
     * Gives back the weapon the launcher stood in for, exactly as it was (its
     * slot, ammo, rarity, Pack-a-Punch, attachments). Time up, out of shells,
     * going down, or reaching for a wall-buy or the box all end it.
     */
    endLauncher(p: SimPlayer): void {
        const g = this.gear.get(p.pid)
        const l = g?.launcher
        if (!g || !l) return
        g.launcher = null
        for (const list of [p.weapons, p.savedWeapons]) {
            const i = list ? list.indexOf(l.weapon) : -1
            if (!list || i < 0) continue
            list[i] = l.saved
            if (list === p.weapons && p.slot === i) {
                p.reload = null
                p.swapUntil = this.host.time + 0.5
            }
            break
        }
        this.host.emit({ k: 'launcher', p: p.pid, on: false })
    }

    private stepLaunchers(t: number): void {
        for (const p of this.host.players) {
            const l = this.gear.get(p.pid)?.launcher
            if (!l) continue
            // dry: a beat for the last shell to land, then it goes back
            const dry = l.weapon.mag + l.weapon.reserve <= 0
            if (dry && !l.emptyAt) l.emptyAt = t + 1.2
            if (t >= l.until || (l.emptyAt && t >= l.emptyAt) || !p.weapons.includes(l.weapon)) this.endLauncher(p)
        }
    }

    /**
     * A player is going down: the launcher goes back first (last stand takes
     * the real weapons). After: the streak ends, and a field kit picks them
     * back up (unless Second Wind already will).
     */
    beforeDown(p: SimPlayer): void {
        this.endLauncher(p)
    }

    onDown(p: SimPlayer): void {
        const g = this.gearOf(p)
        dfKillstreakDown(g.streak)
        if (g.kit && !(p.selfReviveAt > 0)) {
            g.kit = false
            p.selfReviveAt = this.host.time + SELF_REVIVE_DELAY
        }
    }

    /**
     * The zombie AI asks before it hunts: a playing gramophone in earshot pulls
     * the zombie to it instead (true: handled this tick).
     */
    lure(z: SimZombie, dt: number): boolean {
        if (!this.decoys.length || z.state !== 'hunt') return false
        let best: SimDecoy | null = null
        let bd: number = DF_DECOY.lureRadius
        for (const d of this.decoys) {
            const dd = hdist(z.pos, d.pos)
            if (dd < bd && Math.abs(d.pos.y - z.pos.y) < 3.5) {
                bd = dd
                best = d
            }
        }
        if (!best) {
            this.lures.delete(z.id)
            return false
        }
        if (bd < 1.4) {
            // swaying in front of the horn
            z.anim = 'walk'
            z.yaw = dfTurnToward(z.yaw, Math.atan2(best.pos.x - z.pos.x, best.pos.z - z.pos.z), 6, dt)
            z.heading = z.yaw
            return true
        }
        let lg = this.lures.get(z.id)
        if (!lg || lg.decoy !== best.id || this.host.time >= lg.until || hdist(z.pos, lg.goal) < 0.6) {
            lg = { decoy: best.id, goal: this.lureGoal(z, best), until: this.host.time + 0.5 }
            this.lures.set(z.id, lg)
        }
        z.anim = z.gait
        this.hooks.steer(z, lg.goal, z.speed, dt)
        return true
    }

    private lureGoal(z: SimZombie, d: SimDecoy): Vec3 {
        if (this.hooks.walkable(z.pos, d.pos)) return d.pos
        const nav = this.host.nav
        if (!nav.size) return d.pos
        const target = nav.nearest(d.pos)
        const from = nav.nearest(z.pos)
        if (target < 0 || from < 0) return d.pos
        const field = nav.field(target)
        let idx = from
        if (hdist(z.pos, nav.pos(from)) < 0.8 || !this.hooks.walkable(z.pos, nav.pos(from))) {
            const next = nav.nextHop(field, from)
            if (next >= 0) idx = next
        }
        return nav.pos(idx)
    }

    step(dt: number): void {
        const t = this.host.time
        this.stepDrops(t)
        for (let i = this.kits.length - 1; i >= 0; i--) if (this.kits[i]!.expiresAt <= t) this.kits.splice(i, 1)
        this.stepSentries(dt, t)
        this.stepDecoys(t)
        this.stepStrikes(t)
        this.stepLaunchers(t)
    }

    private stepDrops(t: number): void {
        for (let i = this.drops.length - 1; i >= 0; i--) if (this.drops[i]!.expiresAt <= t) this.drops.splice(i, 1)
        for (const d of [...this.drops]) {
            const p = this.host.players.find(q => q.pid === d.owner)
            if (p && p.life === 'alive' && hdist(p.pos, d.pos) < DF_SALVAGE.pickupRadius && Math.abs(p.pos.y - d.pos.y) < 1.6) this.pickUp(p, d.id)
        }
    }

    /**
     * Claim-then-reward: the drop leaves the ground first; nothing pays if it
     * was already gone, and only its owner can take it.
     */
    pickUp(p: SimPlayer, dropId: number): boolean {
        const i = this.drops.findIndex(d => d.id === dropId && d.owner === p.pid)
        if (i < 0) return false
        const [d] = this.drops.splice(i, 1)
        if (!d) return false
        this.grant(p, d.kind, d.n)
        this.emitTo(p.pid, { k: 'salvage', p: p.pid, kind: d.kind, n: d.n, id: d.id, pos: rv(d.pos) })
        return true
    }

    private emitTo(pid: number, ev: DfArsenalEvent): void {
        let q = this.privateEvents.get(pid)
        if (!q) this.privateEvents.set(pid, q = [])
        q.push(ev)
        if (q.length > 64) q.shift()
    }

    /**
     * One player's private slice of the snapshot: their salvage, their drops
     * and their pickup events (drained). Sent to them alone, so nobody sees or
     * chases another player's salvage.
     */
    mine(pid: number): DfArsenalMine {
        const p = this.host.players.find(q => q.pid === pid)
        const pool = p ? this.gearOf(p).pool : { scrap: 0, parts: 0 }
        const t = this.host.time
        const events = this.privateEvents.get(pid) ?? []
        this.privateEvents.delete(pid)
        return {
            scrap: pool.scrap,
            parts: pool.parts,
            drops: this.drops.filter(d => d.owner === pid).map(d => ({ id: d.id, kind: d.kind, pos: rv(d.pos), n: d.n, ttl: r2(d.expiresAt - t) })),
            events
        }
    }

    private stepSentries(dt: number, t: number): void {
        const zombies = this.host.zombies
        for (const s of [...this.sentries]) {
            // zombies claw at it, and can't walk through it
            let claws = 0
            for (const z of zombies) {
                if (z.hp <= 0 || Math.abs(z.pos.y - s.pos.y) > 1.5) continue
                const dx = z.pos.x - s.pos.x
                const dz = z.pos.z - s.pos.z
                const d = Math.hypot(dx, dz)
                if (d < DF_SENTRY.clawRange && z.state !== 'rise' && z.state !== 'climb') claws++
                const min = DF_SENTRY.radius + z.def.radius
                if (d < min && d > 1e-4) {
                    const push = min - d
                    const nx = z.pos.x + (dx / d) * push
                    const nz = z.pos.z + (dz / d) * push
                    if (dfBodyFits(this.host.world, { x: nx, y: z.pos.y + 0.56, z: nz }, { radius: z.def.radius * 0.8, height: 1, zombie: true })) {
                        z.pos.x = nx
                        z.pos.z = nz
                    }
                }
            }
            s.hp -= claws * DF_SENTRY.clawDps * dt
            if (s.hp <= 0) {
                this.retireSentry(s, 'broken')
                continue
            }
            if (t >= s.until || s.ammo <= 0) {
                this.retireSentry(s, 'spent')
                continue
            }
            const muzzle = { x: s.pos.x, y: s.pos.y + DF_SENTRY.muzzleY, z: s.pos.z }
            let target = s.target >= 0 ? zombies.find(z => z.id === s.target && z.hp > 0) : undefined
            if (!target || t >= s.retargetAt) {
                s.retargetAt = t + 0.25
                const pick = dfSentryPick(muzzle, zombies.map(z => ({ id: z.id, pos: z.pos, hp: z.hp, chest: zChestY(z), skip: z.state === 'rise' })), (a, b) => dfLineOfSight(this.host.world, a, b))
                target = pick ? zombies.find(z => z.id === pick.id) : undefined
                s.target = target?.id ?? -1
            }
            if (!target) continue
            const want = Math.atan2(target.pos.x - s.pos.x, target.pos.z - s.pos.z)
            s.yaw = dfTurnToward(s.yaw, want, DF_SENTRY.turnRate, dt)
            if (dfYawGap(s.yaw, want) > DF_SENTRY.aimTol) continue
            const dmg = dfSentryDamage(this.host.round)
            if (t < s.nextShot) continue
            // a steady cadence; after a pause the first shot goes at once
            s.nextShot = (t - s.nextShot > DF_SENTRY.interval ? t : s.nextShot) + DF_SENTRY.interval
            s.ammo--
            s.shots++
            const zone: DfHitZone = randomFloat() < 0.18 ? 'head' : 'body'
            if (this.gearDamage(target, null, zone === 'head' ? dmg * 1.6 : dmg, zone, false, s.owner)) {
                this.payGear(s.owner, DF_SENTRY.killPoints)
                s.target = -1
            }
        }
    }

    private retireSentry(s: SimSentry, what: 'spent' | 'broken'): void {
        const i = this.sentries.indexOf(s)
        if (i < 0) return
        this.sentries.splice(i, 1)
        this.host.emit({ k: 'sentry', id: s.id, what, pos: rv(s.pos) })
    }

    private stepDecoys(t: number): void {
        for (const d of [...this.decoys]) {
            if (t < d.blowAt) continue
            this.decoys.splice(this.decoys.indexOf(d), 1)
            for (const [zid, lg] of this.lures) if (lg.decoy === d.id) this.lures.delete(zid)
            const at = { x: d.pos.x, y: d.pos.y + 0.5, z: d.pos.z }
            this.host.emit({ k: 'decoy', id: d.id, pos: rv(d.pos) })
            this.host.emit({ k: 'explode', pos: rv(at), radius: DF_DECOY.blastRadius, kind: 'grenade' })
            const owner = this.host.players.find(p => p.pid === d.owner) ?? null
            this.blast(at, DF_DECOY.blastRadius, dfDecoyDamage(this.host.round), owner, 0)
        }
    }

    private stepStrikes(t: number): void {
        for (const s of [...this.strikes]) {
            const age = t - s.at
            let left = 0
            for (const h of s.hits) {
                if (h.done) continue
                if (h.t > age) {
                    left++
                    continue
                }
                h.done = true
                const at = { x: h.x, y: h.y + 0.4, z: h.z }
                if (h.all) {
                    this.wipe(at, h.r, s.owner)
                    continue
                }
                this.host.emit({ k: 'explode', pos: rv(at), radius: h.r, kind: 'grenade' })
                this.blast(at, h.r, dfStrikeDamage(s.reward, this.host.round), null, s.owner)
            }
            if (!left) this.strikes.splice(this.strikes.indexOf(s), 1)
        }
    }

    /**
     * Splash from gear and support: zombies only (friendly-safe), falling off
     * with distance, through line of sight. `owner` is credited like a grenade
     * (decoys); otherwise `payTo` gets points per kill.
     */
    private blast(at: Vec3, radius: number, damage: number, owner: SimPlayer | null, payTo: number): void {
        const probe = { x: at.x, y: at.y + 0.3, z: at.z }
        for (const z of [...this.host.zombies]) {
            if (z.hp <= 0) continue
            const c = { x: z.pos.x, y: z.pos.y + zChestY(z), z: z.pos.z }
            const d = Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z)
            if (d > radius + z.def.radius) continue
            if (!dfLineOfSight(this.host.world, probe, c)) continue
            const k = 1 - 0.5 * Math.min(1, d / radius)
            const killed = this.gearDamage(z, owner, damage * k, 'body', true, owner?.pid ?? payTo)
            if (killed && !owner) this.payGear(payTo, 50)
        }
    }

    /** The bomber's carpet: every zombie within `radius` (horizontally, near the ground) dies, cover or not, brutes too. */
    private wipe(at: Vec3, radius: number, payTo: number): void {
        for (const z of [...this.host.zombies]) {
            if (z.hp <= 0 || hdist(z.pos, at) > radius + z.def.radius || Math.abs(z.pos.y - at.y) > 4) continue
            if (this.gearDamage(z, null, z.hp + z.helmet + z.maxHp, 'body', true, payTo)) this.payGear(payTo, 50)
        }
    }

    private gearDamage(z: SimZombie, p: SimPlayer | null, dmg: number, zone: DfHitZone, explosive: boolean, owner: number): boolean {
        this.gearHit = true
        this.gearOwner = this.host.players.find(q => q.pid === owner) ?? null
        try {
            return this.hooks.damage(z, p, dmg, zone, explosive)
        } finally {
            this.gearHit = false
            this.gearOwner = null
        }
    }

    /** A kill by a player's gear or support: it counts for them and pays a flat sum. */
    private payGear(pid: number, amount: number): void {
        const p = this.host.players.find(q => q.pid === pid)
        if (!p) return
        p.kills++
        this.hooks.points(p, amount)
    }

    // ------------------------------------------------------------ output

    worldSnap(): DfArsenalSnap {
        const t = this.host.time
        const c = this.challenge
        const snap: DfArsenalSnap = {
            players: this.host.players.map((p) => {
                const g = this.gearOf(p)
                const snap: DfArsenalPlayerSnap = { pid: p.pid, equip: g.equip, kit: g.kit, streak: g.streak.kills, rewards: [...g.streak.rewards] }
                if (g.launcher) {
                    snap.launcher = r2(Math.max(0, g.launcher.until - t))
                    const w = g.launcher.saved
                    snap.stash = { id: w.id, pap: w.pap, mag: w.mag, reserve: w.reserve, attachments: w.attachments, maxReserve: Math.max(0, Math.round(w.stats.reserve * p.effects.reserveAmmoMult)), rarity: w.rarity || undefined }
                }
                return snap
            }),
            sentries: this.sentries.map((s) => {
                const tz = s.target >= 0 ? this.host.zombies.find(z => z.id === s.target) : undefined
                return {
                    id: s.id, owner: s.owner, pos: rv(s.pos), yaw: r2(s.yaw), ammo: r2(s.ammo / DF_SENTRY.ammo), life: r2(s.until - t),
                    hp: r2(Math.max(0, s.hp) / DF_SENTRY.hp), shots: s.shots,
                    ...(tz ? { tgt: rv({ x: tz.pos.x, y: tz.pos.y + zChestY(tz), z: tz.pos.z }) } : {})
                }
            }),
            decoys: this.decoys.map(d => ({ id: d.id, owner: d.owner, pos: rv(d.pos), yaw: r2(d.yaw), fuse: r2(d.blowAt - t) }))
        }
        if (this.kits.length) snap.kits = this.kits.map(k => ({ id: k.id, tier: k.tier, pos: rv(k.pos), yaw: r2(k.yaw), ttl: r2(k.expiresAt - t) }))
        if (c) snap.challenge = { id: c.id, text: DF_CHALLENGES[c.id].text, n: Math.min(c.n, c.goal), goal: c.goal, done: c.done }
        return snap
    }

    // ------------------------------------------------------------ dev

    dev(p: SimPlayer, op: Extract<DfDevOp, { k: 'arsenal' }>): void {
        switch (op.what) {
            case 'salvage': {
                const pool = this.gearOf(p).pool
                pool.scrap = DF_SALVAGE.maxScrap
                pool.parts = DF_SALVAGE.maxParts
                return
            }
            case 'streak': {
                const n = Number.isFinite(op.n) ? Math.max(1, Math.min(60, Math.floor(op.n!))) : 15
                const g = this.gearOf(p)
                for (let i = 0; i < n; i++) {
                    const earned = dfKillstreakKill(g.streak)
                    if (earned) this.host.emit({ k: 'reward', p: p.pid, reward: earned, n: DF_REWARDS[earned].kills })
                }
                return
            }
            case 'rewards':
                this.gearOf(p).streak.rewards = ['launcher', 'zeppelin', 'bomber']
        }
    }
}

// ---------------------------------------------------------------- helpers

function zChestY(z: SimZombie): number {
    return z.crawl ? 0.35 : z.def.height * 0.62
}

function hdist(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.z - b.z)
}

function r2(n: number): number {
    return Math.round(n * 100) / 100
}

function rv(v: Vec3): Vec3 {
    return { x: r2(v.x), y: r2(v.y), z: r2(v.z) }
}

function finiteVec(v: unknown): Vec3 | null {
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const x = Number(o.x)
    const y = Number(o.y)
    const z = Number(o.z)
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null
}
