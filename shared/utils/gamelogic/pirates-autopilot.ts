import { PIRATE_ENEMY_TIERS, PIRATE_RUN_DURATION_MS } from './pirates'

// Pirate Raid auto-play. The browser flies the ship and sends a snapshot of the
// sea a few times a second; the server turns it into plain-language state and
// asks TypeSafe's Jev a handful of snap judgments (how dangerous is it, which
// way is open water, is that pickup safe, is the keg worth throwing). Code on
// the client turns those answers into movement. Advice only: nothing here
// grants or spends value, and the client can only send numbers and tier ids,
// so no player text ever reaches the model.

export const PIRATE_AUTOPILOT_WORLD_W = 1400
export const PIRATE_AUTOPILOT_WORLD_H = 820
/** Mirrors PLAYER_BOMB_RADIUS in the engine. */
export const PIRATE_AUTOPILOT_KEG_RADIUS = 145
/** Fastest the server asks Jev for one socket. */
export const PIRATE_AUTOPILOT_MIN_INTERVAL_MS = 250

const MAX_ENEMIES = 24
const MAX_HAZARDS = 16
const MAX_MINES = 12
const MAX_ISLANDS = 8

export const PIRATE_AUTOPILOT_HEADINGS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const
export type PirateAutopilotHeading = typeof PIRATE_AUTOPILOT_HEADINGS[number]

/** Screen angle (radians, y down) of each heading. */
export function pirateHeadingAngle(heading: PirateAutopilotHeading) {
    return (PIRATE_AUTOPILOT_HEADINGS.indexOf(heading) - 2) * Math.PI / 4
}

export function pirateHeadingOf(dx: number, dy: number): PirateAutopilotHeading {
    const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 2
    return PIRATE_AUTOPILOT_HEADINGS[((sector % 8) + 8) % 8]!
}

export interface PirateAutopilotPoint {
    x: number
    y: number
}

export interface PirateAutopilotEnemy extends PirateAutopilotPoint {
    tier: string
    /** Hull left, 0-1. */
    hp: number
    /** Firing range, which difficulty may stretch past the tier's base. */
    range: number
}

export interface PirateAutopilotHazard extends PirateAutopilotPoint {
    r: number
}

export interface PirateAutopilotIsland extends PirateAutopilotPoint {
    r: number
}

export interface PirateAutopilotSnapshot {
    /** Elapsed voyage time in ms. */
    t: number
    x: number
    y: number
    /** Hull left, 0-1. */
    hull: number
    shield: number
    /** Effective cannon range right now. */
    range: number
    /** Powder keg equipped and off cooldown. */
    keg: boolean
    enemies: PirateAutopilotEnemy[]
    /** Telegraphed impact zones: bombs, drift mines, skiffs, sniper shots. */
    hazards: PirateAutopilotHazard[]
    mines: PirateAutopilotPoint[]
    islands: PirateAutopilotIsland[]
    supply: PirateAutopilotPoint | null
    repair: PirateAutopilotPoint | null
    treasure: PirateAutopilotPoint | null
}

export interface PirateAutopilotAdvice {
    /** 0 (calm) to 1 (about to sink). */
    danger: number
    heading: PirateAutopilotHeading | null
    headingConfidence: number
    grabSupply: number
    grabRepair: number
    grabTreasure: number
    throwKeg: number
}

// ─── Parsing ────────────────────────────────────────────────────────────────

const TIER_IDS = new Set(PIRATE_ENEMY_TIERS.map(tier => tier.id))

function num(value: unknown, min: number, max: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    return Math.min(max, Math.max(min, value))
}

function point(value: unknown): PirateAutopilotPoint | null {
    if (!value || typeof value !== 'object') return null
    const v = value as Record<string, unknown>
    const x = num(v.x, 0, PIRATE_AUTOPILOT_WORLD_W)
    const y = num(v.y, 0, PIRATE_AUTOPILOT_WORLD_H)
    return x === null || y === null ? null : { x, y }
}

function list<T>(value: unknown, max: number, parse: (item: unknown) => T | null): T[] {
    if (!Array.isArray(value)) return []
    const out: T[] = []
    for (const item of value.slice(0, max)) {
        const parsed = parse(item)
        if (parsed) out.push(parsed)
    }
    return out
}

/** Validate a client snapshot. Returns null when it is malformed. */
export function parsePirateAutopilotSnapshot(raw: unknown): PirateAutopilotSnapshot | null {
    if (!raw || typeof raw !== 'object') return null
    const v = raw as Record<string, unknown>
    const self = point(v)
    const t = num(v.t, 0, PIRATE_RUN_DURATION_MS)
    const hull = num(v.hull, 0, 1)
    const shield = num(v.shield, 0, 10_000)
    const range = num(v.range, 0, 2000)
    if (!self || t === null || hull === null || shield === null || range === null) return null

    return {
        t,
        ...self,
        hull,
        shield,
        range,
        keg: v.keg === true,
        enemies: list(v.enemies, MAX_ENEMIES, (item) => {
            const p = point(item)
            const e = item as Record<string, unknown>
            const hp = num(e?.hp, 0, 1)
            const r = num(e?.range, 0, 2000)
            if (!p || hp === null || r === null || typeof e.tier !== 'string' || !TIER_IDS.has(e.tier)) return null
            return { ...p, tier: e.tier, hp, range: r }
        }),
        hazards: list(v.hazards, MAX_HAZARDS, (item) => {
            const p = point(item)
            const r = num((item as Record<string, unknown>)?.r, 1, 400)
            return p && r !== null ? { ...p, r } : null
        }),
        mines: list(v.mines, MAX_MINES, point),
        islands: list(v.islands, MAX_ISLANDS, (item) => {
            const p = point(item)
            const r = num((item as Record<string, unknown>)?.r, 1, 400)
            return p && r !== null ? { ...p, r } : null
        }),
        supply: point(v.supply),
        repair: point(v.repair),
        treasure: point(v.treasure)
    }
}

// ─── Geometry shared by the server's state and the client's pilot ───────────

function tierOf(id: string) {
    return PIRATE_ENEMY_TIERS.find(tier => tier.id === id)!
}

function dist(a: PirateAutopilotPoint, b: PirateAutopilotPoint) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Enemies whose guns reach `at`, with a small safety buffer. */
export function pirateEnemiesInReach(enemies: PirateAutopilotEnemy[], at: PirateAutopilotPoint, buffer = 30) {
    return enemies.filter(enemy => dist(enemy, at) <= enemy.range + buffer)
}

/**
 * Where a keg lands on the most ships: every enemy is tried as the centre and
 * ships inside the blast count, bosses triple. Null when the sea is empty.
 */
export function pirateKegTarget(enemies: PirateAutopilotEnemy[]) {
    let best: { x: number, y: number, ships: number, boss: boolean, weight: number } | null = null
    for (const centre of enemies) {
        const inside = enemies.filter(enemy => dist(enemy, centre) <= PIRATE_AUTOPILOT_KEG_RADIUS * 0.8)
        const x = inside.reduce((sum, enemy) => sum + enemy.x, 0) / inside.length
        const y = inside.reduce((sum, enemy) => sum + enemy.y, 0) / inside.length
        const boss = inside.some(enemy => tierOf(enemy.tier).boss)
        const weight = inside.length + (boss ? 2 : 0)
        if (!best || weight > best.weight) best = { x, y, ships: inside.length, boss, weight }
    }
    return best
}

// ─── Jev state ──────────────────────────────────────────────────────────────
// Numbers become words and every count, distance and comparison is done here,
// so Jev only makes the judgments.

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function countWord(n: number) {
    return COUNT_WORDS[n] ?? 'many'
}

function ships(n: number) {
    return `${countWord(n)} enemy ${n === 1 ? 'ship' : 'ships'}`
}

function hullWords(hull: number) {
    if (hull > 0.85) return 'pristine'
    if (hull > 0.6) return 'lightly damaged'
    if (hull > 0.35) return 'damaged, about half left'
    if (hull > 0.15) return 'badly damaged, under a third left'
    return 'sinking, almost nothing left'
}

function enemyHealthWords(hp: number) {
    if (hp > 0.75) return 'healthy'
    if (hp > 0.35) return 'damaged'
    return 'nearly sunk'
}

function distanceWords(d: number) {
    if (d < 150) return 'very close'
    if (d < 300) return 'close'
    if (d < 500) return 'mid range'
    return 'far away'
}

function enemyRole(id: string) {
    const tier = tierOf(id)
    if (tier.boss) return 'flagship boss, very dangerous'
    if (tier.sniper) return 'long-range sniper'
    if (tier.maxDamage >= 40) return 'heavy warship'
    if (tier.hp >= 150) return 'armoured ship'
    if (tier.speed >= 300) return 'fast raider'
    return 'light ship'
}

function enemyStanding(snap: PirateAutopilotSnapshot, enemy: PirateAutopilotEnemy) {
    const d = dist(snap, enemy)
    const theyReach = d <= enemy.range + 30
    const weReach = d <= snap.range
    if (theyReach && weReach) return 'trading shots with you'
    if (theyReach) return 'can hit you but is beyond your cannons'
    if (weReach) return 'inside your cannon range but cannot reach you'
    return 'out of range both ways'
}

/** Water ahead on a heading: how far to the edge or an island, plus what sits there. */
function sectorWords(snap: PirateAutopilotSnapshot, heading: PirateAutopilotHeading) {
    const angle = pirateHeadingAngle(heading)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let open = 0
    for (let step = 20; step <= 320; step += 20) {
        const x = snap.x + dx * step
        const y = snap.y + dy * step
        const blocked = x < 45 || y < 45 || x > PIRATE_AUTOPILOT_WORLD_W - 45 || y > PIRATE_AUTOPILOT_WORLD_H - 45
            || snap.islands.some(island => Math.hypot(island.x - x, island.y - y) < island.r + 26)
        if (blocked) break
        open = step
    }
    const ahead = (p: PirateAutopilotPoint, reach: number) => {
        const d = dist(snap, p)
        if (d > reach || d < 1) return false
        const cos = ((p.x - snap.x) * dx + (p.y - snap.y) * dy) / d
        return cos > Math.cos(Math.PI / 5)
    }
    const enemies = snap.enemies.filter(enemy => ahead(enemy, 480))
    const heavy = enemies.filter(enemy => enemyRole(enemy.tier) !== 'light ship')
    const hazards = snap.hazards.filter(hazard => ahead(hazard, 260))
    const mines = snap.mines.filter(mine => ahead(mine, 220))

    const parts = [
        open >= 300 ? 'open water for a long way' : open >= 140 ? 'some open water' : 'blocked by coast or an island almost at once',
        enemies.length ? `${ships(enemies.length)}${heavy.length ? `, ${countWord(heavy.length)} of them dangerous` : ''}` : 'no enemy ships'
    ]
    if (hazards.length) parts.push('an incoming blast lands there')
    if (mines.length) parts.push('a sea mine in the way')
    return parts.join('; ')
}

function pickupWords(snap: PirateAutopilotSnapshot, p: PirateAutopilotPoint | null, what: string) {
    if (!p) return `no ${what} on the sea`
    const d = dist(snap, p)
    const guards = snap.enemies.filter(enemy => dist(enemy, p) <= enemy.range)
    const heavyGuards = guards.filter(enemy => enemyRole(enemy.tier) !== 'light ship')
    const mined = snap.mines.some(mine => dist(mine, p) < 90) || snap.hazards.some(hazard => dist(hazard, p) < hazard.r + 30)
    const heading = pirateHeadingOf(p.x - snap.x, p.y - snap.y)
    const guarded = guards.length
        ? `${ships(guards.length)} can fire on it${heavyGuards.length ? `, ${countWord(heavyGuards.length)} of them dangerous` : ''}`
        : 'no enemy guns cover it'
    return `a ${what} ${distanceWords(d)} to the ${heading}; ${guarded}${mined ? '; a mine or blast sits next to it' : ''}`
}

export function pirateAutopilotState(snap: PirateAutopilotSnapshot) {
    const inReach = pirateEnemiesInReach(snap.enemies, snap)
    const nearest = [...snap.enemies]
        .sort((a, b) => dist(snap, a) - dist(snap, b))
        .slice(0, 6)
    const keg = pirateKegTarget(snap.enemies)
    const remaining = PIRATE_RUN_DURATION_MS - snap.t
    const standingUnder = snap.hazards.some(hazard => dist(hazard, snap) <= hazard.r + 20)

    return {
        ship: {
            hull: hullWords(snap.hull),
            shield: snap.shield > 0 ? 'a shield absorbs the next hits' : 'no shield',
            under_fire: `${ships(inReach.length)} can hit you where you are`,
            incoming: standingUnder ? 'a telegraphed blast is about to land on your position' : 'nothing is about to land on you',
            voyage: remaining < 60_000 ? 'the final minute, survive to finish' : remaining < 150_000 ? 'late in the voyage, the fleet is at its strongest' : 'early or mid voyage'
        },
        enemies: nearest.map(enemy => ({
            ship: tierOf(enemy.tier).name,
            role: enemyRole(enemy.tier),
            health: enemyHealthWords(enemy.hp),
            distance: distanceWords(dist(snap, enemy)),
            direction: pirateHeadingOf(enemy.x - snap.x, enemy.y - snap.y),
            standing: enemyStanding(snap, enemy)
        })),
        sectors: Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(heading => [heading, sectorWords(snap, heading)])),
        supply_drop: pickupWords(snap, snap.supply, 'supply drop'),
        repair_kit: pickupWords(snap, snap.repair, 'repair kit'),
        treasure: pickupWords(snap, snap.treasure, 'treasure chest'),
        keg: !keg
            ? 'no enemy ships to throw at'
            : `the best throw catches ${ships(keg.ships)}${keg.boss ? ', including the flagship boss' : ''}`
    }
}

// ─── Jev questions ──────────────────────────────────────────────────────────

const DANGER_LEVELS = [
    {
        summary: 'No enemy can fire on the ship and nothing is incoming',
        signals: ['Enemies are out of range or absent', 'The hull is in any condition but nobody is shooting']
    },
    {
        summary: 'A light ship or two exchange fire with a healthy hull',
        signals: ['Hull pristine or lightly damaged', 'One or two light ships can hit you']
    },
    {
        summary: 'Several ships or a heavy warship pound a hull that is holding',
        signals: ['Three or more ships can hit you', 'A flagship, sniper or heavy warship is trading shots', 'Hull damaged but not critical']
    },
    {
        summary: 'The hull is failing while enemies still have it in range',
        signals: ['Hull badly damaged or sinking and at least one ship can hit you', 'A blast is about to land on a weak hull']
    }
]

function pickupQuestion(path: string, what: string) {
    return {
        type: 'noul',
        instructions: {
            question: `Is the ${what} described in \`${path}\` safe to sail to right now?`,
            inspect: path,
            focus: 'Safe means few or no enemy guns cover it and no mine or blast sits next to it. A missing item is not safe.'
        },
        criteria: {
            true: { what: 'Reachable without sailing into heavy fire', examples: ['close to the east; no enemy guns cover it', 'mid range to the south; one enemy ship can fire on it'] },
            false: { what: 'Absent, or covered by several or dangerous ships, or mined', examples: [`no ${what} on the sea`, 'three enemy ships can fire on it, two of them dangerous'] }
        }
    }
}

export const PIRATE_AUTOPILOT_QUESTIONS = {
    danger: {
        type: 'score',
        instructions: {
            question: 'How much danger is the ship in right now, judging `ship.hull` against the fire described in `ship.under_fire`, `ship.incoming` and `enemies`?',
            inspect: 'ship'
        },
        criteria: DANGER_LEVELS
    },
    heading: {
        type: 'choice',
        instructions: {
            question: 'Which heading in `sectors` offers the safest open water to sail toward?',
            inspect: 'sectors',
            focus: 'Prefer long open water with no enemy ships, blasts or mines. Avoid headings blocked by coast.'
        },
        criteria: Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(heading => [heading, `Sail ${heading}, as described by \`sectors.${heading}\``]))
    },
    grab_supply: pickupQuestion('supply_drop', 'supply drop'),
    grab_repair: pickupQuestion('repair_kit', 'repair kit'),
    grab_treasure: pickupQuestion('treasure', 'treasure chest'),
    throw_keg: {
        type: 'noul',
        instructions: {
            question: 'Does the throw described in `keg` catch at least three enemy ships or the flagship boss?',
            inspect: 'keg'
        },
        criteria: {
            true: { what: 'Three or more ships, or the flagship', examples: ['the best throw catches four enemy ships', 'the best throw catches one enemy ship, including the flagship boss'] },
            false: { what: 'Two ships or fewer and no flagship', examples: ['the best throw catches one enemy ship', 'the best throw catches two enemy ships'] }
        }
    }
} as const

// ─── Answers ────────────────────────────────────────────────────────────────

interface JevAnswer {
    type?: string
    noul?: number
    choice?: string
    score?: number
    confidence?: number
}

function noul(answer: JevAnswer | undefined) {
    return typeof answer?.noul === 'number' ? Math.min(1, Math.max(0, answer.noul)) : 0
}

export function pirateAutopilotAdvice(answers: Record<string, JevAnswer | undefined>): PirateAutopilotAdvice {
    const danger = answers.danger
    const heading = answers.heading
    const headingChoice = PIRATE_AUTOPILOT_HEADINGS.find(h => h === heading?.choice) ?? null
    return {
        danger: typeof danger?.score === 'number' ? Math.min(1, Math.max(0, danger.score / (DANGER_LEVELS.length - 1))) : 0,
        heading: headingChoice,
        headingConfidence: headingChoice ? Math.min(1, Math.max(0, heading?.confidence ?? 0)) : 0,
        grabSupply: noul(answers.grab_supply),
        grabRepair: noul(answers.grab_repair),
        grabTreasure: noul(answers.grab_treasure),
        throwKeg: noul(answers.throw_keg)
    }
}
