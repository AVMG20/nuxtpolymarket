import { describe, expect, it } from 'vitest'
import { createPathwardenMapPlan } from '#shared/utils/gamelogic/pathwarden-map'
import { pathwardenSaveIsHydratable } from '#shared/utils/gamelogic/pathwarden-map-validation'
import type { PathwardenGameState } from '#shared/types/pathwarden-save'

function gameState(overrides: Partial<PathwardenGameState>): PathwardenGameState {
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
        path: [],
        claimedRoomIds: [],
        activeRoomIds: [],
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
        relicInstanceId: 1,
        ...overrides
    } as PathwardenGameState
}

// Walks the plan the way the engine does: claim a room, then the rooms it opens.
function claimFrom(plan: ReturnType<typeof createPathwardenMapPlan>, count: number) {
    const claimed: string[] = []
    let frontier = plan.connections.filter(connection => connection.fromRoomId === plan.castleRoomId)
    while (claimed.length < count && frontier.length) {
        const connection = frontier[0]!
        claimed.push(connection.toRoomId)
        frontier = [
            ...frontier.slice(1),
            ...plan.connections.filter(candidate => candidate.fromRoomId === connection.toRoomId)
        ]
    }
    const active = frontier.map(connection => connection.toRoomId)
    return { claimed, active }
}

describe('pathwarden save hydration', () => {
    const plan = createPathwardenMapPlan({ seed: 4242, realm: 1 })
    const castle = plan.rooms.find(room => room.id === plan.castleRoomId)!

    it('accepts a save whose claimed rooms belong to the run map', () => {
        const { claimed, active } = claimFrom(plan, 6)
        const state = gameState({
            path: [{ ...castle.origin }],
            claimedRoomIds: claimed,
            activeRoomIds: active
        })
        expect(pathwardenSaveIsHydratable(plan, state)).toBe(true)
    })

    it('rejects a save recorded against a different map', () => {
        const other = createPathwardenMapPlan({ seed: 909, realm: 1 })
        const { claimed, active } = claimFrom(other, 6)
        const state = gameState({
            path: [{ ...castle.origin }],
            claimedRoomIds: claimed,
            activeRoomIds: active
        })
        expect(pathwardenSaveIsHydratable(plan, state)).toBe(false)
    })

    it('rejects a save whose frontier is cut off from the keep', () => {
        const { claimed, active } = claimFrom(plan, 6)
        const state = gameState({
            path: [{ ...castle.origin }],
            claimedRoomIds: claimed.slice(2),
            activeRoomIds: active
        })
        expect(pathwardenSaveIsHydratable(plan, state)).toBe(false)
    })

    it('accepts a fresh save with nothing claimed yet', () => {
        const active = plan.connections
            .filter(connection => connection.fromRoomId === plan.castleRoomId)
            .map(connection => connection.toRoomId)
        const state = gameState({ path: [{ ...castle.origin }], activeRoomIds: active })
        expect(pathwardenSaveIsHydratable(plan, state)).toBe(true)
    })
})
