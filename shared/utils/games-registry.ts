import { playGame as playCyberCascade } from './gamelogic/cyber-cascade'
import { playDice } from './gamelogic/dice'
import { playLimbo } from './gamelogic/limbo'

export interface GameResult {
  payout: number
  [key: string]: unknown
}

export interface GameDefinition {
  play: (bet: number, options?: Record<string, unknown>) => GameResult
}

export const GAMES_REGISTRY: Record<string, GameDefinition> = {
  'cyber-cascade': {
    play: playCyberCascade
  },
  'dice': {
    play: playDice
  },
  'limbo': {
    play: playLimbo
  }
}

export const isValidGame = (name: string): name is keyof typeof GAMES_REGISTRY =>
  name in GAMES_REGISTRY
