// COLONY income by Habitat Level, whole-colony and net of food.
//
// The properties the numbers in shared/utils/colony.ts are fitted to:
//  1. Income climbs meaningfully with every Habitat Level, and the jump is
//     never so large that the previous stage stops being worth playing.
//  2. Research is worth taking — a fully researched species doubles output,
//     which has to be visible against the Foraging Yield track rather than
//     buried under it.
//  3. Feeding stays a real cost: the gross/net gap should be noticeable at T1
//     and shrink, not vanish, at endgame.
//
// Re-run after touching ITEM_TYPES, BUG_TYPES, YIELD_TRACK_LEVELS_PER_LEVEL,
// MAX_TOTAL_SPEED_PCT, RESEARCH_RESOURCE_MULTIPLIERS or the habitat
// requirement table. Cross-check against XENO with `bun run balance:compare`.

import {
    COLONY_STAGES,
    colonyBestSpecies,
    colonyStage,
    colonyTrackLevels
} from './lib/economy-stages'
import { deriveCapacity, MAX_RESEARCH_LEVEL } from '../shared/utils/colony'

function compact(value: number): string {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
}

const researchLevels = [0, 2, MAX_RESEARCH_LEVEL]

const rows = COLONY_STAGES.map((habitatLevel) => {
    const row: Record<string, string | number> = {
        stage: `hab${habitatLevel}`,
        days: colonyStage(habitatLevel, 0).days.toFixed(1),
        slots: deriveCapacity(colonyTrackLevels(habitatLevel)),
        species: colonyBestSpecies(habitatLevel, 0)?.type.name ?? '—'
    }
    for (const research of researchLevels) {
        const stage = colonyStage(habitatLevel, research)
        row[`research ${research}`] = compact(stage.coinsPerHour)
    }
    const base = colonyStage(habitatLevel, 0)
    const maxed = colonyStage(habitatLevel, MAX_RESEARCH_LEVEL)
    row['research gain'] = `${(maxed.coinsPerHour / base.coinsPerHour).toFixed(2)}x`
    row.capital = compact(base.capital)
    row['payback hrs'] = (base.capital / base.coinsPerHour).toFixed(0)
    return row
})

console.log('COLONY coins/hr for the whole terrarium, net of food, best species at each Habitat Level')
console.table(rows)

// Stage-over-stage ratio. Less than ~2x and the wait isn't worth it; more than
// ~15x and the previous stage stops being worth playing at all. The band is
// wide on purpose: hab1 -> hab3 legitimately runs hot (10-15x) because each
// step unlocks a whole new item tier AND four more slots at once, and the item
// sell values that drive it are deliberately left alone.
const climb = COLONY_STAGES.slice(1).map((habitatLevel) => {
    const previous = colonyStage(habitatLevel - 1, 0)
    const current = colonyStage(habitatLevel, 0)
    const ratio = current.coinsPerHour / previous.coinsPerHour
    if (ratio < 2 || ratio > 15) {
        console.log(`WARNING hab${habitatLevel - 1} -> hab${habitatLevel} is ${ratio.toFixed(2)}x, outside the intended 2-15x climb`)
    }
    return { step: `hab${habitatLevel - 1} -> hab${habitatLevel}`, ratio: `${ratio.toFixed(2)}x`, 'days added': (current.days - previous.days).toFixed(1) }
})
console.table(climb)
