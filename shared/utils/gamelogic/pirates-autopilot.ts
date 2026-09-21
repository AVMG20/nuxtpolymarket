import { PIRATE_ENEMY_TIERS, PIRATE_RUN_DURATION_MS } from './pirates'

// Pirate Raid auto-play. Several times a second the browser describes the sea
// to Laya, a decision model the player runs on their own machine
// (laya_server.py), and asks it a handful of snap judgments: how dangerous is
// it, which headings are open water, is each pickup safe, is the keg worth
// throwing. Code on the client turns those answers into movement. Advice only:
// nothing here grants or spends value.
//
// Laya reads a question's state once per question and cuts it off at 512
// tokens, so every question carries its own short state with only the facts
// it judges. That keeps a whole tick at roughly 100-170 ms on an Apple GPU
// and stops the tail of one long description from being silently dropped.

export const PIRATE_AUTOPILOT_WORLD_W = 1400
export const PIRATE_AUTOPILOT_WORLD_H = 820
/** Mirrors PLAYER_BOMB_RADIUS in the engine. */
export const PIRATE_AUTOPILOT_KEG_RADIUS = 145

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
    /** The heading with the most open water, for display. */
    heading: PirateAutopilotHeading | null
    headingConfidence: number
    /** How safe sailing each heading is, 0-1. Null when nobody judged it. */
    openWater: Record<PirateAutopilotHeading, number> | null
    grabSupply: number
    grabRepair: number
    grabTreasure: number
    throwKeg: number
}

// ─── Geometry shared by the questions and the client's pilot ────────────────

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

// ─── Words ──────────────────────────────────────────────────────────────────
// Numbers become words and every count, distance and comparison is done here,
// so Laya only makes the judgments.

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

/** "three enemy ships can hit you, one of them a heavy warship" style summary of a group. */
function groupWords(enemies: PirateAutopilotEnemy[], verb: string) {
    if (!enemies.length) return `no enemy ship ${verb}`
    const heavy = enemies.filter(enemy => isHeavy(enemy.tier)).length
    const detail = enemies.some(enemy => tierOf(enemy.tier).boss)
        ? ', including the flagship boss'
        : heavy ? `, ${countWord(heavy)} of them ${heavy === 1 ? 'a heavy warship' : 'heavy warships'}` : ''
    return `${ships(enemies.length)} ${verb}${detail}`
}

function dangerState(snap: PirateAutopilotSnapshot) {
    const standingUnder = snap.hazards.some(hazard => dist(hazard, snap) <= hazard.r + 20)
    return [
        `Hull: ${hullWords(snap.hull)}.`,
        snap.shield > 0 ? 'A shield absorbs the next hits.' : '',
        `${capitalise(groupWords(pirateEnemiesInReach(snap.enemies, snap), 'can hit you'))}.`,
        standingUnder ? 'A cannon blast is about to land on you.' : 'Nothing is about to land on you.',
        PIRATE_RUN_DURATION_MS - snap.t < 60_000 ? 'It is the final minute of the voyage.' : ''
    ].filter(Boolean).join(' ')
}

/** Water ahead on a heading: how far to the edge or an island, plus what sits there. */
function sectorState(snap: PirateAutopilotSnapshot, heading: PirateAutopilotHeading) {
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
        return ((p.x - snap.x) * dx + (p.y - snap.y) * dy) / d > Math.cos(Math.PI / 5)
    }
    const parts = [
        open >= 300 ? 'open water for a long way' : open >= 140 ? 'some open water' : 'blocked by the coast or an island almost at once',
        groupWords(snap.enemies.filter(enemy => ahead(enemy, 480)), 'there')
    ]
    if (snap.hazards.some(hazard => ahead(hazard, 260))) parts.push('an incoming blast lands there')
    if (snap.mines.some(mine => ahead(mine, 220))) parts.push('a sea mine in the way')
    return `Sailing ${heading}: ${parts.join('; ')}.`
}

function pickupState(snap: PirateAutopilotSnapshot, p: PirateAutopilotPoint, what: string) {
    const guards = snap.enemies.filter(enemy => dist(enemy, p) <= enemy.range)
    const mined = snap.mines.some(mine => dist(mine, p) < 90) || snap.hazards.some(hazard => dist(hazard, p) < hazard.r + 30)
    return [
        `The ${what} is ${distanceWords(dist(snap, p))} to the ${pirateHeadingOf(p.x - snap.x, p.y - snap.y)}.`,
        `${capitalise(groupWords(guards, 'can fire on it'))}.`,
        mined ? 'A sea mine or blast sits next to it.' : 'No mine or blast near it.'
    ].join(' ')
}

// ─── Laya questions ─────────────────────────────────────────────────────────

export interface PirateLayaQuestion {
    type: 'noul'
    instructions: string
    /** Laya extension: this question's own state, in place of a shared one. */
    state: string
}

const PICKUPS = [
    ['supply', 'supply drop'],
    ['repair', 'repair kit'],
    ['treasure', 'treasure chest']
] as const

/**
 * Every judgment for one tick, each with only the facts it needs. Pickups that
 * aren't on the sea and a keg that isn't ready or has nothing worth hitting
 * are left out, which keeps the batch small. Headings are eight separate
 * yes/no questions rather than one eight-way choice: measured on Laya, the
 * yes/no form ranks open water first and blocked coast near zero, while the
 * choice form spread its probability almost evenly.
 */
export function pirateLayaQuestions(snap: PirateAutopilotSnapshot): Record<string, PirateLayaQuestion> {
    const questions: Record<string, PirateLayaQuestion> = {
        danger: { type: 'noul', instructions: 'Is the ship in serious danger right now?', state: dangerState(snap) }
    }
    for (const heading of PIRATE_AUTOPILOT_HEADINGS) {
        questions[`sail_${heading}`] = { type: 'noul', instructions: `Is sailing ${heading} safe?`, state: sectorState(snap, heading) }
    }
    for (const [key, what] of PICKUPS) {
        const p = snap[key]
        if (p) questions[`grab_${key}`] = { type: 'noul', instructions: `Is it safe to sail to the ${what} right now?`, state: pickupState(snap, p, what) }
    }
    const keg = snap.keg ? pirateKegTarget(snap.enemies) : null
    if (keg && (keg.ships >= 2 || keg.boss)) {
        questions.throw_keg = {
            type: 'noul',
            instructions: 'Is now a good moment to throw the powder keg?',
            state: `The best throw catches ${ships(keg.ships)}${keg.boss ? ', including the flagship boss' : ''}. Hull: ${hullWords(snap.hull)}.`
        }
    }
    return questions
}

// ─── Answers ────────────────────────────────────────────────────────────────

interface LayaAnswer {
    type?: string
    noul?: number
}

function noul(answer: LayaAnswer | undefined) {
    return typeof answer?.noul === 'number' ? Math.min(1, Math.max(0, answer.noul)) : 0
}

export function pirateLayaAdvice(answers: Record<string, LayaAnswer | undefined>): PirateAutopilotAdvice {
    const openWater = Object.fromEntries(PIRATE_AUTOPILOT_HEADINGS.map(h => [h, noul(answers[`sail_${h}`])])) as Record<PirateAutopilotHeading, number>
    const best = PIRATE_AUTOPILOT_HEADINGS.reduce((a, b) => openWater[b] > openWater[a] ? b : a)
    return {
        danger: noul(answers.danger),
        heading: openWater[best] > 0 ? best : null,
        headingConfidence: openWater[best],
        openWater,
        grabSupply: noul(answers.grab_supply),
        grabRepair: noul(answers.grab_repair),
        grabTreasure: noul(answers.grab_treasure),
        throwKeg: noul(answers.throw_keg)
    }
}
