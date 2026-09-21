import {
    shapezzRunUpgrade,
    type ShapezzRunUpgradeId,
    type ShapezzWeaponType
} from './shapezz'

// SHAPEZZ auto-play. Laya, running on the player's own machine
// (laya_server.py), makes the judgment calls; code on the client flies the
// cube. Two kinds of question:
//
// - Combat, several times a second: how much danger the cube is in, which
//   third of the arena is safe to stand in, whether a health orb is worth the
//   trip and which group of enemies to shoot first.
// - Checkpoint, once every 45 seconds: which of the three mutations to take.
//   Auto-play never cashes out; it fights on until the run ends.
//
// Every question carries its own short state (a Laya extension to the Jev
// wire format), so each one sees only the facts it judges and a whole tick
// stays well under Laya's 512-token cut-off. Advice only: nothing here grants
// or spends value.

/** Mirrors the engine's arena constants. */
export const SHAPEZZ_ARENA = {
    width: 1280,
    height: 720,
    floorY: 662,
    gravity: 1900
} as const

export type ShapezzAutopilotEnemyType = 'melee' | 'shooter' | 'tank' | 'dasher' | 'boss'

export interface ShapezzAutopilotEnemy {
    id: number
    type: ShapezzAutopilotEnemyType
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    /** Health left, 0-1. */
    hp: number
    damage: number
    speed: number
}

export interface ShapezzAutopilotBullet {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    damage: number
}

export interface ShapezzAutopilotPickup {
    x: number
    y: number
    kind: 'coin' | 'health'
    value: number
}

export interface ShapezzAutopilotPlatform {
    x: number
    y: number
    width: number
}

/** The arena as the auto-pilot sees it, in world coordinates. */
export interface ShapezzAutopilotView {
    elapsedMs: number
    checkpoint: number
    player: { x: number, y: number, vx: number, vy: number, size: number, onGround: boolean }
    hp: number
    maxHp: number
    shield: number
    moveSpeed: number
    jumpSpeed: number
    weapon: { type: ShapezzWeaponType, bulletSpeed: number, chainRange: number, explosionRadius: number }
    /** Panic Field stacks: hostile shots crawl near the cube. */
    bulletTime: number
    enemies: ShapezzAutopilotEnemy[]
    /** Hostile shots only. */
    bullets: ShapezzAutopilotBullet[]
    pickups: ShapezzAutopilotPickup[]
    /** Elevated platforms; the floor is SHAPEZZ_ARENA.floorY. */
    platforms: ShapezzAutopilotPlatform[]
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>>
}

export const SHAPEZZ_AUTOPILOT_ZONES = ['left', 'centre', 'right'] as const
export type ShapezzAutopilotZone = typeof SHAPEZZ_AUTOPILOT_ZONES[number]

export const SHAPEZZ_AUTOPILOT_TARGETS = ['rammers', 'gunners', 'tanks', 'boss'] as const
export type ShapezzAutopilotTarget = typeof SHAPEZZ_AUTOPILOT_TARGETS[number]

export interface ShapezzAutopilotAdvice {
    /** 0 (calm) to 1 (about to die). */
    danger: number
    /** How safe each third of the arena is, 0-1. Null when nobody judged it. */
    zones: Record<ShapezzAutopilotZone, number> | null
    grabHealth: number
    /** The enemy group to shoot first. Null to let the helm pick the closest threat. */
    focus: ShapezzAutopilotTarget | null
    focusConfidence: number
}

export function shapezzZoneOf(x: number): ShapezzAutopilotZone {
    return x < SHAPEZZ_ARENA.width / 3 ? 'left' : x < SHAPEZZ_ARENA.width * 2 / 3 ? 'centre' : 'right'
}

export function shapezzTargetOf(type: ShapezzAutopilotEnemyType): ShapezzAutopilotTarget {
    if (type === 'boss') return 'boss'
    if (type === 'tank') return 'tanks'
    if (type === 'shooter') return 'gunners'
    return 'rammers'
}

function dist(a: { x: number, y: number }, b: { x: number, y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Hostile shots that pass within `margin` of the cube in the next `horizon` seconds. */
export function shapezzIncomingShots(view: ShapezzAutopilotView, horizon = 0.5, margin = 30) {
    const p = view.player
    return view.bullets.filter((bullet) => {
        const rx = bullet.x - p.x
        const ry = bullet.y - p.y
        const speed2 = bullet.vx * bullet.vx + bullet.vy * bullet.vy
        const t = speed2 > 0 ? Math.max(0, Math.min(horizon, -(rx * bullet.vx + ry * bullet.vy) / speed2)) : 0
        return Math.hypot(rx + bullet.vx * t, ry + bullet.vy * t) < bullet.radius + p.size / 2 + margin
    })
}

// ─── Words ──────────────────────────────────────────────────────────────────
// Numbers become words and every count and distance is worked out here, so
// Laya only makes the judgments.

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function count(n: number, one: string, many: string) {
    return `${COUNT_WORDS[n] ?? 'many'} ${n === 1 ? one : many}`
}

function capitalise(text: string) {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function hullWords(fraction: number) {
    if (fraction > 0.85) return 'pristine'
    if (fraction > 0.6) return 'lightly damaged'
    if (fraction > 0.35) return 'damaged, about half left'
    if (fraction > 0.15) return 'badly damaged, under a third left'
    return 'nearly destroyed'
}

const TARGET_WORDS: Record<ShapezzAutopilotTarget, [string, string]> = {
    rammers: ['rammer', 'rammers'],
    gunners: ['gunner', 'gunners'],
    tanks: ['armoured tank', 'armoured tanks'],
    boss: ['boss', 'bosses']
}

function groupWords(enemies: ShapezzAutopilotEnemy[]) {
    if (!enemies.length) return 'no enemies'
    return SHAPEZZ_AUTOPILOT_TARGETS
        .map(target => [target, enemies.filter(enemy => shapezzTargetOf(enemy.type) === target).length] as const)
        .filter(([, n]) => n > 0)
        .map(([target, n]) => count(n, ...TARGET_WORDS[target]))
        .join(', ')
}

function hullFraction(view: ShapezzAutopilotView) {
    return view.hp / Math.max(1, view.maxHp)
}

function dangerState(view: ShapezzAutopilotView) {
    const striking = view.enemies.filter(enemy => enemy.type !== 'shooter' && dist(enemy, view.player) < enemy.radius + 110)
    const shots = shapezzIncomingShots(view).length
    const boss = view.enemies.find(enemy => enemy.type === 'boss')
    return [
        `Hull: ${hullWords(hullFraction(view))}.`,
        view.shield > 0 ? 'A shield soaks the next hits.' : '',
        striking.length ? `${capitalise(count(striking.length, 'enemy is', 'enemies are'))} close enough to ram you.` : 'Nothing is close enough to ram you.',
        shots ? `${capitalise(count(shots, 'enemy shot', 'enemy shots'))} will hit you within half a second.` : 'No enemy shot is about to hit you.',
        boss ? (dist(boss, view.player) < 330 ? 'The boss is right on top of you.' : 'A boss is in the arena.') : ''
    ].filter(Boolean).join(' ')
}

function zoneState(view: ShapezzAutopilotView, zone: ShapezzAutopilotZone) {
    const enemies = view.enemies.filter(enemy => shapezzZoneOf(enemy.x) === zone)
    const shots = view.bullets.filter(bullet => shapezzZoneOf(bullet.x) === zone).length
    const health = view.pickups.some(pickup => pickup.kind === 'health' && shapezzZoneOf(pickup.x) === zone)
    return [
        `The ${zone} of the arena: ${groupWords(enemies)}`,
        shots ? count(shots, 'enemy shot', 'enemy shots') + ' in the air' : 'no enemy shots',
        health ? 'a health orb lies here' : ''
    ].filter(Boolean).join('; ') + '.'
}

function healthState(view: ShapezzAutopilotView, orb: ShapezzAutopilotPickup) {
    const guards = view.enemies.filter(enemy => dist(enemy, orb) < 200)
    const d = dist(orb, view.player)
    return [
        `A health orb lies ${d < 200 ? 'very close' : d < 450 ? 'nearby' : 'across the arena'}.`,
        guards.length ? `${capitalise(groupWords(guards))} ${guards.length === 1 ? 'is' : 'are'} next to it.` : 'No enemy is near it.',
        `Hull: ${hullWords(hullFraction(view))}.`
    ].join(' ')
}

function focusCriteria(view: ShapezzAutopilotView) {
    const criteria: Partial<Record<ShapezzAutopilotTarget, string>> = {}
    for (const target of SHAPEZZ_AUTOPILOT_TARGETS) {
        const group = view.enemies.filter(enemy => shapezzTargetOf(enemy.type) === target)
        if (!group.length) continue
        const nearest = Math.min(...group.map(enemy => dist(enemy, view.player)))
        const weakest = Math.min(...group.map(enemy => enemy.hp))
        const what = {
            rammers: 'fast shapes that crash into you',
            gunners: 'shapes that shoot from range',
            tanks: 'slow, heavily armoured shapes that hit hard',
            boss: 'the boss, which fires rings of shots'
        }[target]
        criteria[target] = `${count(group.length, ...TARGET_WORDS[target])}, ${what}; the nearest is ${nearest < 180 ? 'very close' : nearest < 400 ? 'close' : 'far away'}${weakest < 0.35 ? ', one nearly dead' : ''}`
    }
    return criteria
}

// ─── Laya questions ─────────────────────────────────────────────────────────

export interface ShapezzLayaQuestion {
    type: 'noul' | 'choice'
    instructions: string
    criteria?: Record<string, string>
    /** Laya extension: this question's own state, in place of a shared one. */
    state: string
}

/**
 * The combat judgments for one tick. The health question only appears when an
 * orb is on the floor and the hull could use it, and the focus question only
 * when there is more than one kind of enemy to choose between.
 */
export function shapezzLayaCombatQuestions(view: ShapezzAutopilotView): Record<string, ShapezzLayaQuestion> {
    const questions: Record<string, ShapezzLayaQuestion> = {
        danger: { type: 'noul', instructions: 'Is the player in serious danger right now?', state: dangerState(view) }
    }
    for (const zone of SHAPEZZ_AUTOPILOT_ZONES) {
        questions[`zone_${zone}`] = { type: 'noul', instructions: `Is the ${zone} of the arena safe to stand in?`, state: zoneState(view, zone) }
    }
    const orb = view.pickups
        .filter(pickup => pickup.kind === 'health')
        .sort((a, b) => dist(a, view.player) - dist(b, view.player))[0]
    if (orb && hullFraction(view) < 0.8) {
        questions.grab_health = { type: 'noul', instructions: 'Is it worth going for the health orb now?', state: healthState(view, orb) }
    }
    const criteria = focusCriteria(view)
    if (Object.keys(criteria).length > 1) {
        questions.focus = {
            type: 'choice',
            instructions: 'Which enemies should the player shoot first to stay alive?',
            criteria: criteria as Record<string, string>,
            state: `Hull: ${hullWords(hullFraction(view))}.`
        }
    }
    return questions
}

interface LayaAnswer {
    type?: string
    noul?: number
    choice?: string
    confidence?: number
    probabilities?: Record<string, number>
}

function noul(answer: LayaAnswer | undefined) {
    return typeof answer?.noul === 'number' ? Math.min(1, Math.max(0, answer.noul)) : 0
}

export function shapezzLayaCombatAdvice(answers: Record<string, LayaAnswer | undefined>): ShapezzAutopilotAdvice {
    const zones = Object.fromEntries(SHAPEZZ_AUTOPILOT_ZONES.map(zone => [zone, noul(answers[`zone_${zone}`])])) as Record<ShapezzAutopilotZone, number>
    const focus = SHAPEZZ_AUTOPILOT_TARGETS.find(target => target === answers.focus?.choice) ?? null
    return {
        danger: noul(answers.danger),
        zones,
        grabHealth: noul(answers.grab_health),
        focus,
        focusConfidence: focus ? Math.min(1, Math.max(0, answers.focus?.probabilities?.[focus] ?? 0)) : 0
    }
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────
// Auto-play never cashes out: it takes a mutation at every checkpoint and
// fights on until the run ends.

export interface ShapezzCheckpointContext {
    offers: ShapezzRunUpgradeId[]
    upgrades: Partial<Record<ShapezzRunUpgradeId, number>>
    weapon: ShapezzWeaponType
    /** Hull left, 0-1. */
    hull: number
    /** Hull and shield lost during the round that just ended, as a share of max hull. */
    damageTaken: number
}

const WEAPON_WORDS: Record<ShapezzWeaponType, string> = {
    blaster: 'Pulse Carbine, fast precise single shots',
    launcher: 'Nova Mortar, slow shells with a wide blast',
    shotgun: 'Scatter Array, a close-range spread of pellets',
    arcCoil: 'Arc Coil, short-range lightning that leaps between enemies'
}

function buildWords(upgrades: Partial<Record<ShapezzRunUpgradeId, number>>) {
    const owned = Object.entries(upgrades).filter(([, n]) => (n ?? 0) > 0)
    if (!owned.length) return 'none yet'
    return owned.map(([id, n]) => `${shapezzRunUpgrade(id as ShapezzRunUpgradeId).name}${n! > 1 ? ` x${n}` : ''}`).join(', ')
}

function roundCostWords(damageTaken: number) {
    if (damageTaken < 0.1) return 'barely scratched you'
    if (damageTaken < 0.3) return 'cost a little hull'
    if (damageTaken < 0.6) return 'cost about half your hull'
    if (damageTaken < 1) return 'nearly killed you'
    return 'cost more than a full hull'
}

export function shapezzLayaCheckpointQuestions(ctx: ShapezzCheckpointContext): Record<string, ShapezzLayaQuestion> {
    return {
        upgrade: {
            type: 'choice',
            instructions: 'Which mutation will help this build kill faster and survive the next round?',
            criteria: Object.fromEntries(ctx.offers.map((id) => {
                const upgrade = shapezzRunUpgrade(id)
                const stacks = ctx.upgrades[id] ?? 0
                return [id, `${upgrade.name}: ${upgrade.description}${stacks ? ` You already have ${stacks}.` : ''}`]
            })),
            state: `Weapon: ${WEAPON_WORDS[ctx.weapon]}. Hull: ${hullWords(ctx.hull)}. The last round ${roundCostWords(ctx.damageTaken)}. Mutations so far: ${buildWords(ctx.upgrades)}.`
        }
    }
}

// Laya's pick is blended with how much each mutation is worth to the build
// rather than trusted outright: measured on these offers it often splits its
// probability almost evenly, and once picked a mutation that never triggers
// on the equipped weapon.

const UPGRADE_VALUE: Record<ShapezzRunUpgradeId, number> = {
    twinFang: 0.7, splitstorm: 0.6, railPierce: 0.6, ricochet: 0.55, explosive: 0.75, chainLightning: 0.7,
    orbitals: 0.8, droneSwarm: 0.75, blackHole: 0.55, bulletTime: 0.5, giantRounds: 0.65, vampireBurst: 0.5,
    // The helm rarely jumps on purpose, so turrets dropped by jumps seldom appear.
    afterimage: 0.3, deathNova: 0.6, frenzy: 0.55, hyperVelocity: 0.45, killShockwave: 0.55, executioner: 0.6,
    overkillDividend: 0.45, ceilingBattery: 0.8, aegisPlating: 0.5
}

const DEFENSIVE = new Set<ShapezzRunUpgradeId>(['vampireBurst', 'aegisPlating', 'bulletTime'])

/** How much a mutation is worth to this build, 0-1, before Laya's opinion. */
export function shapezzUpgradeValue(id: ShapezzRunUpgradeId, ctx: Omit<ShapezzCheckpointContext, 'offers'>) {
    let value = UPGRADE_VALUE[id]
    if (ctx.weapon === 'arcCoil') {
        // The coil never fires a projectile volley, so singularities never trigger and speed barely matters.
        if (id === 'blackHole') value = 0.05
        if (id === 'hyperVelocity') value = 0.3
        if (id === 'twinFang' && (ctx.upgrades.twinFang ?? 0) >= 2) value = 0.2
    }
    if (ctx.weapon === 'launcher' && (id === 'explosive' || id === 'twinFang')) value -= 0.2
    if (ctx.weapon === 'shotgun' && id === 'twinFang' && (ctx.upgrades.twinFang ?? 0) >= 3) value = 0.2
    // A run that never cashes out lives or dies on sustain, so hurt builds lean hard on it.
    if (DEFENSIVE.has(id)) value += 0.4 * Math.min(1, Math.max(ctx.damageTaken, 1 - ctx.hull))
    // Most mutations stop scaling after three or four stacks.
    value *= Math.pow(0.8, ctx.upgrades[id] ?? 0)
    return Math.min(1, Math.max(0, value))
}

export interface ShapezzCheckpointDecision {
    upgrade: ShapezzRunUpgradeId
    /** True when Laya answered; false when this is the build values alone. */
    laya: boolean
}

/** Share of each mutation pick that comes from Laya. */
export const SHAPEZZ_LAYA_CHECKPOINT_WEIGHT = 0.4

export function shapezzCheckpointDecision(ctx: ShapezzCheckpointContext, answers: Record<string, LayaAnswer | undefined> | null): ShapezzCheckpointDecision {
    const w = answers ? SHAPEZZ_LAYA_CHECKPOINT_WEIGHT : 0
    const probabilities = answers?.upgrade?.probabilities ?? {}
    let upgrade = ctx.offers[0]!
    let best = -Infinity
    for (const id of ctx.offers) {
        // Laya's probabilities split across three options; scale them back to 0-1.
        const score = shapezzUpgradeValue(id, ctx) * (1 - w) + Math.min(1, (probabilities[id] ?? 0) * ctx.offers.length / 2) * w
        if (score > best) {
            best = score
            upgrade = id
        }
    }
    return { upgrade, laya: !!answers }
}
