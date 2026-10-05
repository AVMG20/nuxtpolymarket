import { requireUserId } from '#server/utils/auth'
import { getBalance } from '#server/utils/balance'
import {
    getCollections,
    getHqState,
    getLoadouts,
    getShopLevels,
    heroSnapshotOf,
    serializeClassTree,
    serializeDigSite,
    serializeForge,
    serializeGuild,
    serializeHero,
    serializeBattleSpeed,
    serializeLoadouts,
    serializeRun,
    serializeShop,
    serializeTrainingGrounds,
    settleHq,
    voidShardsFor
} from '#server/utils/hero-quest'
import { HQ_REFRESH_INTERVAL_MS, STAGES_PER_WORLD, WORLD_COUNT } from '#shared/utils/hero-quest/constants'
import { fromStore } from '#shared/utils/hero-quest/numbers'
import { hqSettingsOf } from '#shared/utils/hero-quest/settings'
import { serializeRaids } from '#server/utils/hero-quest-raids'

/**
 * The one read the client makes.
 *
 * Settles first, always, so every read sees a settled world. Returns derived display values
 * rather than raw rows, so the client never re-derives game math. Decimals go out as strings.
 *
 * All four gacha tabs are served from one call rather than one endpoint each, because they share
 * a settle and the same `hqCollection` query. Splitting them would mean four settles per page
 * load, and a settle is a write.
 */
export default defineEventHandler(async (event) => {
    const userId = await requireUserId(event)

    // Founding is explicit. Same payload shape either way, so the composable stays simple.
    const existing = await getHqState(userId)
    if (!existing) {
        return {
            initialized: false as const,
            serverNow: Date.now(),
            refreshIntervalMs: HQ_REFRESH_INTERVAL_MS,
            worldCount: WORLD_COUNT,
            stagesPerWorld: STAGES_PER_WORLD,
            run: null,
            hero: null,
            shop: [],
            guild: null,
            forge: null,
            training: null,
            digSite: null,
            loadouts: null,
            classTree: [],
            classToken: false,
            battleSpeed: null,
            settings: hqSettingsOf(null),
            raids: [],
            voidShards: '0',
            nextPrestigeReward: voidShardsFor(0).toString(),
            awaySeconds: 0,
            settled: null
        }
    }

    const settleOutcome = await settleHq(userId)
    const { state, result, online, previousLevel } = settleOutcome

    /**
     * The settle already read the shop levels and the collection rows, inside its lock — reuse
     * them rather than issuing the same two queries again. `?? getShopLevels(...)` covers the
     * no-op path, where the settle returns before reading anything.
     *
     * `getBalance` deliberately is *not* deduplicated the same way. The settle reads the balance
     * **before** its transaction opens, because that is the Gold the window was fought with; this
     * one runs after and therefore includes the Gold the settle just paid out. They are two
     * different numbers with two different jobs, and collapsing them would show the player a
     * balance missing everything they just earned.
     */
    const [shopLevels, collections, loadoutRows, balance, raids] = await Promise.all([
        settleOutcome.shopLevels ?? getShopLevels(userId),
        settleOutcome.collections ?? getCollections(userId),
        getLoadouts(userId),
        getBalance(userId),
        serializeRaids(userId)
    ])
    const hero = heroSnapshotOf(state, shopLevels, collections, parseFloat(balance) || 0)

    return {
        initialized: true as const,
        // Lets the client interpolate accrual without drifting against its own clock.
        serverNow: Date.now(),
        refreshIntervalMs: HQ_REFRESH_INTERVAL_MS,
        worldCount: WORLD_COUNT,
        stagesPerWorld: STAGES_PER_WORLD,

        run: serializeRun(state, hero),
        hero: serializeHero(state, hero),
        shop: serializeShop(shopLevels),
        classTree: serializeClassTree(state),
        /** A prestige's class token is waiting to be spent on a new class. */
        classToken: state.classToken,
        battleSpeed: serializeBattleSpeed(state),
        settings: hqSettingsOf(state.settings),
        raids,

        guild: serializeGuild(state, collections.champion, shopLevels),
        forge: serializeForge(state, collections.gear),
        training: serializeTrainingGrounds(state, collections.skill, shopLevels),
        digSite: serializeDigSite(state, collections.artifact, shopLevels),
        loadouts: serializeLoadouts(loadoutRows, shopLevels),

        voidShards: fromStore(state.voidShards).toString(),
        nextPrestigeReward: voidShardsFor(state.prestige).toString(),

        /**
         * The gap this read closed, in seconds: time since the last settle. The client ends the
         * session on its splash past `HQ_SESSION_TIMEOUT_MS`; it decides nothing else.
         */
        awaySeconds: settleOutcome.elapsedSeconds,

        /** What the settle just banked — the "while you were away" summary. */
        settled: result
            ? {
                online,
                kills: result.kills,
                goldEarned: result.goldEarned,
                xpEarned: result.xpEarned.toString(),
                levelsGained: result.heroLevel - previousLevel,
                effectiveSeconds: result.effectiveSeconds,
                blockedAtBoss: result.blockedAtBoss,
                wipedOnWave: result.wipedOnWave
            }
            : null
    }
})
