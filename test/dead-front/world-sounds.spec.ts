import { describe, expect, it } from 'vitest'
import type { DfAudio, DfSynth } from '../../app/utils/dead-front/context'
import { DF_WORLD_SOUNDS, dfAttackSound, dfDeathSound, dfGroanSound, dfPerkJingleSound } from '../../app/utils/dead-front/world/sound-names'
import { dfAmbienceLoop, registerDfWorldSounds } from '../../app/utils/dead-front/world/sounds/index'
import { parseSeq } from '../../app/utils/dead-front/world/sounds/jingles'
import { DF_ENEMIES } from '#shared/utils/dead-front/enemies'
import { DF_PERK_IDS } from '#shared/utils/dead-front/perks'
import type { DfEnemyType } from '#shared/utils/dead-front/types'

function collect(): Map<string, DfSynth> {
    const names = new Map<string, DfSynth>()
    const audio: DfAudio = {
        ctx: null,
        register: (name, synth) => {
            names.set(name, synth)
        },
        play: () => {},
        loop: () => {},
        stopLoop: () => {}
    }
    registerDfWorldSounds(audio)
    return names
}

describe('dead front world sounds', () => {
    it('registers every world sound name', () => {
        const names = collect()
        for (const name of Object.values(DF_WORLD_SOUNDS)) expect(names.has(name), name).toBe(true)
    })

    it('registers a jingle for every perk', () => {
        const names = collect()
        for (const perk of DF_PERK_IDS) expect(names.has(dfPerkJingleSound(perk)), perk).toBe(true)
    })

    it('registers groan, attack and death for every enemy type', () => {
        const names = collect()
        for (const type of Object.keys(DF_ENEMIES) as DfEnemyType[]) {
            expect(names.has(dfGroanSound(type)), type).toBe(true)
            expect(names.has(dfAttackSound(type)), type).toBe(true)
            expect(names.has(dfDeathSound(type)), type).toBe(true)
        }
    })

    it('registers only functions', () => {
        for (const synth of collect().values()) expect(typeof synth).toBe('function')
        expect(typeof dfAmbienceLoop).toBe('function')
    })

    it('parses sequencer notation', () => {
        const { notes, beats } = parseSeq('A4:1 r:.5 C4+E4:.5! x:.25')
        expect(beats).toBe(2.25)
        expect(notes).toHaveLength(3)
        expect(notes[0]?.freqs[0]).toBeCloseTo(440)
        expect(notes[1]?.freqs).toHaveLength(2)
        expect(notes[1]?.at).toBe(1.5)
        expect(notes[1]?.vel).toBe(1)
        expect(notes[2]?.freqs[0]).toBe(0)
    })
})
