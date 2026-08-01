import { defineEventHandler } from 'nitro/h3'
import { auth } from '#server/utils/auth'

export default defineEventHandler((event) => {
  // `event.req` is a web Request under Nitro v3, but a stray h3 v1 copy still
  // wins type resolution and declares it as a node IncomingMessage.
  return auth.handler(event.req as unknown as Request)
})
