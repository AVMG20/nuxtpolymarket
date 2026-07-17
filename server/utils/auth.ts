import type {H3Event} from 'h3'
import {APIError, betterAuth} from 'better-auth'
import {drizzleAdapter} from 'better-auth/adapters/drizzle'
import {db} from '../database'
import * as schema from '../database/schema'

const NAME_MAX_LENGTH = 30

function assertValidName(data: Record<string, unknown>) {
    if (typeof data.name !== 'string') return
    if (data.name.trim().length === 0) throw new APIError('BAD_REQUEST', {message: 'Name is required'})
    if (data.name.length > NAME_MAX_LENGTH) throw new APIError('BAD_REQUEST', {message: `Name must be ${NAME_MAX_LENGTH} characters or fewer`})
}

const BASE_URL = process.env.BETTER_AUTH_URL || 'http://localhost:3000'

export const auth = betterAuth({
    baseURL: BASE_URL,
    trustedOrigins: [BASE_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    database: drizzleAdapter(db, {
        provider: 'pg',
        schema
    }),
    emailAndPassword: {
        enabled: true
    },
    socialProviders: {
        discord: {
            clientId: process.env.BETTER_AUTH_DISCORD_CLIENT_ID as string,
            clientSecret: process.env.BETTER_AUTH_DISCORD_CLIENT_SECRET as string,
        }
    },
    rateLimit: {
        window: 10, // default is 60
        max: 100, // default is 100
    },
    databaseHooks: {
        user: {
            create: {
                before: async (user) => {
                    assertValidName(user)
                }
            },
            update: {
                before: async (data) => {
                    assertValidName(data)
                }
            }
        }
    },
    user: {
        changeEmail: {
            enabled: true,
        },
        additionalFields: {
            balance: {
                type: 'string',
                required: false,
                defaultValue: '0',
                input: false,
            },
            rake: {
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
            rakebackUnlocked: {
                type: 'boolean',
                required: false,
                defaultValue: false,
                input: false,
            },
        }
    }
})

/** Session user id for a protected endpoint — throws 401 when not signed in. */
export async function requireUserId(event: H3Event): Promise<string> {
    const session = await auth.api.getSession({headers: event.headers})
    if (!session?.user?.id) throw createError({statusCode: 401, statusMessage: 'Unauthorized'})
    return session.user.id
}

/** Session user id for public endpoints that only personalize their response. */
export async function getSessionUserId(event: H3Event): Promise<string | null> {
    const session = await auth.api.getSession({headers: event.headers})
    return session?.user?.id ?? null
}
