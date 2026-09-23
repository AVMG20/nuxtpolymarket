import type {
    PirateAbilityId, PirateBossKind, PirateEnemyTier, PiratePowerUpId, PirateRarity
} from '#shared/utils/gamelogic/pirates'

// Pirate Raid engine contract.
//
// The engine is split the same way as SHAPEZZ:
// - sim.ts      PirateSim: the whole game as plain data. No DOM, no canvas,
//               no audio, so a headless balance run can drive it from bun.
// - render.ts   PirateRenderer: reads the sim's state every frame and draws
//               it on a 2D canvas. Owns nothing the sim depends on.
// - ships.ts    Procedural ship drawing, shared by the renderer and the
//               skin/enemy previews on the other Pirate pages.
// - fx.ts       Cached glow sprites and particle helpers for the renderer.
// - pirate-game.ts  PirateGame: the facade the Vue side talks to. Runs the
//               loop, turns pointer/keyboard input into sim orders, drains
//               sim events into the renderer and the sound callback.
//
// World space: x right, y down, angles in radians with 0 = +x (east) and
// positive turning clockwise on screen. Ship-local space: +x is the bow.

// ─── Loadout coming in from the server ──────────────────────────────────────

export interface PirateCannonRuntime {
    slotIndex: number
    tierId: string
    attackRating: number
    maxDamage: number
    reloadMs: number
    range: number
    shotColor: number
    shotTrail: boolean
}

export interface PirateShipStats {
    maxHp: number
    speed: number
    defenseRating: number
    /** Hull repaired per regen cycle, applied only after PIRATE_REGEN_DELAY_MS without taking a hit. */
    regenRate: number
    cannons: PirateCannonRuntime[]
    ammo: number
    gemAmmo: number
    skinId: string
    abilityId: PirateAbilityId
    /** Upgrade level (1-5) of the equipped right-click ability. */
    abilityLevel: number
}

// ─── Sim entities ───────────────────────────────────────────────────────────

export interface Point {
    x: number
    y: number
}

export interface Island {
    x: number
    y: number
    r: number
    /** Seed for the renderer's coastline, palms and rocks. */
    seed: number
    kind: 'tropical' | 'volcanic' | 'ruins' | 'rock'
}

/**
 * One gun mounted on a hull. Every hull (player, allies, enemies) carries its
 * guns as SimGuns so the renderer can draw each barrel where it actually sits,
 * pointing where it is actually aiming.
 */
export interface SimGun {
    /** Ship-local mount position, from pirateGunMounts(). */
    mountX: number
    mountY: number
    /** World-space angle the barrel points at right now. Slews toward its target; guns only fire once roughly on target. */
    aim: number
    /** Barrel colour at the tip (the cannon tier's shotColor for the player). */
    color: number
    /** Barrel length in world units. */
    length: number
    /** Barrel thickness in world units. */
    bore: number
    /** 1 on the frame it fires, decays to 0 over ~180ms; the renderer kicks the barrel back by it. */
    recoil: number
    /** 0..1 reload progress, for a subtle charge glow on long-reload guns. */
    charge: number
    /** Cosmetic style. 'mortar' draws a squat upward tube, 'harpoon' a launcher, 'long' a sniper barrel. */
    style: 'cannon' | 'long' | 'mortar' | 'harpoon' | 'spectral'
    /** Player guns only: the cannon tier id, which drives the tip glow strength. */
    tierId?: string
}

export interface SimPlayer {
    x: number
    y: number
    angle: number
    /** Current forward speed in world units/s, for wake and heel. */
    velocity: number
    hp: number
    maxHp: number
    shield: number
    maxShield: number
    skinId: string
    guns: SimGun[]
    /** ms left of the red damage flash. */
    flashMs: number
    /** ms left of the harpoon tether (slowed). */
    tetherMs: number
    /** Enemy id holding the tether line, for the renderer's rope. */
    tetherFrom: number | null
    /** Hunter's Chain warheads still in orbit. */
    warheads: number
    /** Orbit rotation of those warheads (radians). */
    warheadSpin: number
    /** Active move waypoints (first is the next one). */
    path: Point[]
    /** Enemy the captain ordered an attack on. */
    attackTargetId: number | null
    alive: boolean
}

export type SimEnemyState =
    | 'sailing'
    /** Fire ship: fuse lit, charging the player. */
    | 'burning'
    /** Kraken: below the surface (untargetable, invulnerable). */
    | 'submerged'
    /** Kraken: rising; `stateMs` counts down to 'sailing'. */
    | 'surfacing'
    /** Kraken: sinking back down; counts down to 'submerged'. */
    | 'diving'
    /** Phantom: mid-blink, faded out. */
    | 'blinking'

export interface SimEnemy {
    id: number
    tier: PirateEnemyTier
    x: number
    y: number
    angle: number
    velocity: number
    hp: number
    maxHp: number
    /** Tidecaller ward on this hull. Absorbs damage before hp. */
    shield: number
    defense: number
    attackRating: number
    maxDamage: number
    guns: SimGun[]
    state: SimEnemyState
    stateMs: number
    flashMs: number
    /** ms since spawn; the renderer scales ships in over the first ~400ms. */
    ageMs: number
    /** Summoned by the Phantom Admiral: spectral, fades when the admiral sinks. */
    summoned: boolean
    /** Kraken tentacles currently raised (cosmetic count and positions). */
    tentacles: { x: number, y: number, raise: number }[]
}

/** A ship on its way to the bottom. Kept so the renderer can play the sink. */
export interface SimWreck {
    id: number
    tierId: string | null
    /** 'player' | 'enemy' | 'ally'. */
    side: 'player' | 'enemy' | 'ally'
    x: number
    y: number
    angle: number
    color: number
    sizeScale: number
    skinId?: string
    /** 0..1 over ~1.6s. */
    progress: number
    boss: PirateBossKind | null
}

export interface SimAlly {
    id: number
    kind: 'consort' | 'ghost'
    x: number
    y: number
    angle: number
    velocity: number
    hp: number
    maxHp: number
    guns: SimGun[]
    flashMs: number
    ageMs: number
    /** Station offset around the player (radians). */
    stationAngle: number
}

export type ProjectileKind =
    | 'ball' // player/ally cannonball
    | 'gem' // gem-ammo shot
    | 'titan' // Titan Shot power-up
    | 'enemy' // enemy cannonball
    | 'sniper' // Longshot / Dreadnought sniper round
    | 'spiral' // Phantom spiral shot
    | 'harpoon'
    | 'mine' // drift mine
    | 'bomb' // frenzy bomb (lobbed)
    | 'mortar' // mortar shell (lobbed)
    | 'skiff' // kamikaze skiff
    | 'keg' // player's powder keg (lobbed)
    | 'warhead' // Hunter's Chain warhead
    | 'shell' // Hellfire shell (falls from the sky)

export interface SimProjectile {
    id: number
    kind: ProjectileKind
    owner: 'player' | 'ally' | 'enemy'
    x: number
    y: number
    /** Height above the water for lobbed shots, world units. The renderer offsets the sprite by it and draws a shadow. */
    z: number
    angle: number
    color: number
    /** Radius of the ball in world units (before any z scaling). */
    size: number
    /** 'tier' = tinted trail, 'mutated' = blooming plasma wake (top cannon tiers), 'spectral' = consort/ghost. */
    trail: 'none' | 'smoke' | 'tier' | 'mutated' | 'gem' | 'spectral' | 'fire'
    ageMs: number
}

export type TelegraphKind =
    /** A ring on the water that fills as `ageMs` approaches `durationMs`. */
    | 'circle'
    /** A sniper/harpoon lane from (x,y) to (x2,y2) with `width`. */
    | 'line'
    /** The sniper reticle that tightens onto its point. */
    | 'reticle'

export interface SimTelegraph {
    id: number
    kind: TelegraphKind
    x: number
    y: number
    x2: number
    y2: number
    r: number
    width: number
    color: number
    ageMs: number
    durationMs: number
    /** Enemy (red family) or player ability (the ability's colour). */
    hostile: boolean
}

export type ZoneKind =
    | 'maelstrom' // Kraken's Maw whirlpool (player)
    | 'hellfire' // Hellfire Barrage danger zone (player)
    | 'wave' // Rogue Wave wall of water (player); x,y = centre, angle = travel direction, r = half width
    | 'ink' // Kraken ink cloud: slows and hides
    | 'whirlpool' // Kraken drag vortex (hostile)
    | 'ward' // Tidecaller ward pulse ring

export interface SimZone {
    id: number
    kind: ZoneKind
    x: number
    y: number
    r: number
    angle: number
    ageMs: number
    durationMs: number
}

export interface SimPickup {
    id: number
    kind: 'crate' | 'repair'
    x: number
    y: number
    vx: number
    vy: number
    ageMs: number
    lifespanMs: number
    /** Crates only. */
    powerUpId?: PiratePowerUpId
    rarity?: PirateRarity
}

export interface SimSeaMine {
    id: number
    x: number
    y: number
    ageMs: number
    lifespanMs: number
}

// ─── Events: sim → renderer / sound / HUD ───────────────────────────────────
// Drained once per rendered frame. Everything cosmetic that is a one-off
// (flashes, bursts, numbers, shakes, sounds) travels as an event, so the sim
// never has to know how it looks or sounds.

export type PirateSoundEvent =
    // guns
    | 'cannon' | 'cannon-heavy' | 'cannon-gem' | 'enemy-cannon' | 'titan-fire'
    | 'impact' | 'impact-crit' | 'miss-splash' | 'ship-hit' | 'shield-hit'
    | 'enemy-sunk' | 'boss-sunk' | 'player-sunk'
    // pickups
    | 'crate-spawn' | 'crate-pickup' | 'repair-pickup'
    // hazards
    | 'mine-explode' | 'explosion'
    // player abilities
    | 'keg-throw' | 'keg-explode'
    | 'warhead-launch' | 'warhead-hit'
    | 'consort-summon'
    | 'maelstrom-open' | 'maelstrom-loop-start' | 'maelstrom-loop-stop'
    | 'hellfire-call' | 'hellfire-impact'
    | 'wave-roll'
    | 'lightning'
    | 'ability-ready'
    // enemy abilities
    | 'sniper-charge' | 'sniper-fire'
    | 'harpoon-fire' | 'harpoon-hit'
    | 'mortar-launch'
    | 'bomb-throw'
    | 'skiff-launch'
    | 'ward-cast'
    | 'fireship-ignite'
    // bosses
    | 'boss-horn' | 'kraken-roar' | 'tentacle-slam' | 'kraken-dive' | 'ink-splash'
    | 'phantom-blink' | 'phantom-spiral' | 'phantom-summon'
    // voyage + UI
    | 'low-hull' | 'voyage-start' | 'voyage-complete' | 'defeat' | 'menu'

export interface SoundOptions {
    /** World x, for stereo pan. */
    x?: number
    /** 0..1+ loudness/size hint (cannon tier, blast radius, crate rarity index...). */
    intensity?: number
}

export type SimEvent =
    | { type: 'muzzle', x: number, y: number, angle: number, color: number, size: number }
    | { type: 'impact', x: number, y: number, color: number, heavy: boolean }
    | { type: 'explosion', x: number, y: number, r: number, color: number, heavy: boolean }
    | { type: 'splash', x: number, y: number, size: number }
    | { type: 'popup', x: number, y: number, text: string, color: number, big: boolean }
    | { type: 'lightning', points: Point[], color: number }
    | { type: 'shockwave', x: number, y: number, r: number, color: number }
    | { type: 'burst', x: number, y: number, color: number, count: number }
    | { type: 'heal', x: number, y: number, amount: number }
    | { type: 'shake', amount: number }
    | { type: 'move-marker', x: number, y: number }
    | { type: 'sound', sound: PirateSoundEvent, options?: SoundOptions }

// ─── HUD + callbacks to the Vue side ────────────────────────────────────────

export interface PirateHudPowerUp {
    id: PiratePowerUpId
    stacks: number
}

export interface PirateHudBoss {
    id: number
    name: string
    kind: PirateBossKind
    hp: number
    maxHp: number
    shield: number
    /** Kraken below the surface, Phantom mid-blink. */
    hidden: boolean
}

/** Pushed to the Vue side ~10 times a second while a voyage runs. */
export interface PirateHudState {
    elapsedMs: number
    remainingMs: number
    hp: number
    maxHp: number
    shield: number
    maxShield: number
    /** Survival pay banked so far (display; the server computes the real figure). */
    coins: number
    /** Current pay rate, coins per second. */
    coinRate: number
    ammo: number
    gemAmmo: number
    preferGem: boolean
    ability: {
        id: PirateAbilityId
        level: number
        remainingMs: number
        totalMs: number
        /** Consort: escort still afloat, so the cooldown hasn't started. */
        locked: boolean
        ready: boolean
    }
    powerUps: PirateHudPowerUp[]
    kills: number
    enemiesAfloat: number
    bosses: PirateHudBoss[]
    tethered: boolean
    nextCrateMs: number
}

export interface PirateAnnouncement {
    kind: 'boss' | 'crate' | 'upgrade' | 'repair' | 'warning'
    title: string
    subtitle?: string
    rarity?: PirateRarity
    bossKind?: PirateBossKind
    powerUpId?: PiratePowerUpId
}

export interface PirateGameOverResult {
    survived: boolean
    /** Display only — the server derives the payout from elapsed time and difficulty. */
    coins: number
    elapsedMs: number
    ammoUsed: number
    gemAmmoUsed: number
    kills: number
    bossesSunk: number
    shotsFired: number
    abilitiesUsed: number
    damageDealt: number
    sunkByType: { id: string, name: string, count: number }[]
    powerUps: PirateHudPowerUp[]
    reason: 'timeout' | 'defeat' | 'cancelled'
    /** 0 (pristine) to 1 (sunk) — drives how long the ship spends in dry dock afterward. */
    hullDamageFraction: number
}

export interface PirateGameCallbacks {
    onHud: (hud: PirateHudState) => void
    onGameOver: (result: PirateGameOverResult) => void
    onAnnounce?: (announcement: PirateAnnouncement) => void
    onSound?: (sound: PirateSoundEvent, options?: SoundOptions) => void
}
