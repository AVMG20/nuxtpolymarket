import type { SwingDef, WeaponDef, WeaponId } from './types'

const deg = (d: number) => d * Math.PI / 180

const arc = (reach: number, halfDeg: number) => ({ kind: 'arc' as const, reach, halfAngle: deg(halfDeg) })
const thrust = (reach: number, width: number) => ({ kind: 'thrust' as const, reach, width })

export const WEAPONS: Record<WeaponId, WeaponDef> = {
    sword: {
        id: 'sword',
        name: 'Knight\'s Sword',
        tagline: '3-hit · fast · balanced',
        description: 'Quick, even arcs. The cleave finisher sends them flying.',
        baseDamage: 14,
        comboWindow: 0.45,
        heavy: false,
        color: '#dbe4f3',
        swings: [
            { name: 'Slash', windup: 0.10, active: 0.10, recovery: 0.16, damage: 1.0, shape: arc(76, 70), step: 18, knockback: 120, stagger: 0.25, sweep: 1 },
            { name: 'Backslash', windup: 0.10, active: 0.10, recovery: 0.16, damage: 1.1, shape: arc(76, 70), step: 18, knockback: 120, stagger: 0.25, sweep: -1 },
            { name: 'Cleave', windup: 0.16, active: 0.12, recovery: 0.30, damage: 2.0, shape: arc(90, 88), step: 32, knockback: 320, stagger: 0.55, sweep: 1, finisher: true }
        ],
        extraSwing: { name: 'Riposte', windup: 0.10, active: 0.10, recovery: 0.16, damage: 1.25, shape: arc(80, 74), step: 20, knockback: 140, stagger: 0.28, sweep: -1 },
        special: { kind: 'dash', name: 'Lunge Slash', description: 'Dash through everything in your path, cutting as you go.', cooldown: 5, damage: 2.4 }
    },
    greataxe: {
        id: 'greataxe',
        name: 'Greataxe',
        tagline: '2-hit · slow · massive',
        description: 'Wide, crushing sweeps. Every hit is heavy and breaks shields.',
        baseDamage: 34,
        comboWindow: 0.6,
        heavy: true,
        color: '#c8ccd2',
        swings: [
            { name: 'Sweep', windup: 0.32, active: 0.14, recovery: 0.34, damage: 1.0, shape: arc(100, 105), step: 24, knockback: 240, stagger: 0.45, sweep: 1 },
            { name: 'Reaping Sweep', windup: 0.44, active: 0.16, recovery: 0.50, damage: 1.9, shape: arc(112, 150), step: 44, knockback: 460, stagger: 0.9, sweep: -1, finisher: true }
        ],
        extraSwing: { name: 'Whirl', windup: 0.30, active: 0.14, recovery: 0.30, damage: 1.3, shape: arc(104, 140), step: 26, knockback: 280, stagger: 0.5, sweep: 1 },
        special: { kind: 'slam', name: 'Ground Slam', description: 'Smash the earth. A shockwave staggers everything nearby.', cooldown: 8, damage: 2.6 }
    },
    spear: {
        id: 'spear',
        name: 'Ash Spear',
        tagline: '4-hit · long reach · narrow',
        description: 'Keep them at the end of your point. Poor against crowds, deadly in a line.',
        baseDamage: 17,
        comboWindow: 0.5,
        heavy: false,
        color: '#e7d7b8',
        swings: [
            { name: 'Thrust', windup: 0.10, active: 0.10, recovery: 0.18, damage: 1.0, shape: thrust(124, 30), step: 14, knockback: 100, stagger: 0.25, sweep: 0 },
            { name: 'Thrust', windup: 0.10, active: 0.10, recovery: 0.18, damage: 1.0, shape: thrust(124, 30), step: 14, knockback: 100, stagger: 0.25, sweep: 0 },
            { name: 'Double Thrust', windup: 0.12, active: 0.10, recovery: 0.18, damage: 1.25, shape: thrust(136, 34), step: 22, knockback: 130, stagger: 0.3, sweep: 0 },
            { name: 'Piercing Lunge', windup: 0.18, active: 0.14, recovery: 0.34, damage: 2.3, shape: thrust(168, 42), step: 54, knockback: 340, stagger: 0.55, sweep: 0, finisher: true }
        ],
        extraSwing: { name: 'Jab', windup: 0.10, active: 0.10, recovery: 0.16, damage: 1.15, shape: thrust(128, 32), step: 16, knockback: 110, stagger: 0.25, sweep: 0 },
        special: { kind: 'sweep', name: 'Circle Sweep', description: 'A full 360° sweep that clears the space around you.', cooldown: 6, damage: 1.7 }
    },
    daggers: {
        id: 'daggers',
        name: 'Twin Daggers',
        tagline: '5-hit · tiny reach · blistering',
        description: 'Get close and never stop moving. The flurry finisher shreds.',
        baseDamage: 8,
        comboWindow: 0.4,
        heavy: false,
        color: '#f1e5c7',
        swings: [
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.08, damage: 1.0, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: 1 },
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.08, damage: 1.0, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: -1 },
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.08, damage: 1.05, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: 1 },
            { name: 'Cross', windup: 0.06, active: 0.07, recovery: 0.08, damage: 1.15, shape: arc(54, 70), step: 14, knockback: 60, stagger: 0.18, sweep: -1 },
            { name: 'Flurry', windup: 0.08, active: 0.10, recovery: 0.20, damage: 2.2, shape: arc(60, 95), step: 26, knockback: 220, stagger: 0.45, sweep: 1, finisher: true }
        ],
        extraSwing: { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.08, damage: 1.1, shape: arc(54, 66), step: 12, knockback: 55, stagger: 0.16, sweep: -1 },
        special: { kind: 'blink', name: 'Shadowstep', description: 'Blink behind the nearest enemy and open them up.', cooldown: 4, damage: 4.0 }
    }
}

export const WEAPON_IDS: WeaponId[] = ['sword', 'greataxe', 'spear', 'daggers']

/** The full combo chain for a weapon with `extraHits` "+1 combo hit" stacks. */
export function buildChain(weapon: WeaponDef, extraHits: number): SwingDef[] {
    const chain = weapon.swings.slice(0, -1)
    const finisher = weapon.swings[weapon.swings.length - 1]!
    for (let i = 0; i < extraHits; i++) {
        chain.push({ ...weapon.extraSwing, sweep: (i % 2 === 0 ? weapon.extraSwing.sweep : -weapon.extraSwing.sweep) as 1 | -1 | 0 })
    }
    chain.push(finisher)
    return chain
}
