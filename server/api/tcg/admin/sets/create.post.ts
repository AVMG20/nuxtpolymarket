import { db } from '#server/database'
import { tcgSet } from '#server/database/schema'
import { requirePokemonAdmin } from '#server/utils/auth'
import { serializeSet } from '#server/utils/tcg/engine'

export default defineEventHandler(async (event) => {
    await requirePokemonAdmin(event)

    const body = await readBody(event)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!name) throw createError({ statusCode: 400, statusMessage: 'Name is required' })
    if (!code) throw createError({ statusCode: 400, statusMessage: 'Code is required' })

    const plaatjesSetCode = typeof body?.plaatjesSetCode === 'string' && body.plaatjesSetCode.trim()
        ? body.plaatjesSetCode.trim()
        : null
    const releaseDate = typeof body?.releaseDate === 'string' && body.releaseDate.trim()
        ? body.releaseDate.trim()
        : null

    const [created] = await db.insert(tcgSet)
        .values({ name, code, plaatjesSetCode, releaseDate, status: 'draft' })
        .returning()
    return serializeSet(created!)
})
