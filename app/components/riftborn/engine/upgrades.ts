/*
 * Passives, stat recompute, and level-up / chest choice generation.
 */
import { randomFloat, randomWeighted } from '#shared/utils/random'
import type { RiftbornClassDef, RiftbornMetaEffects } from '#shared/utils/gamelogic/riftborn'
import { ABILITY_DEFS, ABILITY_MAX_LEVEL, describeAbility } from './abilities'
import type { AbilityInst, PassiveInst, PlayerStats, WeaponInst } from './core'
import type { Rarity, UpgradeChoice } from './types'
import { describeMods, isIntegerOnly, WEAPON_DEFS, WEAPON_MAX_LEVEL } from './weapons'

export interface PassiveDef {
    id: string
    name: string
    icon: string
    color: number
    maxLevel: number
    /** Gain per level at common rarity */
    per: number
    /** Whether rarity scales the gain */
    scalable: boolean
    text: (v: number) => string
    apply: (s: PlayerStats, v: number) => void
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const pct1 = (v: number) => `${(Math.round(v * 1000) / 10).toString()}%`

export const PASSIVES: PassiveDef[] = [
    { id: 'might', name: 'Power Shard', icon: 'i-lucide-biceps-flexed', color: 0xff4d4d, maxLevel: 5, per: 0.1, scalable: true, text: v => `+${pct(v)} damage`, apply: (s, v) => { s.might *= 1 + v } },
    { id: 'haste', name: 'Chrono Gear', icon: 'i-lucide-cog', color: 0x7fd4ff, maxLevel: 5, per: 0.06, scalable: true, text: v => `-${pct(v)} cooldowns`, apply: (s, v) => { s.cooldown *= Math.max(0.5, 1 - v) } },
    { id: 'area', name: 'Rift Lens', icon: 'i-lucide-circle-dot', color: 0xc58bff, maxLevel: 5, per: 0.1, scalable: true, text: v => `+${pct(v)} area`, apply: (s, v) => { s.area *= 1 + v } },
    { id: 'amount', name: 'Twin Soul', icon: 'i-lucide-copy', color: 0x9af7ff, maxLevel: 2, per: 1, scalable: false, text: () => '+1 projectile on every weapon', apply: (s, v) => { s.amount += Math.round(v) } },
    { id: 'speed', name: 'Wind Boots', icon: 'i-lucide-footprints', color: 0x9effa8, maxLevel: 5, per: 0.08, scalable: true, text: v => `+${pct(v)} move speed`, apply: (s, v) => { s.moveSpeed *= 1 + v } },
    { id: 'vitality', name: 'Iron Heart', icon: 'i-lucide-heart', color: 0xff5c7a, maxLevel: 5, per: 0.15, scalable: true, text: v => `+${pct(v)} max HP`, apply: (s, v) => { s.maxHp *= 1 + v } },
    { id: 'regen', name: 'Troll Blood', icon: 'i-lucide-heart-pulse', color: 0x4dff9a, maxLevel: 5, per: 0.4, scalable: true, text: v => `+${v.toFixed(1)} HP regen per second`, apply: (s, v) => { s.regen += v } },
    { id: 'armor', name: 'Bulwark', icon: 'i-lucide-shield', color: 0xb8c4d6, maxLevel: 5, per: 1, scalable: true, text: v => `+${v.toFixed(1)} armor`, apply: (s, v) => { s.armor += v } },
    { id: 'magnet', name: 'Lodestone', icon: 'i-lucide-magnet', color: 0x5aa8ff, maxLevel: 5, per: 0.3, scalable: true, text: v => `+${pct(v)} pickup range`, apply: (s, v) => { s.magnet *= 1 + v } },
    { id: 'crit', name: 'Keen Eye', icon: 'i-lucide-crosshair', color: 0xffd84d, maxLevel: 5, per: 0.05, scalable: true, text: v => `+${pct(v)} crit chance, +${pct(v * 3)} crit damage`, apply: (s, v) => { s.crit += v; s.critMul += v * 3 } },
    { id: 'duration', name: 'Hourglass', icon: 'i-lucide-hourglass', color: 0xe0b070, maxLevel: 5, per: 0.12, scalable: true, text: v => `+${pct(v)} duration`, apply: (s, v) => { s.duration *= 1 + v } },
    { id: 'projSpeed', name: 'Fletching', icon: 'i-lucide-feather', color: 0xd9f0ff, maxLevel: 5, per: 0.12, scalable: true, text: v => `+${pct(v)} projectile speed`, apply: (s, v) => { s.projSpeed *= 1 + v } },
    { id: 'lifesteal', name: 'Vampire Fang', icon: 'i-lucide-droplet', color: 0xd01c3c, maxLevel: 5, per: 0.01, scalable: true, text: v => `+${pct1(v)} lifesteal`, apply: (s, v) => { s.lifesteal += v } },
    { id: 'luck', name: 'Clover', icon: 'i-lucide-clover', color: 0x52e06b, maxLevel: 5, per: 1, scalable: true, text: v => `+${v.toFixed(1)} luck (rarer cards, more drops)`, apply: (s, v) => { s.luck += v; s.crit += v * 0.01 } },
    { id: 'growth', name: 'Tome of Insight', icon: 'i-lucide-book-open', color: 0x8fb0ff, maxLevel: 5, per: 0.1, scalable: true, text: v => `+${pct(v)} experience`, apply: (s, v) => { s.growth *= 1 + v } },
    { id: 'greed', name: 'Shard Prism', icon: 'i-lucide-gem', color: 0xff7ae0, maxLevel: 5, per: 0.25, scalable: true, text: v => `+${pct(v)} shard drops`, apply: (s, v) => { s.greed *= 1 + v } },
    { id: 'focus', name: 'Arcane Focus', icon: 'i-lucide-timer-reset', color: 0x7fb8ff, maxLevel: 5, per: 0.08, scalable: true, text: v => `-${pct(v)} ability cooldowns`, apply: (s, v) => { s.abilityHaste *= Math.max(0.4, 1 - v) } },
    { id: 'spellpower', name: 'Spell Power', icon: 'i-lucide-wand-sparkles', color: 0xd98bff, maxLevel: 5, per: 0.15, scalable: true, text: v => `+${pct(v)} ability damage`, apply: (s, v) => { s.abilityPower *= 1 + v } }
]

export const PASSIVE_DEFS: Record<string, PassiveDef> = Object.fromEntries(PASSIVES.map(p => [p.id, p]))

export const MAX_WEAPONS = 6
export const MAX_PASSIVES = 6

export const RARITY_MUL: Record<Rarity, number> = { common: 1, rare: 1.3, epic: 1.7, legendary: 2.3 }
/** Extra weapon damage on a level-up of this rarity; legendary also adds +1 projectile (or +15% area) */
export const RARITY_BONUS: Record<Rarity, number> = { common: 0, rare: 0.05, epic: 0.12, legendary: 0.25 }
const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary']

export function computeStats(cls: RiftbornClassDef, meta: RiftbornMetaEffects, passives: readonly PassiveInst[]): PlayerStats {
    const s: PlayerStats = {
        maxHp: cls.baseHp * meta.hpMul,
        regen: meta.regen,
        armor: cls.armor + meta.armor,
        moveSpeed: cls.baseSpeed * (cls.id === 'ranger' ? 1.15 : 1),
        might: cls.might * meta.damageMul,
        area: 1,
        cooldown: meta.cooldownMul * (cls.id === 'stormcaller' ? 0.9 : 1),
        amount: (cls.id === 'ranger' ? 1 : 0) + Math.max(0, Math.floor(meta.projectiles ?? 0)),
        duration: 1,
        projSpeed: 1,
        magnet: 95 * meta.magnetMul,
        crit: 0.05 + meta.luck * 0.01 + (meta.critChance ?? 0),
        critMul: 2 + (meta.critDamage ?? 0),
        luck: meta.luck,
        growth: meta.xpMul,
        lifesteal: 0,
        greed: 1,
        abilityPower: 1,
        abilityHaste: 1
    }
    for (const p of passives) {
        const def = PASSIVE_DEFS[p.id]
        if (def) def.apply(s, def.per * p.power)
    }
    s.cooldown = Math.max(0.35, s.cooldown)
    return s
}

export function rollRarity(luck: number, boost = 0): Rarity {
    const l = Math.max(0, luck + boost)
    const w = [Math.max(10, 62 - l * 3), 25 + l * 2.5, 9 + l * 1.8, 2.5 + l * 1.1]
    return randomWeighted(RARITIES, r => w[RARITIES.indexOf(r)]!)
}

export type OptionKind = UpgradeChoice['kind']

export interface UpgradeOption {
    kind: OptionKind
    /** Weapon or passive id */
    id: string
    rarity: Rarity
    choice: UpgradeChoice
}

export interface UpgradeState {
    cls: RiftbornClassDef
    weapons: readonly WeaponInst[]
    passives: readonly PassiveInst[]
    luck: number
    hp: number
    maxHp: number
    abilities: readonly AbilityInst[]
    /** Ability slots open */
    slots: number
    stats: PlayerStats
    level: number
}

interface Candidate {
    kind: OptionKind
    id: string
    weight: number
}

function candidates(st: UpgradeState, ownedOnly: boolean): Candidate[] {
    const out: Candidate[] = []
    for (const w of st.weapons) {
        if (w.level >= WEAPON_MAX_LEVEL && !w.evolved && st.passives.some(p => p.id === w.def.evo.passive)) {
            out.push({ kind: 'evolution', id: w.def.id, weight: 1000 })
        } else if (w.level < WEAPON_MAX_LEVEL) {
            out.push({ kind: 'weapon', id: w.def.id, weight: 10 })
        }
    }
    for (const p of st.passives) {
        const def = PASSIVE_DEFS[p.id]
        if (def && p.level < def.maxLevel) out.push({ kind: 'passive', id: p.id, weight: 8 })
    }
    for (const a of st.abilities) {
        if (a.level < ABILITY_MAX_LEVEL) out.push({ kind: 'ability', id: a.def.id, weight: 9 })
    }
    if (ownedOnly && out.length > 0) return out
    if (st.abilities.length < st.slots) {
        for (const def of Object.values(ABILITY_DEFS)) {
            if (st.abilities.some(a => a.def.id === def.id)) continue
            out.push({ kind: 'ability', id: def.id, weight: 2 })
        }
    }
    if (st.weapons.length < MAX_WEAPONS) {
        for (const def of Object.values(WEAPON_DEFS)) {
            if (st.weapons.some(w => w.def.id === def.id)) continue
            const foreign = def.classWeapon && def.classWeapon !== st.cls.id
            out.push({ kind: 'weapon', id: def.id, weight: foreign ? 2.5 : 6 })
        }
    }
    if (st.passives.length < MAX_PASSIVES) {
        for (const def of PASSIVES) {
            if (st.passives.some(p => p.id === def.id)) continue
            // Nudge toward passives that would evolve a weapon you own
            const evolves = st.weapons.some(w => w.def.evo.passive === def.id)
            out.push({ kind: 'passive', id: def.id, weight: evolves ? 8 : 5 })
        }
    }
    return out
}

export function describeOption(st: UpgradeState, kind: OptionKind, id: string, rarity: Rarity): UpgradeChoice {
    const mul = RARITY_MUL[rarity]
    if (kind === 'evolution') {
        const def = WEAPON_DEFS[id]!
        return {
            id: `evo:${id}`,
            kind,
            name: def.evo.name,
            description: def.evo.description,
            icon: def.evo.icon,
            rarity: 'legendary',
            level: WEAPON_MAX_LEVEL,
            maxLevel: WEAPON_MAX_LEVEL,
            color: def.evo.color,
            isNew: false
        }
    }
    if (kind === 'weapon') {
        const def = WEAPON_DEFS[id]!
        const owned = st.weapons.find(w => w.def.id === id)
        if (!owned) {
            const bonus = (mul - 1) * 0.3
            return {
                id: `weapon:${id}`,
                kind,
                name: def.name,
                description: bonus > 0 ? `${def.description} +${Math.round(bonus * 100)}% damage` : def.description,
                icon: def.icon,
                rarity,
                level: 1,
                maxLevel: WEAPON_MAX_LEVEL,
                color: def.color,
                isNew: true
            }
        }
        const mods = def.levels[owned.level - 1] ?? {}
        const bonus = (isIntegerOnly(mods) ? (mul - 1) * 0.25 : 0) + RARITY_BONUS[rarity]
        let text = describeMods(def, mods, mul, bonus)
        if (rarity === 'legendary') text += def.usesAmount ? `, +1 ${def.amountLabel ?? 'projectile'}` : ', +15% area'
        return {
            id: `weapon:${id}`,
            kind,
            name: def.name,
            description: text,
            icon: def.icon,
            rarity,
            level: owned.level + 1,
            maxLevel: WEAPON_MAX_LEVEL,
            color: def.color,
            isNew: false
        }
    }
    if (kind === 'passive') {
        const def = PASSIVE_DEFS[id]!
        const owned = st.passives.find(p => p.id === id)
        const r = def.scalable ? rarity : 'common'
        return {
            id: `passive:${id}`,
            kind,
            name: def.name,
            description: def.text(def.per * RARITY_MUL[r]),
            icon: def.icon,
            rarity: r,
            level: (owned?.level ?? 0) + 1,
            maxLevel: def.maxLevel,
            color: def.color,
            isNew: !owned
        }
    }
    if (kind === 'ability') {
        const def = ABILITY_DEFS[id]!
        const owned = st.abilities.find(a => a.def.id === id) ?? null
        return {
            id: `ability:${id}`,
            kind,
            name: def.name,
            description: describeAbility(def, owned, mul, st.stats, st.level) + (!owned && mul > 1 ? ` +${Math.round((mul - 1) * 40)}% damage` : ''),
            icon: def.icon,
            rarity,
            level: (owned?.level ?? 0) + 1,
            maxLevel: ABILITY_MAX_LEVEL,
            color: def.color,
            isNew: !owned
        }
    }
    if (kind === 'heal') {
        return {
            id: 'heal',
            kind,
            name: 'Feast',
            description: `Heal ${Math.round(30 * mul)}% max HP`,
            icon: 'i-lucide-drumstick',
            rarity,
            level: 1,
            maxLevel: 1,
            color: 0xff6060,
            isNew: false
        }
    }
    return {
        id: 'shards',
        kind: 'shards',
        name: 'Shard Cache',
        description: `+${shardCacheAmount(rarity)} shards`,
        icon: 'i-lucide-gem',
        rarity,
        level: 1,
        maxLevel: 1,
        color: 0xff5ec4,
        isNew: false
    }
}

export function shardCacheAmount(rarity: Rarity): number {
    return Math.round(2 * RARITY_MUL[rarity])
}

/**
 * Roll n distinct options. An available evolution always takes a slot.
 * `ownedOnly` (chests) prefers upgrades to what you already have.
 */
export function rollOptions(st: UpgradeState, n: number, opts: { ownedOnly?: boolean, rarityBoost?: number, exclude?: string[] } = {}): UpgradeOption[] {
    const pool = candidates(st, opts.ownedOnly ?? false).filter(c => !opts.exclude?.includes(`${c.kind}:${c.id}`))
    const out: UpgradeOption[] = []
    // A free ability slot always gets one new ability card
    if (!opts.ownedOnly && st.abilities.length < st.slots) {
        const fresh = pool.filter(c => c.kind === 'ability' && !st.abilities.some(a => a.def.id === c.id))
        if (fresh.length) {
            const c = fresh[Math.floor(randomFloat() * fresh.length)]!
            pool.splice(pool.indexOf(c), 1)
            const rarity = rollRarity(st.luck, opts.rarityBoost ?? 0)
            out.push({ kind: c.kind, id: c.id, rarity, choice: describeOption(st, c.kind, c.id, rarity) })
        }
    }
    while (out.length < n && pool.length > 0) {
        const c = randomWeighted(pool, x => x.weight)
        pool.splice(pool.indexOf(c), 1)
        // A weapon can't be offered as both upgrade and evolution
        for (let i = pool.length - 1; i >= 0; i--) if (pool[i]!.id === c.id && (pool[i]!.kind === 'weapon' || pool[i]!.kind === 'evolution') && (c.kind === 'weapon' || c.kind === 'evolution')) pool.splice(i, 1)
        const rarity = c.kind === 'evolution' ? 'legendary' : rollRarity(st.luck, opts.rarityBoost ?? 0)
        const choice = describeOption(st, c.kind, c.id, rarity)
        out.push({ kind: c.kind, id: c.id, rarity: choice.rarity, choice })
    }
    const fillers: OptionKind[] = st.hp < st.maxHp * 0.95 ? ['heal', 'shards'] : ['shards', 'heal']
    for (const k of fillers) {
        if (out.length >= n) break
        const rarity = rollRarity(st.luck, opts.rarityBoost ?? 0)
        out.push({ kind: k, id: k, rarity, choice: describeOption(st, k, k, rarity) })
    }
    // Evolutions first, they're the headline, then new abilities
    const rank = (o: UpgradeOption) => o.kind === 'evolution' ? 2 : o.kind === 'ability' && o.choice.isNew ? 1 : 0
    out.sort((a, b) => rank(b) - rank(a))
    return out
}
