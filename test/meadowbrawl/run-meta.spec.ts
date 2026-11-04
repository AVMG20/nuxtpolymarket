import { describe, expect, it } from 'vitest'
import { DEFAULT_RUN_CONFIG, MeadowbrawlGame, type RunConfig } from '../../app/utils/meadowbrawl/engine'
import { eliteFor } from '../../app/utils/meadowbrawl/waves'
import {
    MEADOWBRAWL_SAVE_VERSION,
    MEADOWBRAWL_TOTAL_WAVES,
    meadowbrawlCoinCeiling,
    meadowbrawlEliteCount,
    meadowbrawlValidateSave,
    type MeadowbrawlRunSave
} from '../../shared/utils/gamelogic/meadowbrawl-meta'

function step(g: MeadowbrawlGame, seconds: number, dt = 1 / 120) {
    for (let t = 0; t < seconds; t += dt) g.update(dt)
}

function fresh(config: Partial<RunConfig> = {}, weapon: 'sword' | 'greataxe' = 'sword') {
    const g = new MeadowbrawlGame()
    g.startRun(weapon, { ...DEFAULT_RUN_CONFIG, ...config })
    g.spawnQueue = [{ time: 9999, type: 'grunt', count: 1, side: 'north' }]
    g.enemies = []
    return g
}

function save(over: Partial<MeadowbrawlRunSave> = {}): MeadowbrawlRunSave {
    return {
        version: MEADOWBRAWL_SAVE_VERSION,
        wave: 6,
        hp: 70,
        maxHp: 125,
        upgrades: { might: 3, doubledodge: 1, comboplus: 1 },
        offers: ['vigor', 'haste', 'burn'],
        coins: 12000,
        phoenixUsed: 1,
        stats: { kills: 80, elitesKilled: 1, damageDealt: 5000, damageTaken: 200, highestCombo: 12, time: 400 },
        ...over
    }
}

describe('coins', () => {
    it('every enemy carries a share of its wave pool, and the pools never exceed the server ceiling', () => {
        const g = new MeadowbrawlGame()
        g.startRun('sword')
        let cumulative = 0
        for (let wave = 1; wave <= MEADOWBRAWL_TOTAL_WAVES; wave++) {
            if (wave > 1) {
                g.restoreRun('sword', save({ wave: wave - 1, offers: null, upgrades: {} }))
                step(g, 1.7)
            }
            expect(g.wave).toBe(wave)
            // The opening group may already be on the field.
            let dropped = g.enemies.reduce((s, e) => s + e.coin, 0)
            for (const group of g.spawnQueue) {
                for (let i = 0; i < group.count; i++) dropped += g.spawnEnemy(group.type, group.side).coin
            }
            cumulative += dropped
            expect(dropped).toBeGreaterThan(0)
            expect(cumulative).toBeLessThanOrEqual(meadowbrawlCoinCeiling(wave))
            // A full clear lands close to the ceiling — the slack is for rounding only.
            expect(cumulative).toBeGreaterThan(meadowbrawlCoinCeiling(wave) * 0.9)
            g.enemies = []
        }
    })

    it('the elite cadence matches what the payout ceiling assumes', () => {
        for (let wave = 1; wave <= MEADOWBRAWL_TOTAL_WAVES; wave++) {
            expect(eliteFor(wave).length, `wave ${wave}`).toBe(meadowbrawlEliteCount(wave))
        }
    })

    it('a kill scatters coins that the player then walks over and banks', () => {
        const g = fresh()
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.entered = true
        e.state = 'chase'
        expect(e.coin).toBeGreaterThan(0)
        g.damageEnemy(e, 9999, { source: g.player, tag: 'melee' })
        expect(e.alive).toBe(false)
        expect(g.coinDrops.length).toBeGreaterThan(0)
        const total = g.coinDrops.reduce((s, c) => s + c.value, 0)
        expect(total).toBe(e.coin)
        step(g, 1.5)
        // Walk over whatever landed out of reach of the pull.
        for (let i = 0; i < 6 && g.coinDrops.length; i++) {
            g.player.x = g.coinDrops[0]!.x
            g.player.y = g.coinDrops[0]!.y
            step(g, 0.3)
        }
        expect(g.coinDrops.length).toBe(0)
        expect(g.coins).toBe(e.coin)
    })

    it('summoned brood carry no bounty', () => {
        const g = fresh()
        const mother = g.spawnEnemy('briar', 'north')
        mother.x = g.player.x + 240
        mother.y = g.player.y
        mother.entered = true
        mother.state = 'chase'
        step(g, 12)
        const brood = g.enemies.filter(e => e !== mother)
        expect(brood.length).toBeGreaterThan(0)
        expect(brood.every(e => e.coin === 0)).toBe(true)
    })
})

describe('checkpoints', () => {
    it('writes a valid save when boons are rolled and again after the pick', () => {
        const g = fresh()
        const checkpoints: MeadowbrawlRunSave[] = []
        g.onCheckpoint = s => checkpoints.push(s)
        g.coins = 777
        g.spawnQueue = []
        step(g, 2)
        expect(g.phase).toBe('upgrade')
        expect(checkpoints).toHaveLength(1)
        expect(checkpoints[0]!.wave).toBe(1)
        expect(checkpoints[0]!.offers).toHaveLength(3)
        expect(checkpoints[0]!.coins).toBe(777)
        g.chooseOffer(0)
        expect(checkpoints).toHaveLength(2)
        expect(checkpoints[1]!.wave).toBe(1)
        expect(checkpoints[1]!.offers).toBeNull()
        expect(Object.values(checkpoints[1]!.upgrades).reduce((a, b) => a + b, 0)).toBe(1)
        expect(g.wave).toBe(2)
        for (const s of checkpoints) expect(meadowbrawlValidateSave(s)).toBe(true)
    })

    it('restores a run at its pending pick, stacks and all', () => {
        const g = new MeadowbrawlGame()
        g.restoreRun('greataxe', save())
        expect(g.phase).toBe('upgrade')
        expect(g.wave).toBe(6)
        expect(g.player.weapon).toBe('greataxe')
        expect(g.player.hp).toBe(70)
        expect(g.player.maxHp).toBe(125)
        expect(g.stack('might')).toBe(3)
        expect(g.player.dodgeMax).toBe(2)
        expect(g.player.chain.length).toBe(3)
        expect(g.player.phoenixUsed).toBe(1)
        expect(g.coins).toBe(12000)
        expect(g.stats.kills).toBe(80)
        expect(g.offers.map(o => o.upgrade.id)).toEqual(['vigor', 'haste', 'burn'])
        g.chooseOffer(0)
        expect(g.wave).toBe(7)
        expect(g.phase).toBe('wave')
    })

    it('restores a run past its pick straight into the next wave', () => {
        const g = new MeadowbrawlGame()
        g.restoreRun('sword', save({ offers: null }))
        expect(g.phase).toBe('calm')
        step(g, 1.7)
        expect(g.phase).toBe('wave')
        expect(g.wave).toBe(7)
        expect(g.stack('might')).toBe(3)
    })

    it('a snapshot survives a round trip', () => {
        const g = new MeadowbrawlGame()
        g.restoreRun('sword', save())
        const again = g.snapshot()
        expect(again).toEqual(save({ stats: { ...save().stats, time: 400 } }))
    })
})
