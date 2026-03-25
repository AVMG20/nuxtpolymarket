import { createHmac } from 'node:crypto'

const SECRET = process.env.GAME_TOKEN_SECRET || 'blackjack-state-secret-key-change-in-production'

export function signGameState<T>(payload: T): string {
  const json = JSON.stringify(payload)
  const data = Buffer.from(json).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyGameState<T>(token: string): T {
  const [data, sig] = token.split('.')
  if (!data || !sig) throw createError({ statusCode: 400, message: 'Invalid game token' })

  const expected = createHmac('sha256', SECRET).update(data).digest('base64url')
  if (sig !== expected) throw createError({ statusCode: 400, message: 'Game state tampered' })

  return JSON.parse(Buffer.from(data, 'base64url').toString()) as T
}
