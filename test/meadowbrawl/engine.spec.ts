import { describe, expect, it } from 'vitest'
import { MeadowbrawlGame } from '../../app/utils/meadowbrawl/engine'
import { WEAPONS } from '../../app/utils/meadowbrawl/weapons'
import { weaponUpgradeDef, UPGRADE_BY_ID } from '../../app/utils/meadowbrawl/upgrades'

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

    it('buffers a click during the swing, but only chains once most of the recovery has played', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.05)
        expect(g.player.attack?.index).toBe(0)
        click(g)
        // Windup + active is over, recovery has barely begun: still swing 0.
        step(g, 0.2)
        expect(g.player.attack?.index).toBe(0)
        step(g, 0.2)
        expect(g.player.attack?.index).toBe(1)
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
        step(g, 0.45)
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

describe('second pass', () => {
    it('attacking while holding sprint does not get cancelled by the sprint restarting', () => {
        const g = fresh('sword')
        aimRight(g)
        g.input.moveX = 1
        g.input.spacePressed = true
        g.input.spaceDown = true
        step(g, 0.4)
        expect(g.player.sprinting).toBe(true)
        click(g)
        step(g, 0.05)
        expect(g.player.attack?.index).toBe(0)
        step(g, 0.1)
        expect(g.player.attack).not.toBeNull()
        expect(g.player.sprinting).toBe(false)
    })

    it('keeps the hit counter alive through a finisher', () => {
        const g = fresh('greataxe')
        aimRight(g)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 50
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99
        click(g)
        step(g, 0.05)
        click(g)
        step(g, 2.2)
        expect(g.player.attack).toBeNull()
        expect(g.player.comboHits).toBe(2)
        expect(g.player.comboTimer).toBeGreaterThan(0)
    })

    it('Titan Grip makes light hits break shields', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.titangrip!, stack: 1 })
        aimRight(g)
        const e = g.spawnEnemy('shield', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        e.facing = Math.PI
        e.shield!.hp = 1
        click(g)
        step(g, 0.3)
        expect(e.shield!.broken).toBe(true)
    })

    it('Executioner finishes weak enemies and Phoenix Feather cheats death once', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.execute!, stack: 1 })
        g.applyOffer({ upgrade: UPGRADE_BY_ID.phoenix!, stack: 1 })
        const e = g.spawnEnemy('grunt', 'north')
        e.state = 'chase'
        e.hp = e.maxHp * 0.15
        g.damageEnemy(e, 1, { source: g.player, tag: 'melee' })
        expect(e.alive).toBe(false)
        expect(g.floaters.some(f => f.text === 'EXECUTED')).toBe(true)

        g.hurtPlayer(9999, { x: g.player.x + 30, y: g.player.y }, 0)
        expect(g.phase).toBe('wave')
        expect(g.player.hp).toBe(Math.ceil(g.player.maxHp * 0.5))
        expect(g.player.phoenixUsed).toBe(1)
        g.player.invuln = 0
        g.hurtPlayer(9999, { x: g.player.x + 30, y: g.player.y }, 0)
        expect(g.phase).toBe('dead')
    })

    it('Echo Strike doubles every third hit', () => {
        const g = fresh('daggers')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.echo!, stack: 1 })
        aimRight(g)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99
        for (let i = 0; i < 3; i++) {
            click(g)
            step(g, 0.3)
        }
        expect(g.player.hitCount).toBe(3)
        expect(g.floaters.filter(f => /^\d+$/.test(f.text)).length).toBe(4)
    })

    it('Sky Fall leaps to the cursor and slams on landing; Reaper\'s Whirl drags enemies in', () => {
        const g = fresh('warhammer')
        const start = { x: g.player.x, y: g.player.y }
        g.input.aimX = start.x + 200
        g.input.aimY = start.y
        const e = g.spawnEnemy('grunt', 'north')
        e.x = start.x + 220
        e.y = start.y
        e.state = 'chase'
        g.input.specialPressed = true
        step(g, 0.02)
        expect(g.player.special?.kind).toBe('leap')
        step(g, 0.25)
        expect(g.player.z).toBeGreaterThan(20)
        step(g, 0.4)
        expect(g.player.x).toBeGreaterThan(start.x + 150)
        expect(g.player.z).toBe(0)
        expect(e.hp).toBeLessThan(e.maxHp)

        const s = fresh('scythe')
        aimRight(s)
        const far = s.spawnEnemy('grunt', 'north')
        far.x = s.player.x + 200
        far.y = s.player.y
        far.state = 'chase'
        far.entered = true
        far.attackCd = 99
        s.input.specialPressed = true
        step(s, 0.02)
        expect(s.player.special?.kind).toBe('whirl')
        step(s, 0.6)
        expect(far.x).toBeLessThan(s.player.x + 200)
        expect(far.hp).toBeLessThan(far.maxHp)
    })

    it('Bloodlust and Overcharge trigger on kills', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.bloodlust!, stack: 1 })
        g.applyOffer({ upgrade: UPGRADE_BY_ID.overcharge!, stack: 3 })
        g.player.upgrades.set('overcharge', 5)
        g.player.specialCd = 3
        const e = g.spawnEnemy('swarmer', 'north')
        e.state = 'chase'
        g.damageEnemy(e, 999, { source: g.player, tag: 'melee' })
        expect(g.player.bloodlust).toBe(1)
        expect(g.attackSpeed).toBeGreaterThan(1)
        expect(g.player.specialCd).toBe(0)
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

    it('routes around a wall of trunks with a gap', () => {
        const g = fresh('spear')
        const p = g.player
        g.world.obstacles = []
        for (let i = -6; i <= 6; i++) {
            if (i === 5) continue
            g.world.obstacles.push({ x: p.x + 150, y: p.y + i * 32, r: 14, kind: 'tree', seed: 0.5, scale: 1 })
        }
        g.rebuildNav()
        const e = g.spawnEnemy('swarmer', 'north')
        e.x = p.x + 300
        e.y = p.y
        e.state = 'chase'
        e.entered = true
        e.attackCd = 99
        step(g, 5)
        expect(Math.hypot(e.x - p.x, e.y - p.y)).toBeLessThan(70)
    })

    it('chargers and thornspitters wait for a clear line before committing', () => {
        const g = fresh('sword')
        const p = g.player
        g.world.obstacles = [{ x: p.x + 120, y: p.y, r: 40, kind: 'boulder', seed: 0.5, scale: 1.3 }]
        g.rebuildNav()
        const c = g.spawnEnemy('charger', 'north')
        c.x = p.x + 250
        c.y = p.y
        c.state = 'chase'
        c.entered = true
        c.attackCd = 0
        const r = g.spawnEnemy('ranged', 'north')
        r.x = p.x + 300
        r.y = p.y + 6
        r.state = 'chase'
        r.entered = true
        r.attackCd = 0
        step(g, 0.05)
        expect(c.state).toBe('chase')
        expect(r.state).toBe('chase')
    })
})
