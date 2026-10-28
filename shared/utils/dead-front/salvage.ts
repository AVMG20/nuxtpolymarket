import { DF_ENEMIES, dfZombieBaseHealth } from './enemies'
import { DF_WEAPONS } from './weapons'
import type { DfAttachmentChoice, DfEnemyType, DfHitZone, DfWeaponId, Vec3 } from './types'
import type { DfSupportId, DfStrikeId } from './support'
import type { DfHeldWeapon } from './protocol'

// Salvage and the workbench, shared by the server (which runs them) and the
// client (HUD, prompts, the craft list): zombies drop scrap and the odd rare
// part for their killer alone, and a workbench turns it into gear and
// support: a Lewis gun sentry, a gramophone decoy, a field kit, a bomber run
// and a grenade launcher (plus rarity upgrades, rarity.ts). Also the round
// challenges that pay out salvage. Pure and
// unit tested; the server's state lives in server/utils/dead-front/salvage.ts.

// ---------------------------------------------------------------- salvage drops

export type DfSalvageKind = 'scrap' | 'part'

export const DF_SALVAGE = {
    /**
     * Chance a regular (shambler / ghoul) kill drops scrap on the early
     * rounds. Every zombie rolls, so a bigger horde pays more, but from round
     * `fadeFrom` the chances fall with the square root of the round
     * (`dfSalvageFade`): the horde grows faster than the income, and the
     * bench stays a treat deep into the night.
     */
    chance: 0.15,
    fadeFrom: 5,
    /** Scrap in one regular drop. */
    amount: [1, 3] as const,
    /** Chance a regular kill drops a rare part. */
    partChance: 0.004,
    /** Ghouls carry a little more. */
    ghoulMult: 1.25,
    /** Brutes always drop a pile, and often a part. */
    brute: { scrap: [6, 10] as const, part: 0.3 },
    /** Bloaters usually do. */
    bloater: { chance: 0.5, scrap: [3, 5] as const, part: 0.1 },
    /** Seconds a drop lies on the ground. */
    life: 40,
    /** Drops on the ground at once (the oldest rusts away first). */
    maxOnGround: 30,
    /** Walking this close (horizontally) picks it up. */
    pickupRadius: 1.35,
    /** A player's pool tops out here. */
    maxScrap: 999,
    maxParts: 20
} as const

export interface DfSalvageRoll {
    scrap: number
    parts: number
}

/** The drop chances' share on a round: 1 until `fadeFrom`, then sqrt(fadeFrom / round). */
export function dfSalvageFade(round: number): number {
    const r = Math.max(1, Math.floor(Number.isFinite(round) ? round : 1))
    return r <= DF_SALVAGE.fadeFrom ? 1 : Math.sqrt(DF_SALVAGE.fadeFrom / r)
}

function span(range: readonly [number, number], roll: number): number {
    return range[0] + Math.min(range[1] - range[0], Math.floor(roll * (range[1] - range[0] + 1)))
}

/** A Maxim silencer on the killing weapon: quiet kills turn up this much more salvage (chance, relative). */
export const DF_SILENCER_SALVAGE = 1.1

/** The salvage bonus of a weapon's attachments (a Maxim silencer's `salvage`), 1 without. */
export function dfSalvageBonus(id: DfWeaponId, attachments: DfAttachmentChoice | undefined): number {
    const def = DF_WEAPONS[id]
    if (!def || !attachments) return 1
    let k = 1
    for (const att of Object.values(attachments)) {
        const a = att ? def.attachments.find(x => x.id === att) : undefined
        if (a?.salvage && Number.isFinite(a.salvage)) k *= a.salvage
    }
    return k
}

/** What a kill on `round` drops; `roll` is uniform in [0, 1). `bonus` scales the drop chances (the silencer's 1.1). */
export function dfSalvageRoll(type: DfEnemyType, round: number, roll: () => number, bonus = 1): DfSalvageRoll {
    const k = (Number.isFinite(bonus) && bonus > 0 ? bonus : 1) * dfSalvageFade(round)
    if (type === 'brute') {
        return { scrap: span(DF_SALVAGE.brute.scrap, roll()), parts: roll() < DF_SALVAGE.brute.part ? 1 : 0 }
    }
    if (type === 'bloater') {
        if (roll() >= Math.min(1, DF_SALVAGE.bloater.chance * k)) return { scrap: 0, parts: 0 }
        return { scrap: span(DF_SALVAGE.bloater.scrap, roll()), parts: roll() < DF_SALVAGE.bloater.part ? 1 : 0 }
    }
    const mult = (type === 'ghoul' ? DF_SALVAGE.ghoulMult : 1) * k
    const scrap = roll() < Math.min(1, DF_SALVAGE.chance * mult) ? span(DF_SALVAGE.amount, roll()) : 0
    const parts = roll() < Math.min(1, DF_SALVAGE.partChance * mult) ? 1 : 0
    return { scrap, parts }
}

// ---------------------------------------------------------------- the workbench

export type DfCraftId = 'sentry' | 'decoy' | 'kit' | 'barrage' | 'zeppelin' | 'launcher' | 'bomber'

export interface DfRecipe {
    id: DfCraftId
    name: string
    /** One line for the craft list. */
    desc: string
    scrap: number
    parts: number
    /**
     * `deploy` goes into the equipment slot (Q to place it); `instant` applies
     * at once; `support` is held (up to three) and called in with X (support.ts).
     */
    use: 'deploy' | 'instant' | 'support'
    /** Its colour (the crate it turns up in as a rare find). */
    color: string
}

/**
 * The bench, the only place support comes from, and a treat rather than a
 * routine. Priced against the solo income: the first craft around round 7,
 * a saved-up bomber around round 17, and the field kit (a cheat death)
 * priced like a Legendary upgrade, around round 22. Even deep into the night
 * a round pays for a sentry or so, not a handful.
 */
export const DF_RECIPES: Record<DfCraftId, DfRecipe> = {
    sentry: { id: 'sentry', name: 'Lewis Sentry', desc: 'A Lewis gun on a tripod that guns down the nearest zombie', scrap: 60, parts: 0, use: 'deploy', color: '#c9a25a' },
    decoy: { id: 'decoy', name: 'Gramophone', desc: 'Plays a waltz the dead can\'t resist, then blows up', scrap: 50, parts: 0, use: 'deploy', color: '#e2b24f' },
    kit: { id: 'kit', name: 'Field Kit', desc: 'Morphine and bandages: pick yourself up once', scrap: 700, parts: 6, use: 'instant', color: '#e2412f' },
    barrage: { id: 'barrage', name: 'Artillery Barrage', desc: 'Eight shells on the spot you mark (X)', scrap: 100, parts: 0, use: 'support', color: '#ff7a3a' },
    zeppelin: { id: 'zeppelin', name: 'Zeppelin Raid', desc: 'A bomb run along your line of sight (X)', scrap: 200, parts: 2, use: 'support', color: '#9fb4c8' },
    launcher: { id: 'launcher', name: 'Granatwerfer', desc: 'A grenade launcher in your hands for 45 s (X)', scrap: 140, parts: 0, use: 'support', color: '#8ab052' },
    bomber: { id: 'bomber', name: 'Bomber Run', desc: 'A Gotha carpets the spot you mark: nothing in it survives (X)', scrap: 350, parts: 3, use: 'support', color: '#b46cff' }
}

/** The craft list, in the order the bench shows it (the weapon upgrade comes last). */
export const DF_CRAFT_ORDER: readonly DfCraftId[] = ['sentry', 'decoy', 'kit', 'barrage', 'zeppelin', 'launcher', 'bomber']

/** The support items (held for X). */
export function dfIsSupport(id: DfCraftId): id is 'barrage' | 'zeppelin' | 'launcher' | 'bomber' {
    return DF_RECIPES[id].use === 'support'
}

/**
 * A rare find: every zombie kill has this chance (fading like salvage) to drop a
 * supply crate with one of the bench's items in it, ready to use (picked
 * uniformly). For its first seconds only the killer sees it and can take it;
 * then anyone can, until it's gone.
 */
export const DF_CRATE = {
    chance: 0.003,
    /** Seconds it is the killer's alone. */
    private: 15,
    /** Seconds from the drop until it's gone. */
    life: 60,
    items: DF_CRAFT_ORDER
} as const

/** Can this player take a crate's item now? Why not, or null (a full support list, gear in hand, a kit already held). */
export function dfCrateBlocked(item: DfCraftId, k: DfKitState): DfCraftBlock | null {
    return dfCraftBlocked(DF_RECIPES[item], { scrap: Infinity, parts: Infinity }, k)
}

/** A player's salvage pool. */
export interface DfSalvagePool {
    scrap: number
    parts: number
}

/** What one player carries from the bench. */
export interface DfKitState {
    /** The deployable in hand (Q places it), or null. */
    equip: 'sentry' | 'decoy' | null
    /** Holds a field kit (self-revive). */
    kit: boolean
    /** Support held for X, and how many fit. */
    support: number
    supportMax: number
}

export type DfCraftBlock = 'scrap' | 'parts' | 'hands' | 'full' | 'have'

/** Why this recipe can't be crafted now, or null. */
export function dfCraftBlocked(r: DfRecipe, pool: DfSalvagePool, k: DfKitState): DfCraftBlock | null {
    if (r.use === 'deploy' && k.equip) return 'hands'
    if (r.use === 'support' && k.support >= k.supportMax) return 'full'
    if (r.id === 'kit' && k.kit) return 'have'
    if (pool.scrap < r.scrap) return 'scrap'
    if (pool.parts < r.parts) return 'parts'
    return null
}

/** The craft list's reason line. */
export function dfCraftBlockText(b: DfCraftBlock, r: DfRecipe, pool: DfSalvagePool): string {
    switch (b) {
        case 'scrap': return `Need ${r.scrap - pool.scrap} more scrap`
        case 'parts': return r.parts - pool.parts === 1 ? 'Need a rare part' : `Need ${r.parts - pool.parts} more rare parts`
        case 'hands': return 'Place your gear first (Q)'
        case 'full': return 'Call in your support first (X)'
        case 'have': return 'Already carrying one'
    }
}

/** Takes the cost off the pool; false (and nothing taken) when it can't pay. */
export function dfCraftSpend(pool: DfSalvagePool, r: DfRecipe): boolean {
    if (pool.scrap < r.scrap || pool.parts < r.parts) return false
    pool.scrap -= r.scrap
    pool.parts -= r.parts
    return true
}

/** "12 scrap · 1 part" */
export function dfRecipeCost(r: DfRecipe): string {
    return r.parts > 0 ? `${r.scrap} scrap · ${r.parts} part${r.parts > 1 ? 's' : ''}` : `${r.scrap} scrap`
}

// ---------------------------------------------------------------- the Lewis sentry

export const DF_SENTRY = {
    /** Seconds it runs before the barrel is spent. */
    life: 60,
    /** Rounds in its drums. */
    ammo: 240,
    hp: 600,
    /** Engages zombies this close (metres) it can see. */
    range: 22,
    /** Seconds between shots. */
    interval: 0.11,
    /** Radians per second it can swing. */
    turnRate: 7,
    /** It fires once within this many radians of its target. */
    aimTol: 0.14,
    /** Muzzle height over its feet. */
    muzzleY: 1.05,
    /** Share of the round's zombie health per bullet, and a floor. */
    damageShare: 0.2,
    minDamage: 45,
    /** A zombie clawing at it (within `clawRange`) takes this much a second off it. */
    clawDps: 45,
    clawRange: 1.2,
    /** Points per kill for its owner. */
    killPoints: 40,
    /** Placed within this far of the player. */
    placeRange: 4,
    /** Zombies are pushed out of this radius (it stands in the way). */
    radius: 0.45,
    /** One per player at a time (a second one replaces the first). */
    perPlayer: 1
} as const

/** Damage per bullet on a round. */
export function dfSentryDamage(round: number): number {
    return Math.max(DF_SENTRY.minDamage, dfZombieBaseHealth(Math.max(1, round)) * DF_SENTRY.damageShare)
}

export interface DfSentryTarget {
    id: number
    pos: Vec3
    hp: number
    /** Chest height over its feet. */
    chest?: number
    /** Ignore (rising out of the ground, outside the walls). */
    skip?: boolean
}

/** The nearest live zombie in range it can see (by `los` from the muzzle to the chest), or null. */
export function dfSentryPick(muzzle: Vec3, targets: readonly DfSentryTarget[], los: (a: Vec3, b: Vec3) => boolean, range: number = DF_SENTRY.range): DfSentryTarget | null {
    const cands: { t: DfSentryTarget, d: number }[] = []
    for (const t of targets) {
        if (t.skip || !(t.hp > 0)) continue
        const d = Math.hypot(t.pos.x - muzzle.x, (t.pos.y + (t.chest ?? 1.1)) - muzzle.y, t.pos.z - muzzle.z)
        if (d > range) continue
        cands.push({ t, d })
    }
    cands.sort((a, b) => a.d - b.d)
    // only the closest few get a line-of-sight test (they're cheap but not free)
    for (const c of cands.slice(0, 6)) {
        const chest = { x: c.t.pos.x, y: c.t.pos.y + (c.t.chest ?? 1.1), z: c.t.pos.z }
        if (los(muzzle, chest)) return c.t
    }
    return null
}

/** Turns `yaw` toward `want` by at most `rate * dt`; returns the new yaw (wrapped to -pi..pi). */
export function dfTurnToward(yaw: number, want: number, rate: number, dt: number): number {
    let d = want - yaw
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    const step = Math.max(-rate * dt, Math.min(rate * dt, d))
    let y = yaw + step
    while (y > Math.PI) y -= Math.PI * 2
    while (y < -Math.PI) y += Math.PI * 2
    return y
}

/** Angle between two yaws (0..pi). */
export function dfYawGap(a: number, b: number): number {
    let d = Math.abs(a - b) % (Math.PI * 2)
    if (d > Math.PI) d = Math.PI * 2 - d
    return d
}

// ---------------------------------------------------------------- the gramophone decoy

export const DF_DECOY = {
    /** Seconds it plays before it blows. */
    fuse: 9,
    /** Zombies this close come dancing. */
    lureRadius: 22,
    /** Placed (thrown) within this far of the player. */
    placeRange: 12,
    blastRadius: 5.5,
    /** Blast damage as a share of the round's zombie health. */
    damageShare: 2.6
} as const

/** Blast damage on a round. */
export function dfDecoyDamage(round: number): number {
    return Math.max(400, dfZombieBaseHealth(Math.max(1, round)) * DF_DECOY.damageShare)
}

// ---------------------------------------------------------------- round challenges

export type DfChallengeId = 'heads' | 'knife' | 'blast' | 'brute' | 'gear'

export interface DfChallengeDef {
    id: DfChallengeId
    /** "Headshot kills" */
    text: string
    /** Goal for a solo squad on round `r`. */
    goal(r: number): number
    /** Earliest round it can be dealt. */
    from: number
}

export const DF_CHALLENGES: Record<DfChallengeId, DfChallengeDef> = {
    heads: { id: 'heads', text: 'Headshot kills', goal: r => Math.min(14, 3 + Math.floor(r * 0.6)), from: 3 },
    knife: { id: 'knife', text: 'Knife kills', goal: r => Math.min(8, 2 + Math.floor(r / 3)), from: 3 },
    blast: { id: 'blast', text: 'Explosive kills', goal: r => Math.min(12, 3 + Math.floor(r / 2)), from: 4 },
    brute: { id: 'brute', text: 'Kill the Ironclad Brute', goal: () => 1, from: DF_ENEMIES.brute.minRound },
    gear: { id: 'gear', text: 'Kills by crafted gear and air support', goal: r => Math.min(16, 4 + Math.floor(r / 2)), from: 4 }
}

export const DF_CHALLENGE_REWARD = { scrap: 4, scrapPerRound: 1, maxScrap: 20, parts: 1, points: 250 } as const

/** A challenge's reward on a round: the scrap grows with the round (7 on round 3, 20 from round 16). */
export function dfChallengeReward(round: number): { scrap: number, parts: number, points: number } {
    const scrap = Math.min(DF_CHALLENGE_REWARD.maxScrap, DF_CHALLENGE_REWARD.scrap + DF_CHALLENGE_REWARD.scrapPerRound * Math.max(1, Math.floor(round)))
    return { scrap, parts: DF_CHALLENGE_REWARD.parts, points: DF_CHALLENGE_REWARD.points }
}

/** Goal for the squad (a bigger squad has more to do). */
export function dfChallengeGoal(id: DfChallengeId, round: number, players: number): number {
    const g = DF_CHALLENGES[id].goal(round)
    if (id === 'brute') return g
    return Math.round(g * (1 + 0.5 * Math.max(0, Math.min(3, players - 1))))
}

/** The challenges that can be dealt on a round (none before round 3, the gas rounds take a break). */
export function dfChallengePool(round: number, opts: { gas: boolean, brutes: number }): DfChallengeId[] {
    if (round < 3 || opts.gas) return []
    return (Object.keys(DF_CHALLENGES) as DfChallengeId[]).filter((id) => {
        if (round < DF_CHALLENGES[id].from) return false
        if (id === 'brute') return opts.brutes > 0
        return true
    })
}

/** Does this kill count toward the challenge? */
export function dfChallengeCounts(id: DfChallengeId, kill: { type: DfEnemyType, zone: DfHitZone, weapon: string, explosive: boolean, gear: boolean }): boolean {
    switch (id) {
        case 'heads': return kill.zone === 'head' && !kill.gear
        case 'knife': return kill.weapon === 'knife'
        case 'blast': return kill.explosive && !kill.gear
        case 'brute': return kill.type === 'brute'
        case 'gear': return kill.gear
    }
}

// ---------------------------------------------------------------- snapshot and messages

export interface DfArsenalPlayerSnap {
    pid: number
    equip: 'sentry' | 'decoy' | null
    kit: boolean
    /** Support held, oldest first (X calls in the newest). */
    support: DfSupportId[]
    /** Seconds left on the grenade launcher while it is out. */
    launcher?: number
    /** The weapon the launcher stands in for, set aside (the wall-buy prompt treats it as owned). */
    stash?: DfHeldWeapon
}

export interface DfSalvageDropSnap {
    id: number
    kind: DfSalvageKind
    pos: Vec3
    n: number
    /** Seconds left before it rusts away. */
    ttl: number
}

export interface DfCrateSnap {
    id: number
    item: DfCraftId
    pos: Vec3
    /** The killer it dropped for (theirs alone while `open` is false). */
    owner: number
    /** Anyone may take it now. */
    open: boolean
    /** Seconds until it is anyone's (0 once open). */
    opensIn: number
    /** Seconds left before it's gone. */
    ttl: number
}

export interface DfSentrySnap {
    id: number
    owner: number
    pos: Vec3
    yaw: number
    /** 0..1 rounds left in the drums. */
    ammo: number
    /** Seconds left. */
    life: number
    /** 0..1 */
    hp: number
    /** Shots fired so far (the client draws one tracer per new shot). */
    shots: number
    /** What it is shooting at (chest point), when it is. */
    tgt?: Vec3
}

export interface DfDecoySnap {
    id: number
    owner: number
    pos: Vec3
    yaw: number
    /** Seconds before it blows. */
    fuse: number
}

export interface DfChallengeSnap {
    id: DfChallengeId
    text: string
    n: number
    goal: number
    done: boolean
}

/**
 * The salvage / workbench / sentry / support part of the world snapshot.
 * Salvage is per player: `scrap`, `parts` and `drops` are the receiving
 * player's own, sent to them alone (`DfSnapshot.mine`, merged in on arrival
 * by `dfMergeArsenalMine`).
 */
export interface DfArsenalSnap {
    scrap?: number
    parts?: number
    players: DfArsenalPlayerSnap[]
    drops?: DfSalvageDropSnap[]
    sentries: DfSentrySnap[]
    decoys: DfDecoySnap[]
    /** Upgrade kits set down on the ground (anyone may take one). */
    kits?: DfKitDropSnap[]
    /** Supply crates: the open ones here for everyone; the receiver's own still-private ones arrive in `mine`. */
    crates?: DfCrateSnap[]
    challenge?: DfChallengeSnap
}

export interface DfKitDropSnap {
    id: number
    /** Rarity tier 1..3. */
    tier: number
    pos: Vec3
    yaw: number
    /** Seconds before it's gone. */
    ttl: number
}

/** One player's private slice of a snapshot: their own salvage and pickups. */
export interface DfArsenalMine {
    scrap: number
    parts: number
    drops: DfSalvageDropSnap[]
    /** Their own supply crates still private to them. */
    crates: DfCrateSnap[]
    /** Their pickup events (nobody else hears about them). */
    events: DfArsenalEvent[]
}

/**
 * Folds a snapshot's private slice into its world and events (the client does
 * this as a snapshot arrives, so every view reads `world.arsenal` as one).
 */
export function dfMergeArsenalMine<S extends { world: { arsenal?: DfArsenalSnap }, events: unknown[], mine?: DfArsenalMine }>(s: S): S {
    const m = s.mine
    if (!m) return s
    const a = s.world.arsenal ?? (s.world.arsenal = { players: [], sentries: [], decoys: [] })
    a.scrap = m.scrap
    a.parts = m.parts
    a.drops = m.drops
    if (m.crates?.length) a.crates = [...(a.crates ?? []), ...m.crates]
    if (m.events.length) s.events.push(...m.events)
    delete s.mine
    return s
}

export interface DfStrikeHit {
    x: number
    y: number
    z: number
    /** Seconds after the call-in. */
    t: number
    r: number
    /** The bomber's last word: every zombie within `r` dies (no cover, brutes too). */
    all?: boolean
}

export type DfArsenalEvent =
    /** Salvage picked up (into the player's own pool). */
    | { k: 'salvage', p: number, kind: DfSalvageKind, n: number, id: number, pos: Vec3 }
    /** A supply crate taken: by its killer (`owner`) or, once open, by anyone. */
    | { k: 'crate', p: number, owner: number, item: DfCraftId, id: number, pos: Vec3 }
    | { k: 'craft', p: number, item: DfCraftId | 'upgrade', bench: string }
    | { k: 'deploy', p: number, item: 'sentry' | 'decoy', id: number, pos: Vec3 }
    /** A sentry's run is over: out of ammo / time (`spent`) or clawed apart (`broken`). */
    | { k: 'sentry', id: number, what: 'spent' | 'broken', pos: Vec3 }
    | { k: 'decoy', id: number, pos: Vec3 }
    /** Support called in on `at`: every impact and its time after now. */
    | { k: 'strike', p: number, reward: DfStrikeId, id: number, at: Vec3, dir: Vec3, hits: DfStrikeHit[] }
    /** The grenade launcher came out (`on`) or went back for the weapon it stood in for. */
    | { k: 'launcher', p: number, on: boolean }
    | { k: 'challenge', what: 'new' | 'done' | 'failed', id: DfChallengeId, text: string, goal: number }
    /** A weapon came up a rarity tier: pulled from the box, a kit applied, upgraded at the bench. */
    | { k: 'rarity', p: number, weapon: DfWeaponId, rarity: number, how: 'box' | 'kit' | 'bench' }
    /** An upgrade kit set down on the ground (its claimer's weapon was already that good). */
    | { k: 'kitDrop', p: number, id: number, tier: number, pos: Vec3 }

/** Client requests (inside `{ t: 'arsenal', op }`). */
export type DfArsenalOp =
    | { k: 'craft', bench: string, item: DfCraftId }
    /** Place the deployable in hand at `pos` (a floor point the client picked), facing `yaw`. */
    | { k: 'deploy', pos: Vec3, yaw: number }
    /** Call in the newest support on `at`, flying along `dir` (the caller's facing). */
    | { k: 'callin', at: Vec3, dir: Vec3 }
    /** Upgrade the weapon in `slot` one rarity tier at a bench; `from` is the tier it is now (a repeat finds it changed). */
    | { k: 'upgrade', bench: string, slot: number, from: number, /** The weapon id the client sees there. */ weapon?: DfWeaponId }
    /** Take an upgrade kit off the ground onto the held weapon. */
    | { k: 'kit', id: number }
