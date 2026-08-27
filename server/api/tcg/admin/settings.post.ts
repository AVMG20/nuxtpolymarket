import { requirePokemonAdmin } from '#server/utils/auth'
import { updateShopSettings, type TcgShopSettings } from '#server/utils/tcg/settings'

/** Update the shop economics. Effective immediately for new purchases. */
export default defineEventHandler(async (event): Promise<TcgShopSettings> => {
    await requirePokemonAdmin(event)
    const body = await readBody<Partial<TcgShopSettings>>(event)
    return await updateShopSettings({
        packsPerPair: Number(body?.packsPerPair),
        gemsPerPair: Number(body?.gemsPerPair),
        packsPerDay: Number(body?.packsPerDay),
        bundlePacks: Number(body?.bundlePacks),
        bundleGems: Number(body?.bundleGems)
    })
})
