/**
 * Unit derivation (§12.3): a battler unit reads ONLY card-level imported
 * fields. It must never see condition, grade, printing, stamp or serial
 * (§12.9) — a beaten bulk non-holo plays identically to a gem mint chase
 * variant of the same card.
 */

export interface BattlerAttackOption {
    /** Stable id from the import — locked at purchase for the run. */
    attackId: number
    name: string
    /** Scaled damage (printed / 10). */
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

/** A usable attack: a real numeric damage figure and a 1–5 energy cost. */
function parseAttack(entry: RawAttack): BattlerAttackOption | null {
    const name = typeof entry.name === 'string' ? entry.name : ''
    if (!name || name.startsWith('[Ability]')) return null
    const damageText = typeof entry.damage === 'string' || typeof entry.damage === 'number'
        ? String(entry.damage)
        : ''
    // "20", "20+", "20×" — the leading integer is the base figure.
    const match = damageText.match(/^(\d+)/)
    if (!match) return null
    const printed = Number(match[1])
    if (printed < 10) return null
    const cost = Array.isArray(entry.cost) ? entry.cost.length : 0
    if (cost < 1 || cost > 5) return null
    const attackId = typeof entry.attackId === 'number' ? entry.attackId : 0
    return {
        attackId,
        name,
        damage: Math.round(printed / 10),
        charge: cost
    }
}

/**
 * Derive a unit from a card's imported raw record. Returns null when the
 * card cannot fight — Trainers, Energy, and legacy imports whose combat
 * fields never arrived (§12.3 scope: they are simply not draftable).
 */
export function deriveUnit(cardId: string, raw: Record<string, unknown>): BattlerUnitSpec | null {
    if (raw.category !== 'Pokemon') return null
    const hp = typeof raw.hp === 'number' ? raw.hp : Number(raw.hp)
    if (!Number.isFinite(hp) || hp <= 0) return null
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (!name) return null
    const attacks = (Array.isArray(raw.attacks) ? raw.attacks : [])
        .map(entry => parseAttack(entry as RawAttack))
        .filter((entry): entry is BattlerAttackOption => entry !== null)
    if (attacks.length === 0) return null

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
