/*
 * Codex data: lore for the horde and the bosses, duck-typed ability
 * discovery (the ability module is optional), and enemy thumbnails baked
 * once with a single shared offscreen Pixi renderer.
 */
import type { EnemyDef } from './engine/types'

// ─── Lore ────────────────────────────────────────────────────────────────

export interface CodexLore {
    text: string
    tag: string
}

export const ENEMY_LORE: Record<string, CodexLore> = {
    bat: { tag: 'Swarm', text: 'Zigzags in flocks.' },
    ghoul: { tag: 'Fodder', text: 'Slow, hungry, endless.' },
    slime: { tag: 'Splits', text: 'Bursts into slimelings on death.' },
    slimeling: { tag: 'Spawn', text: 'Weak alone, a pest in packs.' },
    charger: { tag: 'Charge', text: 'Rams in a straight line. Sidestep.' },
    archer: { tag: 'Ranged', text: 'Shoots where you are heading.' },
    bomber: { tag: 'Explodes', text: 'Runs in and blows up.' },
    ghost: { tag: 'Phasing', text: 'Fades out; attacks pass through.' },
    shieldbearer: { tag: 'Tank', text: 'A wall that ignores knockback.' },
    cultist: { tag: 'Summoner', text: 'Calls more of the horde.' },
    worm: { tag: 'Burrows', text: 'Erupts from cracking ground.' },
    drone: { tag: 'Dash', text: 'Locks on, then dives.' },
    imp: { tag: 'Ranged', text: 'Hurls fireballs.' },
    wisp: { tag: 'Bullets', text: 'Pulses rings of frost orbs.' },
    brute: { tag: 'Heavy', text: 'Leaps and slams a wide area.' },
    mimic: { tag: 'Treasure', text: 'Fake loot. Real reward.' },
    mite: { tag: 'Swarm', text: 'Tiny, fast, in clouds.' },
    gazer: { tag: 'Beam', text: 'Warns, then fires a long laser.' },
    spider: { tag: 'Lunge', text: 'Skitters close, then pounces.' },
    skull: { tag: 'Fast', text: 'Streaks straight at you.' },
    knight: { tag: 'Elite', text: 'Armoured. Telegraphed charge.' },
    golem: { tag: 'Shatters', text: 'Breaks into a ring of spikes.' }
}

export const ENEMY_LORE_FALLBACK: CodexLore = { tag: 'Horde', text: 'Keep moving.' }

export interface BossLore {
    title: string
    text: string
    /** Helper enemy ids that belong to this boss */
    parts: string[]
}

export const BOSS_LORE: Record<string, BossLore> = {
    boneColossus: {
        title: 'First warden',
        text: 'Slams where you are heading. Faster when hurt.',
        parts: []
    },
    hiveQueen: {
        title: 'Swarm mother',
        text: 'Acid fans and brood eggs. Smash the eggs.',
        parts: ['broodEgg']
    },
    stormWyrm: {
        title: 'Living tempest',
        text: 'Coils through the arena. Aim for the head.',
        parts: ['wyrmSegment', 'wyrmTail']
    },
    lichKing: {
        title: 'Lord of the dead',
        text: 'Orb spirals. Break the phylacteries to drop his shield.',
        parts: ['phylactery']
    },
    riftHeart: {
        title: 'The source',
        text: 'Kill it to win the run.',
        parts: []
    }
}

// ─── Abilities (optional engine module) ─────────────────────────────────

export interface CodexAbility {
    id: string
    name: string
    icon: string
    color: number
    description: string
    maxLevel: number | null
    cooldown: number | null
    key: string | null
    /** Level-max bonus, when the engine describes one */
    mastery: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function looksLikeAbility(v: unknown): v is Record<string, unknown> {
    return isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string'
}

function textOf(v: unknown): string {
    if (typeof v === 'string') return v
    if (typeof v === 'function') {
        try {
            const out: unknown = (v as (level: number) => unknown)(1)
            return typeof out === 'string' ? out : ''
        } catch {
            return ''
        }
    }
    return ''
}

function toAbility(raw: Record<string, unknown>): CodexAbility {
    const num = (k: string) => typeof raw[k] === 'number' ? raw[k] as number : null
    const base = isRecord(raw.base) ? raw.base : {}
    const baseCooldown = typeof base.cooldown === 'number' ? base.cooldown : null
    const levels = Array.isArray(raw.levels) ? raw.levels.length + 1 : null
    return {
        id: raw.id as string,
        name: raw.name as string,
        icon: typeof raw.icon === 'string' ? raw.icon : 'i-lucide-sparkles',
        color: num('color') ?? 0x8ef6ff,
        description: textOf(raw.description) || textOf(raw.text) || textOf(raw.desc),
        maxLevel: num('maxLevel') ?? levels,
        cooldown: num('cooldown') ?? num('baseCooldown') ?? baseCooldown,
        key: typeof raw.key === 'string' ? raw.key : null,
        mastery: textOf(raw.mastery)
    }
}

/** Finds the first exported list (array or record) of ability-like objects in the given modules. */
export function findAbilities(modules: Record<string, unknown>): CodexAbility[] {
    for (const mod of Object.values(modules)) {
        if (!isRecord(mod)) continue
        for (const value of Object.values(mod)) {
            const items = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : null
            if (!items || items.length === 0 || !items.every(looksLikeAbility)) continue
            const seen = new Set<string>()
            return items.filter((a) => {
                if (seen.has(a.id as string)) return false
                seen.add(a.id as string)
                return true
            }).map(toAbility)
        }
    }
    return []
}

// ─── Thumbnails ──────────────────────────────────────────────────────────

/** id -> PNG data URL, or null when the drawing failed */
const thumbs = new Map<string, string | null>()
const pending = new Map<string, EnemyDef>()
const listeners = new Set<(id: string, url: string | null) => void>()
let baking: Promise<void> | null = null

const THUMB = 96

export function cachedThumb(id: string): string | null | undefined {
    return thumbs.get(id)
}

export function onThumb(fn: (id: string, url: string | null) => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

const idle = () => new Promise<void>((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 120 })
    else setTimeout(resolve, 16)
})

function settle(id: string, url: string | null) {
    thumbs.set(id, url)
    for (const fn of listeners) fn(id, url)
}

/**
 * Queues thumbnails for the given defs. One renderer bakes the whole queue,
 * one drawing per idle slice, then it is destroyed.
 */
export function requestThumbs(defs: readonly EnemyDef[]): void {
    for (const def of defs) {
        if (!thumbs.has(def.id) && !pending.has(def.id)) pending.set(def.id, def)
    }
    if (!baking && pending.size) baking = bake().finally(() => (baking = null))
}

async function bake(): Promise<void> {
    let pixi: typeof import('pixi.js')
    let renderer: Awaited<ReturnType<typeof import('pixi.js')['autoDetectRenderer']>>
    try {
        pixi = await import('pixi.js')
        renderer = await pixi.autoDetectRenderer({
            width: THUMB,
            height: THUMB,
            backgroundAlpha: 0,
            antialias: true,
            preference: 'webgl',
            resolution: 2
        })
    } catch (e) {
        console.error('[riftborn] codex thumbnails unavailable', e)
        for (const id of [...pending.keys()]) settle(id, null)
        pending.clear()
        return
    }
    const frame = new pixi.Rectangle(0, 0, THUMB, THUMB)
    try {
        while (pending.size) {
            const [id, def] = pending.entries().next().value as [string, EnemyDef]
            pending.delete(id)
            await idle()
            const root = new pixi.Container()
            const g = new pixi.Graphics()
            try {
                def.draw(g, 0, false)
                const fit = (THUMB / Math.max(1, def.size)) * 0.98
                g.scale.set(fit)
                g.position.set(THUMB / 2, THUMB / 2)
                root.addChild(g)
                const url = await renderer.extract.base64({ target: root, frame, resolution: 2 })
                settle(id, url)
            } catch (e) {
                console.warn(`[riftborn] codex thumbnail for ${id} failed`, e)
                settle(id, null)
            } finally {
                root.destroy({ children: true })
            }
        }
    } finally {
        renderer.destroy()
    }
}
