import { describe, expect, it } from 'vitest'
import { dfCrossedSecond } from '../../app/utils/dead-front/engine/cues'
import { dfAmbienceIntensity } from '../../app/utils/dead-front/world/sounds/ambience'

describe('audio cues', () => {
    it('beats each whole second of a countdown once, only in range', () => {
        expect(dfCrossedSecond(3.04, 2.99, 3)).toBe(3)
        expect(dfCrossedSecond(2.99, 2.94, 3)).toBeNull()
        expect(dfCrossedSecond(1.02, 0.97, 3)).toBe(1)
        expect(dfCrossedSecond(0.4, 0, 3)).toBeNull()
        // out of range, counting up, a jump across several marks lands on the last
        expect(dfCrossedSecond(5.02, 4.97, 3)).toBeNull()
        expect(dfCrossedSecond(2.5, 2.6, 3)).toBeNull()
        expect(dfCrossedSecond(3.5, 1.5, 3)).toBe(2)
    })

    it('the night grows louder with the rounds', () => {
        expect(dfAmbienceIntensity(1)).toBe(0)
        expect(dfAmbienceIntensity(10)).toBeCloseTo(9 / 19)
        expect(dfAmbienceIntensity(40)).toBe(1)
    })
})
