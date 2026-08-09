/**
 * The run draft (§12.2): 10 distinct cards from the collection, weighted by
 * copies SQUARED — depth beats breadth — each bringing min(copies, 6)
 * instances so the level ceiling is legible from the draft screen.
 */
import { BATTLER } from './shop'
import type { BattlerRandom } from './rng'

export interface DraftHolding {
    cardId: string
    copies: number
}

export interface DraftedCard {
    cardId: string
    /** Instances that entered the pool: min(copies_owned, 6). */
    instances: number
}

export function draftPool(holdings: DraftHolding[], rng: BattlerRandom): DraftedCard[] {
    const remaining = holdings.filter(holding => holding.copies > 0)
    const drafted: DraftedCard[] = []
    while (drafted.length < BATTLER.draftUnits && remaining.length > 0) {
        const total = remaining.reduce((sum, holding) => sum + holding.copies * holding.copies, 0)
        let roll = rng.next() * total
        let index = remaining.length - 1
        for (let i = 0; i < remaining.length; i++) {
            roll -= remaining[i]!.copies * remaining[i]!.copies
            if (roll < 0) {
                index = i
                break
            }
        }
        const [chosen] = remaining.splice(index, 1)
        drafted.push({
            cardId: chosen!.cardId,
            instances: Math.min(chosen!.copies, BATTLER.maxInstances)
        })
    }
    return drafted
}
