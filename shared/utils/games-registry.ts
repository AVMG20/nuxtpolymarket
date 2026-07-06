import { playDice } from './gamelogic/dice'
import { playLimbo } from './gamelogic/limbo'
import { playWheel } from '#shared/utils/gamelogic/wheel'
import { playMagicHands } from './gamelogic/magichands'
import { playXenoSlot } from './gamelogic/xenoslot'
import { playCandyMadness } from './gamelogic/candymadness'
import { playAetherGates } from './gamelogic/aethergates'
import { playFireInTheHole } from './gamelogic/fireinthehole'
import { playBookOfShadows } from './gamelogic/bookofshadows'

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
  magichands: {
    play: playMagicHands
  },
  xenoslot: {
    play: playXenoSlot
  },
  candymadness: {
    play: playCandyMadness
  },
  aethergates: {
    play: playAetherGates
  },
  fireinthehole: {
    play: playFireInTheHole
  },
  bookofshadows: {
    play: playBookOfShadows
  }
}

export const isValidGame = (name: string): name is keyof typeof GAMES_REGISTRY =>
  name in GAMES_REGISTRY
