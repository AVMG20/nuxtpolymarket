import type * as THREE from 'three'
import type { Vec3 } from '#shared/utils/dead-front/types'

// Client-side contract between the engine (owner: engine agent) and the
// modules other agents build: world + zombies (map agent) and viewmodel +
// weapon models + projectiles (weapons agent). Changes must stay additive.

export type DfFxPreset
    = | 'blood' // bullet hit on flesh, spray along normal
        | 'blood-mist' // headshot pop
        | 'gib' // chunky bits on explosive / pap kills
        | 'sparks' // bullet on metal
        | 'dust' // bullet on stone / plaster / mud
        | 'splinters' // bullet on wood, board torn off
        | 'muzzle-smoke'
        | 'smoke'
        | 'explosion'
        | 'electric' // arcs, reload shock, generator
        | 'ray' // X-Ray bolt impact (green)
        | 'pap' // Pack-a-Punch glow sparks (violet)
        | 'powerup' // golden shimmer
        | 'gas' // bloater cloud puffs (sickly green)
        | 'soul' // wisp flying to the generator
        | 'embers'

export interface DfFxOpts {
    normal?: Vec3 | THREE.Vector3
    count?: number
    color?: THREE.ColorRepresentation
    scale?: number
}

export interface DfFx {
    burst(preset: DfFxPreset, pos: Vec3 | THREE.Vector3, opts?: DfFxOpts): void
    /** Thin bright streak from muzzle to impact. */
    tracer(from: Vec3 | THREE.Vector3, to: Vec3 | THREE.Vector3, color?: THREE.ColorRepresentation): void
    /** Lightning bolt polyline (wunderweapon, reload shock). */
    lightning(from: Vec3 | THREE.Vector3, to: Vec3 | THREE.Vector3, color?: THREE.ColorRepresentation): void
    /** `scale` multiplies the kind's size (default 1; scorches are 2-2.8 m across). */
    decal(pos: Vec3 | THREE.Vector3, normal: Vec3 | THREE.Vector3, kind: 'bullet' | 'scorch' | 'blood', scale?: number): void
    /** Short-lived point light from a pool (muzzle flashes, explosions). */
    flash(pos: Vec3 | THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, seconds: number): void
    /** Camera shake, 0..1 trauma added. */
    shake(amount: number): void
}

export interface DfSoundOpts {
    /** World position for spatialised sounds; omit for 2D (UI, own weapon). */
    pos?: Vec3 | THREE.Vector3
    volume?: number
    rate?: number
}

/**
 * A procedural sound recipe. Builds and starts nodes into `out`; must stop them itself.
 * The engine applies `opts.volume` and the spatial panner on `out`, so recipes only
 * need `opts.rate` (pitch variation); applying volume again would square it.
 */
export type DfSynth = (ctx: AudioContext, out: AudioNode, opts: DfSoundOpts) => void

export interface DfAudio {
    readonly ctx: AudioContext | null
    register(name: string, synth: DfSynth): void
    play(name: string, opts?: DfSoundOpts): void
    /** Looping ambience / music bed handles. */
    loop(name: string, synth: (ctx: AudioContext, out: AudioNode) => () => void): void
    stopLoop(name: string): void
}

export interface DfRenderContext {
    renderer: THREE.WebGLRenderer
    /** World scene, rendered with `camera`. */
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    /** Viewmodel scene, rendered after clearing depth with `vmCamera` (narrow FOV). Lit separately. */
    vmScene: THREE.Scene
    vmCamera: THREE.PerspectiveCamera
    fx: DfFx
    audio: DfAudio
    /** 'low' on weak GPUs; modules may skip extras. */
    quality: 'low' | 'high'
}

// ---------------------------------------------------------------- module APIs
// The engine imports these factories by exact path and name:
//   world (map agent):     app/utils/dead-front/world/index.ts   -> createDfWorldView, createDfZombieView, registerDfWorldSounds
//   weapons (weapons agent): app/utils/dead-front/weapons/index.ts -> createDfViewmodel, createDfProjectileView, buildDfWeaponModel, registerDfWeaponSounds

/** Static map + live interactable state (doors, boards, box, PaP, perks, power, egg). */
export interface DfWorldView {
    /** Called every frame with the latest world snapshot and the match clock. */
    update(dt: number, world: import('#shared/utils/dead-front/protocol').DfWorldSnap, time: number): void
    /** One-shot reactions to server events (door opening, board torn, box open, power on...). */
    onEvent(ev: import('#shared/utils/dead-front/protocol').DfEvent): void
    /** Meshes the client bullets should collide with for impact FX are NOT needed: use dfRaycast on the shared collision world. */
    dispose(): void
}

/** Zombies, already interpolated by the engine. */
export interface DfZombieView {
    update(dt: number, zombies: readonly import('#shared/utils/dead-front/protocol').DfZombieSnap[]): void
    /** Hit / kill reactions: flinch, blood, headshot pop, gib, death animation (the snap stops listing a dead zombie; the view keeps a corpse animating out). */
    onEvent(ev: import('#shared/utils/dead-front/protocol').DfEvent): void
    /**
     * Optional: undo a kill the engine predicted but the server didn't take
     * (a refused shot). Forget the death so the next frames show the zombie
     * again. Rare by design: the server honours kill claims.
     */
    unkill?(id: number): void
    /**
     * Optional: the round's last few zombies (ids; empty when not in the final
     * stretch). The view makes them easy to find, e.g. a glow that reads
     * through the dark. Called whenever the set changes.
     */
    highlight?(ids: readonly number[]): void
    dispose(): void
}

export interface DfViewmodelInput {
    /** 0..1 horizontal speed relative to sprint speed. */
    speed: number
    sprinting: boolean
    crouching: boolean
    grounded: boolean
    /** Mouse delta this frame in pixels, for sway. */
    look: { x: number, y: number }
    /** Wants to aim; the viewmodel eases its own ADS blend using the weapon's adsTime / effects.adsMult. */
    ads: boolean
    adsMult: number
}

export interface DfViewmodelWeapon {
    id: import('#shared/utils/dead-front/types').DfWeaponId
    pap: number
    attachments: import('#shared/utils/dead-front/types').DfAttachmentChoice
}

export interface DfViewmodel {
    /** Already added to ctx.vmScene by the factory. */
    readonly root: THREE.Object3D
    /** Current ADS blend 0..1 (the engine lerps camera FOV with it). */
    readonly adsBlend: number
    /** Swap to a weapon with a raise animation; returns the raise time in seconds. */
    equip(w: DfViewmodelWeapon, swapMult: number): number
    /** Play a shot: recoil kick, muzzle flash, smoke, shell ejection, slide/bolt motion. */
    fire(): void
    /** Animate a reload over exactly `seconds` (per-shell weapons: one shell per call when `shell` is true). */
    reload(empty: boolean, seconds: number, shell?: boolean): void
    cancelReload(): void
    melee(): void
    /** Downed: lower to the pistol last-stand pose. */
    setDowned(down: boolean): void
    /** Muzzle position in WORLD space (the engine passes the world camera), for tracers. */
    muzzleWorld(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3
    update(dt: number, input: DfViewmodelInput): void
    dispose(): void
}

export interface DfProjectileView {
    update(dt: number, projectiles: readonly import('#shared/utils/dead-front/protocol').DfProjectileSnap[]): void
    onEvent(ev: import('#shared/utils/dead-front/protocol').DfEvent): void
    dispose(): void
}

// Also exported from weapons/index.ts (weapons agent):
//   dfShotSoundName(weapon: DfWeaponId, pap: number): string  -> sound name the engine plays for remote shots
