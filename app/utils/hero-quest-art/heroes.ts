// The Hero, all sixteen class nodes (asset-list §1.1: fully unique per node, 6 states each).
//
// Every class is the same chibi rookie re-outfitted (chibi.ts): one face throughout, and what
// changes per node is the Look (outfit, weapon, headgear) and every keyframe of Idle, Basic
// Attack, Skill cast, Hit and Death. Tier shows in the gear: base classes are novices in
// hand-me-downs, elites are specialised, masters are unmistakable at a glance.
//
// The classes live one file per line (heroes-warrior.ts, heroes-mage.ts, heroes-archer.ts),
// built from the shared kit in hero-kit.ts. The sixth state, Move, is derived here.

import type { Clip } from './anim'
import { runClip, floatClip, poseOf, type Look } from './rig'
import { WARRIOR_LINE } from './heroes-warrior'
import { MAGE_LINE } from './heroes-mage'
import { ARCHER_LINE } from './heroes-archer'

export interface HeroClips { idle: Clip, attack: Clip, cast: Clip, hit: Clip, death: Clip }
export interface HeroArt { look: Look, clips: HeroClips }

export const HERO_STATES = ['idle', 'attack', 'cast', 'hit', 'death', 'move'] as const
export type HeroState = typeof HERO_STATES[number]

/** Every class node, keyed by its stable content ID. */
export const HERO_ART: Readonly<Record<string, HeroArt>> = {
    ...WARRIOR_LINE,
    ...MAGE_LINE,
    ...ARCHER_LINE
}

/**
 * The class whose art draws a Hero: its own, or the Beginner's for a class with none yet. Only the
 * Ascendant has none, until its art round (`capstone-class.md`); the stand-in stays out of
 * `HERO_ART` so the art catalog shows no duplicate sheet for it.
 */
export function heroArtId(classId: string): string {
    return HERO_ART[classId] ? classId : 'class_beginner'
}

/** The robed caster line hovers on the march; everyone else runs. */
const FLOATERS: ReadonlySet<string> = new Set([
    'class_mage', 'class_wizard', 'class_sorcerer', 'class_shaman', 'class_witch_doctor'
])

/**
 * How each class travels between battles, generated from its own idle rest pose so a marching
 * Hero keeps the stance and weapon he stands in. Kept out of `HeroClips` deliberately: it is
 * derived from a class rather than authored per class, so there is one place to change it.
 */
export const HERO_GAIT: Readonly<Record<string, Clip>> = Object.fromEntries(
    Object.entries(HERO_ART).map(([id, art]) =>
        [id, (FLOATERS.has(id) ? floatClip : runClip)(poseOf(art.clips.idle))])
)
