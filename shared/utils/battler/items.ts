/**
 * Trainers as items (§12.6). No data source carries the Trainer subtype —
 * not even the modern sets — so behaviour keys on the NORMALISED CARD NAME:
 * authored effects for the perennials (which carry their subtype), a name
 * heuristic for Stadiums ("… Gym" / "… Stadium"), and a generic tool
 * attachment for everything else, scaled by the card's price tier. Every
 * Trainer is playable day one; famous names get authored over time, and a
 * future subtype feed only ever improves the fallback (§12.6: a legitimate
 * content patch, not a bug fix).
 */
import { unitCostFor } from './shop'

export type BattlerItemSubtype = 'tool' | 'supporter' | 'stadium'

/** Permanent buffs riding on one unit. */
export interface BattlerAttachEffect {
    hp?: number
    atk?: number
    /** Added to the attack's charge, floored at 1 — negative is faster. */
    charge?: number
    noWeakness?: boolean
    retreatZero?: boolean
}

/** One-shot on use, during the shop phase. */
export interface BattlerConsumeEffect {
    cash?: number
    freeRerolls?: number
    /** Refill the reposition budget this phase. */
    reposition?: boolean
    /** Team-wide buffs applying to the NEXT battle only. */
    teamAtk?: number
    teamHp?: number
}

/** Persists for the whole run and affects BOTH boards (§12.6). */
export interface BattlerStadiumEffect {
    allHp?: number
    allAtk?: number
    /** Added to every attack's charge, floored at 1 — positive slows everyone. */
    allCharge?: number
    noWeakness?: boolean
}

export interface BattlerItemSpec {
    cardId: string
    name: string
    subtype: BattlerItemSubtype
    attach?: BattlerAttachEffect
    consume?: BattlerConsumeEffect
    stadium?: BattlerStadiumEffect
    /** Short human description, shown in shop and tooltips. */
    text: string
}

export function normalizeItemName(name: string): string {
    return name.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim()
}

type Authored = { subtype: BattlerItemSubtype, attach?: BattlerAttachEffect, consume?: BattlerConsumeEffect, stadium?: BattlerStadiumEffect, text: string }

/**
 * The perennials (§12.6 names roughly 40; this is the starting set).
 * Reprints inherit automatically — the key is the name, not the printing.
 */
const AUTHORED: Record<string, Authored> = {
    // Tools — permanent attachments.
    'weakness policy': { subtype: 'tool', attach: { noWeakness: true }, text: 'Holder loses its weakness' },
    'muscle band': { subtype: 'tool', attach: { atk: 1 }, text: '+1 attack' },
    'choice band': { subtype: 'tool', attach: { atk: 2 }, text: '+2 attack' },
    'choice belt': { subtype: 'tool', attach: { atk: 2 }, text: '+2 attack' },
    'giant cape': { subtype: 'tool', attach: { hp: 2 }, text: '+2 HP' },
    'cape of toughness': { subtype: 'tool', attach: { hp: 3 }, text: '+3 HP' },
    'bravery charm': { subtype: 'tool', attach: { hp: 3 }, text: '+3 HP' },
    'float stone': { subtype: 'tool', attach: { retreatZero: true }, text: 'Holder repositions free' },
    'air balloon': { subtype: 'tool', attach: { retreatZero: true }, text: 'Holder repositions free' },
    'exp. share': { subtype: 'tool', attach: { hp: 1 }, text: '+1 HP' },
    'leftovers': { subtype: 'tool', attach: { hp: 2 }, text: '+2 HP' },
    'rocky helmet': { subtype: 'tool', attach: { hp: 1, atk: 1 }, text: '+1 HP, +1 attack' },
    'magnifier': { subtype: 'tool', attach: { charge: -1 }, text: 'Attack charges 1 round faster' },
    'electrical cord': { subtype: 'tool', attach: { charge: -1 }, text: 'Attack charges 1 round faster' },

    // Supporters and ball Items — consumed on use.
    'professors research': { subtype: 'supporter', consume: { freeRerolls: 2 }, text: '2 free rerolls' },
    'professor oak': { subtype: 'supporter', consume: { freeRerolls: 2 }, text: '2 free rerolls' },
    'professor elm': { subtype: 'supporter', consume: { freeRerolls: 2 }, text: '2 free rerolls' },
    'judge': { subtype: 'supporter', consume: { freeRerolls: 1, cash: 1 }, text: '1 free reroll, +₱1' },
    'marnie': { subtype: 'supporter', consume: { freeRerolls: 2 }, text: '2 free rerolls' },
    'iono': { subtype: 'supporter', consume: { cash: 2 }, text: '+₱2' },
    'bill': { subtype: 'supporter', consume: { cash: 2 }, text: '+₱2' },
    'boss orders': { subtype: 'supporter', consume: { teamAtk: 2 }, text: 'Team +2 attack next battle' },
    'bosss orders': { subtype: 'supporter', consume: { teamAtk: 2 }, text: 'Team +2 attack next battle' },
    'ultra ball': { subtype: 'supporter', consume: { freeRerolls: 1 }, text: '1 free reroll' },
    'poke ball': { subtype: 'supporter', consume: { freeRerolls: 1 }, text: '1 free reroll' },
    'poké ball': { subtype: 'supporter', consume: { freeRerolls: 1 }, text: '1 free reroll' },
    'quick ball': { subtype: 'supporter', consume: { freeRerolls: 1 }, text: '1 free reroll' },
    'nest ball': { subtype: 'supporter', consume: { cash: 1 }, text: '+₱1' },
    'switch': { subtype: 'supporter', consume: { reposition: true }, text: 'Refill the reposition budget' },
    'escape rope': { subtype: 'supporter', consume: { reposition: true }, text: 'Refill the reposition budget' },
    'potion': { subtype: 'supporter', consume: { teamHp: 2 }, text: 'Team +2 HP next battle' },
    'super potion': { subtype: 'supporter', consume: { teamHp: 3 }, text: 'Team +3 HP next battle' },
    'rare candy': { subtype: 'supporter', consume: { teamHp: 2, teamAtk: 1 }, text: 'Team +2 HP, +1 attack next battle' },

    // Stadiums — both boards, whole run.
    'area zero underdepths': { subtype: 'stadium', stadium: { allAtk: 1 }, text: 'Every unit +1 attack' },
    'path to the peak': { subtype: 'stadium', stadium: { allCharge: 1 }, text: 'Every attack charges 1 round slower' },
    'artazon': { subtype: 'stadium', stadium: { allHp: 1 }, text: 'Every unit +1 HP' }
}

const describeAttach = (attach: BattlerAttachEffect): string => {
    const parts: string[] = []
    if (attach.hp) parts.push(`+${attach.hp} HP`)
    if (attach.atk) parts.push(`+${attach.atk} attack`)
    if (attach.charge) parts.push(attach.charge < 0 ? 'charges faster' : 'charges slower')
    if (attach.noWeakness) parts.push('no weakness')
    if (attach.retreatZero) parts.push('free repositioning')
    return parts.join(', ')
}

/** FNV-1a — a stable hash so a card's generic flavor never shifts between runs. */
function nameHash(name: string): number {
    let hash = 0x811C9DC5
    for (let i = 0; i < name.length; i++) {
        hash ^= name.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

/**
 * Derive an item from a Trainer card's raw record. Returns null for
 * non-Trainers. `rarity` follows the same tier chain as unit pricing.
 */
export function deriveItem(cardId: string, raw: Record<string, unknown>, rarity: string | null = null): BattlerItemSpec | null {
    if (raw.category !== 'Trainer') return null
    const name = typeof raw.name === 'string' ? raw.name : ''
    if (!name) return null
    const normalized = normalizeItemName(name)
    const tier = (raw.pullRate as { tier?: string } | undefined)?.tier ?? rarity

    const authored = AUTHORED[normalized]
    if (authored) {
        return { cardId, name, subtype: authored.subtype, attach: authored.attach, consume: authored.consume, stadium: authored.stadium, text: authored.text }
    }

    // Gyms and Stadiums announce themselves in the name.
    if (/\b(gym|stadium|city|tower|lab|laboratory|park|quarry|ruins)$/i.test(name.trim())) {
        const stadium: BattlerStadiumEffect = nameHash(normalized) % 2 === 0 ? { allHp: 1 } : { allAtk: 1 }
        return { cardId, name, subtype: 'stadium', stadium, text: stadium.allHp ? 'Every unit +1 HP' : 'Every unit +1 attack' }
    }

    // Generic fallback: a tool attachment scaled by the price tier, with the
    // flavor (HP vs attack vs speed) picked deterministically per name.
    const cost = unitCostFor(tier)
    const flavor = nameHash(normalized) % 3
    let attach: BattlerAttachEffect
    if (flavor === 0) attach = { hp: cost <= 3 ? 1 : cost <= 6 ? 2 : 3 }
    else if (flavor === 1) attach = { atk: cost <= 4 ? 1 : 2 }
    else attach = cost >= 6 ? { charge: -1 } : { hp: 1 }
    return { cardId, name, subtype: 'tool', attach, text: describeAttach(attach) }
}

/** Items price one step under the unit of the same tier, floor ₱2. */
export function itemCostFor(tierOrRarity: string | null): number {
    return Math.max(2, unitCostFor(tierOrRarity) - 1)
}

export const ITEM_GLYPH: Record<BattlerItemSubtype, string> = {
    tool: '🔧',
    supporter: '🎴',
    stadium: '🏟️'
}
