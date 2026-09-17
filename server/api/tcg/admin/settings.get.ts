import { requirePokemonAdmin } from '#server/utils/auth'
import { getShopSettings, type TcgShopSettings } from '#server/utils/tcg/settings'

export default defineEventHandler(async (event): Promise<TcgShopSettings> => {
    await requirePokemonAdmin(event)
    return await getShopSettings()
})
