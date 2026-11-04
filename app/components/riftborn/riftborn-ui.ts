import { riftbornBaseEffects } from '#shared/utils/gamelogic/riftborn'
import type { RiftbornClassId, RiftbornMetaEffects, RiftbornRunReport, RiftbornSkillRanks } from '#shared/utils/gamelogic/riftborn'
import type { Rarity } from './engine/types'

export interface RiftbornProgress {
    xp: number
    level: number
    xpIntoLevel: number
    /** null at the max level */
    xpForNext: number | null
    /** Total earned; available = skillPoints - pointsSpent */
    skillPoints: number
    pointsSpent: number
    skills: RiftbornSkillRanks
    effects: RiftbornMetaEffects
    achievements: string[]
    unlockedClasses: string[]
}

export interface RiftbornLifetimeStats {
    runsPlayed: number
    victories: number
    bestTime: number
    bestKills: number
    bestLevel: number
    totalKills: number
}

export interface RiftbornState extends RiftbornProgress {
    stats: RiftbornLifetimeStats
    activeRun: { runId: string, classId: string, startedAt: string } | null
}

export interface RiftbornStartResponse {
    runId: string
    classId: RiftbornClassId
    startedAt: string
    effects: RiftbornMetaEffects
}

export interface RiftbornNewAchievement {
    id: string
    name: string
    description: string
    icon: string
    points: number
    unlocks: RiftbornClassId | null
}

export interface RiftbornFinishResponse {
    report: RiftbornRunReport
    xpGained: number
    levelBefore: number
    progress: RiftbornProgress
    newAchievements: RiftbornNewAchievement[]
    newBest: { time: boolean, kills: boolean }
}

export type RiftbornSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export const RARITY: Record<Rarity, { label: string, color: string, glow: string }> = {
    common: { label: 'Common', color: '#b8c2d6', glow: 'rgba(184, 194, 214, 0.35)' },
    rare: { label: 'Rare', color: '#45a8ff', glow: 'rgba(69, 168, 255, 0.5)' },
    epic: { label: 'Epic', color: '#c05cff', glow: 'rgba(192, 92, 255, 0.55)' },
    legendary: { label: 'Legendary', color: '#ffb627', glow: 'rgba(255, 182, 39, 0.65)' }
}

export function hex(color: number): string {
    return `#${(color >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
}

/** Keyboard shortcuts must never fire while the player is typing anywhere. */
export function isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el || typeof el.tagName !== 'string') return false
    if (el.isContentEditable) return true
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

export function formatClock(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 'chainLightning' -> 'Chain Lightning' */
export function humanize(id: string): string {
    return id
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
}

const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
const num = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100) / 100}`

/** Human lines for everything the tree changes from a bare run. */
export function riftbornEffectLines(effects: RiftbornMetaEffects): { label: string, value: string, keystone?: boolean }[] {
    const base = riftbornBaseEffects()
    const lines: { label: string, value: string, keystone?: boolean }[] = []
    const d = (key: keyof RiftbornMetaEffects) => (effects[key] as number) - (base[key] as number)
    const add = (key: keyof RiftbornMetaEffects, label: string, value: (delta: number) => string) => {
        const delta = d(key)
        if (Math.abs(delta) > 1e-9) lines.push({ label, value: value(delta) })
    }
    add('damageMul', 'Damage', pct)
    add('hpMul', 'Max HP', pct)
    add('critChance', 'Crit chance', pct)
    add('critDamage', 'Crit damage', pct)
    add('projectiles', 'Projectiles', num)
    add('cooldownMul', 'Cooldowns', v => pct(v))
    add('comboHaste', 'Cooldowns at 50+ combo', v => pct(-v))
    add('armor', 'Armor', num)
    add('regen', 'HP regen / s', num)
    add('killHeal', 'HP per kill', num)
    add('revivals', 'Revivals', num)
    add('magnetMul', 'Pickup range', pct)
    add('xpMul', 'Experience', pct)
    add('luck', 'Luck', num)
    add('rerolls', 'Rerolls', num)
    add('chestBonus', 'Chest rewards', num)
    add('startLevel', 'Starting level-ups', num)
    add('ultChargeMul', 'Ultimate charge', pct)
    add('dashCooldownMul', 'Dash recharge time', pct)
    add('dashIframeMul', 'Dash invulnerability', pct)
    if (effects.executeThreshold > 0) lines.push({ label: 'Execute below', value: `${Math.round(effects.executeThreshold * 100)}% HP`, keystone: true })
    if (effects.deathExplosionChance > 0) lines.push({ label: 'Kills explode', value: `${Math.round(effects.deathExplosionChance * 100)}%`, keystone: true })
    if (effects.thorns > 0) lines.push({ label: 'Thorns', value: 'On', keystone: true })
    if (effects.overkill) lines.push({ label: 'Overkill', value: 'On', keystone: true })
    if (effects.berserk) lines.push({ label: 'Berserker', value: 'On', keystone: true })
    if (effects.blinkDash) lines.push({ label: 'Blink', value: 'On', keystone: true })
    if (effects.magnetPulse) lines.push({ label: 'Gravity Well', value: 'On', keystone: true })
    return lines
}

// ─── Card text ───────────────────────────────────────────────────────────

export interface CardStat {
    /** '+25%', '24', '-10%' */
    value: string
    label: string
    /** Set when the text reads 'Damage 24 → 32' */
    from?: string
}

export type CardBlock = { kind: 'text', text: string } | { kind: 'stats', stats: CardStat[] }

const NUM = '[+\\-−]?\\s?\\d[\\d.,]*\\s?(?:%|s|x|×)?'
const ARROW_RE = new RegExp(`^(.*?)\\s*(${NUM})\\s*(?:→|->)\\s*(${NUM})\\s*(.*)$`)
const LEAD_RE = new RegExp(`^(${NUM})\\s+(.+)$`)

function statOf(part: string): CardStat | null {
    const p = part.trim().replace(/\.$/, '')
    if (!p) return null
    const arrow = ARROW_RE.exec(p)
    if (arrow) {
        const label = `${arrow[1] ?? ''} ${arrow[4] ?? ''}`.trim()
        if (label.length <= 28) return { label: label || 'Value', from: arrow[2]!.trim(), value: arrow[3]!.trim() }
    }
    const lead = LEAD_RE.exec(p)
    if (lead && lead[2]!.length <= 34) return { value: lead[1]!.replace(/\s/g, ''), label: lead[2]! }
    return null
}

/**
 * Splits card text into prose and stat chips: '+25% damage, -10% cooldown'
 * becomes two chips, 'Damage 24 → 32' becomes a before/after chip.
 */
export function cardBlocks(description: string): CardBlock[] {
    const blocks: CardBlock[] = []
    const sentences = description.split(/(?<=\.)\s+/).filter(Boolean)
    for (const sentence of sentences) {
        const parts = sentence.split(/,\s+|;\s+|\s+and\s+(?=[+\-−\d])/)
        const stats = parts.map(statOf)
        if (stats.every(Boolean)) {
            const prev = blocks[blocks.length - 1]
            if (prev?.kind === 'stats') prev.stats.push(...stats as CardStat[])
            else blocks.push({ kind: 'stats', stats: stats as CardStat[] })
        } else {
            const prev = blocks[blocks.length - 1]
            if (prev?.kind === 'text') prev.text += ` ${sentence}`
            else blocks.push({ kind: 'text', text: sentence })
        }
    }
    return blocks
}

/** Ability slot keys, in slot order */
export const ABILITY_KEYS = ['Q', 'F', 'R'] as const
/** Player level each ability slot opens at */
export const ABILITY_SLOT_LEVELS = [1, 8, 18] as const

/** 'ability:frostNova' -> 'frostNova' */
export function choiceBaseId(id: string): string {
    const i = id.indexOf(':')
    return i >= 0 ? id.slice(i + 1) : id
}
