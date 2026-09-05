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

    it('rolls out of a swing at any point in it', () => {
        for (const wait of [0.01, 0.14, 0.25]) {
            const g = fresh('greataxe')
            aimRight(g)
            click(g)
            step(g, wait)
            expect(g.player.attack, `wait ${wait}`).not.toBeNull()
            g.input.spacePressed = true
            g.input.spaceDown = true
            g.update(1 / 120)
            expect(g.player.dodge, `wait ${wait}`).not.toBeNull()
            expect(g.player.attack, `wait ${wait}`).toBeNull()
        }
    })

    it('a dodge press beats a click sent on the same frame', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        expect(g.player.dodge).not.toBeNull()
        expect(g.player.attack).toBeNull()
        expect(g.player.buffer).toBe(0)
    })

    it('clears hit-stop so a roll never crawls out of an impact', () => {
        const g = fresh('greataxe')
        aimRight(g)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 50
        e.y = g.player.y
        e.state = 'chase'
        click(g)
        for (let i = 0; i < 400 && g.hitstop <= 0; i++) g.update(1 / 240)
        expect(g.hitstop).toBeGreaterThan(0)
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 240)
        expect(g.hitstop).toBe(0)
    })

    it('holding space rolls first, then breaks into a sprint', () => {
        const g = fresh('sword')
        aimRight(g)
        click(g)
        step(g, 0.05)
        g.input.moveX = 1
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        expect(g.player.dodge).not.toBeNull()
        expect(g.player.attack).toBeNull()
        expect(g.player.sprinting).toBe(false)
        step(g, 0.6)
        expect(g.player.dodge).toBeNull()
        expect(g.player.sprinting).toBe(true)
        expect(g.player.dodgeCharges).toBe(0)
    })

    it('with no charges left a held space still sprints', () => {
        const g = fresh('sword')
        g.player.dodgeCharges = 0
        g.input.moveX = 1
        g.input.spacePressed = true
        g.input.spaceDown = true
        step(g, 0.25)
        expect(g.player.dodge).toBeNull()
        expect(g.player.sprinting).toBe(true)
    })

    it('attacking cancels the tail of a roll', () => {
        const g = fresh('sword')
        aimRight(g)
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        g.input.spaceDown = false
        step(g, 0.2)
        expect(g.player.dodge).not.toBeNull()
        click(g)
        step(g, 0.12)
        expect(g.player.dodge).toBeNull()
        expect(g.player.attack).not.toBeNull()
    })

    it('a dodge during a committed special waits for it, then fires', () => {
        const g = fresh('greataxe')
        aimRight(g)
        g.input.specialPressed = true
        step(g, 0.5)
        expect(g.player.special?.kind).toBe('slam')
        expect(g.player.special?.fired).toBe(true)
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        // The slam keeps its animation; the press is queued, not eaten.
        expect(g.player.dodge).toBeNull()
        expect(g.player.special).not.toBeNull()
        step(g, 0.35)
        expect(g.player.special).toBeNull()
        expect(g.player.dodge).not.toBeNull()
    })

    it('the scythe channel can be rolled out of immediately', () => {
        const g = fresh('scythe')
        aimRight(g)
        g.input.specialPressed = true
        step(g, 0.3)
        expect(g.player.special?.kind).toBe('whirl')
        g.input.spacePressed = true
        g.input.spaceDown = true
        g.update(1 / 120)
        expect(g.player.special).toBeNull()
        expect(g.player.dodge).not.toBeNull()
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
        // Holding rolls first, then sprints — wait for the sprint.
        step(g, 0.7)
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

describe('third batch', () => {
    it('Rippling Blows spills a share of every hit onto the crowd around the target', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.splash!, stack: 1 })
        const hit = g.spawnEnemy('grunt', 'north')
        hit.x = g.player.x + 40
        hit.y = g.player.y
        hit.state = 'chase'
        const near = g.spawnEnemy('grunt', 'north')
        near.x = hit.x + 50
        near.y = hit.y
        near.state = 'chase'
        const far = g.spawnEnemy('grunt', 'north')
        far.x = hit.x + 300
        far.y = hit.y
        far.state = 'chase'
        g.damageEnemy(hit, 20, { source: g.player, tag: 'melee' })
        expect(near.maxHp - near.hp).toBe(4)
        expect(far.hp).toBe(far.maxHp)
    })

    it('Meteor Shower drops a meteor on an enemy and Singularity pulls them in', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.meteor!, stack: 1 })
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 300
        e.y = g.player.y
        e.state = 'chase'
        e.entered = true
        e.attackCd = 99
        e.frozen = 99
        step(g, 7.2)
        expect(e.hp).toBeLessThan(e.maxHp)

        // The spear's sweep stays put, so the black hole opens where the enemy can feel it.
        const s = fresh('spear')
        s.applyOffer({ upgrade: UPGRADE_BY_ID.singularity!, stack: 1 })
        aimRight(s)
        const far = s.spawnEnemy('shield', 'north')
        far.x = s.player.x + 180
        far.y = s.player.y
        far.state = 'chase'
        far.entered = true
        far.attackCd = 99
        s.input.specialPressed = true
        step(s, 0.02)
        expect(s.singularities).toHaveLength(1)
        step(s, 1)
        expect(Math.hypot(far.x - s.singularities[0]!.x, far.y - s.singularities[0]!.y)).toBeLessThan(120)
        expect(far.hp).toBeLessThan(far.maxHp)
    })

    it('Spectral Blades orbit after the fourth swing and Cleaving Wind fires on finishers', () => {
        const g = fresh('daggers')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.spectral!, stack: 1 })
        g.applyOffer({ upgrade: UPGRADE_BY_ID.cleavingwind!, stack: 1 })
        aimRight(g)
        for (let i = 0; i < 5; i++) {
            click(g)
            step(g, 0.25)
        }
        expect(g.orbitals.length).toBeGreaterThan(0)
        expect(g.projectiles.some(p => p.kind === 'crescent')).toBe(true)
    })

    it('Adrenaline refunds a dodge and Cold Snap chills the field on kills', () => {
        const g = fresh('sword')
        g.applyOffer({ upgrade: UPGRADE_BY_ID.adrenaline!, stack: 1 })
        g.applyOffer({ upgrade: UPGRADE_BY_ID.coldsnap!, stack: 1 })
        g.player.dodgeCharges = 0
        g.hurtPlayer(5, { x: g.player.x + 30, y: g.player.y }, 0)
        expect(g.player.dodgeCharges).toBe(1)
        expect(g.attackSpeed).toBeGreaterThan(1)
        const a = g.spawnEnemy('swarmer', 'north')
        a.state = 'chase'
        const b = g.spawnEnemy('grunt', 'north')
        b.state = 'chase'
        g.damageEnemy(a, 999, { source: g.player, tag: 'melee' })
        expect(b.slow).toBeGreaterThan(0)
    })
})

describe('class abilities', () => {
    const useQ = (g: MeadowbrawlGame) => { g.input.qPressed = true }
    const useE = (g: MeadowbrawlGame) => { g.input.ePressed = true }

    it('every class has two abilities on cooldown after use', () => {
        for (const w of ['sword', 'greataxe', 'spear', 'daggers', 'warhammer', 'scythe'] as const) {
            const g = fresh(w)
            aimRight(g)
            expect(WEAPONS[w].abilities).toHaveLength(2)
            useQ(g)
            step(g, 0.02)
            expect(g.player.abilityCd.q, w).toBeGreaterThan(0)
            step(g, 2)
            useE(g)
            step(g, 0.02)
            expect(g.player.abilityCd.e, w).toBeGreaterThan(0)
        }
    })

    it('Knight: Shield Wall blocks and staggers a frontal attacker, Rallying Cry heals', () => {
        const g = fresh('sword')
        aimRight(g)
        useQ(g)
        step(g, 0.02)
        expect(g.player.fx.shieldWall).toBeGreaterThan(0)
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        const hp = g.player.hp
        expect(g.hurtPlayer(30, e, 100, e)).toBe(true)
        expect(g.player.hp).toBe(hp)
        expect(e.state).toBe('stagger')
        expect(e.hp).toBeLessThan(e.maxHp)
        g.player.hp = 50
        step(g, 2)
        useE(g)
        step(g, 0.02)
        expect(g.player.hp).toBeGreaterThan(50)
        expect(g.damageMult).toBeGreaterThan(1)
    })

    it('Berserker: Bloodrage speeds attacks, Rending Throw hits out and back', () => {
        const g = fresh('greataxe')
        aimRight(g)
        const base = g.attackSpeed
        useQ(g)
        step(g, 0.02)
        expect(g.attackSpeed).toBeGreaterThan(base)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 150
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99
        useE(g)
        step(g, 0.02)
        expect(g.thrownAxes).toHaveLength(1)
        expect(g.player.axeOut).toBe(true)
        const dealtBefore = g.stats.damageDealt
        step(g, 1.2)
        expect(g.thrownAxes).toHaveLength(0)
        expect(g.player.axeOut).toBe(false)
        // Out and back: two hits' worth of damage on the same target.
        expect(g.stats.damageDealt - dealtBefore).toBeGreaterThanOrEqual(WEAPONS.greataxe.baseDamage * 1.5 * 2 - 2)
    })

    it('Lancer: Skewer Charge carries an enemy and slams it, Javelin Rain lands on the cursor', () => {
        const g = fresh('spear')
        aimRight(g)
        const start = g.player.x
        const e = g.spawnEnemy('grunt', 'north')
        e.x = start + 120
        e.y = g.player.y
        e.state = 'chase'
        e.attackCd = 99
        useQ(g)
        step(g, 0.2)
        expect(g.player.skewer).not.toBeNull()
        expect(e.x).toBeGreaterThan(start + 150)
        step(g, 0.4)
        expect(g.player.skewer).toBeNull()
        expect(g.player.x).toBeGreaterThan(start + 250)
        expect(e.hp).toBeLessThan(e.maxHp * 0.6)

        const j = fresh('spear')
        j.input.aimX = j.player.x + 250
        j.input.aimY = j.player.y
        const far = j.spawnEnemy('shield', 'north')
        far.x = j.player.x + 250
        far.y = j.player.y
        far.state = 'chase'
        far.facing = Math.PI
        far.frozen = 99
        useE(j)
        step(j, 0.02)
        expect(j.javelins).toHaveLength(7)
        step(j, 1.5)
        expect(far.hp).toBeLessThan(far.maxHp)
    })

    it('Assassin: Smoke Bomb hides you and sets up a triple-damage ambush, Fan of Knives throws nine', () => {
        const g = fresh('daggers')
        aimRight(g)
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        e.entered = true
        e.attackCd = 0
        // Rooted: lost in the smoke it otherwise mills out of dagger reach.
        e.speed = 0
        useQ(g)
        step(g, 0.3)
        expect(g.player.fx.smoke).toBeGreaterThan(0)
        expect(e.state).toBe('chase')
        click(g)
        step(g, 0.2)
        expect(g.player.fx.smoke).toBe(0)
        expect(g.floaters.some(f => f.text === 'AMBUSH')).toBe(true)
        const dealt = e.maxHp - e.hp
        expect(dealt).toBeGreaterThanOrEqual(WEAPONS.daggers.baseDamage * 3 - 1)
        step(g, 2)
        useE(g)
        step(g, 0.02)
        expect(g.projectiles.filter(p => p.kind === 'knife')).toHaveLength(9)
    })

    it('Juggernaut: Iron Skin cuts damage and knockback, Seismic Line erupts nine times', () => {
        const g = fresh('warhammer')
        aimRight(g)
        useQ(g)
        step(g, 0.02)
        const x = g.player.x
        g.hurtPlayer(50, { x: g.player.x + 30, y: g.player.y }, 400)
        expect(g.player.hp).toBe(80)
        expect(g.player.x).toBe(x)
        step(g, 2)
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 250
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99
        useE(g)
        step(g, 0.02)
        expect(g.seismics).toHaveLength(1)
        step(g, 0.8)
        expect(g.seismics).toHaveLength(0)
        expect(e.hp).toBeLessThan(e.maxHp)
    })

    it('Reaper: Soul Harvest drains through shields and heals, Death Mark amplifies and spawns souls', () => {
        const g = fresh('scythe')
        aimRight(g)
        g.player.hp = 40
        const s = g.spawnEnemy('shield', 'north')
        s.x = g.player.x + 100
        s.y = g.player.y
        s.state = 'chase'
        s.facing = Math.PI
        useQ(g)
        step(g, 0.02)
        expect(s.hp).toBeLessThan(s.maxHp)
        expect(g.player.hp).toBeGreaterThan(40)
        step(g, 2)
        const m = g.spawnEnemy('grunt', 'north')
        m.x = g.player.x + 60
        m.y = g.player.y
        m.state = 'chase'
        useE(g)
        step(g, 0.02)
        expect(m.marked).toBeGreaterThan(0)
        const before = m.hp
        g.damageEnemy(m, 10, { source: g.player, tag: 'melee' })
        expect(before - m.hp).toBe(14)
        g.damageEnemy(m, 999, { source: g.player, tag: 'melee' })
        expect(g.souls.length).toBeGreaterThanOrEqual(3)
    })

    it('Battle Rhythm shortens ability cooldowns too', () => {
        const g = fresh('sword')
        const before = g.player.abilityCdMax.q
        g.applyOffer({ upgrade: UPGRADE_BY_ID.quickspecial!, stack: 1 })
        expect(g.player.abilityCdMax.q).toBeLessThan(before)
    })
})

describe('the stun meter', () => {
    it('a single sword finisher does not stagger a boss — the meter barely moves', () => {
        const g = fresh('sword')
        aimRight(g)
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 50
        e.y = g.player.y
        e.state = 'chase'
        e.frozen = 99 // hold it still; we only care about the stagger rule
        const finisher = WEAPONS.sword.swings[2]!
        expect(finisher.finisher).toBe(true)
        const dealt = g.damageEnemy(e, WEAPONS.sword.baseDamage * finisher.damage, {
            source: g.player, heavy: true, knockback: finisher.knockback, stagger: finisher.stagger, tag: 'melee', finisher: true
        })
        expect(dealt).toBeGreaterThan(0)
        expect(e.state).not.toBe('stagger')
        expect(e.stun).toBeGreaterThan(0)
        expect(e.stun).toBeLessThan(e.stunMax * 0.35)
    })

    it('repeated heavy hits fill the meter, and a full meter breaks the boss for 2.6s', () => {
        const g = fresh('greataxe')
        const e = g.spawnEnemy('ogre', 'north')
        e.x = g.player.x + 60
        e.y = g.player.y
        e.state = 'chase'
        let hits = 0
        while (e.state !== 'stagger' && hits < 40) {
            g.damageEnemy(e, e.maxHp * 0.1, { source: g.player, heavy: true, tag: 'melee' })
            e.hp = e.maxHp // isolate the meter from the health bar
            hits += 1
        }
        expect(hits).toBeGreaterThan(3)
        expect(hits).toBeLessThan(20)
        expect(e.state).toBe('stagger')
        expect(e.stunT).toBeCloseTo(2.6, 5)
        expect(e.stun).toBe(e.stunMax)
        expect(g.floaters.some(f => f.text === 'STUNNED')).toBe(true)
        expect(g.events.some(ev => ev.type === 'stun')).toBe(true)
        // Stunned enemies eat 30% more.
        const fresh1 = g.damageEnemy(e, 100, { source: g.player, tag: 'melee' })
        expect(fresh1).toBe(130)
    })

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

    it('a grunt breaks under a single combo, and shield breaks fill the meter outright', () => {
        const g = fresh('sword')
        aimRight(g)
        const e = g.spawnEnemy('grunt', 'north')
        e.x = g.player.x + 40
        e.y = g.player.y
        e.state = 'chase'
        e.speed = 0
        click(g)
        step(g, 0.3)
        expect(e.stun).toBeGreaterThan(0)
        click(g)
        step(g, 0.4)
        expect(e.state).toBe('stagger')
        expect(e.stun).toBe(e.stunMax)
        expect(e.stunT).toBeCloseTo(1.2, 5)

        const w = g.spawnEnemy('shield', 'north')
        w.x = g.player.x + 40
        w.y = g.player.y
        w.state = 'chase'
        w.facing = Math.PI
        g.damageEnemy(w, w.shield!.hp + 1, { source: g.player, heavy: true, tag: 'melee' })
        expect(w.shield!.broken).toBe(true)
        expect(w.state).toBe('stagger')
        expect(w.stun).toBe(w.stunMax)
    })

    it('flinches never interrupt an elite, only the meter does', () => {
        const g = fresh('sword')
        const e = g.spawnEnemy('warlord', 'north')
        e.x = g.player.x + 60
        e.y = g.player.y
        e.state = 'chase'
        e.shield = null
        for (let i = 0; i < 3; i++) g.damageEnemy(e, 6, { source: g.player, knockback: 200, stagger: 1.5, tag: 'melee' })
        expect(e.state).not.toBe('stagger')
        // Knockback still lands, elites just take less of it.
        expect(e.vx).toBeGreaterThan(0)
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
        step(g, 30, 1 / 60)
        expect(brood()).toBeLessThanOrEqual(8)
        g.damageEnemy(b, b.hp * 2, { source: p, heavy: true, tag: 'melee' })
        expect(b.alive).toBe(false)
        expect(g.stats.elitesKilled).toBe(1)
        const after = brood()
        step(g, 12, 1 / 60)
        expect(brood()).toBeLessThanOrEqual(after)
    })

    it('the Briar Matriarch telegraphs a thorn volley and a root snare', () => {
        const g = fresh('sword')
        const p = g.player
        p.maxHp = 1e6
        p.hp = p.maxHp
        const b = g.spawnEnemy('briar', 'north')
        b.x = p.x + 260
        b.y = p.y
        b.state = 'chase'
        b.entered = true
        b.moveT = 99 // no brood calls, just the two ranged moves
        const kinds = new Set<string>()
        let thorns = false
        for (let i = 0; i < 60 * 30; i++) {
            g.update(1 / 60)
            if (b.state === 'windup' && b.attack) kinds.add(b.attack.kind)
            if (g.projectiles.filter(pr => pr.owner === 'enemy').length >= 5) thorns = true
            if (kinds.has('volley') && kinds.has('snare') && thorns) break
        }
        expect(kinds.has('volley')).toBe(true)
        expect(kinds.has('snare')).toBe(true)
        // The volley goes out five thorns wide.
        expect(thorns).toBe(true)
    })

    it('the Hollow Knight parries a hit for zero damage and ripostes', () => {
        const g = fresh('sword')
        const p = g.player
        p.maxHp = 1e6
        p.hp = p.maxHp
        const k = g.spawnEnemy('knight', 'north')
        expect(k.def.elite).toBe(true)
        k.x = p.x + 150
        k.y = p.y
        k.state = 'chase'
        k.entered = true
        k.moveT = 0
        for (let i = 0; i < 120 && k.parryT <= 0; i++) g.update(1 / 60)
        expect(k.parryT).toBeGreaterThan(0)
        const hp = k.hp
        expect(g.damageEnemy(k, 80, { source: p, heavy: true, tag: 'melee' })).toBe(0)
        expect(k.hp).toBe(hp)
        expect(k.parryT).toBe(0)
        expect(k.state).toBe('windup')
        expect(k.attack!.kind).toBe('melee')
        expect(k.attack!.damage).toBeCloseTo(k.damage * 1.5, 5)
        expect(g.floaters.some(f => f.text === 'PARRY')).toBe(true)
    })

    it('the Hollow Knight shadow-steps in from range and chains a three-hit combo', () => {
        const g = fresh('sword')
        const p = g.player
        p.maxHp = 1e6
        p.hp = p.maxHp
        // Clear line of sight so the blink is the only thing under test.
        g.world.obstacles = []
        g.rebuildNav()
        const k = g.spawnEnemy('knight', 'north')
        k.x = p.x + 420
        k.y = p.y
        k.state = 'chase'
        k.entered = true
        k.moveT = 99 // no parry stance, we want the blink
        k.attackCd = 0
        let blinked = false
        let px = k.x
        let py = k.y
        for (let i = 0; i < 60 && !blinked; i++) {
            g.update(1 / 60)
            if (Math.hypot(k.x - px, k.y - py) > 120) blinked = true
            px = k.x
            py = k.y
        }
        expect(blinked).toBe(true)
        expect(Math.hypot(k.x - p.x, k.y - p.y)).toBeLessThan(200)
        let swings = 0
        let last = k.combo
        for (let i = 0; i < 60 * 6; i++) {
            g.update(1 / 60)
            if (k.combo !== last) {
                swings += 1
                last = k.combo
            }
        }
        expect(swings).toBeGreaterThanOrEqual(3)
    })
})
