import { and, count, eq, gte, lt } from 'drizzle-orm'
import { db } from '#server/database'
import { aiMessages, user } from '#server/database/schema'
import { AI_MONTHLY_PROMPT_LIMIT } from '#shared/utils/ai'

export function currentAiPeriodStart(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function getAiUsage(userId: string) {
    const periodStart = currentAiPeriodStart()
    const nextPeriod = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1))
    const [row] = await db.select({ value: count() }).from(aiMessages).where(and(
        eq(aiMessages.userId, userId),
        eq(aiMessages.role, 'user'),
        gte(aiMessages.createdAt, periodStart),
        lt(aiMessages.createdAt, nextPeriod)
    ))
    const used = row?.value ?? 0
    return { used, limit: AI_MONTHLY_PROMPT_LIMIT, resetsAt: nextPeriod.toISOString() }
}

export async function consumeAiPrompt(userId: string, conversationId: string, content: string) {
    return db.transaction(async (tx) => {
        await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update')
        const periodStart = currentAiPeriodStart()
        const nextPeriod = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1))
        const [row] = await tx.select({ value: count() }).from(aiMessages).where(and(
            eq(aiMessages.userId, userId),
            eq(aiMessages.role, 'user'),
            gte(aiMessages.createdAt, periodStart),
            lt(aiMessages.createdAt, nextPeriod)
        ))
        const used = row?.value ?? 0
        if (used >= AI_MONTHLY_PROMPT_LIMIT) {
            throw createError({ statusCode: 429, statusMessage: 'Monthly AI prompt limit reached' })
        }
        await tx.insert(aiMessages).values({ conversationId, userId, role: 'user', content })
        return { used: used + 1, limit: AI_MONTHLY_PROMPT_LIMIT }
    })
}
