import { SECTIONS, type SectionId } from './custom'
import type { LayoutWalk, RoadState, TrackPiece } from './layout'

/** Building a course a piece at a time: what the controls ask for, and the section that lays next. */

export type Curve = 'straight' | 'left-45' | 'left-90' | 'left-180' | 'right-45' | 'right-90' | 'right-180'
export type BendSize = 'tight' | 'medium' | 'wide'

/** What the controls are set to; slope and bank name the piece that puts the road in that state. */
export interface Construction {
    curve: Curve
    size: BendSize
    length: StraightLength
    slope: SectionId
    bank: SectionId
}

export const BENDS: Record<Exclude<Curve, 'straight'>, Record<BendSize, SectionId>> = {
    'left-45': { tight: 'left-eighth-tight', medium: 'left-eighth', wide: 'left-eighth-wide' },
    'left-90': { tight: 'left-tight', medium: 'left-medium', wide: 'left-wide' },
    'left-180': { tight: 'left-hairpin', medium: 'left-hairpin-medium', wide: 'left-hairpin-wide' },
    'right-45': { tight: 'right-eighth-tight', medium: 'right-eighth', wide: 'right-eighth-wide' },
    'right-90': { tight: 'right-tight', medium: 'right-medium', wide: 'right-wide' },
    'right-180': { tight: 'right-hairpin', medium: 'right-hairpin-medium', wide: 'right-hairpin-wide' }
}

export const STRAIGHTS = { 10: 'straight-10', 20: 'straight-20', 60: 'straight-60', 100: 'straight-100', 200: 'straight-200' } as const satisfies Record<number, SectionId>
export type StraightLength = keyof typeof STRAIGHTS
export const STRAIGHT_LENGTHS = Object.keys(STRAIGHTS).map(Number) as StraightLength[]

/** A state the controls offer, named for the road it leaves rather than the road it comes from. */
export interface StateStep {
    id: SectionId
    name: string
}

export const SLOPE_STEPS: readonly (StateStep & { icon: string })[] = [
    { id: 'slope-down-steep', name: 'steep down', icon: 'i-lucide-chevrons-down' },
    { id: 'slope-down', name: 'gentle down', icon: 'i-lucide-chevron-down' },
    { id: 'slope-flat', name: 'level', icon: 'i-lucide-minus' },
    { id: 'slope-up', name: 'gentle up', icon: 'i-lucide-chevron-up' },
    { id: 'slope-up-steep', name: 'steep up', icon: 'i-lucide-chevrons-up' }
]
export const BANK_STEPS: readonly StateStep[] = [
    { id: 'bank-left', name: 'left' },
    { id: 'bank-flat', name: 'level' },
    { id: 'bank-right', name: 'right' }
]

/** The bank or grade a state piece leaves the road on. */
export function targetOf(id: SectionId) {
    const piece: TrackPiece = SECTIONS[id].piece
    return piece.type === 'slope' || piece.type === 'bank' ? piece.to : 0
}

/** A bank is walked through radians, so it comes back a rounding error off the degrees it was given. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6

/** The road's state where the piece after `cursor` would go in. */
export function stateAfter(walk: LayoutWalk, cursor: number): RoadState {
    const { bank, grade } = walk.states[cursor + 1] ?? walk.end
    return { bank, grade }
}

/** The controls' slope and bank for a road already in `state`, so they read what's there. */
export function stepsFor({ bank, grade }: RoadState): Pick<Construction, 'slope' | 'bank'> {
    return {
        slope: SLOPE_STEPS.find(s => same(targetOf(s.id), grade))?.id ?? 'slope-flat',
        bank: BANK_STEPS.find(s => same(targetOf(s.id), bank))?.id ?? 'bank-flat'
    }
}

/** The section to lay next: first what puts the road in the asked-for state, one change a piece, and then the road itself. */
export function nextSection(choice: Construction, state: RoadState): SectionId {
    if (!same(targetOf(choice.slope), state.grade)) return choice.slope
    if (!same(targetOf(choice.bank), state.bank)) return choice.bank
    return choice.curve === 'straight' ? STRAIGHTS[choice.length] : BENDS[choice.curve][choice.size]
}

/** What building `id` does: a state piece's own label assumes the flat road it's usually laid on, so it goes by where it leaves the road. */
export function nextLabel(id: SectionId) {
    const slope = SLOPE_STEPS.find(s => s.id === id)
    if (slope) return `Slope to ${slope.name}`
    const bank = BANK_STEPS.find(s => s.id === id)
    return bank ? `Bank to ${bank.name}` : SECTIONS[id].label
}
