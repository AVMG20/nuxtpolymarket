/**
 * Generated opponents (§12.5): until enough real boards exist at a round,
 * the ladder backfills with boards sampled from the committed-set catalog,
 * scaled up as the run deepens.
 */
import { BATTLER } from './shop'
import type { BattlerRandom } from './rng'
import type { BattlerUnitSpec } from './unit'
import type { BattleUnit } from './combat'

/**
 * Board size and depth by round: early boards are small and level 1, late
 * boards fill the bench and carry merged units.
 */
export function generateBoard(round: number, catalog: BattlerUnitSpec[], rng: BattlerRandom): BattleUnit[] {
    if (catalog.length === 0) return []
    const size = Math.min(BATTLER.boardSlots, 2 + Math.floor(round / 2))
    const board: BattleUnit[] = []
    for (let i = 0; i < size; i++) {
        const spec = rng.pick(catalog)
        // Depth arrives with the rounds: instances drift up so mid-run
        // opponents field level 2s and late ones the occasional level 3.
        const maxInstances = round >= 8 ? 6 : round >= 4 ? 3 : 1
        const instances = Math.max(1, Math.min(maxInstances, 1 + rng.integer(0, Math.floor(round / 3))))
        board.push({
            key: `gen-${i}`,
            spec,
            attackId: spec.attacks[0]!.attackId,
            instances
        })
    }
    return board
}
