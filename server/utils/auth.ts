import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { db } from '../database'
import * as schema from '../database/schema'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema
  }),
  emailAndPassword: {
    enabled: true
  },
  user: {
    additionalFields: {
      balance: {
        type: 'string',
        required: false,
        defaultValue: '0',
        input: false,
      },
      gems: {
        type: 'number',
        required: false,
        defaultValue: 0,
        input: false,
      },
    }
  }
})
