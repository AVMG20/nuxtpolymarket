/*
 * Elite affixes. The engine rolls them onto elites (1 from 2:00, 2 from 7:00,
 * 3 from 12:00), draws the aura in `color` with the name tag, and calls the
 * hooks below. Every affix is readable at a glance: a coloured aura, its own
 * particles, a telegraph before anything hurts, and its own sound.
 *
 * Scratch fields live in e.ai under an `ax` prefix so they never collide with
 * the enemy's own AI.
 */
import { aim, chance, hpMulOf, later, num, onScreen, panOf, pick, rand, ring, shoot, summon, teleport, tick } from './content-ai'
import type { EliteAffix, Enemy, GameApi } from './types'

const TAU = Math.PI * 2

/** Defs whose AI owns their position or that make no sense copied */
const NO_SPLIT = new Set(['champion', 'goblin', 'mimic', 'phylactery', 'broodEgg', 'wyrmSegment', 'wyrmTail'])
const NO_BLINK = new Set(['champion', 'lurker', 'worm', 'goblin', 'mimic'])

function near(e: Enemy, g: GameApi, r: number): boolean {
    const dx = g.player.x - e.x
    const dy = g.player.y - e.y
    return dx * dx + dy * dy < r * r
}

function sfx(e: Enemy, g: GameApi, name: Parameters<GameApi['sfx']['play']>[0], volume = 0.5, pitch = 1): void {
    if (onScreen(e, g, 80)) g.sfx.play(name, { volume, pitch, pan: panOf(e, g) })
}

export const ELITE_AFFIXES: Record<string, EliteAffix> = {
    vampiric: {
        id: 'vampiric',
        name: 'Vampiric',
        color: 0xff2d55,
        onHitPlayer(e, g) {
            const heal = e.maxHp * 0.15
            e.hp = Math.min(e.maxHp, e.hp + heal)
            g.particles(g.player.x, g.player.y, { count: 10, color: 0xff2d55, speed: 160, life: 0.4, size: 4 })
            g.particles(e.x, e.y, { count: 14, color: 0xff6a8a, speed: 120, life: 0.5, size: 5 })
            sfx(e, g, 'affixVamp', 0.6)
        },
        update(e, g, dt) {
            // a slow drip of life while it is near the player
            if (near(e, g, 180)) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt)
            if (chance(dt * 3)) g.particles(e.x + rand(-1, 1) * e.radius * 0.7, e.y + e.radius * 0.4, { count: 1, color: 0xb0102a, speed: 30, life: 0.6, size: 4, angle: Math.PI / 2, spread: 0.4 })
        }
    },
    shielded: {
        id: 'shielded',
        name: 'Shielded',
        color: 0x7fd8ff,
        apply(e) {
            e.ai.axShield = e.maxHp * 0.6
        },
        damageTaken(e, g, amount) {
            const left = num(e, 'axShield')
            if (left <= 0) return 1
            e.ai.axShield = left - amount * 0.5
            if (e.ai.axShield <= 0) {
                g.particles(e.x, e.y, { count: 34, color: 0x7fd8ff, speed: 360, life: 0.5, size: 5 })
                g.particles(e.x, e.y, { count: 14, color: 0xffffff, speed: 240, life: 0.35, size: 4 })
                sfx(e, g, 'shieldBreak', 0.7)
                g.shake(0.08)
            } else if (chance(0.25)) {
                g.particles(e.x, e.y, { count: 3, color: 0xbff0ff, speed: 140, life: 0.25, size: 4 })
                sfx(e, g, 'affixShield', 0.4)
            }
            return 0.5
        },
        update(e, g, dt) {
            if (num(e, 'axShield') > 0 && chance(dt * 4)) {
                const a = rand(0, TAU)
                g.particles(e.x + Math.cos(a) * e.radius * 1.2, e.y + Math.sin(a) * e.radius * 1.2, { count: 1, color: 0x9fe8ff, speed: 20, life: 0.4, size: 4 })
            }
        }
    },
    splitting: {
        id: 'splitting',
        name: 'Splitting',
        color: 0x7dff6a,
        onDeath(e, g) {
            if (NO_SPLIT.has(e.def.id) || e.boss || g.enemyCount > 530) return
            const n = 3
            const off = rand(0, TAU)
            for (let i = 0; i < n; i++) {
                const a = off + (i / n) * TAU
                try {
                    const c = g.spawn(e.def.id, e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, { hpMul: hpMulOf(e) * 0.6 })
                    if (c) {
                        c.scale = 0.6
                        c.ai.axKid = true
                    }
                } catch {
                    // ignore
                }
            }
            g.particles(e.x, e.y, { count: 30, color: 0x7dff6a, speed: 280, life: 0.5, size: 5 })
            sfx(e, g, 'affixSplit', 0.6)
        },
        update(e, g, dt) {
            if (chance(dt * 3)) g.particles(e.x, e.y, { count: 1, color: 0x7dff6a, speed: 60, life: 0.4, size: 4 })
        }
    },
    hasted: {
        id: 'hasted',
        name: 'Hasted',
        color: 0xffe14a,
        apply(e) {
            e.speed *= 1.35
            e.ai.axSprint = rand(2, 4)
        },
        update(e, g, dt) {
            const t = tick(e, 'axSprint', dt)
            if (t <= 0 && t > -dt * 1.5) {
                e.speed *= 1.9
                e.ai.axSprintEnd = 0.9
                g.particles(e.x, e.y, { count: 16, color: 0xffe14a, speed: 220, life: 0.35, size: 4 })
                sfx(e, g, 'affixHaste', 0.5)
            }
            if (num(e, 'axSprintEnd') > 0) {
                if (chance(dt * 30)) g.particles(e.x, e.y, { count: 1, color: 0xfff0a0, speed: 10, life: 0.3, size: e.radius * 0.6 })
                if (tick(e, 'axSprintEnd', dt) <= 0) {
                    // Divide out the sprint so an overlapping speed buff survives
                    e.speed /= 1.9
                    e.ai.axSprint = rand(3.5, 5)
                }
            }
        }
    },
    volatile: {
        id: 'volatile',
        name: 'Volatile',
        color: 0xff7a1a,
        update(e, g, dt) {
            if (chance(dt * 5)) g.particles(e.x + rand(-1, 1) * e.radius * 0.6, e.y - e.radius * 0.5, { count: 1, color: pick([0xff7a1a, 0xffe066]), speed: 70, life: 0.4, size: 4, angle: -Math.PI / 2, spread: 1 })
        },
        onDeath(e, g) {
            const x = e.x
            const y = e.y
            const r = 120 + e.radius * 1.5
            g.telegraphCircle({ x, y, radius: r, delay: 0.9, damage: e.damage * 2, color: 0xff7a1a })
            sfx(e, g, 'affixBlast', 0.7)
            later(0.9, gg => {
                gg.particles(x, y, { count: 44, color: 0xff7a1a, speed: 420, life: 0.6, size: 7 })
                gg.particles(x, y, { count: 20, color: 0xffe066, speed: 240, life: 0.45, size: 5 })
                gg.particles(x, y, { count: 12, color: 0x2b2b38, speed: 140, life: 0.9, size: 8 })
                if (Math.hypot(gg.player.x - x, gg.player.y - y) < gg.view.width) {
                    gg.shake(0.3)
                    gg.sfx.play('explosion', { volume: 0.7, pitch: 0.85 })
                }
            })
        }
    },
    glacial: {
        id: 'glacial',
        name: 'Glacial',
        color: 0x9fe8ff,
        apply(e) {
            e.ai.axNova = rand(2, 3.5)
        },
        update(e, g, dt) {
            if (chance(dt * 4)) {
                const a = rand(0, TAU)
                g.particles(e.x + Math.cos(a) * 60, e.y + Math.sin(a) * 60, { count: 1, color: 0xdff6ff, speed: 30, life: 0.6, size: 4 })
            }
            if (tick(e, 'axNova', dt) > 0 || e.stunT > 0) return
            e.ai.axNova = rand(3.5, 4.5)
            if (!near(e, g, 520)) return
            const x = e.x
            const y = e.y
            g.telegraphCircle({ x, y, radius: 150, delay: 0.9, damage: e.damage * 0.9, color: 0x9fe8ff })
            sfx(e, g, 'frost', 0.45, 0.7)
            later(0.9, gg => {
                if (e.dead) return
                ring(gg, x, y, 10, rand(0, TAU), { speed: 150, damage: e.damage * 0.45, color: 0xbff3ff, radius: 7, kind: 'spike', life: 3 })
                gg.particles(x, y, { count: 30, color: 0xdff6ff, speed: 300, life: 0.45, size: 5 })
                gg.sfx.play('timeSlow', { volume: 0.25, pitch: 1.6 })
            })
        }
    },
    molten: {
        id: 'molten',
        name: 'Molten',
        color: 0xff4a1a,
        update(e, g, dt) {
            if (tick(e, 'axTrail', dt) > 0 || !onScreen(e, g, 60)) return
            e.ai.axTrail = 0.4
            g.telegraphCircle({ x: e.x, y: e.y, radius: 26 + e.radius * 0.4, delay: 0.7, damage: e.damage * 0.35, color: 0xff4a1a })
            g.particles(e.x, e.y + e.radius * 0.5, { count: 3, color: 0xff7a1a, speed: 60, life: 0.5, size: 5 })
        }
    },
    summoner: {
        id: 'summoner',
        name: 'Summoner',
        color: 0xb06bff,
        apply(e) {
            e.ai.axSummon = rand(2, 4)
        },
        update(e, g, dt) {
            if (tick(e, 'axSummon', dt) > 0 || e.stunT > 0) return
            e.ai.axSummon = rand(5.5, 7)
            if (g.enemyCount > 520 || !onScreen(e, g, 160)) return
            const pool = g.time < 300 ? ['bat', 'ghoul'] : g.time < 600 ? ['skull', 'spider', 'ghoul'] : ['skull', 'stalker', 'imp']
            const n = 4
            for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU + rand(0, 0.6)
                const x = e.x + Math.cos(a) * (e.radius + 26)
                const y = e.y + Math.sin(a) * (e.radius + 26)
                summon(g, pick(pool), x, y, hpMulOf(e) * 0.5)
                g.particles(x, y, { count: 10, color: 0xb06bff, speed: 140, life: 0.45, size: 4 })
            }
            sfx(e, g, 'summon', 0.45)
        }
    },
    blinking: {
        id: 'blinking',
        name: 'Blinking',
        color: 0xd08aff,
        apply(e) {
            e.ai.axBlink = rand(2.5, 4)
        },
        update(e, g, dt) {
            if (NO_BLINK.has(e.def.id) || tick(e, 'axBlink', dt) > 0 || e.stunT > 0) return
            e.ai.axBlink = rand(3.5, 5)
            const a = aim(e, g)
            if (a.dist < 200 || a.dist > 900) return
            const ang = a.angle + Math.PI + rand(-1.2, 1.2)
            const r = rand(110, 160)
            g.particles(e.x, e.y, { count: 18, color: 0xd08aff, speed: 200, life: 0.4, size: 5 })
            teleport(e, g.player.x + Math.cos(ang) * r, g.player.y + Math.sin(ang) * r)
            g.particles(e.x, e.y, { count: 22, color: 0xf0d0ff, speed: 240, life: 0.4, size: 5 })
            sfx(e, g, 'blink', 0.55)
        }
    },
    reflective: {
        id: 'reflective',
        name: 'Reflective',
        color: 0xe0e8ff,
        damageTaken(e, g, amount) {
            if (num(e, 'axReflect') > g.time || amount < 1) return 1
            e.ai.axReflect = g.time + 0.7
            const a = aim(e, g)
            shoot(g, e.x + a.nx * e.radius, e.y + a.ny * e.radius, a.angle, { speed: 300, damage: e.damage * 0.5, color: 0xe0e8ff, radius: 7, kind: 'orb', life: 3 })
            g.particles(e.x + a.nx * e.radius, e.y + a.ny * e.radius, { count: 6, color: 0xffffff, speed: 160, life: 0.25, size: 4, angle: a.angle, spread: 1 })
            return 0.85
        }
    },
    berserk: {
        id: 'berserk',
        name: 'Berserk',
        color: 0xff3a3a,
        update(e, g, dt) {
            if (e.ai.axRage === true) {
                if (chance(dt * 12)) g.particles(e.x + rand(-1, 1) * e.radius * 0.6, e.y - e.radius * 0.4, { count: 1, color: 0xff3a3a, speed: 90, life: 0.4, size: 5, angle: -Math.PI / 2, spread: 0.8 })
                return
            }
            if (e.hp > e.maxHp * 0.5) return
            e.ai.axRage = true
            e.speed *= 1.55
            e.damage *= 1.4
            e.scale = 1.12
            g.particles(e.x, e.y, { count: 30, color: 0xff3a3a, speed: 300, life: 0.5, size: 6 })
            sfx(e, g, 'bossRoar', 0.3, 1.8)
        }
    },
    bombardier: {
        id: 'bombardier',
        name: 'Bombardier',
        color: 0xffa040,
        apply(e) {
            e.ai.axMortar = rand(1.5, 3)
        },
        update(e, g, dt) {
            if (tick(e, 'axMortar', dt) > 0 || e.stunT > 0) return
            e.ai.axMortar = rand(2.6, 3.4)
            if (!near(e, g, 700)) return
            const n = g.time > 600 ? 3 : 2
            for (let i = 0; i < n; i++) {
                const tx = g.player.x + g.player.vx * 0.9 + rand(-70, 70)
                const ty = g.player.y + g.player.vy * 0.9 + rand(-70, 70)
                g.telegraphCircle({ x: tx, y: ty, radius: 60, delay: 1.1 + i * 0.15, damage: e.damage * 0.9, color: 0xffa040 })
            }
            g.particles(e.x, e.y - e.radius, { count: 8, color: 0xffa040, speed: 200, life: 0.4, size: 4, angle: -Math.PI / 2, spread: 0.7 })
            sfx(e, g, 'shootHeavy', 0.35, 1.4)
        }
    }
}
