/*
 * The contract between the three halves of RIFTBORN's client:
 *
 * - the engine (engine/index.ts and everything it owns): PixiJS app, loop,
 *   camera, player, classes, weapons, projectiles, level-up upgrades, pickups,
 *   chests, juice (shake, hit-stop, damage numbers), enemy simulation;
 * - the content (engine/enemies.ts, engine/bosses.ts, engine/director.ts) and
 *   the audio (engine/audio.ts);
 * - the Vue UI (components/riftborn/*.vue): lobby, HUD, level-up cards, chest
 *   reveal, pause and results screens.
 *
 * Everything crosses through the types below. Keep them stable.
 */
import type { Graphics } from 'pixi.js'
import type { RiftbornClassId, RiftbornMetaEffects, RiftbornRunReport } from '#shared/utils/gamelogic/riftborn'

// ─── Audio ───────────────────────────────────────────────────────────────

export type SfxName =
    | 'shoot' | 'shootHeavy' | 'swing' | 'arrow' | 'fire' | 'zap' | 'frost' | 'laser' | 'summon'
    | 'hit' | 'crit' | 'kill' | 'killBig' | 'explosion'
    | 'xp' | 'shard' | 'coin' | 'heal' | 'magnet'
    | 'levelUp' | 'cardReveal' | 'cardSelect' | 'legendary' | 'reroll'
    | 'chestDrop' | 'chestOpen' | 'chestReward'
    | 'hurt' | 'dash' | 'ultimateReady' | 'ultimate' | 'comboUp' | 'streak'
    | 'spawnElite' | 'telegraph' | 'enemyShot' | 'bossWarning' | 'bossRoar' | 'bossDeath'
    | 'victory' | 'defeat' | 'revive'
    | 'uiHover' | 'uiClick' | 'uiBuy' | 'uiError' | 'countTick'
    // Abilities (Q / F / R) and elite affixes
    | 'cast' | 'castHeavy' | 'blink' | 'shield' | 'shieldBreak' | 'nova' | 'timeSlow' | 'gravity'
    | 'beam' | 'quake' | 'turret' | 'abilityReady' | 'abilityUnlock' | 'slotUnlock'
    | 'affixShield' | 'affixVamp' | 'affixSplit' | 'affixHaste' | 'affixBlast'

export interface SfxOptions {
    /** Playback rate / pitch multiplier, 1 = normal */
    pitch?: number
    /** 0..1, multiplied with the master volume */
    volume?: number
    /** -1 (left) .. 1 (right) */
    pan?: number
}

export type MusicMode = 'off' | 'lobby' | 'run' | 'boss' | 'victory' | 'defeat'

export interface Sfx {
    /** Never throws; silently no-ops before the AudioContext is unlocked. */
    play(name: SfxName, opts?: SfxOptions): void
    /** Call from a user gesture (click/keydown) to unlock audio. */
    unlock(): void
    music(mode: MusicMode): void
    /** 0..1: how hectic the fight is, the music thickens with it */
    setIntensity(value: number): void
    setMuted(muted: boolean): void
    readonly muted: boolean
    setVolume(value: number): void
    destroy(): void
}

// ─── Enemies (content ↔ engine) ──────────────────────────────────────────

export interface Enemy {
    readonly uid: number
    readonly def: EnemyDef
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    hp: number
    maxHp: number
    /** Contact damage per hit */
    damage: number
    /** World units per second */
    speed: number
    elite: boolean
    boss: boolean
    /** Spawned by another enemy: no XP, doesn't count toward kills for shards */
    minion: boolean
    dead: boolean
    /** Seconds alive */
    age: number
    /** -1 or 1, which way the sprite faces */
    facing: number
    /** Visual scale multiplier (squash, grow-in), engine animates on top of it */
    scale: number
    /** 0..1 */
    alpha: number
    /** While true, player weapons pass through and contact deals no damage */
    untargetable: boolean
    /** Free-form AI scratch space for the def's update() */
    ai: Record<string, number | boolean | string>
    // Status effects, owned by the engine
    slowT: number
    burnT: number
    stunT: number
    flashT: number
    /** Elite affix ids from ELITE_AFFIXES, empty for non-elites */
    affixes: string[]
}

export interface EnemyDef {
    id: string
    name: string
    hp: number
    speed: number
    damage: number
    radius: number
    xp: number
    /** Knockback resistance, 1 = normal, bosses ~10 */
    mass?: number
    /** Size of the baked texture in px (square), drawing is centred on 0,0 */
    size: number
    /** Number of animation frames baked from draw() */
    frames: number
    /** Frames per second for the animation */
    frameRate: number
    /**
     * Draw one frame centred on 0,0 facing right. `white` = draw every shape
     * solid white (baked once into the hit-flash texture).
     */
    draw(g: Graphics, frame: number, white: boolean): void
    /** Rotate the sprite to its velocity instead of flipping by facing */
    rotate?: boolean
    /** Additive glow colour drawn under the sprite */
    glow?: number
    boss?: boolean
    /** The Rift Heart: killing it wins the run */
    final?: boolean
    /** Called once after spawn */
    init?(e: Enemy, g: GameApi): void
    /** Custom AI. When absent the engine calls g.chase(e, dt). */
    update?(e: Enemy, g: GameApi, dt: number): void
    onDeath?(e: Enemy, g: GameApi): void
}

export interface EnemyShot {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    damage: number
    color: number
    /** Seconds */
    life: number
    kind?: 'orb' | 'arrow' | 'spike' | 'fire'
    /** Homing strength toward the player, 0 = straight */
    homing?: number
}

export interface TelegraphCircle {
    x: number
    y: number
    radius: number
    /** Seconds of warning before it hits */
    delay: number
    damage: number
    color: number
}

export interface TelegraphLine {
    x1: number
    y1: number
    x2: number
    y2: number
    width: number
    delay: number
    damage: number
    color: number
}

export interface ParticleBurst {
    count: number
    color: number
    /** Px per second, default ~200 */
    speed?: number
    /** Seconds, default ~0.5 */
    life?: number
    /** Px, default ~4 */
    size?: number
    /** Radians, centre of the emission cone (default random all around) */
    angle?: number
    /** Radians, cone width (default 2π) */
    spread?: number
}

/** What the engine exposes to enemy AI, bosses and the director. */
export interface GameApi {
    /** Seconds of game time since the run started */
    readonly time: number
    readonly player: { readonly x: number, readonly y: number, readonly vx: number, readonly vy: number, readonly radius: number }
    readonly enemies: readonly Enemy[]
    /** Visible area in world units (camera is centred on the player) */
    readonly view: { readonly width: number, readonly height: number }
    readonly sfx: Sfx
    spawn(defId: string, x: number, y: number, opts?: { elite?: boolean, hpMul?: number, minion?: boolean }): Enemy | null
    /** Live count, for the director's population cap */
    readonly enemyCount: number
    enemyShot(shot: EnemyShot): void
    telegraphCircle(t: TelegraphCircle): void
    telegraphLine(t: TelegraphLine): void
    particles(x: number, y: number, burst: ParticleBurst): void
    /** 0..1-ish, stacks and decays */
    shake(power: number): void
    flash(color: number, alpha: number): void
    /** Big centre-screen text, e.g. 'THE BONE COLOSSUS AWAKENS' */
    announce(text: string, color?: number): void
    /** Default steering toward the player with separation, speedMul on e.speed */
    chase(e: Enemy, dt: number, speedMul?: number): void
    /** Slows the player's movement by `amount` (0..0.8) for `seconds`; the strongest active slow wins */
    slowPlayer?(seconds: number, amount: number): void
    /** Total damage the player has dealt this run (real hits only, not removals) */
    readonly damageDealt?: number
    /** The current biome and the enemy ids it favours */
    readonly biome?: { readonly id: string, readonly index: number, readonly favor: readonly string[] }
    /** True while the player travels between biomes: spawn nothing */
    readonly calm?: boolean
}

export interface Director {
    update(g: GameApi, dt: number): void
}

/**
 * A modifier rolled onto elites (content owns the list in engine/affixes.ts,
 * the engine rolls 1 affix from 2:00, 2 from 7:00, 3 from 12:00, draws the
 * aura in `color` and a name tag, and calls the hooks).
 */
export interface EliteAffix {
    id: string
    /** Shown above the elite, e.g. 'Vampiric' */
    name: string
    color: number
    /** Called once when rolled, may change stats (hp, speed, radius, damage) */
    apply?(e: Enemy, g: GameApi): void
    update?(e: Enemy, g: GameApi, dt: number): void
    /** Multiplier on incoming damage, e.g. shielded 0.5 until broken; return 1 for none */
    damageTaken?(e: Enemy, g: GameApi, amount: number): number
    onHitPlayer?(e: Enemy, g: GameApi): void
    onDeath?(e: Enemy, g: GameApi): void
}

// ─── Engine ↔ Vue UI ─────────────────────────────────────────────────────

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'

export interface UpgradeChoice {
    id: string
    kind: 'weapon' | 'passive' | 'evolution' | 'ability' | 'heal' | 'shards'
    name: string
    description: string
    /** Lucide icon name, e.g. 'i-lucide-flame' */
    icon: string
    rarity: Rarity
    /** Level after taking it */
    level: number
    maxLevel: number
    color: number
    isNew: boolean
}

export interface HudItem {
    id: string
    name: string
    icon: string
    level: number
    maxLevel: number
    color: number
    evolved: boolean
}

export interface HudAbility {
    id: string
    name: string
    icon: string
    color: number
    /** Key label, 'Q' / 'F' / 'R' */
    key: string
    level: number
    maxLevel: number
    /** 0..1 cooldown remaining, 0 = ready */
    cooldown: number
    /** Seconds of cooldown remaining */
    cooldownSeconds: number
    /** True while its effect is running (channels, shields, toggles) */
    active: boolean
    /** Casts stored right now (abilities with extra charges) */
    charges?: number
    maxCharges?: number
    /** Seconds until the next charge comes back, 0 when full */
    rechargeSeconds?: number
}

export interface RunHud {
    hp: number
    maxHp: number
    xp: number
    xpNext: number
    level: number
    /** Seconds */
    time: number
    kills: number
    /** Current combo count, 0 when it lapsed */
    combo: number
    /** 0..1, how long until the combo lapses */
    comboTimer: number
    /** Shard crystals picked up this run (each is 1 Rift XP) */
    shards: number
    /** Rift XP the run has earned so far (riftbornRunXp of the live report) */
    riftXp: number
    weapons: HudItem[]
    passives: HudItem[]
    boss: { name: string, hp: number, maxHp: number } | null
    /** 0..1 */
    dashCooldown: number
    /** 0..1, ready at 1 */
    ultimateCharge: number
    ultimateName: string
    revivals: number
    /** Seconds until the next boss, null when none are left */
    nextBossIn: number | null
    /** Learned abilities, in slot order */
    abilities: HudAbility[]
    /** Ability slots open so far (1 at start, 2 at level 8, 3 at level 18) */
    abilitySlots: number
    /** Player level the next slot opens at, null when all 3 are open */
    nextSlotAt: number | null
    /** Current biome; index 0 is the starting map */
    biome?: RunBiome
}

export interface RunBiome {
    id: string
    name: string
    index: number
}

export interface DamageShare {
    id: string
    name: string
    icon: string
    color: number
    damage: number
    kind: 'weapon' | 'ability' | 'ultimate' | 'other'
}

export interface RunResult extends RiftbornRunReport {
    classId: RiftbornClassId
    weapons: HudItem[]
    passives: HudItem[]
    damageDealt: number
    highestCombo: number
    abilities: HudAbility[]
    /** Damage dealt per source, highest first */
    damageBySource: DamageShare[]
    /** Furthest biome reached */
    biome?: RunBiome
}

export interface EngineEvents {
    /** About 15 times a second */
    onHud(hud: RunHud): void
    /** Engine is paused until choose() or reroll() is called */
    onLevelUp(choices: UpgradeChoice[], rerolls: number): void
    /** Engine is paused until closeChest(); rewards are already applied */
    onChest(rewards: UpgradeChoice[], gold: number): void
    onPause(paused: boolean): void
    onGameOver(result: RunResult): void
}

export interface EngineOptions {
    classId: RiftbornClassId
    meta: RiftbornMetaEffects
    sfx: Sfx
    events: EngineEvents
}

export interface EngineHandle {
    choose(index: number): void
    /** Returns the new choices (also re-sent through onLevelUp) */
    reroll(): void
    closeChest(): void
    /** Cast the ability in slot 0..2 (keyboard Q/F/R is handled by the engine; this is for touch buttons) */
    castAbility(slot: number): void
    pause(): void
    resume(): void
    /** Ends the run now as a defeat (from the pause menu) */
    forfeit(): void
    destroy(): void
}

export type CreateEngine = (container: HTMLElement, options: EngineOptions) => Promise<EngineHandle>
