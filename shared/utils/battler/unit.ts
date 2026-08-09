/**
 * Unit derivation (§12.3): a battler unit reads ONLY card-level imported
 * fields. It must never see condition, grade, printing, stamp or serial
 * (§12.9) — a beaten bulk non-holo plays identically to a gem mint chase
 * variant of the same card.
 *
 * Damage is NOT read from the printed damage text — that text is variable
 * ("10+", coin flips) and era-inflated. Damage = charge × the card's tier
 * rate, so every Pokémon card with HP fights, including ability-only ones.
 */
import { damagePerChargeFor } from './shop'

export interface BattlerAttackOption {
    /** Stable id from the import — locked at purchase for the run. */
    attackId: number
    name: string
    /** charge × the tier's damage rate — never the printed damage text. */
    damage: number
    /** Charge rounds = printed energy cost length, clamped 1–5. */
    charge: number
}

export interface BattlerModifier {
    type: string
    /** '×' multiplies, '+'/'−' add scaled points (printed / 10). */
    operator: 'x' | 'add'
    value: number
}

export interface BattlerUnitSpec {
    cardId: string
    name: string
    /** Scaled HP (printed / 10). */
    hp: number
    type: string | null
    attacks: BattlerAttackOption[]
    weaknesses: BattlerModifier[]
    resistances: BattlerModifier[]
    retreat: number
    /** Prize bounty the OPPONENT collects on faint: 0, 2 (ex/V/GX) or 3 (VMAX/VSTAR). */
    bounty: number
}

interface RawAttack {
    name?: unknown
    damage?: unknown
    cost?: unknown
    attackId?: unknown
}

interface RawModifier {
    type?: unknown
    amount?: unknown
}

/** Bounty tier from the card name — the import carries no suffix field. */
export function bountyTierFor(name: string): number {
    if (/\b(VMAX|VSTAR)\b/.test(name)) return 3
    if (/\b(ex|EX|GX|V)\b/.test(name)) return 2
    return 0
}

/**
 * Parse a printed weakness/resistance amount: "2"/"×2"/"x2" multiply,
 * "+30"/"-30" add scaled by the same /10 the damage figures use (§12.3).
 */
function parseModifier(entry: RawModifier): BattlerModifier | null {
    const type = typeof entry.type === 'string' ? entry.type : null
    const amount = typeof entry.amount === 'string' || typeof entry.amount === 'number'
        ? String(entry.amount).trim()
        : ''
    if (!type || !amount) return null
    if (amount.startsWith('+') || amount.startsWith('-') || amount.startsWith('−')) {
        const value = Number(amount.replace('−', '-'))
        if (!Number.isFinite(value) || value === 0) return null
        return { type, operator: 'add', value: value / 10 }
    }
    const multiplier = Number(amount.replace(/[×x*]/gi, ''))
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null
    return { type, operator: 'x', value: multiplier }
}

function normalizeModifiers(value: unknown): BattlerModifier[] {
    const entries = Array.isArray(value) ? value : value ? [value] : []
    return entries
        .map(entry => parseModifier(entry as RawModifier))
        .filter((entry): entry is BattlerModifier => entry !== null)
}

/** A usable attack: any non-ability entry. Free attacks charge as 1. */
function parseAttack(entry: RawAttack, perCharge: number): BattlerAttackOption | null {
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!name || name.startsWith('[Ability]')) return null
    const cost = Array.isArray(entry.cost) ? entry.cost.length : 0
    const charge = Math.min(5, Math.max(1, cost))
    const attackId = typeof entry.attackId === 'number' ? entry.attackId : 0
    return {
        attackId,
        name,
        damage: Math.max(1, Math.round(charge * perCharge)),
        charge
    }
}

/**
 * Derive a unit from a card's imported raw record. Returns null when the
 * card cannot fight — Trainers, Energy, and legacy imports whose combat
 * fields never arrived (§12.3 scope: they are simply not draftable).
 *
 * `rarity` is the DB rarity column, the fallback when raw.pullRate.tier
 * (thepricedex vocabulary) is absent — same resolution the shop cost uses.
 */
export function deriveUnit(cardId: string, raw: Record<string, unknown>, rarity: string | null = null): BattlerUnitSpec | null {
    if (raw.category !== 'Pokemon') return null
    const hp = typeof raw.hp === 'number' ? raw.hp : Number(raw.hp)
    if (!Number.isFinite(hp) || hp <= 0) return null
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (!name) return null
    const tier = (raw.pullRate as { tier?: string } | undefined)?.tier ?? rarity
    const perCharge = damagePerChargeFor(tier)
    const attacks = (Array.isArray(raw.attacks) ? raw.attacks : [])
        .map(entry => parseAttack(entry as RawAttack, perCharge))
        .filter((entry): entry is BattlerAttackOption => entry !== null)
    // Ability-only (or attack-less) Pokémon still fight — with a plain move.
    if (attacks.length === 0) {
        attacks.push({ attackId: 0, name: 'Struggle', damage: Math.max(1, Math.round(2 * perCharge)), charge: 2 })
    }

    return {
        cardId,
        name,
        hp: Math.max(1, Math.round(hp / 10)),
        type: typeof raw.type === 'string' ? raw.type : null,
        attacks,
        weaknesses: normalizeModifiers(raw.weakness ?? raw.weaknesses),
        resistances: normalizeModifiers(raw.resistance ?? raw.resistances),
        retreat: typeof raw.retreat === 'number' && raw.retreat >= 0 ? raw.retreat : 1,
        bounty: bountyTierFor(name)
    }
}
