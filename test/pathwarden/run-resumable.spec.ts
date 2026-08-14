import { describe, expect, it } from 'vitest'
import { pathwardenRunIsResumable, type PathwardenResumableRun } from '#server/utils/pathwarden'
import {
    PATHWARDEN_GENERATOR_VERSION,
    PATHWARDEN_SAVE_VERSION,
    type PathwardenGameState
} from '#shared/types/pathwarden-save'
import { createPathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map'

const plan = createPathwardenMapPlan({ seed: 4242, realm: 1 })
const castle = plan.rooms.find(room => room.id === plan.castleRoomId)!

// Walks a plan the way the engine does: claim a room, then the rooms it opens.
function claimFrom(mapPlan: typeof plan, count: number) {
    const claimed: string[] = []
    let frontier = mapPlan.connections.filter(connection => connection.fromRoomId === mapPlan.castleRoomId)
    while (claimed.length < count && frontier.length) {
        const connection = frontier[0]!
        claimed.push(connection.toRoomId)
        frontier = [
            ...frontier.slice(1),
            ...mapPlan.connections.filter(candidate => candidate.fromRoomId === connection.toRoomId)
        ]
    }
    return { claimed, active: frontier.map(connection => connection.toRoomId) }
}

function saveOn(mapPlan: typeof plan): PathwardenGameState {
    const { claimed, active } = claimFrom(mapPlan, 6)
    return {
        phase: 'planning',
        paused: false,
        wave: 1,
        lives: 20,
        maxLives: 20,
        aether: 100,
        score: 0,
        streak: 0,
        flawlessWaves: 0,
        spawnLeft: 0,
        spawnTotal: 0,
        spawnTimer: 0,
        combatRandomState: 1,
        path: [{ ...castle.origin }],
        claimedRoomIds: claimed,
        activeRoomIds: active,
        selectedTower: 'bolt',
        towerPurchases: {},
        relicRanks: {},
        globalRelics: {},
        relicInventory: [],
        ashPiles: [],
        interest: 0,
        canSellRelics: false,
        towers: [],
        enemies: [],
        projectiles: [],
        towerId: 1,
        enemyId: 1,
        relicInstanceId: 1
    } as PathwardenGameState
}

function run(overrides: Partial<PathwardenResumableRun> = {}): PathwardenResumableRun {
    return {
        saveVersion: PATHWARDEN_SAVE_VERSION,
        generatorVersion: PATHWARDEN_GENERATOR_VERSION,
        mapPlan: plan,
        gameState: saveOn(plan),
        ...overrides
    }
}

describe('pathwardenRunIsResumable', () => {
    it('resumes a march whose save still fits its map', () => {
        expect(pathwardenRunIsResumable(run())).toBe(true)
    })

    it('does not resume a march that has not autosaved yet', () => {
        // Reloading inside the ~2.5s gap after starting wave 1 used to leave the
        // player permanently unable to start a wave: the client saw no save and
        // asked for a new march, and start-run refused because one was active.
        expect(pathwardenRunIsResumable(run({ gameState: null }))).toBe(false)
    })

    it('does not resume a save recorded against a different map', () => {
        const other = createPathwardenMapPlan({ seed: 909, realm: 1 })
        expect(pathwardenRunIsResumable(run({ gameState: saveOn(other) }))).toBe(false)
    })

    it('does not resume a march saved by an older save or generator version', () => {
        expect(pathwardenRunIsResumable(run({ saveVersion: PATHWARDEN_SAVE_VERSION - 1 }))).toBe(false)
        expect(pathwardenRunIsResumable(run({ generatorVersion: PATHWARDEN_GENERATOR_VERSION - 1 }))).toBe(false)
    })

    it('has nothing to resume without a run row', () => {
        expect(pathwardenRunIsResumable(undefined)).toBe(false)
    })
})
