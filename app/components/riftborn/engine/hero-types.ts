/*
 * The procedural hero rig contract. Each class supplies one HeroArt: a set
 * of part drawings (baked once into the atlas, a solid white copy too) and
 * the anchor points the rig in hero.ts animates them around.
 *
 * Coordinates are world px with the hero facing right (+x). The rig origin
 * (0, 0) is the middle of the torso; feet stand at about y = +24 and the top
 * of the head sits at about y = -30. Every part is drawn around its own
 * pivot at (0, 0) and must stay inside its box (w x h, centred on 0, 0).
 */
import type { Graphics } from 'pixi.js'

/** Maps a colour; the white bake passes () => 0xffffff, so every fill/stroke colour must go through it */
export type Col = (c: number) => number

export interface HeroPart {
    /** Box size in px, centred on the pivot */
    w: number
    h: number
    draw: (g: Graphics, c: Col) => void
}

export interface HeroArt {
    /** Hangs from its pivot (top centre, at the shoulders) down and back (-x); swings with motion */
    cape: HeroPart
    /** Pivot at the hip, leg hangs down (+y) about 14 px to the sole, foot points +x */
    leg: HeroPart
    /** Pivot at torso centre */
    torso: HeroPart
    /** Pivot at the neck, head drawn above it (-y) */
    head: HeroPart
    /** Pivot at the grip in the hand; the weapon points along +x (the aim direction) */
    weapon: HeroPart
    /** Optional item worn on the back (shield, quiver), pivot at torso centre, drawn behind the torso */
    back?: HeroPart
    /** Where each part's pivot sits relative to the rig origin */
    anchors: {
        cape: [number, number]
        legBack: [number, number]
        legFront: [number, number]
        head: [number, number]
        hand: [number, number]
        back?: [number, number]
    }
    /** A glowing class accent (gem, flame, eyes), in rig coordinates, pulsed additively */
    accent: { x: number, y: number, r: number, color: number, onWeapon?: boolean }
    /** How the weapon animates when the class weapon fires */
    motion: 'swing' | 'draw' | 'cast' | 'reap' | 'float'
    /** Resting weapon angle in radians (0 = pointing forward, negative = up) */
    rest: number
}
