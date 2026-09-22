import {
    shapezzRunUpgrade,
    type ShapezzEnemyType,
    type ShapezzRunUpgradeId,
    type ShapezzWeaponType
} from './shapezz'

// SHAPEZZ auto-play, played by Laya: a decision model the player runs on their
// own machine (laya_server.py). Laya makes every decision:
//
// - Several times a second: which move to make (run left, run right, hold,
//   jump, drop through a platform) and which enemy to shoot.
// - At every checkpoint: which of the three mutations to take. Auto-play never
//   cashes out; it fights on until the run ends.
//
// Code only describes the arena in words and carries out what Laya picked:
// pressing the chosen key and aiming at the chosen enemy. There is no fallback
// player. Without an answer from Laya the cube stands still and holds fire.
//
// Every question carries its own short state (a Laya extension to the Jev wire
// format), so each one sees only the facts it judges. Nothing here grants or
// spends value.

/** Mirrors the engine's arena constants. */
export const SHAPEZZ_ARENA = {
    width: 1280,
    height: 720,
    floorY: 662,
    gravity: 1900
} as const

export type ShapezzAutopilotEnemyType = ShapezzEnemyType

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

export const SHAPEZZ_AUTOPILOT_ACTIONS = ['left', 'right', 'hold', 'jump', 'drop'] as const
export type ShapezzAutopilotAction = typeof SHAPEZZ_AUTOPILOT_ACTIONS[number]

/** What Laya decided on one tick. */
export interface ShapezzLayaDecision {
    /** The move Laya rated best; null when it wasn't asked. */
    action: ShapezzAutopilotAction | null
    /** Laya's rating of every move it was asked about, 0-1. */
    actions: Partial<Record<ShapezzAutopilotAction, number>>
    /** The enemy Laya chose to shoot; null when there is nothing to shoot. */
    targetId: number | null
}

/** Maximum enemies offered as targets in one question. */
export const SHAPEZZ_AUTOPILOT_MAX_TARGETS = 4

function dist(a: { x: number, y: number }, b: { x: number, y: number }) {
    return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Enemies that are on screen and can be shot, nearest first. */
export function shapezzVisibleEnemies(view: ShapezzAutopilotView) {
    return view.enemies
        .filter(enemy => enemy.x >= 0 && enemy.x <= SHAPEZZ_ARENA.width)
        .sort((a, b) => dist(a, view.player) - dist(b, view.player))
}

/** The platform the cube stands on, if it isn't on the floor. */
export function shapezzStandingPlatform(view: ShapezzAutopilotView) {
    if (!view.player.onGround) return null
    const feet = view.player.y + view.player.size / 2
    return view.platforms.find(platform => Math.abs(feet - platform.y) <= 4
        && view.player.x > platform.x && view.player.x < platform.x + platform.width) ?? null
}

// ─── Words ──────────────────────────────────────────────────────────────────
// The arena is turned into plain facts: what is where, how close, and which
// shots are coming. Nothing here rates a move; Laya does that.

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function count(n: number, one: string, many: string) {
    return `${COUNT_WORDS[n] ?? 'many'} ${n === 1 ? one : many}`
}

function hullWords(fraction: number) {
    if (fraction > 0.85) return 'pristine'
    if (fraction > 0.6) return 'lightly damaged'
    if (fraction > 0.35) return 'damaged, about half left'
    if (fraction > 0.15) return 'badly damaged, under a third left'
    return 'nearly destroyed'
}

function distanceWords(d: number) {
    if (d < 130) return 'very close'
    if (d < 300) return 'close'
    if (d < 550) return 'at mid range'
    return 'far away'
}

/** Hostile shots heading for the cube: which side they come from and whether they fly low. */
function incomingShots(view: ShapezzAutopilotView) {
    const p = view.player
    return view.bullets.flatMap((bullet) => {
        const rx = bullet.x - p.x
        const ry = bullet.y - p.y
        const speed2 = bullet.vx * bullet.vx + bullet.vy * bullet.vy
        if (!speed2) return []
        const t = -(rx * bullet.vx + ry * bullet.vy) / speed2
        if (t < 0 || t > 0.8) return []
        const miss = Math.hypot(rx + bullet.vx * t, ry + bullet.vy * t)
        if (miss > bullet.radius + p.size / 2 + 20) return []
        return [{ side: rx < 0 ? 'left' : 'right', low: Math.abs(bullet.vy) < Math.abs(bullet.vx) * 0.5 }]
    })
}

/** Hull, plus how built up the cube is: mutations add damage and survivability, which ones doesn't matter here. */
function strengthWords(view: ShapezzAutopilotView) {
    const mutations = Object.values(view.upgrades).reduce((sum, n) => sum + (n ?? 0), 0)
    const build = mutations ? `; ${count(Math.min(mutations, 8), 'mutation adds', 'mutations add')} damage and survivability` : ''
    return `Hull: ${hullWords(view.hp / Math.max(1, view.maxHp))}${build}.`
}

function actionState(view: ShapezzAutopilotView, action: ShapezzAutopilotAction) {
    const p = view.player
    const hull = strengthWords(view)
    const shots = incomingShots(view)
    const rammers = view.enemies.filter(enemy => enemy.type !== 'shooter' && enemy.type !== 'sniper' && enemy.type !== 'warden')
    const nearest = rammers.reduce<ShapezzAutopilotEnemy | null>((best, enemy) => !best || dist(enemy, p) < dist(best, p) ? enemy : best, null)
    if (action === 'left' || action === 'right') {
        const sign = action === 'left' ? -1 : 1
        const toward = rammers.filter(enemy => Math.sign(enemy.x - p.x) === sign && Math.abs(enemy.x - p.x) < 500)
        const fromThere = shots.filter(shot => shot.side === action).length
        const room = action === 'left' ? p.x : SHAPEZZ_ARENA.width - p.x
        const orb = view.pickups.some(pickup => pickup.kind === 'health' && Math.sign(pickup.x - p.x) === sign)
        return [
            room < 120
                ? `Running ${action} slams you into the wall, where new enemies spawn`
                : toward.length
                    ? `Running ${action} takes you toward ${count(toward.length, 'rammer', 'rammers')}, the nearest ${distanceWords(Math.min(...toward.map(enemy => dist(enemy, p))))}`
                    : `Running ${action} takes you away from every rammer${nearest ? `, including the nearest, ${distanceWords(dist(nearest, p))}` : ''}`,
            fromThere ? `into ${count(fromThere, 'incoming shot', 'incoming shots')}` : '',
            orb ? 'toward a health orb' : ''
        ].filter(Boolean).join(', ') + `. ${hull}`
    }
    if (action === 'hold') {
        const closing = rammers.filter(enemy => dist(enemy, p) < 220).length
        return [
            closing ? `Standing still lets ${count(closing, 'rammer', 'rammers')} reach you` : 'Standing still, no rammer is close enough to reach you',
            shots.length ? `and ${count(shots.length, 'incoming shot hits', 'incoming shots hit')} you` : 'and no shot is coming at you'
        ].join(' ') + `. ${hull}`
    }
    if (action === 'jump') {
        const low = shots.filter(shot => shot.low).length
        const high = shots.length - low
        const above = view.enemies.filter(enemy => enemy.y < p.y - 60 && Math.abs(enemy.x - p.x) < 200).length
        return [
            low ? `Jumping lifts you over ${count(low, 'low shot', 'low shots')}` : 'Jumping dodges no shots',
            high ? `but not over ${count(high, 'high shot', 'high shots')}` : '',
            above ? `and brings you up to ${count(above, 'enemy', 'enemies')} overhead` : '',
            nearest && dist(nearest, p) < 220 ? 'and you land where the nearest rammer is heading' : ''
        ].filter(Boolean).join(' ') + `. ${hull}`
    }
    const below = view.enemies.filter(enemy => enemy.y > p.y + 40 && Math.abs(enemy.x - p.x) < 250).length
    const above = view.enemies.filter(enemy => enemy.y < p.y && Math.abs(enemy.x - p.x) < 250).length
    return [
        below ? `Dropping down a level lands you among ${count(below, 'enemy', 'enemies')}` : 'Dropping down a level lands you on clear ground',
        above ? `and away from ${count(above, 'enemy', 'enemies')} up here` : ''
    ].filter(Boolean).join(' ') + `. ${hull}`
}

function targetWords(enemy: ShapezzAutopilotEnemy, view: ShapezzAutopilotView) {
    const role = {
        melee: 'a rammer that crashes into you',
        dasher: 'a fast rammer that lunges at you',
        tank: 'a slow armoured tank that hits hard',
        shooter: 'a gunner that shoots from range',
        splitter: 'a splitter that bursts into three fast shards when killed',
        shard: 'a small fast shard that rams you',
        bomber: 'a bomber that explodes next to you; killing it first blows up its neighbours',
        sniper: 'a sniper that aims a laser and fires one fast shot',
        warden: 'a warden that halves the damage its neighbours take; kill it first',
        boss: 'the boss, which fires rings of shots'
    }[enemy.type]
    const side = enemy.x < view.player.x ? 'to the left' : 'to the right'
    const health = enemy.hp < 0.35 ? ', nearly dead' : enemy.hp < 0.75 ? ', damaged' : ''
    return `${role}, ${distanceWords(dist(enemy, view.player))} ${side}${health}`
}

// ─── Laya questions ─────────────────────────────────────────────────────────

export interface ShapezzLayaQuestion {
    type: 'noul' | 'choice'
    instructions: string
    criteria?: Record<string, string>
    /** Laya extension: this question's own state, in place of a shared one. */
    state: string
}

/** The moves open to the cube right now: jumps and drops need solid footing. */
export function shapezzAvailableActions(view: ShapezzAutopilotView): ShapezzAutopilotAction[] {
    if (!view.player.onGround) return ['left', 'right', 'hold']
    return shapezzStandingPlatform(view) ? ['left', 'right', 'hold', 'jump', 'drop'] : ['left', 'right', 'hold', 'jump']
}

/**
 * One tick's decisions. Each move is its own yes/no question: measured on the
 * pirate headings, Laya ranks separate yes/no questions far better than one
 * many-way choice. The target is a choice among the nearest enemies, asked
 * only when there is more than one to choose from.
 */
export function shapezzLayaQuestions(view: ShapezzAutopilotView): Record<string, ShapezzLayaQuestion> {
    const questions: Record<string, ShapezzLayaQuestion> = {}
    for (const action of shapezzAvailableActions(view)) {
        const move = { left: 'running left', right: 'running right', hold: 'standing still', jump: 'jumping', drop: 'dropping down a level' }[action]
        questions[`move_${action}`] = { type: 'noul', instructions: `Is ${move} the best move right now to avoid getting hit?`, state: actionState(view, action) }
    }
    const targets = shapezzVisibleEnemies(view).slice(0, SHAPEZZ_AUTOPILOT_MAX_TARGETS)
    if (targets.length > 1) {
        questions.target = {
            type: 'choice',
            instructions: 'Which enemy should the player shoot first to stay alive?',
            criteria: Object.fromEntries(targets.map(enemy => [`e${enemy.id}`, targetWords(enemy, view)])),
            state: strengthWords(view)
        }
    }
    return questions
}

interface LayaAnswer {
    type?: string
    noul?: number
    choice?: string
    probabilities?: Record<string, number>
}

// Laya leans toward some words regardless of the facts (at sea it favoured
// "west" over identical water, and here it favoured "left"). Once per session
// left and right are asked over the same neutral description, and each one's
// lean from their average is subtracted from its answers. This removes the
// model's bias, not its choice.

export function shapezzLayaCalibrationQuestions(): Record<string, ShapezzLayaQuestion> {
    return Object.fromEntries((['left', 'right'] as const).map(side => [`move_${side}`, {
        type: 'noul' as const,
        instructions: `Is running ${side} the best move right now to avoid getting hit?`,
        state: `Running ${side} takes you away from every rammer. Hull: pristine.`
    }]))
}

/** Left and right's lean away from their average, keyed like the move questions. Null if Laya didn't answer both. */
export function shapezzLayaBias(answers: Record<string, LayaAnswer | undefined>): Record<string, number> | null {
    const left = answers.move_left?.noul
    const right = answers.move_right?.noul
    if (typeof left !== 'number' || typeof right !== 'number') return null
    const mean = (left + right) / 2
    return { move_left: left - mean, move_right: right - mean }
}

/**
 * Read Laya's answers, with its word bias taken out. With a single enemy on
 * screen there is no choice to make: it is the target.
 */
export function shapezzLayaDecision(view: ShapezzAutopilotView, answers: Record<string, LayaAnswer | undefined>, bias: Record<string, number> = {}): ShapezzLayaDecision {
    const actions: Partial<Record<ShapezzAutopilotAction, number>> = {}
    let action: ShapezzAutopilotAction | null = null
    for (const candidate of SHAPEZZ_AUTOPILOT_ACTIONS) {
        const raw = answers[`move_${candidate}`]?.noul
        if (typeof raw !== 'number') continue
        const value = raw - (bias[`move_${candidate}`] ?? 0)
        actions[candidate] = value
        if (action === null || value > actions[action]!) action = candidate
    }
    const visible = shapezzVisibleEnemies(view)
    const chosen = answers.target?.choice?.startsWith('e') ? Number(answers.target.choice.slice(1)) : null
    const targetId = visible.length === 1
        ? visible[0]!.id
        : visible.some(enemy => enemy.id === chosen) ? chosen : null
    return { action, actions, targetId }
}

// ─── Checkpoint ─────────────────────────────────────────────────────────────

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
    shotgun: 'Scatter Array, micro-missiles that curve onto enemies near where you aim',
    arcCoil: 'Arc Coil, short-range lightning that leaps between enemies; it fires no projectiles',
    railgun: 'Rail Driver, a slow hitscan slug that pierces every enemy on the line; line enemies up'
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

/** Laya's pick among the offers, or null if it didn't answer with one of them. */
export function shapezzLayaUpgrade(offers: ShapezzRunUpgradeId[], answers: Record<string, LayaAnswer | undefined>): ShapezzRunUpgradeId | null {
    const choice = answers.upgrade?.choice
    return offers.find(id => id === choice) ?? null
}
