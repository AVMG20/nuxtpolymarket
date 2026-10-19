import type { DfEnemyType, DfPerkId } from '#shared/utils/dead-front/types'
import type { DfAudio, DfSynth } from '../../context'
import { DF_WORLD_SOUNDS, dfAttackSound, dfDeathSound, dfGroanSound, dfPerkJingleSound } from '../sound-names'
import { ambienceSting } from './ambience'
import { bloaterGurgle, bodyFall, bruteStep, climb, flesh, gas, gib, headPop, helmetClang, rise, spit, swipe } from './gore'
import {
    boardRip, boardSlam, boxClose, boxLand, boxMove, boxOpen, boxRoll, debrisCrash, doorOpen
} from './interact'
import { boxJingle, perkJingle } from './jingles'
import {
    eggStep, fuse, fuseInstall, genHum, lever, papReady, papWork, perkBuy, perkHum, power, rodCrackle, rodLever, rodSputter, rodThunder, soul, zap
} from './machines'
import { rt } from './noise'
import type { Rt } from './noise'
import { zombieVoice } from './zombies'
import type { DfVoiceKind } from './zombies'

export { dfAmbienceLoop } from './ambience'

// Every procedural world and zombie sound, keyed by the names in sound-names.ts,
// with a mix level per sound (measured offline so peaks land around 0.3-0.6).

type Recipe = (r: Rt) => void

function synth(recipe: Recipe, level: number): DfSynth {
    return (ctx, out, opts) => {
        const r = rt(ctx, out, opts)
        r.vol *= level
        recipe(r)
    }
}

const WORLD: Record<keyof typeof DF_WORLD_SOUNDS, readonly [Recipe, number]> = {
    ambience: [ambienceSting, 1],
    boardRip: [boardRip, 1.1],
    boardSlam: [boardSlam, 1],
    debrisCrash: [debrisCrash, 0.68],
    doorOpen: [doorOpen, 0.8],
    boxOpen: [boxOpen, 2],
    boxJingle: [boxJingle, 0.9],
    boxRoll: [boxRoll, 2.4],
    boxClose: [boxClose, 0.8],
    boxMove: [boxMove, 1.6],
    boxLand: [boxLand, 0.65],
    papWork: [papWork, 0.65],
    papReady: [papReady, 1.6],
    power: [power, 0.62],
    lever: [lever, 0.7],
    fuse: [fuse, 2],
    fuseInstall: [fuseInstall, 2.8],
    genHum: [genHum, 1.2],
    zap: [r => zap(r), 1.8],
    soul: [soul, 1.7],
    eggStep: [eggStep, 0.85],
    rodLever: [rodLever, 1.1],
    rodCrackle: [rodCrackle, 1.2],
    rodSputter: [rodSputter, 1],
    rodThunder: [rodThunder, 0.9],
    perkBuy: [perkBuy, 0.9],
    perkHum: [perkHum, 1.3],
    helmetClang: [helmetClang, 1.3],
    headPop: [headPop, 1],
    gib: [gib, 0.85],
    bodyFall: [bodyFall, 0.8],
    flesh: [flesh, 0.95],
    swipe: [swipe, 2.8],
    rise: [rise, 0.9],
    spit: [spit, 2],
    gas: [gas, 1.1],
    climb: [climb, 0.8],
    bruteStep: [bruteStep, 1],
    bloaterGurgle: [bloaterGurgle, 0.9]
}

const JINGLE_LEVEL: Record<DfPerkId, number> = {
    ironhide: 0.63,
    quickhand: 0.55,
    twinfire: 0.5,
    secondwind: 0.75,
    fleetfoot: 0.6,
    steadyeye: 0.65
}

const VOICE_LEVEL: Record<DfEnemyType, Record<DfVoiceKind, number>> = {
    shambler: { groan: 0.6, attack: 0.52, death: 0.62 },
    ghoul: { groan: 0.5, attack: 0.55, death: 0.6 },
    brute: { groan: 0.52, attack: 0.5, death: 0.55 },
    bloater: { groan: 0.75, attack: 0.58, death: 0.65 }
}

/** Registers every world, machine, perk-jingle and zombie sound on the engine's audio manager. */
export function registerDfWorldSounds(audio: DfAudio): void {
    for (const key of Object.keys(WORLD) as (keyof typeof DF_WORLD_SOUNDS)[]) {
        const [recipe, level] = WORLD[key]
        audio.register(DF_WORLD_SOUNDS[key], synth(recipe, level))
    }
    for (const perk of Object.keys(JINGLE_LEVEL) as DfPerkId[]) {
        audio.register(dfPerkJingleSound(perk), synth(perkJingle(perk), JINGLE_LEVEL[perk]))
    }
    for (const type of Object.keys(VOICE_LEVEL) as DfEnemyType[]) {
        const lv = VOICE_LEVEL[type]
        audio.register(dfGroanSound(type), synth(zombieVoice(type, 'groan'), lv.groan))
        audio.register(dfAttackSound(type), synth(zombieVoice(type, 'attack'), lv.attack))
        audio.register(dfDeathSound(type), synth(zombieVoice(type, 'death'), lv.death))
    }
}
