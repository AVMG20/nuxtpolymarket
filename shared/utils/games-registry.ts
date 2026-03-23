import { playGame as playCyberCascade } from './gamelogic/cyber-cascade'

export interface GameResult {
  totalSessionWin: number
  [key: string]: unknown
}

export interface GameDefinition {
  play: (bet: number) => GameResult
}

export const GAMES_REGISTRY: Record<string, GameDefinition> = {
  'cyber-cascade': {
    play: playCyberCascade
  }
}

export const isValidGame = (name: string): name is keyof typeof GAMES_REGISTRY =>
  name in GAMES_REGISTRY
