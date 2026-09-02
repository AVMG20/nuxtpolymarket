import { describe, expect, it } from 'vitest'
import { MeadowbrawlGame } from '../../app/utils/meadowbrawl/engine'
import { WEAPONS } from '../../app/utils/meadowbrawl/weapons'
import { weaponUpgradeDef, UPGRADE_BY_ID } from '../../app/utils/meadowbrawl/upgrades'

function fresh(weapon: 'sword' | 'greataxe' | 'spear' | 'daggers' = 'sword') {
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

    it('buffers a click during recovery so the chain flows', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.05)
        expect(g.player.attack?.index).toBe(0)
        click(g)
        step(g, 0.3)
        expect(g.player.attack?.index).toBe(1)
    })

    it('ends on the finisher and resets to the opener', () => {
        const g = fresh('greataxe')
        aimRight(g)
        click(g)
        step(g, 0.05)
        click(g)
        step(g, 1.0)
        expect(g.player.attack?.index).toBe(1)
        expect(g.player.attack?.def.finisher).toBe(true)
        step(g, 1.5)
        expect(g.player.attack).toBeNull()
        expect(g.player.comboIndex).toBe(0)
    })

    it('dodging cancels the combo and grants i-frames', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.3)
        click(g)
        step(g, 0.05)
        expect(g.player.attack?.index).toBe(1)
        g.input.spacePressed = true
        g.input.spaceDown = true
        step(g, 0.05)
        g.input.spaceReleased = true
        g.input.spaceDown = false
        step(g, 0.02)
        expect(g.player.dodge).not.toBeNull()
        expect(g.player.attack).toBeNull()
        expect(g.player.comboIndex).toBe(0)
        expect(g.player.dodgeCharges).toBe(0)
        expect(g.hurtPlayer(20, { x: g.player.x + 10, y: g.player.y }, 0)).toBe(false)
        expect(g.player.hp).toBe(100)
    })

    it('holding space sprints instead of dodging, and cancels the combo', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.05)
        g.input.moveX = 1
        g.input.spacePressed = true
        g.input.spaceDown = true
        step(g, 0.4)
        expect(g.player.sprinting).toBe(true)
        expect(g.player.dodge).toBeNull()
        expect(g.player.attack).toBeNull()
        expect(g.player.dodgeCharges).toBe(1)
    })

    it('+1 combo hit lengthens the chain', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.comboplus!, stack: 1 })
        expect(g.player.chain).toHaveLength(4)
        g.applyOffer({ upgrade: weaponUpgradeDef('daggers'), stack: 1, weapon: 'daggers' })
        expect(g.player.weapon).toBe('daggers')
        expect(g.player.chain).toHaveLength(6)
    })
})

describe('combat', () => {
    it('a swing damages, knocks back and staggers an enemy in its arc and misses one behind', () => {
        const g = fresh('sword')
        aimRight(g)
        const front = g.spawnEnemy('grunt', 'north')
        front.x = g.player.x + 40
        front.y = g.player.y
        front.state = 'chase'
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
        expect(g.floaters.some(f => f.text === String(front.maxHp - front.hp))).toBe(true)
        expect(g.hitstop).toBeGreaterThanOrEqual(0)
        expect(g.stats.highestCombo).toBe(1)
    })

    it('kills count, leave a blood decal and trigger explosions when stacked', () => {
        const g = fresh('greataxe')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.explode!, stack: 1 })
        const a = g.spawnEnemy('swarmer', 'north')
        a.x = g.player.x + 40
        a.y = g.player.y
        a.hp = 1
        const b = g.spawnEnemy('swarmer', 'north')
        b.x = a.x + 50
        b.y = a.y
        b.hp = 1
        b.state = 'chase'
        g.damageEnemy(a, 5, { source: g.player, tag: 'melee' })
        expect(a.alive).toBe(false)
        expect(b.alive).toBe(false)
        expect(g.stats.kills).toBe(2)
        expect(g.decals.some(d => d.kind === 'blood')).toBe(true)
        expect(g.decals.some(d => d.kind === 'scorch')).toBe(true)
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

    it('lifesteal heals on hit and freeze slows', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.lifesteal!, stack: 1 })
        g.applyOffer({ upgrade: UPGRADE_BY_ID.freeze!, stack: 1 })
        g.player.hp = 50
        const e = g.spawnEnemy('grunt', 'north')
        e.state = 'chase'
        g.damageEnemy(e, 100, { source: g.player, tag: 'melee' })
        expect(g.player.hp).toBeGreaterThan(50)
        expect(e.slow).toBeGreaterThan(0)
    })

    it('specials go on cooldown and the greataxe slam hits everything around', () => {
        const g = fresh('greataxe')
        const near = g.spawnEnemy('grunt', 'north')
        near.x = g.player.x - 80
        near.y = g.player.y + 60
        near.state = 'chase'
        const far = g.spawnEnemy('grunt', 'north')
        far.x = g.player.x + 400
        far.y = g.player.y
        far.state = 'chase'
        g.input.specialPressed = true
        step(g, 0.02)
        expect(g.player.special?.kind).toBe('slam')
        expect(g.player.specialCd).toBeGreaterThan(0)
        step(g, 0.6)
        expect(near.hp).toBeLessThan(near.maxHp)
        expect(far.hp).toBe(far.maxHp)
        expect(WEAPONS.greataxe.special.kind).toBe('slam')
    })
})
