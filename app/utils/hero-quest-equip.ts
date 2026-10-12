/**
 * The Collections equip picker: the spots a Champion, Skill or Artifact can go, and what picking
 * one does. A Champion gets the formation, front row over back with the Hero in its own; a Skill
 * or Artifact gets its slots in order. A free spot takes the entry; a held one is replaced by it,
 * or swapped with it when the entry is already in. Pure, so the rules are specs, not canvas clicks.
 */
import type { FormationRow } from '#shared/utils/hero-quest/types'

/** Who holds a spot: an entry by id, the Hero, or nobody. */
export type EquipHolder = { kind: 'entry', id: string } | { kind: 'hero' } | null

export interface EquipSpot {
    /** What pressing it does: `row:<row>` or `add` on a free spot, `with:<id>` or `hero` on a held one. */
    pick: string
    holder: EquipHolder
    enabled: boolean
    /** The entry being equipped is the one here. */
    current: boolean
    /** The pick the small x in its corner sends, freeing the spot (`bench:<id>`); absent where there is none. */
    unset?: string
}

export interface EquipPicker {
    title: string
    /** The formation's two rows, or a slotted system's one, unlabelled. */
    rows: readonly { label: string | null, spots: readonly EquipSpot[] }[]
    /** The button that takes the entry off while it is on, null while it is not. */
    remove: string | null
    /** How many slots are unlocked of the most there can be: "3/5 slots unlocked". */
    hint: string
}

function slotHint(slots: number, max: number): string {
    return `${slots}/${max} slots unlocked`
}

/** The party as saved: who is fielded in what order, every row (the Hero's under `hero`), and the caps. */
export interface HqPartyState {
    party: readonly string[]
    formation: Readonly<Record<string, FormationRow>>
    /** Champion slots unlocked, and the most the shop sells up to. */
    slots: number
    maxSlots: number
    /** Places in a row, the Hero counted. */
    capacity: number
}

export type HqChampionPick = { championIds: string[], formation: Record<string, FormationRow> }

const ROWS: readonly FormationRow[] = ['front', 'back']

/**
 * A Champion's picker. A free spot fields it there, or moves it there when it is fielded already;
 * a party at its slot cap leaves only the fielded Champions to replace. A fielded one can also
 * swap places with another member, the Hero included. Every fielded Champion carries an x that
 * benches it, so a full party can free a spot without leaving the picker.
 */
export function hqChampionPicker(id: string, s: HqPartyState): EquipPicker {
    const fielded = s.party.includes(id)
    const room = fielded || s.party.length < s.slots
    const own = fielded ? s.formation[id] ?? 'front' : null
    const rows = ROWS.map((row) => {
        const spots: EquipSpot[] = []
        if ((s.formation.hero ?? 'front') === row) spots.push({ pick: 'hero', holder: { kind: 'hero' }, enabled: fielded && own !== row, current: false })
        for (const member of s.party) {
            if ((s.formation[member] ?? 'front') !== row) continue
            spots.push({ pick: `with:${member}`, holder: { kind: 'entry', id: member }, enabled: member !== id, current: member === id, unset: `bench:${member}` })
        }
        while (spots.length < s.capacity) spots.push({ pick: `row:${row}`, holder: null, enabled: room && own !== row, current: false })
        return { label: row === 'front' ? 'Front' : 'Back', spots }
    })
    return {
        title: fielded ? 'Move or swap' : room ? 'Pick a spot' : 'Party full: replace who?',
        rows,
        remove: fielded ? 'Bench' : null,
        hint: slotHint(s.slots, s.maxSlots)
    }
}

/** The party and formation a Champion's pick, or `remove`, comes to; null for a pick that does nothing. */
export function hqApplyChampionPick(id: string, pick: string, s: HqPartyState): HqChampionPick | null {
    const party = [...s.party]
    const formation: Record<string, FormationRow> = { ...s.formation }
    const at = party.indexOf(id)
    const swapRows = (a: string, b: string) => {
        const row = formation[a] ?? 'front'
        formation[a] = formation[b] ?? 'front'
        formation[b] = row
    }
    if (pick === 'remove') return at < 0 ? null : { championIds: party.filter(c => c !== id), formation }
    if (pick.startsWith('bench:')) {
        const other = pick.slice(6)
        return party.includes(other) ? { championIds: party.filter(c => c !== other), formation } : null
    }
    if (pick.startsWith('row:')) {
        const row = pick.slice(4) as FormationRow
        if (at >= 0 && formation[id] === row) return null
        if (at < 0 && party.length >= s.slots) return null
        formation[id] = row
        return { championIds: at < 0 ? [...party, id] : party, formation }
    }
    if (pick === 'hero') {
        if (at < 0) return null
        swapRows(id, 'hero')
        return { championIds: party, formation }
    }
    if (pick.startsWith('with:')) {
        const other = pick.slice(5)
        const j = party.indexOf(other)
        if (j < 0 || other === id) return null
        party[j] = id
        if (at < 0) formation[id] = formation[other] ?? 'front'
        else {
            party[at] = other
            swapRows(id, other)
        }
        return { championIds: party, formation }
    }
    return null
}

/**
 * A Skill's or Artifact's picker: its slots in order, the free ones after the held. A free slot
 * takes it while it is off; a held one is replaced by it, or swapped with it while it is on.
 */
export function hqSlotPicker(id: string, equipped: readonly string[], slots: number, maxSlots: number, noun: string): EquipPicker {
    const on = equipped.includes(id)
    const spots: EquipSpot[] = equipped.map(e => ({ pick: `with:${e}`, holder: { kind: 'entry', id: e }, enabled: e !== id, current: e === id }))
    while (spots.length < slots) spots.push({ pick: 'add', holder: null, enabled: !on, current: false })
    const full = equipped.length >= slots
    return {
        title: on ? 'Swap or unequip' : full ? `Slots full: replace which ${noun}?` : 'Pick a slot',
        rows: [{ label: null, spots }],
        remove: on ? 'Unequip' : null,
        hint: slotHint(slots, maxSlots)
    }
}

/** The equipped list a Skill's or Artifact's pick, or `remove`, comes to; null for a pick that does nothing. */
export function hqApplySlotPick(id: string, pick: string, equipped: readonly string[], slots: number): string[] | null {
    const list = [...equipped]
    const at = list.indexOf(id)
    if (pick === 'remove') return at < 0 ? null : list.filter(e => e !== id)
    if (pick === 'add') return at < 0 && list.length < slots ? [...list, id] : null
    if (pick.startsWith('with:')) {
        const other = pick.slice(5)
        const j = list.indexOf(other)
        if (j < 0 || other === id) return null
        list[j] = id
        if (at >= 0) list[at] = other
        return list
    }
    return null
}
