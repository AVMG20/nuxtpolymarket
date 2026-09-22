import { PIRATE_ENEMY_TIERS, PIRATE_RUN_DURATION_MS } from './pirates'

// Pirate Raid auto-play, played by Laya: a decision model the player runs on
// their own machine (laya_server.py). Several times a second the sea is
// described to Laya and Laya makes every call:
//
// - The move: sail one of eight headings, sail to a pickup, or attack one of
//   the nearest enemy ships (the game's own attack order: chase into range
//   and focus every cannon on it). Each option is its own yes/no question and
//   the one Laya rates highest is carried out.
// - The powder keg: whether to throw it now, and at which group of ships.
//
// The cannons fire on their own, as they do for a human player. Code only
// describes the sea in words and carries out what Laya picked. There is no
// fallback player: without an answer from Laya the ship heaves to.
//
// Every question carries its own short state (a Laya extension to the Jev wire
// format), so each one sees only the facts it judges. Nothing here grants or
// spends value.

export const PIRATE_AUTOPILOT_WORLD_W = 1400
export const PIRATE_AUTOPILOT_WORLD_H = 820
/** Mirrors PLAYER_BOMB_RADIUS in the engine. */
export const PIRATE_AUTOPILOT_KEG_RADIUS = 145
/** Enemy ships offered as attack orders, and ship groups offered as keg targets, per tick. */
export const PIRATE_AUTOPILOT_MAX_TARGETS = 3

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
    id: number
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
    /** Power-up stacks active right now. */
    powerUps: number
    enemies: PirateAutopilotEnemy[]
    /** Telegraphed impact zones: bombs, drift mines, skiffs, sniper shots. */
    hazards: PirateAutopilotHazard[]
    mines: PirateAutopilotPoint[]
    islands: PirateAutopilotIsland[]
    supply: PirateAutopilotPoint | null
    repair: PirateAutopilotPoint | null
    treasure: PirateAutopilotPoint | null
}

export const PIRATE_AUTOPILOT_PICKUPS = ['supply', 'repair', 'treasure'] as const
export type PirateAutopilotPickup = typeof PIRATE_AUTOPILOT_PICKUPS[number]

export type PirateAutopilotMove =
    | { kind: 'sail', heading: PirateAutopilotHeading }
    | { kind: 'grab', pickup: PirateAutopilotPickup }
    | { kind: 'attack', enemyId: number }

/** What Laya decided on one tick. */
export interface PirateLayaDecision {
    /** The move Laya rated best; null when it gave no usable answer. */
    move: PirateAutopilotMove | null
    /** Laya's rating of every move it was asked about, 0-1, keyed by question id. */
    moves: Record<string, number>
    /** Where to throw the keg now, or null to hold it. */
    keg: PirateAutopilotPoint | null
}

// ─── Geometry ───────────────────────────────────────────────────────────────

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

export interface PirateKegGroup extends PirateAutopilotPoint {
    ships: number
    boss: boolean
}

/**
 * Up to three separate groups of ships a keg could land on, biggest first.
 * Each enemy is tried as a blast centre; a group's ships are then left out of
 * the next one. These are the options Laya chooses between, not a choice.
 */
export function pirateKegGroups(enemies: PirateAutopilotEnemy[]): PirateKegGroup[] {
    const groups: PirateKegGroup[] = []
    let left = enemies
    while (left.length && groups.length < PIRATE_AUTOPILOT_MAX_TARGETS) {
        let best: { inside: PirateAutopilotEnemy[], weight: number } | null = null
        for (const centre of left) {
            const inside = left.filter(enemy => dist(enemy, centre) <= PIRATE_AUTOPILOT_KEG_RADIUS * 0.8)
            const weight = inside.length + (inside.some(enemy => tierOf(enemy.tier).boss) ? 2 : 0)
            if (!best || weight > best.weight) best = { inside, weight }
        }
        const inside = best!.inside
        groups.push({
            x: inside.reduce((sum, enemy) => sum + enemy.x, 0) / inside.length,
            y: inside.reduce((sum, enemy) => sum + enemy.y, 0) / inside.length,
            ships: inside.length,
            boss: inside.some(enemy => tierOf(enemy.tier).boss)
        })
        left = left.filter(enemy => !inside.includes(enemy))
    }
    return groups
}

/** The nearest enemies, which are the ones offered as attack orders. */
export function pirateAttackCandidates(snap: PirateAutopilotSnapshot) {
    return [...snap.enemies].sort((a, b) => dist(a, snap) - dist(b, snap)).slice(0, PIRATE_AUTOPILOT_MAX_TARGETS)
}

// ─── Words ──────────────────────────────────────────────────────────────────
// The sea is turned into plain facts: what is where, how close, and what can
// shoot at what. Nothing here rates a move; Laya does that.

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function countWord(n: number) {
    return COUNT_WORDS[n] ?? 'many'
}

function capitalise(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1)
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

function distanceWords(d: number) {
    if (d < 150) return 'very close'
    if (d < 300) return 'close'
    if (d < 500) return 'at mid range'
    return 'far away'
}

function isHeavy(id: string) {
    const tier = tierOf(id)
    return !tier.boss && (!!tier.sniper || tier.maxDamage >= 30 || tier.hp >= 150)
}

function roleWords(id: string) {
    const tier = tierOf(id)
    if (tier.boss) return 'the flagship boss'
    if (tier.sniper) return 'a long-range sniper'
    if (isHeavy(id)) return 'a heavy warship'
    if (tier.speed >= 300) return 'a fast raider'
    return 'a light ship'
}

/** "three enemy ships can hit you, one of them a heavy warship" style summary of a group. */
function groupWords(enemies: PirateAutopilotEnemy[], verb: string) {
    if (!enemies.length) return `no enemy ship ${verb}`
    const heavy = enemies.filter(enemy => isHeavy(enemy.tier)).length
    const detail = enemies.some(enemy => tierOf(enemy.tier).boss)
        ? ', including the flagship boss'
        : heavy ? `, ${countWord(heavy)} of them ${heavy === 1 ? 'a heavy warship' : 'heavy warships'}` : ''
    return `${ships(enemies.length)} ${verb}${detail}`
}

function situationWords(snap: PirateAutopilotSnapshot) {
    const underBlast = snap.hazards.some(hazard => dist(hazard, snap) <= hazard.r + 20)
    return [
        `Hull: ${hullWords(snap.hull)}${snap.shield > 0 ? ', shielded' : ''}.`,
        `${capitalise(groupWords(pirateEnemiesInReach(snap.enemies, snap), 'can hit you'))} where you are.`,
        underBlast ? 'A blast is about to land on you.' : '',
        PIRATE_RUN_DURATION_MS - snap.t < 60_000 ? 'Final minute of the voyage.' : ''
    ].filter(Boolean).join(' ')
}

/** Where a heading leads on the map: toward the open middle, or into an edge or corner. */
function leadsWords(snap: PirateAutopilotSnapshot, dx: number, dy: number) {
    const cx = PIRATE_AUTOPILOT_WORLD_W / 2
    const cy = PIRATE_AUTOPILOT_WORLD_H / 2
    const x = Math.min(PIRATE_AUTOPILOT_WORLD_W, Math.max(0, snap.x + dx * 250))
    const y = Math.min(PIRATE_AUTOPILOT_WORLD_H, Math.max(0, snap.y + dy * 250))
    if (Math.hypot(x - cx, y - cy) < Math.hypot(snap.x - cx, snap.y - cy) - 60) return 'it leads toward the open middle of the sea'
    const ns = y < 170 ? 'north' : y > PIRATE_AUTOPILOT_WORLD_H - 170 ? 'south' : ''
    const ew = x < 200 ? 'west' : x > PIRATE_AUTOPILOT_WORLD_W - 200 ? 'east' : ''
    if (ns && ew) return `it leads into the ${ns}-${ew} corner, where a ship gets trapped`
    if (ns || ew) return `it leads to the ${ns || ew} edge of the map`
    return 'it keeps you away from the edges'
}

/** How strong the ship is right now; power-ups add damage and survivability. */
function strengthWords(snap: PirateAutopilotSnapshot) {
    const boosts = snap.powerUps ? `${countWord(Math.min(snap.powerUps, 8))} power-up${snap.powerUps === 1 ? '' : 's'} adding damage and survivability` : 'no power-ups yet'
    return `Your ship: hull ${hullWords(snap.hull)}, ${boosts}.`
}

/** How far the ship can sail on a heading before the coast or an island, up to 320. */
export function pirateOpenWater(snap: PirateAutopilotSnapshot, heading: PirateAutopilotHeading) {
    const angle = pirateHeadingAngle(heading)
    let open = 0
    for (let step = 20; step <= 320; step += 20) {
        const x = snap.x + Math.cos(angle) * step
        const y = snap.y + Math.sin(angle) * step
        const blocked = x < 45 || y < 45 || x > PIRATE_AUTOPILOT_WORLD_W - 45 || y > PIRATE_AUTOPILOT_WORLD_H - 45
            || snap.islands.some(island => Math.hypot(island.x - x, island.y - y) < island.r + 26)
        if (blocked) break
        open = step
    }
    return open
}

/** A heading the ship can actually take: at least a short stretch of water before the coast or an island. */
export const PIRATE_AUTOPILOT_MIN_OPEN_WATER = 100

/** Water ahead on a heading: how far to the edge or an island, plus what sits there. */
function sectorState(snap: PirateAutopilotSnapshot, heading: PirateAutopilotHeading) {
    const angle = pirateHeadingAngle(heading)
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    const open = pirateOpenWater(snap, heading)
    const ahead = (p: PirateAutopilotPoint, reach: number) => {
        const d = dist(snap, p)
        if (d > reach || d < 1) return false
        return ((p.x - snap.x) * dx + (p.y - snap.y) * dy) / d > Math.cos(Math.PI / 5)
    }
    const parts = [
        open >= 300 ? 'open water for a long way' : 'a short stretch of water before the coast or an island',
        leadsWords(snap, dx, dy),
        groupWords(snap.enemies.filter(enemy => ahead(enemy, 480)), 'there')
    ]
    if (snap.hazards.some(hazard => ahead(hazard, 260))) parts.push('an incoming blast lands there')
    if (snap.mines.some(mine => ahead(mine, 220))) parts.push('a sea mine lies in your path and explodes if you touch it')
    return `Sailing ${heading}: ${parts.join('; ')}.`
}

const PICKUP_WORDS: Record<PirateAutopilotPickup, string> = {
    supply: 'supply drop with a power-up that adds damage or survivability',
    repair: 'repair kit',
    treasure: 'treasure chest'
}

/** Distance from p to the straight route between a and b. */
function routeDistance(a: PirateAutopilotPoint, b: PirateAutopilotPoint, p: PirateAutopilotPoint) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}

/** Mines and incoming blasts on the straight route to a target: an attack or pickup run sails right through them. */
function routeWords(snap: PirateAutopilotSnapshot, to: PirateAutopilotPoint) {
    const mines = snap.mines.filter(mine => routeDistance(snap, to, mine) < 60).length
    const blasts = snap.hazards.filter(hazard => routeDistance(snap, to, hazard) < hazard.r + 30).length
    const parts = [
        mines ? `${countWord(mines)} sea ${mines === 1 ? 'mine lies' : 'mines lie'} on the route there and ${mines === 1 ? 'explodes' : 'explode'} if you touch ${mines === 1 ? 'it' : 'them'}` : '',
        blasts ? `${countWord(blasts)} incoming ${blasts === 1 ? 'blast lands' : 'blasts land'} on the route` : ''
    ].filter(Boolean)
    return parts.length ? `${capitalise(parts.join('; '))}.` : 'The route there is clear of mines and blasts.'
}

function pickupState(snap: PirateAutopilotSnapshot, p: PirateAutopilotPoint, what: string) {
    const guards = snap.enemies.filter(enemy => dist(enemy, p) <= enemy.range)
    const mined = snap.mines.some(mine => dist(mine, p) < 90) || snap.hazards.some(hazard => dist(hazard, p) < hazard.r + 30)
    return [
        `Sailing to the ${what}, ${distanceWords(dist(snap, p))} to the ${pirateHeadingOf(p.x - snap.x, p.y - snap.y)}:`,
        `${groupWords(guards, 'can fire on it')}${mined ? '; a sea mine or blast sits next to it' : ''}.`,
        routeWords(snap, p),
        strengthWords(snap)
    ].join(' ')
}

function attackState(snap: PirateAutopilotSnapshot, enemy: PirateAutopilotEnemy) {
    const d = dist(snap, enemy)
    const escorts = snap.enemies.filter(other => other !== enemy && dist(other, enemy) < other.range)
    const health = enemy.hp < 0.35 ? 'nearly sunk' : enemy.hp < 0.75 ? 'damaged' : 'healthy'
    return [
        `Attacking ${roleWords(enemy.tier)} (${tierOf(enemy.tier).name}), ${health}, ${distanceWords(d)} to the ${pirateHeadingOf(enemy.x - snap.x, enemy.y - snap.y)}:`,
        d <= snap.range ? 'already inside your cannon range;' : 'you must close in to reach it;',
        `${groupWords(escorts, 'guards it')}.`,
        routeWords(snap, enemy),
        strengthWords(snap)
    ].join(' ')
}

function kegGroupWords(group: PirateKegGroup, snap: PirateAutopilotSnapshot) {
    return `${ships(group.ships)}${group.boss ? ' including the flagship boss' : ''}, ${distanceWords(dist(group, snap))} to the ${pirateHeadingOf(group.x - snap.x, group.y - snap.y)}`
}

// ─── Laya questions ─────────────────────────────────────────────────────────

export interface PirateLayaQuestion {
    type: 'noul'
    instructions: string
    /** Laya extension: this question's own state, in place of a shared one. */
    state: string
}

/**
 * One tick's decisions, every one a yes/no question with its own short
 * state. Wording was measured against the model: "Is sailing east safe?" over
 * a one-line description of that heading picked the open water in every test
 * (0.79 for open sea, 0.00 for the coast), while "the best move" wording, or
 * appending the ship's overall situation to each state, blurred every option
 * to about 0.9. Moves of every kind are asked as "is it safe", so their
 * answers compare on one scale and the highest one wins.
 *
 * Pickups not on the sea and a keg that isn't ready are left out, which keeps
 * the batch small.
 */
export function pirateLayaQuestions(snap: PirateAutopilotSnapshot): Record<string, PirateLayaQuestion> {
    const questions: Record<string, PirateLayaQuestion> = {}
    // A heading straight into the coast or an island isn't a move the ship can make, so it isn't offered.
    for (const heading of PIRATE_AUTOPILOT_HEADINGS) {
        if (pirateOpenWater(snap, heading) < PIRATE_AUTOPILOT_MIN_OPEN_WATER) continue
        questions[`sail_${heading}`] = { type: 'noul', instructions: `Is sailing ${heading} safe?`, state: sectorState(snap, heading) }
    }
    for (const pickup of PIRATE_AUTOPILOT_PICKUPS) {
        const p = snap[pickup]
        if (p) questions[`grab_${pickup}`] = { type: 'noul', instructions: `Is it safe to sail to the ${PICKUP_WORDS[pickup]} right now?`, state: pickupState(snap, p, PICKUP_WORDS[pickup]) }
    }
    for (const enemy of pirateAttackCandidates(snap)) {
        questions[`attack_${enemy.id}`] = { type: 'noul', instructions: `Is it safe to attack this ${tierOf(enemy.tier).name} now?`, state: attackState(snap, enemy) }
    }
    const groups = snap.keg ? pirateKegGroups(snap.enemies) : []
    if (groups.length) {
        questions.throw_keg = {
            type: 'noul',
            instructions: 'Is now a good moment to throw the powder keg?',
            state: `The keg blasts every ship near where it lands. The biggest group it could hit: ${kegGroupWords(groups[0]!, snap)}. ${situationWords(snap)}`
        }
    }
    // Asked per group rather than as one choice: as a choice Laya split its
    // answer 50/50 between three ships and one; asked this way it picked the
    // bigger group, or the boss, in every test.
    if (groups.length > 1) {
        groups.forEach((group, i) => {
            questions[`keg_${i}`] = { type: 'noul', instructions: 'Is this the best group of ships to hit with the powder keg?', state: `The keg would land on ${kegGroupWords(group, snap)}.` }
        })
    }
    return questions
}

// ─── Calibration ────────────────────────────────────────────────────────────
// Laya leans toward some words regardless of the facts: over identical open
// water it rated "west" 0.82 and "north-east" 0.78, so a ship left to it
// drifted west into the corner. Once per session every heading is asked over
// the same neutral description; each heading's lean from the average is then
// subtracted from its answers. This removes the model's bias, not its choice.

export function pirateLayaCalibrationQuestions(): Record<string, PirateLayaQuestion> {
    return Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(heading => [`sail_${heading}`, {
        type: 'noul' as const,
        instructions: `Is sailing ${heading} safe?`,
        state: `Sailing ${heading}: open water for a long way; it keeps you away from the edges; no enemy ship there.`
    }]))
}

/** Each heading's lean away from the average, keyed like the move questions. Null if Laya didn't answer all of them. */
export function pirateLayaBias(answers: Record<string, { noul?: number } | undefined>): Record<string, number> | null {
    const values = PIRATE_AUTOPILOT_HEADINGS.map(heading => answers[`sail_${heading}`]?.noul)
    if (values.some(value => typeof value !== 'number')) return null
    const mean = (values as number[]).reduce((sum, value) => sum + value, 0) / values.length
    return Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map((heading, i) => [`sail_${heading}`, values[i]! - mean]))
}

// ─── Answers ────────────────────────────────────────────────────────────────

interface LayaAnswer {
    type?: string
    noul?: number
}

function moveOf(key: string, snap: PirateAutopilotSnapshot): PirateAutopilotMove | null {
    const [kind, rest] = [key.slice(0, key.indexOf('_')), key.slice(key.indexOf('_') + 1)]
    if (kind === 'sail') {
        const heading = PIRATE_AUTOPILOT_HEADINGS.find(h => h === rest)
        return heading ? { kind: 'sail', heading } : null
    }
    if (kind === 'grab') {
        const pickup = PIRATE_AUTOPILOT_PICKUPS.find(p => p === rest)
        return pickup && snap[pickup] ? { kind: 'grab', pickup } : null
    }
    if (kind === 'attack') {
        const enemyId = Number(rest)
        return snap.enemies.some(enemy => enemy.id === enemyId) ? { kind: 'attack', enemyId } : null
    }
    return null
}

/** Read Laya's answers, with its word bias taken out: the highest-rated move, and the keg if Laya says throw. */
export function pirateLayaDecision(snap: PirateAutopilotSnapshot, answers: Record<string, LayaAnswer | undefined>, bias: Record<string, number> = {}): PirateLayaDecision {
    const moves: Record<string, number> = {}
    let best: string | null = null
    for (const [key, answer] of Object.entries(answers)) {
        if (typeof answer?.noul !== 'number' || !moveOf(key, snap)) continue
        moves[key] = answer.noul - (bias[key] ?? 0)
        if (best === null || moves[key]! > moves[best]!) best = key
    }
    let keg: PirateAutopilotPoint | null = null
    if ((answers.throw_keg?.noul ?? 0) > 0.5) {
        const groups = pirateKegGroups(snap.enemies)
        let group = groups.length === 1 ? groups[0] : undefined
        let bestGroup = -1
        groups.forEach((candidate, i) => {
            const rating = answers[`keg_${i}`]?.noul
            if (typeof rating === 'number' && rating > bestGroup) {
                bestGroup = rating
                group = candidate
            }
        })
        if (group) keg = { x: group.x, y: group.y }
    }
    return { move: best ? moveOf(best, snap) : null, moves, keg }
}
