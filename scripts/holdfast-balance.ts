// Holdfast balance check: plays each difficulty with a do-nothing player and
// a few scripted strategies, and prints how long each survives.
//   bun run balance:holdfast [runs]

import { HoldfastBot, simulateRun } from '../shared/utils/holdfast/bot'
import { HOLDFAST_DIFFICULTIES } from '../shared/utils/holdfast/meta'
import { HoldfastSim } from '../shared/utils/holdfast/sim'

const runs = Number(process.argv[2] ?? 6)

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const strategies = [
    { name: 'idle', bot: null },
    { name: 'units only', bot: { greed: 0, walls: false } },
    { name: 'balanced', bot: { greed: 1, walls: true } },
    { name: 'greedy', bot: { greed: 2, walls: true } }
] as const

for (const difficulty of HOLDFAST_DIFFICULTIES) {
    console.log(`\n${difficulty.toUpperCase()}`)
    for (const strat of strategies) {
        const times: number[] = []
        const waves: number[] = []
        let ms = 0
        for (let r = 0; r < runs; r++) {
            const sim = new HoldfastSim(difficulty, 1000 + r * 7919)
            const bot = strat.bot ? new HoldfastBot(sim, strat.bot) : null
            const t0 = performance.now()
            times.push(simulateRun(sim, bot))
            ms += performance.now() - t0
            waves.push(sim.wave)
        }
        times.sort((a, b) => a - b)
        const median = times[Math.floor(times.length / 2)]!
        console.log(`  ${strat.name.padEnd(11)} median ${fmt(median)}  range ${fmt(times[0]!)}–${fmt(times[times.length - 1]!)}  waves ~${Math.round(waves.reduce((a, b) => a + b, 0) / runs)}  ${(ms / runs).toFixed(0)}ms/run`)
    }
}
