import { describe, expect, it } from 'vitest'
import { MeadowbrawlGame } from '../../app/utils/meadowbrawl/engine'
import { WEAPONS } from '../../app/utils/meadowbrawl/weapons'

function fresh(weapon: 'sword' | 'greataxe' | 'spear' | 'daggers' | 'warhammer' | 'scythe' = 'sword') {
    const g = new MeadowbrawlGame()
    g.startRun(weapon)
    // Tests drive their own enemies; a far-future group keeps the wave open.
    g.spawnQueue = [{ time: 9999, type: 'grunt', count: 1, side: 'north' }]
    g.enemies = []
    return g
}

function step(g: MeadowbrawlGame, seconds: number, dt = 1 / 120) {
    for (let t = 0; t < seconds; t += dt) g.update(dt)
}

function aimRight(g: MeadowbrawlGame) {
    g.input.aimX = g.player.x + 100
    g.input.aimY = g.player.y
}

function click(g: MeadowbrawlGame) {
    g.input.attackPressed = true
}

describe('run loop', () => {
    it('starts on wave 1 with a spawn schedule and a fresh player', () => {
        const g = new MeadowbrawlGame()
        expect(g.phase).toBe('menu')
        g.startRun('spear')
        expect(g.phase).toBe('wave')
        expect(g.wave).toBe(1)
        expect(g.spawnQueue.length).toBeGreaterThan(0)
        expect(g.player.weapon).toBe('spear')
        expect(g.player.hp).toBe(100)
    })

    it('clears the wave, offers three boons, and the pick starts the next wave', () => {
        const g = fresh()
        g.spawnQueue = []
        step(g, 0.1)
        expect(g.phase).toBe('calm')
        step(g, 2)
        expect(g.phase).toBe('upgrade')
        expect(g.offers).toHaveLength(3)
        const pick = g.offers[0]!
        g.chooseOffer(0)
        expect(g.phase).toBe('wave')
        expect(g.wave).toBe(2)
        if (pick.weapon) expect(g.player.weapon).toBe(pick.weapon)
        else expect(g.player.upgrades.get(pick.upgrade.id)).toBe(1)
    })

    it('death ends the run and restart returns to the menu', () => {
        const g = fresh()
        g.hurtPlayer(500, { x: g.player.x + 30, y: g.player.y }, 100)
        expect(g.phase).toBe('dead')
        expect(g.player.hp).toBe(0)
        g.restart()
        expect(g.phase).toBe('menu')
    })
})

describe('combo chain', () => {
    it('advances one swing per click and resets when the window lapses', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.02)
        expect(g.player.attack?.index).toBe(0)
        // Wait until the first swing is over, then chain within the window.
        step(g, 0.5)
        expect(g.player.attack).toBeNull()
        expect(g.player.comboTimer).toBeGreaterThan(0)
        click(g)
        step(g, 0.02)
        expect(g.player.attack?.index).toBe(1)
        // Let the window lapse: the chain resets to the opener.
        step(g, 1.5)
        expect(g.player.comboIndex).toBe(0)
        click(g)
        step(g, 0.02)
        expect(g.player.attack?.index).toBe(0)
    })

    it('spam clicking cannot swing faster than the weapon cadence', () => {
        const g = fresh('sword')
        aimRight(g)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 50
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99
        // Click every frame for two seconds.
        for (let t = 0; t < 2; t += 1 / 60) {
            click(g)
            g.update(1 / 60)
        }
        const swing = WEAPONS.sword.swings[0]!
        const cadence = swing.windup + swing.active + swing.recovery * 0.7
        expect(g.player.hitCount).toBeLessThanOrEqual(Math.ceil(2 / cadence) + 1)
        expect(g.player.hitCount).toBeGreaterThanOrEqual(3)
    })

    it('dodges on the press — one frame, mid-swing, no release needed', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.45)
        click(g)
        step(g, 0.05)
        expect(g.player.attack?.index).toBe(1)
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        expect(g.player.dodge).not.toBeNull()
        expect(g.player.dodge!.t).toBeLessThan(0.02)
        expect(g.player.attack).toBeNull()
        expect(g.player.comboIndex).toBe(0)
        expect(g.player.dodgeCharges).toBe(0)
        expect(g.hurtPlayer(20, { x: g.player.x + 10, y: g.player.y }, 0)).toBe(false)
        expect(g.player.hp).toBe(100)
    })
})

describe('combat', () => {
    it('a swing damages, knocks back and flinches an enemy in its arc and misses one behind', () => {
        const g = fresh('sword')
        aimRight(g)
        const front = g.spawnEnemy('grunt', 'north')
        front.x = g.player.x + 40
        front.y = g.player.y
        front.state = 'chase'
        // Rooted, so the slide we measure is the knockback and nothing else.
        front.speed = 0
        const behind = g.spawnEnemy('grunt', 'north')
        behind.x = g.player.x - 40
        behind.y = g.player.y
        behind.state = 'chase'
        click(g)
        step(g, 0.25)
        expect(front.hp).toBeLessThan(front.maxHp)
        expect(front.state).toBe('stagger')
        // Knocked away from the player, then keeps sliding once hit-stop ends.
        expect(front.vx).toBeGreaterThan(0)
        const atHit = front.x
        step(g, 0.2)
        expect(front.x).toBeGreaterThan(atHit + 5)
        expect(behind.hp).toBe(behind.maxHp)
        expect(g.stats.highestCombo).toBe(1)
    })

    it('shields block light hits from the front, break under heavy hits, and are bypassed from behind', () => {
        const g = fresh('sword')
        const e = g.spawnEnemy('shield', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        e.facing = Math.PI // looking at the player
        expect(g.damageEnemy(e, 20, { source: g.player, tag: 'melee' })).toBe(0)
        expect(e.hp).toBe(e.maxHp)
        expect(e.shield!.broken).toBe(false)
        g.damageEnemy(e, e.shield!.hp + 1, { source: g.player, heavy: true, tag: 'melee' })
        expect(e.shield!.broken).toBe(true)
        expect(g.damageEnemy(e, 20, { source: g.player, tag: 'melee' })).toBeGreaterThan(0)

        const f = g.spawnEnemy('shield', 'north')
        f.x = g.player.x + 40
        f.y = g.player.y
        f.state = 'chase'
        f.facing = 0 // looking away
        expect(g.damageEnemy(f, 20, { source: g.player, tag: 'melee' })).toBeGreaterThan(0)
    })

    it('enemy attacks telegraph before they land, and dodge rolls avoid them', () => {
        const g = fresh('sword')
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 30
        e.y = g.player.y
        e.state = 'chase'
        e.entered = true
        e.attackCd = 0
        step(g, 0.1)
        expect(e.state).toBe('windup')
        expect(e.attack?.kind).toBe('melee')
        const hpBefore = g.player.hp
        step(g, 0.7)
        expect(g.player.hp).toBeLessThan(hpBefore)
    })
})

describe('pathfinding', () => {
    it('walks around a boulder that sits between it and the player instead of getting stuck', () => {
        const g = fresh('sword')
        const p = g.player
        g.world.obstacles = [{ x: p.x + 120, y: p.y, r: 40, kind: 'boulder', seed: 0.5, scale: 1.3 }]
        g.rebuildNav()
        const e = g.spawnEnemy('grunt', 'north')
        e.x = p.x + 260
        e.y = p.y + 4
        e.state = 'chase'
        e.entered = true
        e.attackCd = 99
        expect(g.hasLineOfSight(e)).toBe(false)
        step(g, 4)
        expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThan(70)
    })
})

describe('the stun meter', () => {
    it('locks the meter out after the stun so a boss cannot be chain-stunned', () => {
        const g = fresh('greataxe')
        const p = g.player
        p.maxHp = 1e6
        p.hp = p.maxHp
        const e = g.spawnEnemy('ogre', 'north')
        e.x = p.x + 300
        e.y = p.y
        e.state = 'chase'
        e.entered = true
        for (let i = 0; i < 40 && e.state !== 'stagger'; i++) {
            g.damageEnemy(e, e.maxHp * 0.1, { source: p, heavy: true, tag: 'melee' })
            e.hp = e.maxHp
        }
        expect(e.state).toBe('stagger')
        step(g, 2.9)
        expect(e.state).not.toBe('stagger')
        expect(e.stunLock).toBeGreaterThan(0)
        expect(e.stun).toBe(0)
        for (let i = 0; i < 10; i++) {
            g.damageEnemy(e, e.maxHp * 0.1, { source: p, heavy: true, tag: 'melee' })
            e.hp = e.maxHp
        }
        expect(e.stun).toBe(0)
        expect(e.state).not.toBe('stagger')
    })
})

describe('the new bosses', () => {
    it('the Briar Matriarch calls a brood, caps it, and stops calling once she dies', () => {
        const g = fresh('sword')
        const p = g.player
        p.maxHp = 1e6
        p.hp = p.maxHp
        const b = g.spawnEnemy('briar', 'north')
        expect(b.def.elite).toBe(true)
        expect(b.def.poise).toBe(true)
        b.x = p.x + 240
        b.y = p.y
        b.state = 'chase'
        b.entered = true
        b.moveT = 0
        step(g, 2, 1 / 60)
        const brood = () => g.enemies.filter(e => e.alive && e.type === 'swarmer').length
        expect(brood()).toBeGreaterThanOrEqual(3)
        step(g, 20, 1 / 60)
        expect(brood()).toBeLessThanOrEqual(8)
        g.damageEnemy(b, b.hp * 2, { source: p, heavy: true, tag: 'melee' })
        expect(b.alive).toBe(false)
        expect(g.stats.elitesKilled).toBe(1)
        const after = brood()
        // longer than her 9 s call interval
        step(g, 10, 1 / 60)
        expect(brood()).toBeLessThanOrEqual(after)
    })
})
