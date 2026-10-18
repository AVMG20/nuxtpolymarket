import type { DfEnemyType, DfPerkId } from '#shared/utils/dead-front/types'

// Names of every world and zombie sound registered by registerDfWorldSounds
// (sounds/) and played by the world view and the zombie view. One place so the
// three modules agree.

export const DF_WORLD_SOUNDS = {
    /** Looping night ambience (started with audio.loop, synth from sounds/ambience). */
    ambience: 'df:ambience',
    boardRip: 'df:board-rip',
    boardSlam: 'df:board-slam',
    /** Debris/rubble collapsing when a debris door is bought. */
    debrisCrash: 'df:debris-crash',
    /** A wooden door bursting open on its hinges. */
    doorOpen: 'df:door-open',
    boxOpen: 'df:box-open',
    /** Music-box melody while the box rolls (~4 s). */
    boxJingle: 'df:box-jingle',
    /** Weapon cycling clicks while rolling. */
    boxRoll: 'df:box-roll',
    boxClose: 'df:box-close',
    /** The box leaves (chains, creak, mocking chime). */
    boxMove: 'df:box-move',
    /** The box lands at its new spot. */
    boxLand: 'df:box-land',
    /** Pack-a-Punch machine working (~3.5 s of press stamps and dynamo whine). */
    papWork: 'df:pap-work',
    papReady: 'df:pap-ready',
    power: 'df:power-on',
    lever: 'df:lever',
    fuse: 'df:fuse-pickup',
    fuseInstall: 'df:fuse-install',
    /** ~2 s generator hum, replayed back to back while the generator runs. */
    genHum: 'df:gen-hum',
    zap: 'df:zap',
    soul: 'df:soul',
    eggStep: 'df:egg-step',
    perkBuy: 'df:perk-buy',
    /** Machine hum when a perk machine powers up. */
    perkHum: 'df:perk-hum',
    helmetClang: 'df:helmet-clang',
    headPop: 'df:head-pop',
    gib: 'df:gib',
    bodyFall: 'df:body-fall',
    flesh: 'df:flesh-hit',
    swipe: 'df:zombie-swipe',
    rise: 'df:zombie-rise',
    spit: 'df:zombie-spit',
    gas: 'df:gas-hiss',
    climb: 'df:zombie-climb',
    /** The brute's heavy footfall (spatial, play per stomp). */
    bruteStep: 'df:brute-step',
    /** The bloater's gut churning (spatial, an occasional idle sound). */
    bloaterGurgle: 'df:bloater-gurgle'
} as const

/** Short original jingle per perk, played at the machine on purchase. */
export function dfPerkJingleSound(perk: DfPerkId): string {
    return `df:perk-jingle:${perk}`
}

/** Idle groan / moan of one enemy type (spatial, the zombie view plays them at random intervals). */
export function dfGroanSound(type: DfEnemyType): string {
    return `df:groan:${type}`
}

/** Attack screech of one enemy type. */
export function dfAttackSound(type: DfEnemyType): string {
    return `df:attack:${type}`
}

/** Death cry of one enemy type. */
export function dfDeathSound(type: DfEnemyType): string {
    return `df:death:${type}`
}
