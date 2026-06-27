import { playDice } from './gamelogic/dice'
import { playLimbo } from './gamelogic/limbo'
import { playWheel } from '#shared/utils/gamelogic/wheel'
import { playGoldParty } from './gamelogic/goldparty'

export interface GameResult {
  payout: number
  [key: string]: unknown
}

export interface GameDefinition {
  play: (bet: number, options?: Record<string, unknown>) => GameResult
}

export const GAMES_REGISTRY: Record<string, GameDefinition> = {
  dice: {
    play: playDice
  },
  limbo: {
    play: playLimbo
  },
  wheel: {
    play: playWheel
  },
  goldparty: {
    play: playGoldParty
  }
}

export const isValidGame = (name: string): name is keyof typeof GAMES_REGISTRY =>
  name in GAMES_REGISTRY
