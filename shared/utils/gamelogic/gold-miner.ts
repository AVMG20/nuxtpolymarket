/**
 * GOLD MINER — the classic claw game.
 *
 * A miner on the surface swings a claw back and forth. Tap to fire it, and it
 * grabs the first thing it touches and winches it back up. Heavy things come up
 * slowly, and every level runs on a 60-second clock with a cash goal. Clear the
 * goal and the shop opens: spend cash on dynamite and boosts, or cash out.
 *
 * Two currencies, deliberately separate:
 *
 * - **Cash** ($) is earned and spent inside one run. Each level has its own
 *   goal that must be dug up on that level; what you hold carries over and is
 *   what the shop charges and the cash-out pays on.
 * - **Coins** are the site currency. A run costs a coin stake up front, and
 *   cashing out at the shop converts the run's cash into coins at
 *   `stake × cash / GM_CASH_PER_STAKE`. Missing a goal loses the stake.
 *
 * Every level rolls a hidden vein (thin, steady or rich), so how deep a run
 * gets is part aim and part luck: that uncertainty is what the cash-out prices.
 *
 * Everything that decides value lives here and is replayed by the server:
 * levels are generated from the run's secret seed, revealed one level at a
 * time, and the client only ever reports *which* items it reeled in and *when*.
 * `gmScoreLevel` rejects any
 * report the winch could not physically have produced in the time allowed, so
 * a forged report can never claim more than a perfect player could pull.
 */

// ─── World ──────────────────────────────────────────────────────────────────

/** Logical world size. The renderer scales this to fit; the rules never see pixels. */
export const GM_W = 1280
export const GM_H = 720
/** Where the rope leaves the winch. */
export const GM_PIVOT = { x: 640, y: 144 } as const
/** Top of the dirt. Nothing is ever placed above `GM_ITEM_TOP`. */
export const GM_GROUND_Y = 160
export const GM_ITEM_TOP = 215
export const GM_ITEM_BOTTOM = 692

// ─── Winch ──────────────────────────────────────────────────────────────────

/** Rope length with the claw resting under the winch. */
export const GM_ROPE_MIN = 36
/** Radius of the claw's grab circle, measured at the rope tip. */
export const GM_CLAW_R = 14
/** Swing amplitude either side of straight down, in radians (~72°). */
export const GM_SWING_MAX = 1.26
export const GM_SWING_PERIOD_MS = 2600
/** Rope pay-out speed while the claw is flying, px/s. */
export const GM_SHOOT_SPEED = 540
/** Reel speed with nothing on the claw. Also the ceiling for any load. */
export const GM_EMPTY_REEL = 820
/** Strength drink multiplies every loaded reel speed (capped at the empty speed). */
export const GM_STRENGTH_MULT = 1.75
/** Radius a TNT barrel clears when the claw sets it off. Chains into other barrels. */
export const GM_TNT_RADIUS = 125

// ─── Run ────────────────────────────────────────────────────────────────────

export const GM_LEVEL_MS = 60_000
/** "Level N — Goal $X" card before the clock starts. */
export const GM_INTRO_MS = 2_800
/** How late a level report may arrive before the level counts as abandoned. */
export const GM_SUBMIT_GRACE_MS = 30_000
export const GM_MAX_DYNAMITE = 9

export const GM_MIN_STAKE = 100
/**
 * A skill game pays whoever is good at it, so its exposure is bounded here
 * rather than riding `CASINO_MAX_BET`. Kept low while the game is unlisted.
 */
export const GM_MAX_STAKE = 10_000
/** Cash per stake at the cash-out. Tuned by `bun run balance:gold-miner` so a near-perfect player only just breaks even. */
export const GM_CASH_PER_STAKE = 7500

/**
 * What you have to dig up *on* `level` to clear it. Each level stands on its
 * own — cash carried in from earlier levels grows the cash-out, but never pays
 * a later goal — so every level is a fresh bet on its vein and your aim.
 */
export function gmGoal(level: number): number {
    return 600 + 300 * (Math.max(1, Math.floor(level)) - 1)
}

/** Coins a run pays when cashed out holding `cash`. */
export function gmPayout(stake: number, cash: number): number {
    if (!(stake > 0) || !(cash > 0)) return 0
    return Math.floor((stake * cash / GM_CASH_PER_STAKE) * 100) / 100
}

// ─── Items ──────────────────────────────────────────────────────────────────

export type GmKind =
    | 'goldS' | 'goldM' | 'goldL' | 'goldXL'
    | 'rockS' | 'rockL'
    | 'diamond'
    | 'mole' | 'moleDiamond'
    | 'bag'
    | 'bone' | 'skull'
    | 'tnt'

export interface GmItemDef {
    /** Collision radius in world px. */
    r: number
    /** Base cash value. Bags are rolled instead; TNT pays for its scrap. */
    value: number
    /** Reel speed with this on the claw, px/s. Lower is heavier. */
    pull: number
    label: string
}

export const GM_ITEMS: Record<GmKind, GmItemDef> = {
    goldS: { r: 14, value: 50, pull: 400, label: 'Gold nugget' },
    goldM: { r: 23, value: 100, pull: 290, label: 'Gold chunk' },
    goldL: { r: 36, value: 250, pull: 150, label: 'Gold lump' },
    goldXL: { r: 58, value: 500, pull: 70, label: 'Mother lode' },
    rockS: { r: 22, value: 11, pull: 175, label: 'Rock' },
    rockL: { r: 38, value: 20, pull: 80, label: 'Boulder' },
    diamond: { r: 12, value: 600, pull: 470, label: 'Diamond' },
    mole: { r: 19, value: 2, pull: 420, label: 'Mole' },
    moleDiamond: { r: 21, value: 602, pull: 380, label: 'Mole with a diamond' },
    bag: { r: 20, value: 0, pull: 240, label: 'Mystery bag' },
    bone: { r: 16, value: 7, pull: 360, label: 'Bone' },
    skull: { r: 17, value: 20, pull: 300, label: 'Skull' },
    tnt: { r: 22, value: 2, pull: 620, label: 'TNT' }
}

export interface GmMole {
    /** Patrol bounds (item centre). */
    x0: number
    x1: number
    /** px/s. */
    speed: number
    /** Start offset along the patrol, 0..1 of a full there-and-back. */
    phase: number
}

export interface GmItem {
    id: number
    kind: GmKind
    x: number
    y: number
    /** Cosmetic: rotation and shape variant, so two nuggets never look alike. */
    rot: number
    variant: number
    mole?: GmMole
}

export interface GmLevel {
    level: number
    vein: GmVein
    richness: number
    /** Background theme, cosmetic. */
    theme: number
    items: GmItem[]
}

/** Where a patrolling mole is `ms` into the level. Deterministic, so client and server agree. */
export function gmMoleX(m: GmMole, ms: number): { x: number, dir: 1 | -1 } {
    const span = m.x1 - m.x0
    if (span <= 0) return { x: m.x0, dir: 1 }
    const period = (2 * span) / m.speed
    const t = ((ms / 1000) / period + m.phase) % 1
    const u = t < 0 ? t + 1 : t
    return u < 0.5
        ? { x: m.x0 + span * (u * 2), dir: 1 }
        : { x: m.x1 - span * ((u - 0.5) * 2), dir: -1 }
}

// ─── Deterministic RNG ──────────────────────────────────────────────────────
//
// Seeded, so a level (or a bag, or a shop) can be regenerated from its seed on
// either side. The *seeds* come from `#shared/utils/random` on the server.

export function gmHash(...parts: number[]): number {
    let h = 0x9e3779b9
    for (const p of parts) {
        h = Math.imul(h ^ (p | 0), 0x85ebca6b)
        h ^= h >>> 13
        h = Math.imul(h, 0xc2b2ae35)
        h ^= h >>> 16
    }
    return h >>> 0
}

export function gmRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ─── Level generation ───────────────────────────────────────────────────────

/** Whether the swinging claw can point at (x, y) at all. */
export function gmReachable(x: number, y: number, margin = 0.06): boolean {
    const dy = y - GM_PIVOT.y
    if (dy <= 0) return false
    return Math.abs(Math.atan2(x - GM_PIVOT.x, dy)) <= GM_SWING_MAX - margin
}

interface Placer {
    items: GmItem[]
    rng: () => number
    nextId: number
}

function tryPlace(p: Placer, kind: GmKind, yMin: number, yMax: number, near?: { x: number, y: number, dist: number }): GmItem | null {
    const r = GM_ITEMS[kind].r
    const lo = Math.max(GM_ITEM_TOP + r, yMin)
    const hi = Math.min(GM_ITEM_BOTTOM - r, yMax)
    if (hi < lo) return null
    for (let attempt = 0; attempt < 160; attempt++) {
        let x: number
        let y: number
        if (near) {
            const a = p.rng() * Math.PI * 2
            const d = near.dist * (0.55 + p.rng() * 0.45)
            x = near.x + Math.cos(a) * d
            y = near.y + Math.sin(a) * d
        } else {
            x = 40 + r + p.rng() * (GM_W - 80 - 2 * r)
            y = lo + p.rng() * (hi - lo)
        }
        x = Math.round(x)
        y = Math.round(y)
        if (x < 30 + r || x > GM_W - 30 - r || y < lo || y > hi) continue
        if (!gmReachable(x, y)) continue
        let clear = true
        for (const o of p.items) {
            const pad = o.mole ? 26 : 8
            const or = GM_ITEMS[o.kind].r
            // Moles patrol a whole row, so keep their lane free.
            if (o.mole) {
                if (Math.abs(o.y - y) < or + r + pad && x > o.mole.x0 - or - r && x < o.mole.x1 + or + r) {
                    clear = false
                    break
                }
                continue
            }
            const dx = o.x - x
            const dy = o.y - y
            if (dx * dx + dy * dy < (or + r + pad) ** 2) {
                clear = false
                break
            }
        }
        if (!clear) continue
        const item: GmItem = {
            id: p.nextId++,
            kind,
            x,
            y,
            rot: Math.round((p.rng() * 2 - 1) * 100) / 100,
            variant: Math.floor(p.rng() * 4)
        }
        p.items.push(item)
        return item
    }
    return null
}

function placeMole(p: Placer, kind: 'mole' | 'moleDiamond'): GmItem | null {
    const r = GM_ITEMS[kind].r
    for (let attempt = 0; attempt < 80; attempt++) {
        const y = Math.round(330 + p.rng() * 330)
        // Patrol only across the reachable part of the row.
        const reach = Math.tan(GM_SWING_MAX - 0.1) * (y - GM_PIVOT.y)
        const minX = Math.max(40 + r, GM_PIVOT.x - reach)
        const maxX = Math.min(GM_W - 40 - r, GM_PIVOT.x + reach)
        const len = 180 + p.rng() * 260
        const start = minX + p.rng() * Math.max(0, maxX - minX - len)
        const x0 = Math.round(start)
        const x1 = Math.round(Math.min(maxX, start + len))
        if (x1 - x0 < 120) continue
        const blocked = p.items.some((o) => {
            const or = GM_ITEMS[o.kind].r
            if (Math.abs(o.y - y) >= or + r + 26) return false
            const oLo = o.mole ? o.mole.x0 : o.x
            const oHi = o.mole ? o.mole.x1 : o.x
            return oHi + or + r > x0 && oLo - or - r < x1
        })
        if (blocked) continue
        const mole: GmMole = {
            x0,
            x1,
            speed: Math.round(55 + p.rng() * 45 + (kind === 'moleDiamond' ? 20 : 0)),
            phase: Math.round(p.rng() * 1000) / 1000
        }
        const item: GmItem = { id: p.nextId++, kind, x: x0, y, rot: 0, variant: Math.floor(p.rng() * 4), mole }
        p.items.push(item)
        return item
    }
    return null
}

// ─── Veins: how rich a level is ─────────────────────────────────────────────
//
// Every level rolls a hidden richness when it's dealt. A thin vein barely holds
// the goal; a mother lode holds double. Nobody — not the shop, not the client —
// knows the next level's vein until it's on the board, which is what makes
// "cash out now or go one deeper?" a real call.

export type GmVein = 'thin' | 'steady' | 'rich'

export const GM_VEINS: Record<GmVein, { label: string, chance: number, richness: readonly [number, number] }> = {
    thin: { label: 'Thin vein', chance: 0.2, richness: [0.95, 1.2] },
    steady: { label: 'Steady vein', chance: 0.5, richness: [1.3, 1.7] },
    rich: { label: 'Mother lode', chance: 0.2, richness: [1.9, 2.5] }
}

/** The layout seed for one level of a run. Derived from the run's secret, so it can't be read ahead. */
export function gmLevelSeed(secret: number, level: number): number {
    return gmHash(secret, level, 0x1e7e1)
}

/** Thin veins get commoner the deeper you go; the first level is gentle so runs don't die at the door. */
export function gmThinChance(level: number): number {
    return level <= 1 ? 0.1 : Math.min(0.55, GM_VEINS.thin.chance + 0.04 * (level - 2))
}

export function gmVeinRoll(levelSeed: number, level: number): { vein: GmVein, richness: number } {
    const rng = gmRng(gmHash(levelSeed, 0x7e1))
    const thin = gmThinChance(level)
    const roll = rng()
    const vein: GmVein = roll < thin ? 'thin' : roll < 1 - GM_VEINS.rich.chance ? 'steady' : 'rich'
    const [lo, hi] = GM_VEINS[vein].richness
    return { vein, richness: Math.round((lo + rng() * (hi - lo)) * 100) / 100 }
}

/**
 * Gold and diamonds dealt onto the board, in cash. Bags, rocks and the odd
 * bone add a little on top.
 */
export function gmLevelBudget(level: number, richness: number): number {
    // Never below the goal itself: a thin vein is a scramble, not a certain loss.
    const goal = gmGoal(level)
    return Math.round(Math.max(goal * 1.05, goal * richness - 150))
}

export function gmGenerateLevel(levelSeed: number, level: number): GmLevel {
    const rng = gmRng(gmHash(levelSeed, level, 0x60d))
    const { vein, richness } = gmVeinRoll(levelSeed, level)
    const p: Placer = { items: [], rng, nextId: 1 }
    const pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]!

    // Moles first: they need a whole clear row.
    const moles = level >= 2 ? 1 + Math.floor(rng() * Math.min(3, 1 + level / 3)) : 0
    const diamondMoles = level >= 4 ? Math.floor(rng() * Math.min(3, (level - 2) / 2)) : 0
    let budget = gmLevelBudget(level, richness)
    for (let i = 0; i < diamondMoles; i++) {
        if (placeMole(p, 'moleDiamond')) budget -= GM_ITEMS.moleDiamond.value
    }
    for (let i = 0; i < moles; i++) placeMole(p, 'mole')

    // Big stuff next, deep down, while there is still room for it.
    const xl = level === 1 ? 1 : Math.min(3, 1 + Math.floor(rng() * (1 + level / 4)))
    for (let i = 0; i < xl && budget > 300; i++) {
        if (tryPlace(p, 'goldXL', 430, 700)) budget -= GM_ITEMS.goldXL.value
    }

    // Fill the valuables budget with a level-dependent mix.
    const valuables: { kind: GmKind, w: number, y: [number, number] }[] = [
        { kind: 'goldL', w: 3, y: [300, 680] },
        { kind: 'goldM', w: 4, y: [240, 620] },
        { kind: 'goldS', w: level <= 2 ? 5 : 3, y: [220, 560] },
        { kind: 'diamond', w: level >= 3 ? Math.min(4, (level - 1) / 1.5) : 0, y: [420, 690] }
    ]
    let guard = 0
    while (budget > 40 && guard++ < 80) {
        const total = valuables.reduce((s, v) => s + v.w, 0)
        let roll = rng() * total
        let choice = valuables[0]!
        for (const v of valuables) {
            roll -= v.w
            if (roll < 0) {
                choice = v
                break
            }
        }
        const value = GM_ITEMS[choice.kind].value
        if (value > budget + 60) {
            if (tryPlace(p, 'goldS', 220, 560)) budget -= GM_ITEMS.goldS.value
            continue
        }
        if (tryPlace(p, choice.kind, choice.y[0], choice.y[1])) budget -= value
    }

    // TNT sits in the middle of the good stuff, so it always costs something.
    const tnts = level >= 3 ? 1 + Math.floor(rng() * Math.min(3, level / 3)) : 0
    const rich = p.items.filter(i => !i.mole && (i.kind === 'diamond' || i.kind === 'goldL' || i.kind === 'goldM'))
    for (let i = 0; i < tnts && rich.length; i++) {
        const target = pick(rich)
        tryPlace(p, 'tnt', GM_ITEM_TOP, GM_ITEM_BOTTOM, { x: target.x, y: target.y, dist: 90 })
    }

    // Junk: rocks are the filler that makes aiming matter. More and heavier later on.
    const rocks = 4 + Math.floor(rng() * 3) + Math.min(4, Math.floor(level / 2)) + (vein === 'thin' ? 3 : 0)
    for (let i = 0; i < rocks; i++) {
        tryPlace(p, rng() < 0.45 + Math.min(0.25, level * 0.03) ? 'rockL' : 'rockS', 230, 690)
    }
    const bags = 1 + (rng() < 0.55 ? 1 : 0) + (level >= 5 && rng() < 0.4 ? 1 : 0)
    for (let i = 0; i < bags; i++) tryPlace(p, 'bag', 260, 680)
    const junk = Math.floor(rng() * 3)
    for (let i = 0; i < junk; i++) tryPlace(p, rng() < 0.5 ? 'bone' : 'skull', 250, 690)

    return { level, theme: (level - 1) % 4, vein, richness, items: p.items }
}

// ─── Values and speeds ──────────────────────────────────────────────────────

export interface GmPerks {
    /** Strength drink: loaded reels are faster all level. */
    strength: boolean
    /** Lucky clover: mystery bags roll better. */
    clover: boolean
    /** Rock collector's book: rocks are worth triple. */
    book: boolean
    /** Diamond polish: diamonds are worth half again. */
    polish: boolean
}

export const GM_NO_PERKS: GmPerks = { strength: false, clover: false, book: false, polish: false }

export function gmItemValue(kind: GmKind, perks: Pick<GmPerks, 'book' | 'polish'>): number {
    const base = GM_ITEMS[kind].value
    if (perks.book && (kind === 'rockS' || kind === 'rockL')) return base * 3
    if (perks.polish && kind === 'diamond') return Math.round(base * 1.5)
    if (perks.polish && kind === 'moleDiamond') return GM_ITEMS.mole.value + Math.round(GM_ITEMS.diamond.value * 1.5)
    return base
}

export function gmReelSpeed(kind: GmKind | null, strong: boolean): number {
    if (!kind) return GM_EMPTY_REEL
    const base = GM_ITEMS[kind].pull
    return Math.min(GM_EMPTY_REEL, strong ? base * GM_STRENGTH_MULT : base)
}

// ─── Mystery bags ───────────────────────────────────────────────────────────

export type GmBagOutcome =
    | { kind: 'cash', amount: number }
    | { kind: 'strength' }
    | { kind: 'dynamite' }

/**
 * What's in a bag. Keyed on the run's *secret* seed, which never leaves the
 * server, so the client only learns it by reeling the bag in.
 */
export function gmBagOutcome(secret: number, level: number, itemId: number, clover: boolean): GmBagOutcome {
    const rng = gmRng(gmHash(secret, level, itemId, 0xba6))
    const roll = rng()
    const amountRoll = rng()
    if (clover) {
        if (roll < 0.1) return { kind: 'strength' }
        if (roll < 0.2) return { kind: 'dynamite' }
        return { kind: 'cash', amount: 150 + Math.floor(amountRoll * 650) }
    }
    if (roll < 0.12) return { kind: 'strength' }
    if (roll < 0.3) return { kind: 'dynamite' }
    // Skewed low: most bags are pocket change, a few are a jackpot.
    return { kind: 'cash', amount: 20 + Math.floor(amountRoll * amountRoll * 580) }
}

// ─── Shop ───────────────────────────────────────────────────────────────────

export type GmShopItem = 'dynamite' | 'strength' | 'clover' | 'book' | 'polish'

export const GM_SHOP_ITEMS: Record<GmShopItem, { name: string, blurb: string }> = {
    dynamite: {
        name: 'Dynamite',
        blurb: 'Blow up whatever is on the claw and reel back at full speed. Carries over between levels.'
    },
    strength: {
        name: 'Strength Drink',
        blurb: 'Reel every load faster for the whole next level.'
    },
    clover: {
        name: 'Lucky Clover',
        blurb: 'Mystery bags hold more money next level.'
    },
    book: {
        name: 'Rock Collector\'s Book',
        blurb: 'Rocks are worth three times as much next level.'
    },
    polish: {
        name: 'Diamond Polish',
        blurb: 'Diamonds are worth 50% more next level.'
    }
}

export interface GmOffer {
    item: GmShopItem
    price: number
}

/** The shop that opens after clearing `level`. Stocked and priced from the secret seed. */
export function gmShopOffers(secret: number, level: number): GmOffer[] {
    const rng = gmRng(gmHash(secret, level, 0x5409))
    const next = level + 1
    const table: { item: GmShopItem, chance: number, price: () => number }[] = [
        { item: 'dynamite', chance: 0.8, price: () => 15 + next * 10 + rng() * 90 },
        { item: 'strength', chance: 0.55, price: () => 100 + next * 25 + rng() * 220 },
        { item: 'clover', chance: 0.5, price: () => 10 + next * 18 + rng() * 70 },
        { item: 'book', chance: 0.45, price: () => 5 + next * 6 + rng() * 60 },
        { item: 'polish', chance: next >= 3 ? 0.45 : 0, price: () => 300 + next * 45 + rng() * 260 }
    ]
    const offers: GmOffer[] = []
    for (const row of table) {
        const stocked = rng() < row.chance
        const price = Math.round(row.price())
        if (stocked) offers.push({ item: row.item, price })
    }
    if (!offers.length) offers.push({ item: 'dynamite', price: 15 + next * 10 })
    return offers
}

// ─── TNT ────────────────────────────────────────────────────────────────────

/**
 * Everything a barrel takes with it, including chained barrels. Moles are
 * quick enough to scurry clear, so they never count.
 */
export function gmTntBlast(level: GmLevel, tntId: number, gone: ReadonlySet<number>): number[] {
    const byId = new Map(level.items.map(i => [i.id, i]))
    const destroyed = new Set<number>()
    const queue = [tntId]
    const seen = new Set<number>([tntId])
    while (queue.length) {
        const id = queue.shift()!
        const tnt = byId.get(id)
        if (!tnt) continue
        for (const other of level.items) {
            if (other.id === tntId || seen.has(other.id) || gone.has(other.id) || other.mole) continue
            const dx = other.x - tnt.x
            const dy = other.y - tnt.y
            if (dx * dx + dy * dy > GM_TNT_RADIUS * GM_TNT_RADIUS) continue
            seen.add(other.id)
            destroyed.add(other.id)
            if (other.kind === 'tnt') queue.push(other.id)
        }
    }
    return [...destroyed]
}

// ─── Scoring a level report ─────────────────────────────────────────────────

export interface GmGrab {
    /** Item id from the level. */
    id: number
    /** ms after the level clock started: when the load reached the winch, or when it was blown up. */
    at: number
    /** Dynamited on the way up: pays nothing. */
    blown?: boolean
}

export interface GmScoreInput {
    level: GmLevel
    grabs: GmGrab[]
    perks: GmPerks
    dynamite: number
    bag: (itemId: number) => GmBagOutcome
}

export type GmScoreResult =
    | { ok: true, earned: number, dynamite: number, collected: number }
    | { ok: false, reason: string }

/**
 * Timing is checked against a slightly generous floor: frame steps and the
 * sub-frame moment of contact both make a real pull look a touch quicker than
 * its ideal, never slower.
 */
const TIMING_SLACK = 0.85
const MAX_GRABS = 120

/** Shortest possible rope travel to touch an item: straight line from the winch, minus both radii. */
export function gmReachDistance(item: GmItem): number {
    const r = GM_ITEMS[item.kind].r
    const dy = item.y - GM_PIVOT.y
    const centre = item.mole ? dy : Math.hypot(item.x - GM_PIVOT.x, dy)
    return Math.max(0, centre - r - GM_CLAW_R - GM_ROPE_MIN)
}

export function gmScoreLevel(input: GmScoreInput): GmScoreResult {
    const { level, grabs, perks } = input
    if (!Array.isArray(grabs) || grabs.length > MAX_GRABS) return { ok: false, reason: 'Bad report' }
    const byId = new Map(level.items.map(i => [i.id, i]))
    const gone = new Set<number>()
    let dynamite = input.dynamite
    let strong = perks.strength
    let earned = 0
    let collected = 0
    let clock = 0

    for (const g of grabs) {
        if (!g || !Number.isInteger(g.id) || !Number.isFinite(g.at)) return { ok: false, reason: 'Bad report' }
        if (g.at < 0 || g.at > GM_LEVEL_MS) return { ok: false, reason: 'Grab outside the level clock' }
        if (g.at < clock) return { ok: false, reason: 'Grabs out of order' }
        const item = byId.get(g.id)
        if (!item) return { ok: false, reason: 'Unknown item' }
        if (gone.has(item.id)) return { ok: false, reason: 'Item already taken' }

        const dist = gmReachDistance(item)
        const out = dist / GM_SHOOT_SPEED
        const back = g.blown ? 0 : dist / gmReelSpeed(item.kind, strong)
        if (g.at - clock < (out + back) * 1000 * TIMING_SLACK) {
            return { ok: false, reason: 'Pulled faster than the winch allows' }
        }
        clock = g.at
        gone.add(item.id)

        if (g.blown) {
            if (dynamite <= 0) return { ok: false, reason: 'No dynamite left' }
            dynamite--
            continue
        }
        collected++
        if (item.kind === 'tnt') {
            for (const id of gmTntBlast(level, item.id, gone)) gone.add(id)
            earned += GM_ITEMS.tnt.value
            continue
        }
        if (item.kind === 'bag') {
            const outcome = input.bag(item.id)
            if (outcome.kind === 'cash') earned += outcome.amount
            else if (outcome.kind === 'strength') strong = true
            else dynamite = Math.min(GM_MAX_DYNAMITE, dynamite + 1)
            continue
        }
        earned += gmItemValue(item.kind, perks)
    }
    return { ok: true, earned, dynamite, collected }
}

// ─── API shapes ─────────────────────────────────────────────────────────────

/** The live run as the client sees it. The bag/shop secret is never part of it. */
export interface GmRunView {
    phase: 'level' | 'shop'
    stake: number
    level: number
    /** Layout seed for the level being played; null in the shop so the next board stays unknown. */
    levelSeed: number | null
    goal: number
    cash: number
    dynamite: number
    perks: GmPerks
    /** ms since the level clock started (negative while the intro card is up); null in the shop. */
    levelElapsedMs: number | null
    offers: GmOffer[]
    bought: GmShopItem[]
    payoutNow: number
}

export interface GmLevelResult {
    cleared: boolean
    earned: number
    cash: number
    goal: number
    level: number
    reason?: 'goal' | 'timeout'
    run: GmRunView | null
}
