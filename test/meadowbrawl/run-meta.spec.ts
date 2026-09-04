import { describe, expect, it } from 'vitest'
import { DEFAULT_RUN_CONFIG, MeadowbrawlGame, type RunConfig } from '../../app/utils/meadowbrawl/engine'
import { eliteFor } from '../../app/utils/meadowbrawl/waves'
import { UPGRADE_BY_ID, rollOffers } from '../../app/utils/meadowbrawl/upgrades'
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

    it('an idle pet fetches coins the player left lying around', () => {
        const g = fresh({ pet: { id: 'fox', level: 1 } })
        const p = g.player
        for (let i = 0; i < 3; i++) {
            g.coinDrops.push({ x: p.x + 200, y: p.y + 40 + i * 10, z: 0, vx: 0, vy: 0, vz: 0, value: 10, life: 20, seed: 0, size: 4, magnet: false })
        }
        step(g, 3)
        expect(g.coinDrops.length).toBe(0)
        expect(g.coins).toBe(30)
        // Not while something is on top of the player, though.
        const e = g.spawnEnemy('grunt', 'north')
        e.x = p.x + 60
        e.y = p.y
        e.entered = true
        e.state = 'chase'
        e.speed = 0
        e.attackCd = 99
        g.coinDrops.push({ x: p.x + 250, y: p.y, z: 0, vx: 0, vy: 0, vz: 0, value: 10, life: 20, seed: 0, size: 4, magnet: false })
        step(g, 2)
        expect(g.coinDrops.length).toBe(1)
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

describe('run config', () => {
    it('carries the coin multiplier for the HUD and never touches the player', () => {
        const g = fresh({ coinMult: 2.5 })
        expect(g.player.maxHp).toBe(100)
        expect(g.player.dodgeMax).toBe(1)
        expect(g.damageMult).toBe(1)
        expect(g.coinMult).toBe(2.5)
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

describe('companions', () => {
    it('the fox dashes through a pack and leaves fire behind', () => {
        const g = fresh({ pet: { id: 'fox', level: 3 } })
        expect(g.companion?.id).toBe('fox')
        expect(g.damageMult).toBeCloseTo(1.045)
        for (let i = 0; i < 4; i++) {
            const e = g.spawnEnemy('grunt', 'north')
            e.x = g.player.x + 150 + i * 12
            e.y = g.player.y + (i - 2) * 14
            e.entered = true
            e.state = 'chase'
            e.speed = 0
        }
        g.companion!.cd[0] = 0
        step(g, 0.05)
        expect(g.companion!.dash).not.toBeNull()
        step(g, 1.5)
        expect(g.companion!.trails.length).toBeGreaterThan(0)
        expect(g.stats.damageDealt).toBeGreaterThan(0)
        expect(g.companion!.cd[0]).toBeGreaterThan(0)
    })

    it('the tortoise wards one hit and mends when low', () => {
        const g = fresh({ pet: { id: 'tortoise', level: 6 } })
        const c = g.companion!
        expect(g.player.maxHp).toBe(118)
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 200
        e.y = g.player.y
        e.entered = true
        e.state = 'chase'
        e.speed = 0
        c.cd[0] = 0
        step(g, 0.05)
        expect(c.ward).toBe(true)
        const hp = g.player.hp
        expect(g.hurtPlayer(30, e, 0, e)).toBe(true)
        expect(g.player.hp).toBe(hp)
        expect(c.ward).toBe(false)
        // Damage reduction on the next one.
        g.player.invuln = 0
        g.hurtPlayer(50, e, 0, e)
        expect(g.player.hp).toBe(hp - 47)
        g.player.hp = 20
        c.cd[1] = 0
        step(g, 1)
        expect(g.player.hp).toBeGreaterThan(20)
    })

    it('the owl gusts a crowd back and drops a lucky feather', () => {
        const g = fresh({ pet: { id: 'owl', level: 6 } })
        const c = g.companion!
        const p = g.player
        for (let i = 0; i < 4; i++) {
            const e = g.spawnEnemy('grunt', 'north')
            const a = i / 4 * Math.PI * 2
            e.x = p.x + Math.cos(a) * 40
            e.y = p.y + Math.sin(a) * 40
            e.entered = true
            e.state = 'chase'
            e.speed = 0
        }
        c.cd[0] = 0
        c.cd[1] = 0
        step(g, 0.05)
        expect(c.gust).toBeGreaterThan(0)
        expect(g.enemies.every(e => e.stun > 0 || e.state === 'stagger')).toBe(true)
        expect(c.feather).not.toBeNull()
        p.abilityCd.q = 10
        p.x = c.feather!.x
        p.y = c.feather!.y
        step(g, 0.1)
        expect(c.feather?.taken).toBe(true)
        expect(p.abilityCd.q).toBeLessThan(6)
        expect(g.attackSpeed).toBeGreaterThan(1.2)
    })
})

describe('fourth batch boons', () => {
    function grant(g: MeadowbrawlGame, id: string, stacks = 1) {
        for (let i = 0; i < stacks; i++) g.applyOffer({ upgrade: UPGRADE_BY_ID[id]!, stack: i + 1 })
    }

    function grunt(g: MeadowbrawlGame, dx: number, dy = 0) {
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + dx
        e.y = g.player.y + dy
        e.entered = true
        e.state = 'chase'
        e.speed = 0
        e.attackCd = 99
        return e
    }

    it('Thunder Step strikes where you dodged from and Rolling Kick bowls over what you roll through', () => {
        const g = fresh()
        grant(g, 'thunderstep')
        grant(g, 'rollimpact')
        const near = grunt(g, 40)
        const far = grunt(g, 120)
        g.input.moveX = 1
        g.input.spacePressed = true
        g.input.spaceDown = true
        step(g, 0.05)
        g.input.spaceDown = false
        expect(near.hp).toBeLessThan(near.maxHp)
        expect(far.hp).toBe(far.maxHp)
        step(g, 0.5)
        expect(far.stun).toBeGreaterThan(0)
        expect(far.vx).toBeGreaterThan(0)
    })

    it('Kill Frenzy stacks damage on kills and fades', () => {
        const g = fresh()
        grant(g, 'frenzy')
        const e = grunt(g, 40)
        g.damageEnemy(e, 9999, { source: g.player, tag: 'melee' })
        expect(g.player.frenzy).toBe(1)
        expect(g.damageMult).toBeCloseTo(1.08)
        step(g, 5.2)
        expect(g.player.frenzy).toBe(0)
    })

    it('Meadow\'s Mercy regenerates only after a lull', () => {
        const g = fresh()
        grant(g, 'regen', 2)
        g.player.hp = 50
        g.player.hurtIdle = 0
        step(g, 3)
        expect(g.player.hp).toBe(50)
        step(g, 3)
        expect(g.player.hp).toBeGreaterThan(53)
    })

    it('Chronoshear slows the field when you are hit, once per ten seconds', () => {
        const g = fresh()
        grant(g, 'chrono')
        const a = grunt(g, 60)
        const b = grunt(g, -200)
        g.hurtPlayer(10, a, 0, a)
        expect(a.slow).toBeGreaterThanOrEqual(0.8)
        expect(b.slow).toBeGreaterThanOrEqual(0.8)
        expect(g.player.chronoCd).toBe(10)
        expect(g.events.some(ev => ev.type === 'chrono')).toBe(true)
    })

    it('Avatar of the Meadow turns every sixth swing into a field-wide sweep', () => {
        const g = fresh('greataxe')
        grant(g, 'avatar')
        const behind = grunt(g, -70)
        behind.hp = behind.maxHp = 1e6
        const home = { x: g.player.x, y: g.player.y }
        let swings = 0
        for (let i = 0; i < 60 && g.swingCount < 6; i++) {
            // Swings step forward; hold the player in place so "behind" stays behind.
            g.player.x = home.x
            g.player.y = home.y
            g.input.aimX = home.x + 100
            g.input.aimY = home.y
            g.input.attackPressed = true
            step(g, 0.2)
            swings = g.swingCount
        }
        expect(swings).toBeGreaterThanOrEqual(6)
        expect(behind.hp).toBeLessThan(1e6)
        expect(g.events.some(ev => ev.type === 'avatar')).toBe(true)
    })

    it('Stormcaller rains bolts while a combo is live', () => {
        const g = fresh()
        grant(g, 'stormcaller')
        const e = grunt(g, 200)
        e.hp = e.maxHp = 1e6
        g.input.aimX = g.player.x + 100
        g.input.aimY = g.player.y
        g.input.attackPressed = true
        step(g, 0.9)
        expect(e.hp).toBeLessThan(1e6)
        expect(g.events.some(ev => ev.type === 'storm')).toBe(true)
    })

    it('Magpie widens the coin pull', () => {
        const g = fresh()
        grant(g, 'magpie', 2)
        const p = g.player
        g.coinDrops.push({ x: p.x + 190, y: p.y, z: 0, vx: 0, vy: 0, vz: 0, value: 5, life: 20, seed: 0, size: 4, magnet: false })
        step(g, 1.5)
        expect(g.coins).toBe(5)
    })

    it('legendaries never show before wave six', () => {
        for (let i = 0; i < 40; i++) {
            for (const o of rollOffers(3, new Map())) expect(o.upgrade.rarity).not.toBe('legendary')
        }
    })
})
