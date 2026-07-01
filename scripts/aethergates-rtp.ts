import { playAetherGates } from '../shared/utils/gamelogic/aethergates'

const rounds = Number.parseInt(process.argv[2] ?? '1000000', 10)
const feature = process.argv[3] as 'buyFreeSpins' | 'bonusChance' | undefined

let wagered = 0
let paid = 0
let bonusCount = 0
let hits100 = 0
let hits500 = 0
let hits1000 = 0
let hits5000 = 0
let hits10000 = 0
let maxMult = 0

for (let i = 0; i < rounds; i++) {
  const result = playAetherGates(1, feature ? { feature } : undefined)
  wagered += result.cost
  paid += result.payout
  if (result.bonusTriggered) bonusCount++
  if (result.totalWinMult >= 100) hits100++
  if (result.totalWinMult >= 500) hits500++
  if (result.totalWinMult >= 1000) hits1000++
  if (result.totalWinMult >= 5000) hits5000++
  if (result.totalWinMult >= 10000) hits10000++
  if (result.totalWinMult > maxMult) maxMult = result.totalWinMult
}

function every(count: number): string {
  return count > 0 ? `1 in ${(rounds / count).toFixed(0)}` : 'none'
}

console.table({
  rounds,
  'feature': feature ?? 'base',
  'wagered': wagered.toFixed(2),
  'paid': paid.toFixed(2),
  'rtp': `${((paid / wagered) * 100).toFixed(3)}%`,
  'bonus': every(bonusCount),
  '100x+': every(hits100),
  '500x+': every(hits500),
  '1000x+': every(hits1000),
  '5000x+': every(hits5000),
  '10000x+': every(hits10000),
  'maxMult': `${maxMult.toFixed(4)}x`
})
