import type { SwingDef, WeaponDef, WeaponId } from './types'

const deg = (d: number) => d * Math.PI / 180

const arc = (reach: number, halfDeg: number) => ({ kind: 'arc' as const, reach, halfAngle: deg(halfDeg) })
const thrust = (reach: number, width: number) => ({ kind: 'thrust' as const, reach, width })

export const WEAPONS: Record<WeaponId, WeaponDef> = {
    sword: {
        id: 'sword',
        name: 'Knight\'s Sword',
        className: 'Knight',
        classTagline: 'Steadfast. Blocks, rallies, holds the line.',
        abilities: [
            { id: 'shieldwall', name: 'Shield Wall', description: 'Raise your shield for 1.5s: everything from the front is blocked, attackers are staggered, thorns are batted back at their owners.', cooldown: 9, icon: 'i-lucide-shield', damage: 0.8 },
            { id: 'rally', name: 'Rallying Cry', description: 'Heal 15% and shout: enemies nearby stagger, and you deal +30% damage for 4s.', cooldown: 14, icon: 'i-lucide-megaphone', damage: 0 }
        ],
        tagline: '3-hit · fast · balanced',
        description: 'Quick, even arcs. The cleave finisher sends them flying.',
        baseDamage: 14,
        comboWindow: 0.45,
        heavy: false,
        color: '#dbe4f3',
        swings: [
            { name: 'Slash', windup: 0.12, active: 0.10, recovery: 0.22, damage: 1.0, shape: arc(76, 70), step: 18, knockback: 120, stagger: 0.25, sweep: 1 },
            { name: 'Backslash', windup: 0.12, active: 0.10, recovery: 0.22, damage: 1.1, shape: arc(76, 70), step: 18, knockback: 120, stagger: 0.25, sweep: -1 },
            { name: 'Cleave', windup: 0.18, active: 0.12, recovery: 0.34, damage: 2.0, shape: arc(90, 88), step: 32, knockback: 320, stagger: 0.55, sweep: 1, finisher: true }
        ],
        extraSwing: { name: 'Riposte', windup: 0.12, active: 0.10, recovery: 0.22, damage: 1.25, shape: arc(80, 74), step: 20, knockback: 140, stagger: 0.28, sweep: -1 },
        special: { kind: 'dash', name: 'Lunge Slash', description: 'Dash through everything in your path, cutting as you go.', cooldown: 5, damage: 2.4 }
    },
    greataxe: {
        id: 'greataxe',
        name: 'Greataxe',
        className: 'Berserker',
        classTagline: 'Reckless. Trades blood for speed and never stops swinging.',
        abilities: [
            { id: 'bloodrage', name: 'Bloodrage', description: '5s of fury: +50% attack speed and 15% lifesteal, but you take 25% more damage.', cooldown: 12, icon: 'i-lucide-flame', damage: 0 },
            { id: 'rendingthrow', name: 'Rending Throw', description: 'Hurl the axe. It carves out, turns, and carves back through everything twice.', cooldown: 9, icon: 'i-lucide-refresh-cw', damage: 1.5 }
        ],
        tagline: '2-hit · slow · massive',
        description: 'Wide, crushing sweeps. Every hit is heavy and breaks shields.',
        baseDamage: 32,
        comboWindow: 0.6,
        heavy: true,
        color: '#c8ccd2',
        swings: [
            { name: 'Sweep', windup: 0.32, active: 0.14, recovery: 0.36, damage: 1.0, shape: arc(100, 95), step: 24, knockback: 240, stagger: 0.45, sweep: 1 },
            { name: 'Reaping Sweep', windup: 0.44, active: 0.16, recovery: 0.50, damage: 1.9, shape: arc(112, 130), step: 44, knockback: 460, stagger: 0.9, sweep: -1, finisher: true }
        ],
        extraSwing: { name: 'Whirl', windup: 0.30, active: 0.14, recovery: 0.30, damage: 1.3, shape: arc(104, 140), step: 26, knockback: 280, stagger: 0.5, sweep: 1 },
        special: { kind: 'slam', name: 'Ground Slam', description: 'Smash the earth. A shockwave staggers everything nearby.', cooldown: 8, damage: 2.6 }
    },
    spear: {
        id: 'spear',
        name: 'Ash Spear',
        className: 'Lancer',
        classTagline: 'Precise. Picks the line, then commits to it.',
        abilities: [
            { id: 'skewer', name: 'Skewer Charge', description: 'Charge 300 units, scooping enemies onto the spear, then slam them into the ground at the end.', cooldown: 10, icon: 'i-lucide-move-right', damage: 2.2 },
            { id: 'javelinrain', name: 'Javelin Rain', description: 'Seven javelins fall on your cursor over a second. Each pierces shields.', cooldown: 13, icon: 'i-lucide-cloud-rain', damage: 1.4 }
        ],
        tagline: '4-hit · long reach · narrow',
        description: 'Keep them at the end of your point. Poor against crowds, deadly in a line.',
        baseDamage: 18,
        comboWindow: 0.5,
        heavy: false,
        color: '#e7d7b8',
        swings: [
            { name: 'Thrust', windup: 0.14, active: 0.10, recovery: 0.24, damage: 1.0, shape: thrust(124, 30), step: 14, knockback: 100, stagger: 0.25, sweep: 0 },
            { name: 'Thrust', windup: 0.14, active: 0.10, recovery: 0.24, damage: 1.0, shape: thrust(124, 30), step: 14, knockback: 100, stagger: 0.25, sweep: 0 },
            { name: 'Double Thrust', windup: 0.14, active: 0.10, recovery: 0.24, damage: 1.25, shape: thrust(136, 34), step: 22, knockback: 130, stagger: 0.3, sweep: 0 },
            { name: 'Piercing Lunge', windup: 0.2, active: 0.14, recovery: 0.36, damage: 2.3, shape: thrust(168, 42), step: 54, knockback: 340, stagger: 0.55, sweep: 0, finisher: true }
        ],
        extraSwing: { name: 'Jab', windup: 0.14, active: 0.10, recovery: 0.22, damage: 1.15, shape: thrust(128, 32), step: 16, knockback: 110, stagger: 0.25, sweep: 0 },
        special: { kind: 'sweep', name: 'Circle Sweep', description: 'A full 360° sweep that clears the space around you.', cooldown: 6, damage: 1.7 }
    },
    daggers: {
        id: 'daggers',
        name: 'Twin Daggers',
        className: 'Assassin',
        classTagline: 'Unseen. Vanishes, repositions, and opens with a killing blow.',
        abilities: [
            { id: 'smokebomb', name: 'Smoke Bomb', description: 'Vanish for 2.5s: enemies lose you. Your next hit is an ambush for 3× damage.', cooldown: 11, icon: 'i-lucide-cloud', damage: 0 },
            { id: 'fanofknives', name: 'Fan of Knives', description: 'Nine knives in a 70° fan, each piercing one enemy.', cooldown: 8, icon: 'i-lucide-layers', damage: 0.7 }
        ],
        tagline: '5-hit · tiny reach · blistering',
        description: 'Get close and never stop moving. The flurry finisher shreds.',
        baseDamage: 10,
        comboWindow: 0.4,
        heavy: false,
        color: '#f1e5c7',
        swings: [
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.10, damage: 1.0, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: 1 },
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.10, damage: 1.0, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: -1 },
            { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.10, damage: 1.05, shape: arc(52, 62), step: 12, knockback: 50, stagger: 0.15, sweep: 1 },
            { name: 'Cross', windup: 0.06, active: 0.07, recovery: 0.10, damage: 1.15, shape: arc(54, 70), step: 14, knockback: 60, stagger: 0.18, sweep: -1 },
            { name: 'Flurry', windup: 0.08, active: 0.10, recovery: 0.20, damage: 2.2, shape: arc(60, 95), step: 26, knockback: 220, stagger: 0.45, sweep: 1, finisher: true }
        ],
        extraSwing: { name: 'Cut', windup: 0.05, active: 0.07, recovery: 0.10, damage: 1.1, shape: arc(54, 66), step: 12, knockback: 55, stagger: 0.16, sweep: -1 },
        special: { kind: 'blink', name: 'Shadowstep', description: 'Blink behind the nearest enemy and open them up.', cooldown: 4, damage: 4.0 }
    },
    warhammer: {
        id: 'warhammer',
        name: 'Warhammer',
        className: 'Juggernaut',
        classTagline: 'Immovable. Shrugs off blows and cracks the earth open.',
        abilities: [
            { id: 'ironskin', name: 'Iron Skin', description: '4s of steel: take 60% less damage and nothing knocks you back.', cooldown: 13, icon: 'i-lucide-shield-half', damage: 0 },
            { id: 'seismic', name: 'Seismic Line', description: 'Split the ground in a line ahead of you: nine eruptions that launch everything they touch.', cooldown: 10, icon: 'i-lucide-mountain', damage: 1.3 }
        ],
        tagline: '2-hit · heavy · crushing',
        description: 'Short, brutal swings that send everything flying. Every hit breaks shields.',
        baseDamage: 32,
        comboWindow: 0.6,
        heavy: true,
        color: '#d8d0c4',
        swings: [
            { name: 'Crush', windup: 0.26, active: 0.12, recovery: 0.30, damage: 1.0, shape: arc(88, 80), step: 26, knockback: 320, stagger: 0.5, sweep: 1 },
            { name: 'Skullbreaker', windup: 0.36, active: 0.14, recovery: 0.44, damage: 2.1, shape: arc(96, 62), step: 40, knockback: 520, stagger: 1.0, sweep: -1, finisher: true }
        ],
        extraSwing: { name: 'Crush', windup: 0.26, active: 0.12, recovery: 0.28, damage: 1.25, shape: arc(90, 84), step: 28, knockback: 340, stagger: 0.55, sweep: -1 },
        special: { kind: 'leap', name: 'Sky Fall', description: 'Leap to your cursor and come down like a meteor.', cooldown: 7, damage: 3.2 }
    },
    scythe: {
        id: 'scythe',
        name: 'Reaper\'s Scythe',
        className: 'Reaper',
        classTagline: 'Inevitable. Marks the doomed and drinks what is left.',
        abilities: [
            { id: 'soulharvest', name: 'Soul Harvest', description: 'Tear the soul from every enemy within reach: damage through shields, each one heals you 4%, and any of them that die in the next 6s rise as spectral allies for 9s.', cooldown: 11, icon: 'i-lucide-ghost', damage: 1.2 },
            { id: 'deathmark', name: 'Death Mark', description: 'Mark the five nearest enemies for 5s: they take +40% damage and burst into hunting souls when they die.', cooldown: 12, icon: 'i-lucide-skull', damage: 0.8 }
        ],
        tagline: '3-hit · enormous arcs · pulls',
        description: 'Sweeping crescents that catch whole crowds. The harvest drags them in.',
        baseDamage: 19,
        comboWindow: 0.5,
        heavy: false,
        color: '#c9d6e3',
        swings: [
            { name: 'Reap', windup: 0.16, active: 0.12, recovery: 0.24, damage: 1.0, shape: arc(112, 120), step: 20, knockback: 150, stagger: 0.3, sweep: 1 },
            { name: 'Reap', windup: 0.16, active: 0.12, recovery: 0.24, damage: 1.05, shape: arc(112, 120), step: 20, knockback: 150, stagger: 0.3, sweep: -1 },
            { name: 'Harvest', windup: 0.24, active: 0.14, recovery: 0.36, damage: 2.0, shape: arc(124, 170), step: 30, knockback: -160, stagger: 0.6, sweep: 1, finisher: true }
        ],
        extraSwing: { name: 'Reap', windup: 0.16, active: 0.12, recovery: 0.22, damage: 1.2, shape: arc(116, 125), step: 22, knockback: 160, stagger: 0.32, sweep: -1 },
        special: { kind: 'whirl', name: 'Reaper\'s Whirl', description: 'Spin for a second, dragging enemies into the blade.', cooldown: 7, damage: 0.55 }
    }
}

export const WEAPON_IDS: WeaponId[] = ['sword', 'greataxe', 'spear', 'daggers', 'warhammer', 'scythe']

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
